import { expect, test } from 'bun:test'

import { migrateModels } from '../src/reliability/modelStorage'
function store(local: any, legacy: any, fail = false) {
  const data: any = { 'local:conf-model': local, 'sync:conf-model': legacy }
  return {
    data,
    getItem: async <T>(key: string) => data[key] as T | null,
    setItem: async (key: string, value: any) => {
      if (fail) throw new Error('quota')
      data[key] = value
    },
    removeItem: async (key: string) => {
      data[key] = null
    },
  }
}
test('model migration moves synced credentials locally and is idempotent', async () => {
  const s = store(null, [{ key: 'a', api_key: 'secret' }])
  expect(await migrateModels(s)).toEqual([{ key: 'a', api_key: 'secret' }])
  expect(s.data['sync:conf-model']).toBeNull()
  expect(await migrateModels(s)).toEqual([{ key: 'a', api_key: 'secret' }])
})
test('existing local settings win over stale synced settings', async () => {
  const s = store([{ key: 'new' }], [{ key: 'old' }])
  expect(await migrateModels(s)).toEqual([{ key: 'new' }])
  expect(s.data['sync:conf-model']).toBeNull()
})
test('save failure retains synced configuration', async () => {
  const s = store(null, [{ key: 'a' }], true)
  await expect(migrateModels(s)).rejects.toThrow('quota')
  expect(s.data['sync:conf-model']).toEqual([{ key: 'a' }])
})
test('failed readback verification never deletes the old credential', async () => {
  const s = store(null, [{ key: 'a' }])
  s.setItem = async () => {}
  await expect(migrateModels(s)).rejects.toThrow('校验')
  expect(s.data['sync:conf-model']).toEqual([{ key: 'a' }])
})
