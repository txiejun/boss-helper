import { assertContactAllowed, blocksRepeat, recoverInterrupted, redact } from './core'
import type { ActionRecord, ActionStatus, RunLease } from './core'
export interface JournalStore {
  load(): Promise<ActionRecord[]>
  save(records: ActionRecord[]): Promise<void>
}
export class DeliveryJournal {
  private leases = new Map<string, RunLease>()
  private queue: Promise<unknown> = Promise.resolve()
  private records: ActionRecord[] = []
  private ready = false
  constructor(
    private store: JournalStore,
    private now = () => Date.now(),
    private uuid: () => string = () => crypto.randomUUID(),
  ) {}
  private transact<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (!this.ready) {
        this.records = recoverInterrupted(await this.store.load())
        await this.store.save(this.records)
        this.ready = true
      }
      return fn()
    })
    this.queue = result.catch(() => {})
    return result
  }
  private lease(account: string, runId: string, tabId: number) {
    const l = this.leases.get(account)
    if (!l || l.runId !== runId || l.tabId !== tabId || l.expiresAt <= this.now())
      throw Object.assign(new Error('运行锁已失效，请重新启动任务'), { fatal: true })
    return l
  }
  acquire(account: string, tabId: number) {
    return this.transact(async () => {
      if (!account) throw new Error('账号标识缺失')
      const old = this.leases.get(account)
      if (old && old.expiresAt > this.now())
        throw Object.assign(new Error('该账号已有任务运行，请先停止另一标签页'), { fatal: true })
      if (old) {
        this.records = recoverInterrupted(this.records, old.runId)
        await this.store.save(this.records)
      }
      const runId = this.uuid()
      this.leases.set(account, { account, tabId, runId, expiresAt: this.now() + 20000 })
      return runId
    })
  }
  heartbeat(account: string, runId: string, tabId: number) {
    return this.transact(async () => {
      this.lease(account, runId, tabId).expiresAt = this.now() + 20000
      return true
    })
  }
  release(account: string, runId: string, tabId: number) {
    return this.transact(async () => {
      const l = this.leases.get(account)
      if (l?.runId !== runId || l.tabId !== tabId) return
      this.records = recoverInterrupted(this.records, runId)
      await this.store.save(this.records)
      this.leases.delete(account)
    })
  }
  closeTab(tabId: number) {
    return this.transact(async () => {
      for (const [account, l] of this.leases)
        if (l.tabId === tabId) {
          this.records = recoverInterrupted(this.records, l.runId)
          this.leases.delete(account)
        }
      await this.store.save(this.records)
    })
  }
  begin(
    record: Omit<ActionRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
    tabId: number,
    limit: number,
    hrExpiry: number,
    companyExpiry: number,
  ) {
    return this.transact(async () => {
      this.lease(record.account, record.runId, tabId)
      if (!record.jobId || !['contact', 'message', 'image'].includes(record.stage))
        throw new Error('动作参数无效')
      if (record.stage === 'contact')
        assertContactAllowed(
          this.records,
          record.account,
          record.jobId,
          limit,
          record.hrId,
          record.companyId,
          hrExpiry,
          companyExpiry,
          this.now(),
        )
      const item: ActionRecord = {
        ...record,
        id: this.uuid(),
        status: 'pending',
        createdAt: this.now(),
        updatedAt: this.now(),
      }
      this.records.push(item)
      await this.store.save(this.records)
      return item
    })
  }
  update(id: string, status: ActionStatus, tabId: number, error?: string) {
    return this.transact(async () => {
      const item = this.records.find((a) => a.id === id)
      if (!item) throw new Error('动作不存在')
      this.lease(item.account, item.runId, tabId)
      const transitions: Partial<Record<ActionStatus, ActionStatus[]>> = {
        pending: ['running', 'cancelled', 'failed', 'uncertain'],
        running: ['confirmed', 'submitted', 'failed', 'uncertain'],
        submitted: ['uncertain'],
      }
      if (!transitions[item.status]?.includes(status)) throw new Error('动作状态转换无效')
      item.status = status
      item.error = error ? redact(error) : undefined
      item.updatedAt = this.now()
      await this.store.save(this.records)
      return item
    })
  }
  list(account: string) {
    return this.transact(async () => this.records.filter((a) => a.account === account))
  }
  resolve(id: string, status: 'confirmed' | 'failed') {
    return this.transact(async () => {
      const item = this.records.find((a) => a.id === id)
      if (
        !item ||
        !['uncertain', 'submitted'].includes(item.status) ||
        !['confirmed', 'failed'].includes(status)
      )
        throw new Error('只能核实待确认动作')
      const lease = this.leases.get(item.account)
      if (lease && lease.expiresAt > this.now()) throw new Error('请先停止运行中的任务再核实结果')
      item.status = status
      item.updatedAt = this.now()
      item.error = '用户已核实平台状态'
      await this.store.save(this.records)
    })
  }
  async checkDuplicate(
    account: string,
    jobId: string,
    hrId?: string,
    companyId?: string,
    hrExpiry = -1,
    companyExpiry = -1,
  ) {
    const records = await this.list(account)
    const now = this.now()
    return records.some(
      (a) =>
        a.account === account &&
        blocksRepeat(a) &&
        (a.jobId === jobId ||
          (hrExpiry >= 0 &&
            hrId &&
            a.hrId === hrId &&
            (hrExpiry === 0 || now - a.createdAt <= hrExpiry)) ||
          (companyExpiry >= 0 &&
            companyId &&
            a.companyId === companyId &&
            (companyExpiry === 0 || now - a.createdAt <= companyExpiry))),
    )
  }
}
