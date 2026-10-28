import { ref } from 'vue'

import { appearanceConf, useConf } from '@/composables/conf'
import type { WorkflowData } from '@/composables/useApplying/type'
import { createLazyObject, isInitialized } from '@/composables/useApplying/type'
import type { JobData } from '@/composables/useHelper'
import { HelperContext } from '@/composables/useHelper'
import type { AlertItem, ConfigAccordionItem } from '@/composables/useHelper/type'
import type { BoosJobData } from '@/entrypoints/boss/delivery'
import { bossWorkflow } from '@/entrypoints/boss/delivery'
import type { BossZpDetailData, BossZpJobItemData } from '@/entrypoints/boss/types'
import { run } from '@/index'
import { counter } from '@/message'
import { pageCall, pageInfo, disposePageBridge } from '@/platform/bridge'
import { getRootVue, useHookVueData, useHookVueFn } from '@/platform/bridge'
import type { FormDataInput } from '@/types/formData'
import elmGetter from '@/utils/elmGetter'
import { logger } from '@/utils/logger'

function removeAd() {
  // 新职位发布时通知我
  void elmGetter.rm('.job-list-wrapper .subscribe-weixin-wrapper')
  // 侧栏
  void elmGetter.rm('.job-side-wrapper')
  // 侧边悬浮框
  void elmGetter.rm('.side-bar-box')
  // 搜索栏登录框
  void elmGetter.rm('.go-login-btn')
  // 底部页脚
  // elmGetter.rm("#footer-wrapper");

  // 新版: 微信扫码
  void elmGetter.rm('.c-subscribe-weixin')
  // 新版: 求职工具
  void elmGetter.rm('.c-job-tools.job-tools')
  // 新版: 热门职位
  void elmGetter.rm('.c-hot-link.hot-link')
  // 新版: 面包屑
  void elmGetter.rm('.c-breadcrumb')
  // 新版: 职位详情页的引导(想要什么工作)
  void elmGetter.rm('.job-detail-container .job-detail-guide-cont')
}

const initChange = useHookVueFn('#wrap .page-job-wrapper', 'pageChangeAction')
const initSearch = useHookVueFn('#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main', [
  'searchJobAction',
  'onSearch',
])

function formatActiveTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const day = 24 * 60 * 60 * 1000

  if (diff < day) return '今日活跃'
  if (diff < 2 * day) return '昨日活跃'
  if (diff < 7 * day) return '本周活跃'
  if (diff < 30 * day) return '本月活跃'
  return '较久未活跃'
}

function convertBossZpJobItemToJobData(item: BossZpJobItemData): JobData {
  const key = `boss::${item.encryptJobId}`

  return {
    key,
    jobId: item.encryptJobId,
    hrId: item.encryptBossId,
    companyId: item.encryptBrandId,
    link: `https://www.zhipin.com/job_detail/${item.encryptJobId}.html`,
    jobName: item.jobName,
    positionName: item.jobName,
    jobDescription: '',

    // 经验和学历要求 - 从 jobLabels 中解析或直接使用
    experienceName: item.jobExperience || item.jobLabels?.[0] || '经验不限',
    degreeName: item.jobDegree || '学历不限',
    salary: item.salaryDesc,

    // 地址相关
    address: [item.cityName, item.areaDistrict, item.businessDistrict].filter(Boolean).join('-'),
    addressCoords: item.gps ? [item.gps.longitude, item.gps.latitude] : undefined,

    // 技能标签
    showSkills: item.skills || [],
    jobLabels: item.jobLabels || [],
    skills: item.skills || [],

    // 活跃时间 - 从 lastModifyTime 获取
    activeTime: item.lastModifyTime,
    activeTimeStr: item.lastModifyTime ? formatActiveTime(item.lastModifyTime) : undefined,

    // 福利
    welfareList: item.welfareList,

    // 招聘者信息
    boss: {
      link: `https://www.zhipin.com/boss_detail/${item.encryptBossId}.html`,
      name: item.bossName,
      title: item.bossTitle,
      avatar: item.bossAvatar,
      certificated: item.bossCert > 0,
      isHeadhunter: item.goldHunter === 1,
      isFriend: false,
      isOnline: item.bossOnline ?? false,
    },

    // 公司品牌信息
    brand: {
      link: `https://www.zhipin.com/gongsi/${item.encryptBrandId}.html`,
      name: item.brandName,
      logo: item.brandLogo,
      scale: item.brandScaleName,
      industry: item.brandIndustry,
      stageName: item.brandStageName,
      introduce: '',
      labels: [],
    },

    // 状态信息
    // status: {
    //   status: item.contact ? 'warn' : 'pending',
    //   msg: item.contact ? '已沟通' : '未开始',
    // },
  }
}

