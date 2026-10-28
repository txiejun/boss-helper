import type { ModelMessage } from 'ai'

import { browser } from '#imports'
import type { OpenaiLLMConf } from '@/composables/useModel/openai'
import { originPattern } from '@/reliability/core'
export async function grantModelPermission(base: string) {
  const origins = [originPattern(base)]
  if (await browser.permissions.contains({ origins })) return
  if (!(await browser.permissions.request({ origins })))
    throw new Error('未授权该模型 API 域名，配置尚未保存')
}
export function streamModel(
  args: { modelKey?: string; draft?: OpenaiLLMConf; messages: ModelMessage[]; json?: boolean },
  onChunk: (chunk: any) => void,
  signal?: AbortSignal,
): Promise<{ text: string; reasoningText: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const port = browser.runtime.connect({ name: 'boss-helper-ai-v2' })
    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      signal?.removeEventListener('abort', abort)
      port.disconnect()
      fn()
    }
    const abort = () => finish(() => reject(signal?.reason ?? new Error('AI 请求已取消')))
    signal?.addEventListener('abort', abort, { once: true })
    port.onDisconnect.addListener(() => {
      if (!done) finish(() => reject(Object.assign(new Error('AI 后台连接断开'), { fatal: true })))
    })
    port.onMessage.addListener((m) => {
      if (m.type === 'chunk') onChunk(m.chunk)
      else if (m.type === 'done')
        finish(() => resolve({ text: m.text, reasoningText: m.reasoningText }))
      else if (m.type === 'error') finish(() => reject(new Error(m.message)))
    })
    port.postMessage(args)
  })
}
