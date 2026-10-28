// Pure policy shared by the worker and tests. No browser/page globals.
export type ActionStatus =
  | 'pending'
  | 'running'
  | 'confirmed'
  | 'submitted'
  | 'failed'
  | 'uncertain'
  | 'cancelled'
export interface ActionRecord {
  id: string
  runId: string
  account: string
  jobId: string
  hrId?: string
  companyId?: string
  stage: 'contact' | 'message' | 'image'
  status: ActionStatus
  createdAt: number
  updatedAt: number
  error?: string
}
export interface RunLease {
  account: string
  runId: string
  tabId: number
  expiresAt: number
}
export const blocksRepeat = (a: ActionRecord) =>
  a.stage === 'contact' && ['pending', 'running', 'confirmed', 'uncertain'].includes(a.status)
export function isBatchFatal(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'fatal' in error && error.fatal === true
}
export function uncertain(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'uncertain' in error && error.uncertain === true
}
export function redact(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.message
        : JSON.stringify(value)
  return (text ?? '')
    .replace(
      /((?:api[_-]?key|authorization|cookie|zp[_-]?token|securityId|token|wt2?)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,&}]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
}
export function sanitize(value: unknown, seen = new WeakSet<object>()): any {
  if (value instanceof Error) return { name: value.name, message: redact(value.message) }
  if (value === null || typeof value !== 'object')
    return typeof value === 'string' ? redact(value) : value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((v) => sanitize(v, seen))
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      /^(api[_-]?key|authorization|cookie|token|securityId|zp[_-]?token|wt2?|extra_headers)$/i.test(
        k,
      )
        ? '[REDACTED]'
        : sanitize(v, seen),
    ]),
  )
}
export function dayKey(time: number): string {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function contactCount(records: ActionRecord[], account: string, now = Date.now()): number {
  return records.filter(
    (a) =>
      a.account === account &&
      a.stage === 'contact' &&
      a.status === 'confirmed' &&
      dayKey(a.createdAt) === dayKey(now),
  ).length
}
export function assertContactAllowed(
  records: ActionRecord[],
  account: string,
  jobId: string,
  limit: number,
  hrId?: string,
  companyId?: string,
  hrExpiry = -1,
  companyExpiry = -1,
  now = Date.now(),
) {
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('投递上限必须大于零')
  if (contactCount(records, account, now) >= limit)
    throw Object.assign(new Error('已达到今日投递上限'), { fatal: true })
  const active = (createdAt: number, expiry: number) => expiry === 0 || now - createdAt <= expiry
  for (const a of records) {
    if (a.account !== account || !blocksRepeat(a)) continue
    if (a.jobId === jobId) throw new Error('该岗位已沟通或结果待核实，禁止重复发送')
    if (hrExpiry >= 0 && hrId && a.hrId === hrId && active(a.createdAt, hrExpiry))
      throw new Error('相同 HR 已沟通或结果待核实')
    if (
      companyExpiry >= 0 &&
      companyId &&
      a.companyId === companyId &&
      active(a.createdAt, companyExpiry)
    )
      throw new Error('相同公司已沟通或结果待核实')
  }
}
export function recoverInterrupted(records: ActionRecord[], runId?: string): ActionRecord[] {
  return records.map((a) =>
    (!runId || a.runId === runId) && ['pending', 'running'].includes(a.status)
      ? {
          ...a,
          status: 'uncertain',
          updatedAt: Date.now(),
          error: '执行中断，请核实平台状态后处理',
        }
      : a,
  )
}
export function originPattern(base: string): string {
  const url = new URL(base)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('API 地址必须为 HTTP(S) 地址且不能包含账号密码')
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('非本地 API 必须使用 HTTPS')
  return `${url.protocol}//${url.hostname}/*`
}