export class BossHelperCtx extends HelperContext<BossHelperCtx, BoosJobData, {}> {
  private static instance: HTMLElement | null = null
  label = 'Boss直聘'
  key = 'boss'

  private mountedPath = ''
  private appearanceStop?: () => void

  _page = ref({ page: 1, pageSize: 15 })
  _pageHasMore = ref(true)
  _jobDetail = ref<BossZpDetailData>()
  _pageChange: (page: number) => Promise<any> = async (_v: number) => {
    throw new Error('pageChange is undefined')
  }
  _clickJobCardAction = (_: BossZpJobItemData) => {}
  _jobList: Ref<BossZpJobItemData[]>
  _jobDataMap: Map<string, BoosJobData>

  rootVue: any = null
  jobMaps: Map<string, WorkflowData<BoosJobData, {}>>
  jobList: Ref<JobData[]>

  constructor() {
    const jobList = ref<JobData[]>([])
    const _jobList = ref<BossZpJobItemData[]>([])
    const _jobListMap = new Map<string, BoosJobData>()

    super()

    this.jobList = jobList
    this._jobList = _jobList
    this._jobDataMap = _jobListMap

    this.jobMaps = reactive(new Map())
  }

  get uid() {
    // return window?.Cookie.get('bst') // token ?
    if (!pageInfo.value.encryptUserId) {
      useToast().add({
        color: 'error',
        title: '未获取到用户ID，可能会出现奇怪bug, 请尝试刷新页面或反馈',
      })
    }
    return pageInfo.value.encryptUserId
  }

  get userInfo() {
    return {
      id: pageInfo.value.encryptUserId,
      name: pageInfo.value.showName ?? pageInfo.value.name,
      avatar: pageInfo.value.largeAvatar ?? pageInfo.value.tinyAvatar ?? '',
    }
  }

  static async new() {
    const ctx = new BossHelperCtx()
    ctx.rootVue = await getRootVue()
    ctx.workflow = await bossWorkflow(ctx)
    return ctx
  }

  async loadMoreJob(delay: Promise<any>): Promise<boolean> {
    try {
      const oldLen = this._jobList.value.length
      const oldFirstJobId = this._jobList.value[0]?.encryptJobId ?? ''

      await this._pageChange(this._page.value.page + 1)
      await delay
      const currentFirstJobId = this._jobList.value[0]?.encryptJobId ?? ''
      if (
        (location.href.includes('/web/geek/job-recommend') ||
          location.href.includes('/web/geek/jobs')) &&
        oldLen === this._jobList.value.length &&
        oldFirstJobId === currentFirstJobId
      ) {
        logger.error('翻页: 内容无变化')
        return false
      }
    } catch (err) {
      logger.error('翻页: 下一页错误', err)
      return false
    }
    return true
  }

  async start() {
    if (!this.workflow) {
      this.workflow = await bossWorkflow(this)
    }
    await this.workflow.executeAll(this._jobDataMap)
  }

