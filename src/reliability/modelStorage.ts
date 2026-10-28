export interface ModelStorage {
  getItem<T>(key: 'local:conf-model' | 'sync:conf-model'): Promise<T | null>
  setItem<T>(key: 'local:conf-model', value: T): Promise<unknown>
  removeItem(key: 'sync:conf-model'): Promise<unknown>
}
export async function migrateModels<T>(store: ModelStorage): Promise<T[]> {
  let local = await store.getItem<T[]>('local:conf-model')
  const legacy = await store.getItem<T[]>('sync:conf-model')
  if (local === null && legacy !== null) {
    await store.setItem('local:conf-model', legacy)
    const saved = await store.getItem('local:conf-model')
    if (JSON.stringify(saved) !== JSON.stringify(legacy))
      throw new Error('模型配置迁移校验失败，旧配置未删除')
    local = legacy
  }
  if (legacy !== null) await store.removeItem('sync:conf-model')
  return local ?? []
}
