// Page messages never carry extension settings, credentials, or storage access.
import { isBatchFatal } from '@/reliability/core'
const CHANNEL = 'boss-helper-page-v2'
const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>()
export const pageInfo = ref<Record<string, any>>({})
window.addEventListener('message', (event) => {
  const m = event.data
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    m?.channel !== CHANNEL ||
    m.direction !== 'response' ||
    typeof m.id !== 'string'
  )
    return
  const request = pending.get(m.id)
  if (!request) return
  pending.delete(m.id)
  clearTimeout(request.timer)
  if (m.error)
    request.reject(
      Object.assign(new Error(String(m.error.message)), {
        fatal: m.error.fatal === true,
        uncertain: m.error.uncertain === true,
      }),
    )
  else request.resolve(m.result)
})
export function pageCall<T = any>(
  operation:
    | 'snapshot'
    | 'page'
    | 'detail'
    | 'contact'
    | 'boss'
    | 'image'
    | 'message'
    | 'begin'
    | 'cancel',
  args: any = {},
): Promise<T> {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(
        Object.assign(new Error('页面操作超时，请核实平台状态'), {
          fatal: true,
          uncertain: ['contact', 'message', 'image'].includes(operation),
        }),
      )
    }, 65000)
    pending.set(id, { resolve, reject, timer })
    window.postMessage(
      {
        channel: CHANNEL,
        direction: 'request',
        id,
        operation,
        args: JSON.parse(JSON.stringify(args)),
      },
      location.origin,
    )
  })
}
type Watcher = { key: string; update: (value: any) => void; last?: string }
const watchers = new Set<Watcher>()
let timer: ReturnType<typeof setTimeout> | undefined
let running = true
let route = location.pathname
const hooks: Array<(to: any) => void> = []
async function poll() {
  try {
    const snapshot = await pageCall('snapshot')
    pageInfo.value = snapshot.user
    for (const watcher of watchers) {
      const value = snapshot[watcher.key]
      if (value === undefined) continue
      const next = JSON.stringify(value)
      if (next !== watcher.last) {
        watcher.last = next
        watcher.update(value)
      }
    }
    if (route !== location.pathname) {
      route = location.pathname
      hooks.forEach((fn) => fn({ path: route }))
    }
  } catch (e) {
    if (isBatchFatal(e)) console.warn('BOSS 页面连接暂不可用')
  }
  if (running) timer = setTimeout(poll, 750)
}
export async function getRootVue() {
  const snapshot = await pageCall('snapshot')
  pageInfo.value = snapshot.user
  void poll()
  return {
    $route: {
      get path() {
        return location.pathname
      },
    },
    $router: { afterHooks: hooks },
  }
}
export function useHookVueData(
  _selectors: string,
  key: string,
  data: any,
  update?: (v: any) => void,
) {
  return async () => {
    const apply = (value: any) => {
      data.value = value
      update?.(value)
    }
    const watcher: Watcher = { key, update: apply }
    for (const old of watchers) if (old.key === key) watchers.delete(old)
    watchers.add(watcher)
    const snapshot = await pageCall('snapshot')
    if (snapshot[key] !== undefined) {
      watcher.last = JSON.stringify(snapshot[key])
      apply(snapshot[key])
    }
  }
}
export function useHookVueFn(
  _selectors: string,
  key: string | string[],
): () => Promise<(...args: any[]) => Promise<any>> {
  return async () =>
    key === 'clickJobCardAction'
      ? (item: any) => pageCall('detail', { item })
      : (page: number) => pageCall('page', { page })
}
export function disposePageBridge() {
  running = false
  clearTimeout(timer)
  watchers.clear()
  hooks.length = 0
  for (const item of pending.values()) {
    clearTimeout(item.timer)
    item.reject(new Error('页面已关闭'))
  }
  pending.clear()
}