  async sendMessage(data: WorkflowData<BoosJobData, {}>, msgs: FormDataInput['value']) {
    logger.debug('发送消息', { jobKey: data.jobData.key, msg: msgs })

    this.assertActive()
    const items = typeof msgs === 'string' ? [{ type: 'text' as const, content: msgs }] : msgs
    for (const msg of items) {
      this.assertActive()
      if (msg.type === 'text') {
        this.pendingMessages.value = msg.content
        await delay(this.conf.formData.delayMessageSending, () => this.signal.aborted)
      }
      this.assertActive()
      const action = await this.beginAction(data, msg.type === 'image' ? 'image' : 'message')
      try {
        let payload: any
        if (msg.type === 'image') {
          const image = await counter.getImage(msg.image)
          if (!image.success) throw new Error('图片未上传或已过期')
          this.assertActive()
          payload = { type: 'image', file: image }
        } else {
          payload = { type: 'text', text: this.pendingMessages.value }
          this.pendingMessages.value = undefined
        }
        this.assertActive()
        await counter.actionUpdate(action.id, 'running')
        this.assertActive()
        await pageCall('message', {
          account: this.runAccount,
          job: data.rawData,
          message: payload,
          clientMid: crypto.randomUUID(),
        })
        await counter.actionUpdate(action.id, 'submitted')
      } catch (e) {
        await counter.actionUpdate(
          action.id,
          this.signal.aborted || (e as any)?.uncertain ? 'uncertain' : 'failed',
          errorHandle(e),
        )
        throw e
      }
    }
  }

