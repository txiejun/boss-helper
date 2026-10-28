import { logger as raw } from 'devlog-ui'

import { sanitize } from '@/reliability/core'
raw.configure({
  maxLogs: 1000,
  minLevel: 'warn',
  enabled: true,
  shortcutAction: 'toggle',
  showToggleButton: true,
  spanCollapsed: false,
})
const logMethods = new Set(['debug', 'info', 'warn', 'error', 'log', 'table'])
function wrap<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, key, receiver) {
      const value = Reflect.get(t, key, receiver)
      if (typeof value !== 'function') return value
      if (logMethods.has(String(key)))
        return (...args: unknown[]) =>
          value.apply(
            t,
            args.map((a) => sanitize(a)),
          )
      if (key === 'withContext' || key === 'span')
        return (...args: unknown[]) =>
          wrap(
            value.apply(
              t,
              args.map((a) => sanitize(a)),
            ),
          )
      return value.bind(t)
    },
  })
}
export const logger = wrap(raw)
