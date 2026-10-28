import type { Toast } from '@nuxt/ui/runtime/composables/useToast.js'
import { extendRef } from '@vueuse/core'
import type { Reactive } from 'vue'
import { ref } from 'vue'
import type { Ref } from 'vue'

import { useConf } from '@/composables/conf'
import type { DeliveryWorkflow } from '@/composables/useApplying'
import type { BossHelperError } from '@/composables/useApplying/deliverError'
import type { TaskResult, WorkflowData } from '@/composables/useApplying/type'
import { useModel } from '@/composables/useModel'
import { ChatModel } from '@/composables/useModel'
import { counter } from '@/message'
import { pageCall } from '@/platform/bridge'
import { contactCount } from '@/reliability/core'
import type { ActionRecord } from '@/reliability/core'
import type { FormDataInput } from '@/types/formData'

import type { NetConf } from './netConf'
import { initNetConf } from './netConf'
import type { Log, JobData, LogData, ConfigAccordionItem, AlertItem } from './type'

export abstract class HelperContext<C extends HelperContext<C, T, S>, T, S> {
  netConf: Ref<NetConf | null>
  netConfTimer: NodeJS.Timeout | null = null
  conf: ReturnType<typeof useConf>
  models: ReturnType<typeof useModel>
  statistics: ReturnType<typeof useStatistics>

  chatModel: ChatModel
  workflow: DeliveryWorkflow<C, T, S> | null = null
  workflowRunning = computed(() => this.workflow?.status.value === 'running')
  jobResultMaps: Reactive<Map<string, TaskResult>>

  abstract jobList: Ref<JobData[]>
  abstract jobMaps: Map<string, WorkflowData<T, S>>

  currentJob: Ref<string | null>
  _logs: Ref<Log[]>
  logs: {
    add: (job: JobData, err?: BossHelperError, logdata?: LogData, msg?: string) => void
    info: (title: string, message: string) => void
    clear: () => void
    value: Log[]
  }
  pendingMessages: Ref<string | undefined>
  controller = new AbortController()
  mountUi!: (root: HTMLElement) => () => void
  unmountUi?: () => void
  runId = ''
  runAccount = ''
  private heartbeatTimer?: ReturnType<typeof setInterval>
  get signal() {
    return this.controller.signal
  }
  assertActive() {
    this.signal.throwIfAborted()
    if (!this.runId) throw new Error('投递任务尚未启动')
  }
  async beginRun() {
    if (this.runId) throw new Error('已有投递任务运行')
    await this.models.initModel()
    this.runAccount = this.uid
    this.runId = await counter.acquire(this.runAccount)
    this.controller = new AbortController()
    this.heartbeatTimer = setInterval(() => {
      void counter.heartbeat(this.runAccount, this.runId).catch(() => this.stop())
    }, 5000)
    await pageCall('begin', { account: this.runAccount })
  }
  async endRun() {
    clearInterval(this.heartbeatTimer)
    this.chatModel.cancel()
    await pageCall('cancel').catch(() => {})
    if (this.runId) await counter.release(this.runAccount, this.runId).catch(() => {})
    this.runId = ''
    await this.refreshDeliveryStatistics().catch(() => {})
  }
  async beginAction(data: WorkflowData<T, S>, stage: ActionRecord['stage']) {
    this.assertActive()
    if (this.uid !== this.runAccount)
      throw Object.assign(new Error('账号已改变，任务已停止'), { fatal: true })
    const conf = this.conf.formData
    const record = await counter.actionBegin(
      {
        runId: this.runId,
        account: this.runAccount,
        jobId: data.jobData.key,
        hrId: data.jobData.hrId,
        companyId: data.jobData.companyId,
        stage,
      },
      conf.deliveryLimit.value,
      conf.sameHrFilter.value ? (conf.sameHrFilter.expire ?? 0) : -1,
      conf.sameCompanyFilter.value ? (conf.sameCompanyFilter.expire ?? 0) : -1,
    )
    this.assertActive()
    return record
  }
  async refreshDeliveryStatistics() {
    const entries = await counter.journal(this.uid)
    await this.statistics.updateStatistics()
    this.statistics.todayData.value.success = contactCount(entries, this.uid)
    this.statistics.todayData.value.messagesSubmitted = entries.filter(
      (a) =>
        a.stage === 'message' &&
        a.status === 'submitted' &&
        getCurDay(new Date(a.createdAt)) === getCurDay(),
    ).length
  }
  disposeTimers() {
    clearInterval(this.netConfTimer ?? undefined)
    this.netConfTimer = null
  }

  constructor() {
    this.pendingMessages = ref()
    this.conf = useConf()
    this.models = useModel()
    this.statistics = useStatistics()
    this.currentJob = ref(null)
    this._logs = ref([])
    this.logs = extendRef(this._logs, {
      add: (job: JobData, err?: BossHelperError, logdata?: LogData, msg?: string) => {
        const state = !err ? 'success' : err.state
        const message = msg ?? (err ? err.message : undefined)
        this._logs.value.push({
          job,
          title: job.jobName,
          state,
          state_name: err?.name ?? '投递成功',
          message,
          data: logdata,
        })
      },
      info: (title: string, message: string) => {
        this._logs.value.push({
          title,
          state: 'info',
          state_name: '消息',
          message,
          data: undefined,
        })
      },
      clear: () => {
        this._logs.value = []
      },
    })

    this.chatModel = new ChatModel(this)

    this.jobResultMaps = reactive(new Map())
    this.netConf = ref(null)
  }

  abstract loadMoreJob(delay: Promise<any>): Promise<boolean>
  abstract onMount(): Promise<void>
  abstract getConfigItems(): ComputedRef<[AlertItem[], (ConfigAccordionItem | false)[]]>

  abstract start(): Promise<void>
  abstract sendMessage(data: WorkflowData<T, S>, msg: FormDataInput['value']): Promise<void>
  abstract get uid(): string
  abstract get userInfo(): {
    id: string
    name: string
    avatar: string
  }
  abstract get key(): string
  abstract get label(): string

  initNetConf() {
    void initNetConf()
      .then((data) => {
        this.netConf.value = data
      })
      .catch(() => {
        /* Version metadata must not block the application. */
      })
    if (!this.netConfTimer) {
      this.netConfTimer = setInterval(
        () => {
          void initNetConf()
            .then((data) => {
              this.netConf.value = data
            })
            .catch(() => {})
        },
        1000 * 60 * 5,
      )
    }
  }

  stop() {
    this.controller.abort(new DOMException('任务已停止', 'AbortError'))
    this.chatModel.cancel()
    void pageCall('cancel').catch(() => {})
    this.workflow?.stop()
  }
  reset() {
    this.workflow?.reset()
  }
  async notification(
    msg: string,
    opt?: {
      notification?: typeof notification extends (
        message: string,
        options?: infer O,
      ) => Promise<any>
        ? O
        : never
      toast: Partial<Toast>
    },
  ) {
    const toast = useToast()
    if (this.conf.formData.notification.value && document.visibilityState !== 'visible') {
      await notification(msg, opt?.notification)
    }
    toast.add({
      ...opt?.toast,
      title: msg,
    })
  }

  async onJobCardClick(_key: string) {
    throw new Error('Method not implemented.')
  }
}