  async onMount(path?: string) {
    if (!path) {
      path = this.rootVue.$route.path
    }

    if (this.mountedPath === path && BossHelperCtx.instance?.isConnected) return
    if (this.runId) this.stop()
    this.appearanceStop?.()
    this.disposeTimers()
    this.unmountUi?.()
    BossHelperCtx.instance?.remove()
    BossHelperCtx.instance = null
    this.mountedPath = path ?? ''
    const elm = await elmGetter.get(
      '.job-search-wrapper,.job-recommend-main,.page-jobs .page-jobs-main',
    )

    const appElement = document.createElement('boss-helper-job')
    BossHelperCtx.instance = appElement
    elm.insertBefore(appElement, elm.firstChild)
    this.unmountUi = this.mountUi(appElement)
    removeAd()

    await this._initPage()
    await this._initPageChange()
    await this._initJobDetail()
    await this._initClickJobCardAction()
    await this._initJobList()
    await this.refreshDeliveryStatistics()

    this.initNetConf()
    const contentElm = elm.querySelector<HTMLDivElement>('.recommend-result-inner')

    this.appearanceStop = watch(
      appearanceConf,
      (v) => {
        if (!contentElm) return
        contentElm.style.marginRight =
          v.leftChat && v.contentOffset != 25 ? `${v.contentOffset}%` : 'auto'
        contentElm.style.marginLeft =
          !v.leftChat && v.contentOffset != 25 ? `${v.contentOffset}%` : 'auto'
      },
      { immediate: true },
    )
  }
  getConfigItems() {
    const conf = useConf()
    return computed<[AlertItem[], (ConfigAccordionItem | false)[]]>(() => {
      return [
        [
          {
            type: 'alert',
            id: 'config-alert-1',
            showIcon: true,
            title: '首次配置前请先进入帮助模式查看说明',
            color: 'success',
            description:
              '所有配置项均提供说明，获取岗位滚动至约 150 条会自动停止，刷新页面或修改求职期望后可重新获取；如遇 Bug 或帮助内容不清晰，欢迎反馈并提出改进建议。',
          },
        ],
        [
          {
            label: '筛选配置',
            value: 'filter',
            items: [
              {
                type: 'alert',
                id: 'filter-config-alert-enable',
                title: '复选框打钩才会启用，别忘记打钩启用哦。保存也别忘了',
                description: '排除和包含可点击切换，混合模式适用性过低难以配置不会考虑开发',
                color: 'success',
                showIcon: true,
              },
              {
                type: 'div',
                class: 'grid grid-cols-2 gap-2 mt-2 w-full',

                items: [
                  {
                    type: 'select',
                    key: 'company',
                  },
                  {
                    type: 'select',
                    key: 'jobTitle',
                  },
                  {
                    type: 'select',
                    key: 'jobContent',
                  },
                  {
                    type: 'select',
                    key: 'hrPosition',
                  },
                  conf.configLevel.intermediate && {
                    type: 'select',
                    key: 'jobAddress',
                  },
                  {
                    type: 'div',
                  },
                ],
              },
              {
                type: 'div',
                class: 'flex gap-2 mt-3',
                items: [
                  conf.configLevel.intermediate && {
                    type: 'salaryRange',
                    key: 'salaryRange',
                  },
                  conf.configLevel.intermediate && {
                    type: 'companySizeRange',
                    key: 'companySizeRange',
                  },
                ],
              },
              {
                type: 'div',
                class: 'col-span-full flex flex-wrap gap-2 mt-3',
                items: [
                  conf.configLevel.intermediate && {
                    type: 'checkbox',
                    key: 'activityFilter',
                  },
                  {
                    type: 'checkbox',
                    key: 'goldHunterFilter',
                  },
                  {
                    type: 'checkbox',
                    key: 'friendStatus',
                  },
                  {
                    type: 'checkbox',
                    key: 'bossGoldMedalHr',
                  },
                  conf.configLevel.intermediate && {
                    type: 'checkbox-expire',
                    key: 'sameCompanyFilter',
                  },
                  conf.configLevel.intermediate && {
                    type: 'checkbox-expire',
                    key: 'sameHrFilter',
                  },
                ],
              },
            ],
          },
          conf.configLevel.intermediate && {
            label: '招呼语配置',
            value: 'greetings',
            items: [
              {
                type: 'alert',
                id: 'config-alert-2',
                showIcon: true,
                color: 'success',
                description: '使用自定义招呼语前 推荐禁用boss直聘自带招呼语',
                actions: [
                  {
                    label: '前往',
                    color: 'neutral',
                    variant: 'subtle',
                    onClick: () => {
                      window.open(
                        'https://www.zhipin.com/web/geek/notify-set?type=greetSet',
                        '_blank',
                      )
                    },
                  },
                ],
              },
              { type: 'customGreeting', key: 'customGreeting' },
            ],
          },
          {
            label: '外观配置',
            value: 'appearance',
            items: [{ type: 'appearance', key: 'appearance' }],
          },
          conf.configLevel.advanced && {
            label: '地址配置',
            value: 'address',
            items: [{ type: 'address', key: 'address' }],
          },
          conf.configLevel.intermediate && {
            label: '延迟配置',
            value: 'delay',
            items: [
              {
                type: 'div',
                class: 'grid grid-cols-2 gap-3',
                items: [
                  {
                    type: 'inputNumber',
                    key: 'delayDeliveryStarts',
                    fieldProps: {
                      label: '投递开始',
                      'data-help': '点击投递按钮会等待一段时间,默认值10s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                    },
                  },
                  {
                    type: 'inputNumber',
                    key: 'delayDeliveryInterval',
                    fieldProps: {
                      label: '投递间隔',
                      'data-help': '每个投递的间隔,太快易风控,默认值2s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                    },
                  },
                  {
                    type: 'inputNumber',
                    key: 'delayDeliveryPageNext',
                    fieldProps: {
                      label: '投递翻页',
                      'data-help': '投递完下一页之后等待的间隔,太快易风控,默认值60s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                    },
                  },
                  {
                    type: 'inputNumber',
                    key: 'delayMessageSending',
                    fieldProps: {
                      label: '消息发送',
                      'data-help': '在发送消息前允许等待一定的时间让用户来修改或手动发送,默认值2s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                      disable: true,
                    },
                  },
                ],
              },
            ],
          },
        ],
      ]
    })
  }
  override async onJobCardClick(key: string) {
    // const detail = await requestDetail({
    //   securityId: job.rawData.jobitem.securityId,
    //   lid: job.rawData.jobitem.encryptJobId,
    // }).then((r) => r.zpData)
    const job = this.jobMaps.get(key)
    if (!job) {
      throw new Error('未找到job数据')
    }
    if (isInitialized(job.rawData.detail)) {
      return
    }
    const detail = await pageCall<BossZpDetailData>('detail', { item: job.rawData.jobitem })
    this.signal.throwIfAborted()

    job.rawData.detail = detail
    const targetJob = job.jobData
    targetJob.activeTime = detail.brandComInfo.activeTime
    targetJob.activeTimeStr = detail.bossInfo.activeTimeDesc
    targetJob.jobDescription = detail.jobInfo.postDescription
    targetJob.city = detail.jobInfo.locationName
    targetJob.address = detail.jobInfo.address
    targetJob.addressCoords = [detail.jobInfo.longitude, detail.jobInfo.latitude]

    targetJob.boss = {
      ...targetJob.boss,
      isOnline: detail.bossInfo.bossOnline,
      isCertificated: detail.bossInfo.certificated,
    }

    targetJob.brand = {
      ...targetJob.brand,
      labels: detail.brandComInfo.labels,
      introduce: detail.brandComInfo.introduce,
      stageName: detail.brandComInfo.stageName,
    }
    this.jobMaps.set(key, job)
  }
  async _initJobList() {
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'jobList',
      this._jobList,
      (v) => {
        this.jobList.value = v.map((item: BossZpJobItemData) => {
          // const jobData = convertBossZpJobItemToJobData(item)
          // if (this.conf.formData.useCache.value) {
          //   const cacheCheck = checkJobCache(jobData.key)
          //   if (cacheCheck) {
          //     jobData.status = {
          //       status: cacheCheck.status,
          //       msg: `${cacheCheck.message} (缓存)`,
          //     }
          //   }
          // }
          const job = convertBossZpJobItemToJobData(item)

          let jobData = this._jobDataMap.get(job.key)
          if (jobData) {
            jobData = {
              ...jobData,
              jobitem: item,
            }
          } else {
            jobData = {
              jobitem: item,
              detail: createLazyObject('岗位详情获取'),
              boss: createLazyObject('Boss信息获取'),
            }
          }
          this._jobDataMap.set(job.key, jobData)

          return job
        })
        this.jobList.value.forEach((job) => {
          this.jobMaps.set(job.key, {
            jobData: job,
            rawData: this._jobDataMap.get(job.key)!,
            state: {},
          })
        })
      },
    )()
  }

  async _initPage() {
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'pageVo',
      this._page,
    )()
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'hasMore',
      this._pageHasMore,
    )()
  }

  async _initJobDetail() {
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'jobDetail',
      this._jobDetail,
    )()
  }

  async _initPageChange() {
    let pc =
      location.href.includes('/web/geek/job-recommend') || location.href.includes('/web/geek/jobs')
        ? await initSearch()
        : await initChange()
    if (!pc) {
      throw new Error('pageChange is undefined')
    }
    this._pageChange = pc
  }

  async _initClickJobCardAction() {
    this._clickJobCardAction = await useHookVueFn(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'clickJobCardAction',
    )()
  }
}

export async function startIsolatedApp() {
  const ctx = await BossHelperCtx.new()
  ctx.rootVue.$router.afterHooks.push((to: { path: string }) => {
    void ctx.onMount(to.path).catch((e) => logger.error('页面适配失败', errorHandle(e)))
  })
  window.addEventListener(
    'pagehide',
    () => {
      ctx.stop()
      ctx.disposeTimers()
      ctx.unmountUi?.()
      disposePageBridge()
    },
    { once: true },
  )
  await run(ctx)
}
