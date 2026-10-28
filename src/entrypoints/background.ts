import { streamText, Output } from 'ai'

import { defineBackground, browser, storage } from '#imports'
import { modelOptions } from '@/ai/config'
import type { ModelConf } from '@/composables/useModel'
import { BackgroundCounter } from '@/message/background'
import { originPattern, redact } from '@/reliability/core'
import { DeliveryJournal } from '@/reliability/journal'
const KEY = 'local:delivery-journal-v2' as const
export default defineBackground({
  main() {
    const counter = new BackgroundCounter()
    const journal = new DeliveryJournal({
      load: async () => await storage.getItem(KEY, { fallback: [] }),
      save: async (records) => {
        await storage.setItem(KEY, records)
      },
    })
    const valid = (sender: any) =>
      sender.id === browser.runtime.id &&
      typeof sender.tab?.id === 'number' &&
      /^https:\/\/(?:[^/]+\.)?zhipin\.com(?:\/|$)/.test(sender.url ?? '') &&
      (sender.frameId ?? 0) === 0
    const validExtension = (sender: any) =>
      sender.id === browser.runtime.id &&
      (sender.url ?? '').startsWith(browser.runtime.getURL('/options.html'))
    browser.runtime.onMessage.addListener((message, sender) => {
      if (message?.channel !== 'boss-helper-worker-v2') return
      return (async () => {
        try {
          if (!valid(sender) || !Array.isArray(message.args)) throw new Error('扩展消息来源无效')
          const a = message.args
          const tab = sender.tab!.id!
          let value: unknown
          switch (message.method) {
            case 'openModelSettings':
              await browser.runtime.openOptionsPage()
              value = true
              break
            case 'acquire':
              value = await journal.acquire(a[0], tab)
              break
            case 'heartbeat':
              value = await journal.heartbeat(a[0], a[1], tab)
              break
            case 'release':
              value = await journal.release(a[0], a[1], tab)
              break
            case 'actionBegin':
              value = await journal.begin(a[0], tab, a[1], a[2], a[3])
              break
            case 'actionUpdate':
              value = await journal.update(a[0], a[1], tab, a[2])
              break
            case 'journal':
              value = await journal.list(a[0])
              break
            case 'resolveAction':
              value = await journal.resolve(a[0], a[1])
              break
            case 'notify':
              value = await counter.notify(a[0])
              break
            case 'getImage':
              value = await counter.getImage(a[0])
              break
            case 'setImage':
              value = await counter.setImage(a[0])
              break
            case 'request':
              value = await counter.request(a[0])
              break
            default:
              throw new Error('后台操作不在允许列表')
          }
          return { ok: true, value }
        } catch (e) {
          return {
            ok: false,
            error: {
              message: redact(e),
              fatal: (e as any)?.fatal === true,
              uncertain: (e as any)?.uncertain === true,
            },
          }
        }
      })()
    })
    browser.tabs.onRemoved.addListener((tabId) => {
      void journal.closeTab(tabId)
    })
    browser.runtime.onConnect.addListener((port) => {
      if (
        port.name !== 'boss-helper-ai-v2' ||
        !(valid(port.sender) || validExtension(port.sender))
      ) {
        port.disconnect()
        return
      }
      const controller = new AbortController()
      let started = false
      port.onDisconnect.addListener(() => controller.abort())
      port.onMessage.addListener(async (args) => {
        if (started) return
        started = true
        try {
          const models = await storage.getItem<ModelConf[]>('local:conf-model', { fallback: [] })
          if (args.draft && !validExtension(port.sender))
            throw new Error('只有扩展配置页可以测试未保存的模型')
          const conf = args.draft ?? models.find((m) => m.key === args.modelKey)?.data
          if (!conf?.base_url || !conf.api_key || !conf.model)
            throw new Error('模型地址、Key 或模型名未配置')
          if (!(await browser.permissions.contains({ origins: [originPattern(conf.base_url)] })))
            throw new Error('请在模型配置中授权 API 域名')
          if (!Array.isArray(args.messages) || !args.messages.length) throw new Error('AI 消息无效')
          const options = modelOptions(conf)
          const result = streamText({
            ...options,
            messages: args.messages,
            abortSignal: controller.signal,
            ...(args.json ? { output: Output.json() } : {}),
          })
          let text = '',
            reasoningText = ''
          for await (const chunk of result.fullStream) {
            if (chunk.type === 'text-delta') text += chunk.text
            if (chunk.type === 'reasoning-delta') reasoningText += chunk.text
            if (chunk.type === 'error') throw chunk.error
            port.postMessage({ type: 'chunk', chunk: JSON.parse(JSON.stringify(chunk)) })
          }
          if (controller.signal.aborted) throw new Error('AI 请求已取消')
          port.postMessage({ type: 'done', text, reasoningText })
        } catch (e) {
          try {
            port.postMessage({ type: 'error', message: redact(e) })
          } catch {
            /* disconnected */
          }
        }
      })
    })
  },
})
