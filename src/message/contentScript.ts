import { browser, storage } from '#imports'
import type { StorageItemKey } from '#imports'
import type { ActionRecord, ActionStatus } from '@/reliability/core'

import type { BackgroundCounter } from './background'
export async function backgroundCall<T = any>(method: string, ...args: any[]): Promise<T> {
  const r = await browser.runtime.sendMessage({
    channel: 'boss-helper-worker-v2',
    method,
    args: JSON.parse(JSON.stringify(args)),
  })
  if (!r || !r.ok)
    throw Object.assign(new Error(r?.error?.message ?? '扩展后台连接已断开'), {
      fatal: r?.error?.fatal ?? true,
      uncertain: r?.error?.uncertain === true,
    })
  return r.value
}
const genKey = (key: string): StorageItemKey =>
  /^(local|session|sync|managed):/.test(key) ? (key as StorageItemKey) : `local:${key}`
export class ContentCounter {
  request(...args: Parameters<BackgroundCounter['request']>) {
    return backgroundCall('request', ...args)
  }
  notify(...args: Parameters<BackgroundCounter['notify']>) {
    return backgroundCall('notify', ...args)
  }
  getImage(
    ...args: Parameters<BackgroundCounter['getImage']>
  ): ReturnType<BackgroundCounter['getImage']> {
    return backgroundCall('getImage', ...args)
  }
  setImage(
    ...args: Parameters<BackgroundCounter['setImage']>
  ): ReturnType<BackgroundCounter['setImage']> {
    return backgroundCall('setImage', ...args)
  }
  storageGet<T>(key: string, defaultValue: T): Promise<T>
  storageGet<T>(key: string): Promise<T | null>
  storageGet<T>(key: string, defaultValue?: T): Promise<T | null> {
    return storage.getItem<T>(genKey(key), { fallback: defaultValue })
  }
  async storageSet<T>(key: string, value: T) {
    await storage.setItem(genKey(key), value)
  }
  async storageRm(key: string) {
    await storage.removeItem(genKey(key))
  }
  acquire(account: string): Promise<string> {
    return backgroundCall('acquire', account)
  }
  heartbeat(account: string, runId: string) {
    return backgroundCall('heartbeat', account, runId)
  }
  release(account: string, runId: string) {
    return backgroundCall('release', account, runId)
  }
  actionBegin(
    record: Omit<ActionRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
    limit: number,
    hrExpiry: number,
    companyExpiry: number,
  ): Promise<ActionRecord> {
    return backgroundCall('actionBegin', record, limit, hrExpiry, companyExpiry)
  }
  actionUpdate(id: string, status: ActionStatus, error?: string) {
    return backgroundCall('actionUpdate', id, status, error)
  }
  journal(account: string): Promise<ActionRecord[]> {
    return backgroundCall('journal', account)
  }
  resolveAction(id: string, status: 'confirmed' | 'failed') {
    return backgroundCall('resolveAction', id, status)
  }
}
