import mqtt from 'mqtt'

import { assertPageActive, pageSignal } from '../requests'
import { ProtoBufferMessage } from './geek-chat-core'

export class GeekChatClientManager {
  client!: mqtt.MqttClient
  msgBuilder!: ProtoBufferMessage

  constructor() {}

  disconnect() {
    this.client?.end(true)
  }
  async publish(payload: Uint8Array) {
    assertPageActive()
    if (!this.client?.connected) throw Object.assign(new Error('聊天未连接'), { fatal: true })
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error | null) => {
        clearTimeout(timer)
        pageSignal().removeEventListener('abort', onAbort)
        if (error) {
          reject(Object.assign(error, { fatal: true, uncertain: true }))
        } else {
          resolve()
        }
      }
      const onAbort = () => done(new Error('消息发送中断，结果待核实'))
      const timer = setTimeout(() => done(new Error('消息确认超时，结果待核实')), 15000)
      pageSignal().addEventListener('abort', onAbort, { once: true })
      this.client.publish(
        'chat',
        payload as Parameters<typeof this.client.publish>[1],
        { qos: 1, retain: false },
        done,
      )
    })
  }
  async connect() {
    assertPageActive()
    if (this.client?.connected) return
    this.client?.end(true)
    const res: {
      code: 0
      message: 'Success'
      zpData: {
        wt2: string
      }
    } = await fetch(`https://www.zhipin.com/wapi/zppassport/get/wt`, {
      signal: AbortSignal.any([pageSignal(), AbortSignal.timeout(10000)]),
    }).then((res) => {
      if (!res.ok)
        throw Object.assign(new Error(`聊天鉴权失败 HTTP ${res.status}`), { fatal: true })
      return res.json()
    })
    if (res.code !== 0) {
      throw Object.assign(new Error('聊天鉴权失败，请重新登录'), { fatal: true })
    }

    const wt = res.zpData.wt2

    const token = window._PAGE?.token

    if (!token) {
      throw Object.assign(new Error('登录已失效，请重新登录'), { fatal: true })
    }

    this.client = mqtt.connect(`wss://ws6.zhipin.com/chatws`, {
      clientId: `ws-${crypto.randomUUID()}`,
      username: `${token}|0`,
      password: wt,
      keepalive: 25,
      clean: true,
      reconnectPeriod: 0,
      queueQoSZero: false,
      connectTimeout: 10000,
      protocolVersion: 4,
      createWebsocket: (url: string) => {
        const subProtocols = wt ? [wt] : ['mqtt']
        return new WebSocket(url, subProtocols)
      },
    })

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        pageSignal().removeEventListener('abort', onAbort)
        this.client.removeListener('connect', connected)
        this.client.removeListener('error', failed)
      }
      const failed = (e: Error) => {
        cleanup()
        this.client.end(true)
        reject(Object.assign(e, { fatal: true }))
      }
      const connected = () => {
        cleanup()
        resolve()
      }
      const onAbort = () => failed(new Error('聊天连接已取消'))
      const timer = setTimeout(() => failed(new Error('聊天连接超时')), 10000)
      this.client.once('connect', connected)
      this.client.once('error', failed)
      this.client.on('error', () => {
        /* An in-flight publish reports its own uncertainty. */
      })
      pageSignal().addEventListener('abort', onAbort, { once: true })
    })
    assertPageActive()
    this.msgBuilder = new ProtoBufferMessage({
      userId: Number(window._PAGE?.uid ?? window._PAGE?.userId),
      token,
      platform: 'web',
      friendSource: 0,
      supportPush: true,
      wt,
    })
  }
}
