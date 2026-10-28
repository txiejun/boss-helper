import { defineUnlistedScript } from '#imports'
import { getBossPageRootVue } from '@/composables/useVue'
import { findJobComponent, waitForJobComponent } from '@/platform/pageComponent'
import { redact } from '@/reliability/core'

import { GeekChatClientManager } from './chat'
import {
  getBossData,
  sendPublishReq,
  uploadImage,
  cancelPageOperations,
  beginPageOperations,
  assertPageActive,
} from './requests'

const CHANNEL = 'boss-helper-page-v2'
export default defineUnlistedScript(async () => {
  let chat: GeekChatClientManager | undefined
  let busy = false
  let runAccount = ''
  let lastMid = 0
  const component = () => {
    const vm = findJobComponent()
    if (!vm) throw new Error('未找到 BOSS 岗位组件，请刷新页面')
    return vm
  }
  const clean = (value: any) => JSON.parse(JSON.stringify(value ?? null))
  window.addEventListener('message', async (event) => {
    const m = event.data
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      m?.channel !== CHANNEL ||
      m.direction !== 'request' ||
      typeof m.id !== 'string' ||
      !m.args ||
      typeof m.args !== 'object'
    )
      return
    const reply = (result?: any, error?: any) =>
      window.postMessage(
        { channel: CHANNEL, direction: 'response', id: m.id, result, error },
        location.origin,
      )
    const mutating = ['contact', 'message', 'page', 'detail'].includes(m.operation)
    if (mutating && busy) {
      reply(undefined, { message: '另一项页面操作正在执行', fatal: true })
      return
    }
    try {
      if (mutating) busy = true
      const a = m.args
      if (
        ['contact', 'message', 'boss'].includes(m.operation) &&
        (!runAccount || runAccount !== window._PAGE?.encryptUserId)
      )
        throw Object.assign(new Error('当前账号与运行账号不一致，请重新启动'), { fatal: true })
      let result: any
      switch (m.operation) {
        case 'snapshot': {
          await getBossPageRootVue()
          const vm = await waitForJobComponent()
          result = {
            jobList: vm.jobList,
            pageVo: vm.pageVo,
            hasMore: vm.hasMore,
            jobDetail: vm.jobDetail,
            user: {
              encryptUserId: window._PAGE?.encryptUserId,
              showName: window._PAGE?.showName,
              name: window._PAGE?.name,
              largeAvatar: window._PAGE?.largeAvatar,
              tinyAvatar: window._PAGE?.tinyAvatar,
            },
          }
          break
        }
        case 'begin':
          if (!a.account || a.account !== window._PAGE?.encryptUserId)
            throw Object.assign(new Error('账号未就绪'), { fatal: true })
          runAccount = a.account
          beginPageOperations()
          break
        case 'cancel':
          runAccount = ''
          cancelPageOperations()
          chat?.disconnect()
          chat = undefined
          break
        case 'page': {
          if (!Number.isInteger(a.page) || a.page < 1 || a.page > 10000)
            throw new Error('翻页参数无效')
          const vm = component()
          const fn =
            location.pathname.includes('job-recommend') || location.pathname.includes('/geek/jobs')
              ? (vm.searchJobAction ?? vm.onSearch)
              : vm.pageChangeAction
          if (typeof fn !== 'function') throw new Error('未找到翻页方法')
          await fn.call(vm, a.page)
          break
        }
        case 'detail': {
          if (!a.item?.encryptJobId || !a.item?.lid) throw new Error('岗位参数缺失')
          const vm = component()
          vm.clickJobCardAction(a.item)
          const started = Date.now()
          while (Date.now() - started < 15000) {
            if (vm.jobDetail?.lid === a.item.lid) {
              result = vm.jobDetail
              break
            }
            await new Promise((r) => setTimeout(r, 100))
          }
          if (!result) throw new Error('岗位详情超时')
          break
        }
        case 'contact': {
          if (typeof a.securityId !== 'string' || typeof a.encryptJobId !== 'string')
            throw new Error('投递参数缺失')
          result = await sendPublishReq(a)
          break
        }
        case 'boss': {
          if (typeof a.securityId !== 'string' || typeof a.encryptUserId !== 'string')
            throw new Error('招聘者参数缺失')
          result = await getBossData(a)
          break
        }
        case 'message': {
          const job = a.job
          if (!job?.boss?.data?.bossId || !job?.detail?.bossInfo || !job?.jobitem?.encryptBossId)
            throw new Error('聊天目标缺失')
          if (!chat) chat = new GeekChatClientManager()
          await chat.connect()
          const stanza = {
            uid: Number(job.boss.data.bossId),
            friendSource: job.detail.bossInfo.bossSource ?? 0,
            encryptUid: job.jobitem.encryptBossId,
            encryptGid: '',
            clientMid: (lastMid = Math.max(lastMid + 1, Date.now() * 1000)),
          }
          let message
          if (
            a.message?.type === 'text' &&
            typeof a.message.text === 'string' &&
            a.message.text.trim()
          ) {
            message = chat.msgBuilder.createTextMessage(stanza, { text: a.message.text })
          } else if (a.message?.type === 'image' && Array.isArray(a.message.file?.buffer)) {
            const f = a.message.file
            const file = new File([new Uint8Array(f.buffer)], String(f.name), {
              type: String(f.type),
            })
            const img = await uploadImage(job.boss.data.securityId, file)
            message = chat.msgBuilder.createImageMessage(stanza, { content: { iid: 0, ...img } })
          } else throw new Error('消息内容无效')
          assertPageActive()
          await chat.publish(chat.msgBuilder.encode(message))
          break
        }
        default:
          throw new Error('页面操作不在允许列表')
      }
      reply(clean(result))
    } catch (e) {
      reply(undefined, {
        message: redact(e),
        fatal: (e as any)?.fatal === true,
        uncertain:
          (e as any)?.uncertain === true || (m.operation === 'message' && !(e as any)?.fatal),
      })
    } finally {
      if (mutating) busy = false
    }
  })
  window.addEventListener(
    'pagehide',
    () => {
      cancelPageOperations()
      chat?.disconnect()
    },
    { once: true },
  )
})
