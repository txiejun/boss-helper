import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const extension = resolve(process.argv[2] ?? '.output/chrome-mv3')
const profile = await mkdtemp(join(tmpdir(), 'boss-helper-smoke-'))
const chrome = spawn(
  process.env.BOSS_HELPER_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
const errors = [],
  contexts = [],
  requests = []
let ws,
  sequence = 0,
  options,
  page
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(Error(`CDP timeout: ${method}`))
    }, 15000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
const evaluate = async (session, expression) => {
  const result = await call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    session,
  )
  if (result.exceptionDetails)
    throw Error(
      result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description,
    )
  return result.result.value
}
const attach = async (targetId) => {
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  await call('Runtime.enable', {}, sessionId)
  return sessionId
}
const eventually = async (fn, label, timeout = 18000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn()) return
    await sleep(150)
  }
  throw Error(`Timed out: ${label}`)
}
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="header"></div><div id="wrap"><div class="page-job-wrapper"></div><div class="page-jobs"><div class="page-jobs-main"></div></div></div><script>
window._PAGE={uid:123,userId:123,encryptUserId:'mock-user',name:'测试用户',showName:'测试用户'};
window.Cookie={get:()=> 'mock-session'};
const jobs=[1,2].map(i=>({encryptJobId:'job-'+i,encryptBossId:'hr-'+i,encryptBrandId:'brand-'+i,jobName:'测试岗位'+i,jobExperience:'5-10年',jobDegree:'本科',salaryDesc:'30-50K',cityName:'测试城市',bossName:'测试招聘者',bossTitle:'HR',bossCert:1,bossAvatar:'',brandName:'测试公司',brandLogo:'',brandScaleName:'100-499人',brandIndustry:'软件',jobLabels:[],skills:[],welfareList:[],lid:'lid-'+i,securityId:'mock-security-'+i,lastModifyTime:Date.now(),contact:false}));
const vm={jobList:jobs,pageVo:{page:1,pageSize:15},hasMore:false,jobDetail:null,searchJobAction(){},onSearch(){},clickJobCardAction(item){this.jobDetail={lid:item.lid,bossInfo:{bossSource:0,bossOnline:true,certificated:true,activeTimeDesc:'今日活跃'},brandComInfo:{activeTime:Date.now(),labels:[],introduce:'',stageName:''},jobInfo:{postDescription:'测试岗位职责',locationName:'测试城市',address:'测试地址',longitude:1,latitude:1}}}};
document.querySelector('#wrap').__vue__={$route:{path:'/web/geek/jobs'},$router:{afterHooks:[]}};
// The app root and layout exist before the route's job component mounts.
document.querySelector('.page-job-wrapper').__vue__={};
setTimeout(()=>{document.querySelector('.page-jobs-main').__vue__=vm},1500);
</script></body></html>`
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(Error('Browser startup timed out')), 15000)
    chrome.stderr.on('data', (bytes) => {
      output += bytes
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    chrome.once('exit', () => reject(Error('Browser exited before debugging became available')))
  })
  ws = new WebSocket(endpoint)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  ws.addEventListener('message', (event) => {
    const m = JSON.parse(event.data)
    if (m.id) {
      const p = pending.get(m.id)
      if (p) {
        clearTimeout(p.timer)
        pending.delete(m.id)
        if (m.error) p.reject(m.error)
        else p.resolve(m.result)
      }
      return
    }
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(
        m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text,
      )
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
    if (m.method === 'Runtime.executionContextCreated')
      contexts.push({ ...m.params.context, session: m.sessionId })
    if (m.method === 'Fetch.requestPaused') {
      void (async () => {
        const r = m.params
        const url = new URL(r.request.url)
        requests.push(url.pathname)
        let body = '{}',
          type = 'application/json'
        if (r.resourceType === 'Document' && url.hostname === 'www.zhipin.com') {
          body = fixture
          type = 'text/html'
        } else if (url.pathname.endsWith('/friend/add.json'))
          body = JSON.stringify({
            code: 1,
            zpData: { bizData: { chatRemindDialog: { content: '操作过于频繁，请稍后再试' } } },
          })
        else if (url.pathname.endsWith('net-conf.json'))
          body = JSON.stringify({ version: '0.5.2.2', notification: [], feedback: '' })
        await call(
          'Fetch.fulfillRequest',
          {
            requestId: r.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: type }],
            body: Buffer.from(body).toString('base64'),
          },
          m.sessionId,
        )
      })().catch((e) => errors.push(String(e)))
    }
  })
  const { id } = await call('Extensions.loadUnpacked', { path: extension })
  const target = await call('Target.createTarget', { url: `chrome-extension://${id}/options.html` })
  options = await attach(target.targetId)
  await eventually(
    () => evaluate(options, `document.body.innerText.includes('管理模型与密钥')`),
    'extension options renders',
  )
  const manifest = await evaluate(options, `chrome.runtime.getManifest()`)
  assert.ok(
    manifest.host_permissions.includes('https://*/*'),
    'Chrome all-sites access is available',
  )
  assert.ok(
    manifest.content_scripts.every((s) => s.matches.every((m) => m.includes('zhipin.com/'))),
    'content scripts remain limited to BOSS',
  )
  await evaluate(
    options,
    `chrome.storage.local.set({'web-geek-job-FormData':{delayDeliveryStarts:0,delayDeliveryInterval:0,delayDeliveryPageNext:0,activityFilter:{value:false}}})`,
  )
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
  page = await attach(targetId)
  await call('Page.enable', {}, page)
  await call('Fetch.enable', { patterns: [{ urlPattern: 'https://*/*' }] }, page)
  await call('Page.navigate', { url: 'https://www.zhipin.com/web/geek/jobs' }, page)
  await eventually(
    () =>
      evaluate(
        page,
        `!!document.querySelector('boss-helper-job')?.shadowRoot?.textContent.includes('开始')`,
      ),
    'isolated UI renders',
  )
  await evaluate(
    page,
    `[...document.querySelector('boss-helper-job').shadowRoot.querySelectorAll('button')].find(b=>b.textContent.trim()==='开始').click()`,
  )
  await eventually(
    () =>
      evaluate(
        page,
        `document.querySelector('boss-helper-job')?.shadowRoot?.textContent.includes('操作过于频繁')`,
      ),
    'rate limit is shown',
  )
  const journal = await evaluate(
    options,
    `chrome.storage.local.get('delivery-journal-v2').then(r=>r['delivery-journal-v2'])`,
  )
  assert.equal(
    requests.filter((p) => p.endsWith('/friend/add.json')).length,
    1,
    'rate-limited batch must send only one request',
  )
  assert.equal(journal.length, 1)
  assert.equal(journal[0].status, 'failed')
  assert.equal(journal[0].stage, 'contact')
  assert.equal(errors.length, 0, `Browser exceptions: ${errors.join('\n')}`)
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          'extension-owned settings renders',
          'isolated BOSS UI renders',
          'delayed job component renders despite an earlier layout wrapper',
          'all-sites permission declared; content scripts restricted to BOSS',
          'rate limit halts batch after one POST',
          'action journal persists failure',
        ],
        requests: requests.filter((p) => p.startsWith('/wapi/')),
        browserErrors: errors,
      },
      null,
      2,
    ),
  )
} catch (e) {
  console.error(e)
  console.error(
    JSON.stringify(
      {
        errors,
        contexts: contexts.map((c) => ({ name: c.name, origin: c.origin, session: c.session })),
        requests,
      },
      null,
      2,
    ),
  )
  if (page)
    console.error(
      'page',
      await evaluate(
        page,
        `({body:document.documentElement.outerHTML.slice(-6000),extension:document.querySelector('boss-helper-job')?.shadowRoot?.textContent.slice(-5000)})`,
      ).catch(() => null),
    )
  if (options)
    console.error('options', await evaluate(options, `document.body.innerText`).catch(() => null))
  process.exitCode = 1
} finally {
  ws?.close()
  chrome.kill()
  await sleep(300)
  await rm(profile, { recursive: true, force: true })
}
