import { openDB } from 'idb'

import { browser } from '#imports'
import type { Browser } from '#imports'
import { calculateFileMD5 } from '@/utils/file'
export const userKey = 'local:conf-user'
const dbPromise = () =>
  openDB('ExtensionGlobalDB', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images')
    },
  })
export class BackgroundCounter {
  async request(args: { url: string; data: RequestInit; timeout: number; responseType: string }) {
    const url = new URL(args.url)
    if (
      url.protocol !== 'https:' ||
      !['restapi.amap.com', 'testingcf.jsdelivr.net'].includes(url.hostname)
    )
      throw new Error('请求地址不在允许列表')
    const res = await fetch(url, {
      ...args.data,
      credentials: 'omit',
      signal: AbortSignal.timeout(Math.min(Math.max(args.timeout * 1000, 1000), 60000)),
    })
    if (!res.ok) throw new Error(`请求失败 HTTP ${res.status}`)
    return args.responseType === 'json' ? res.json() : res.text()
  }
  async notify(args: Browser.notifications.NotificationCreateOptions) {
    await browser.notifications.create({
      ...args,
      iconUrl: browser.runtime.getURL('/icons/128.png'),
    })
    return true
  }
  async getImage(
    key: string,
  ): Promise<{ success: false } | { success: true; name: string; type: string; buffer: number[] }> {
    const db = await dbPromise()
    const file: File | undefined = await db.get('images', key)
    if (!file) return { success: false }
    return {
      success: true,
      name: file.name,
      type: file.type,
      buffer: Array.from(new Uint8Array(await file.arrayBuffer())),
    }
  }
  async setImage(opt: { name: string; type: string; buffer: number[] }) {
    const db = await dbPromise()
    const file = new File([new Uint8Array(opt.buffer)], opt.name, { type: opt.type })
    const key = `img-${await calculateFileMD5(file)}`
    await db.put('images', file, key)
    return { success: true, key }
  }
}
