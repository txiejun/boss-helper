import { expect, test, afterAll } from 'bun:test'

import {
  sendPublishReq,
  beginPageOperations,
  cancelPageOperations,
} from '../src/entrypoints/boss/requests'
const savedFetch = globalThis.fetch
const savedWindow = globalThis.window
afterAll(() => {
  globalThis.fetch = savedFetch
  globalThis.window = savedWindow
})
const setup = () => {
  ;(globalThis as any).window = { Cookie: { get: () => 'mock-session' } }
  beginPageOperations()
}
test('platform limit response stops without an automatic confirmation or retry', async () => {
  setup()
  const urls: string[] = []
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url))
    return Response.json({
      code: 1,
      zpData: { bizData: { chatRemindDialog: { content: '您今天已与120位BOSS沟通' } } },
    })
  }) as any
  try {
    await sendPublishReq({ securityId: 's', encryptJobId: 'j' })
    throw new Error('expected rejection')
  } catch (e) {
    expect((e as any).fatal).toBe(true)
  }
  expect(urls).toHaveLength(1)
  expect(urls[0]).toContain('friend/add.json')
  expect(urls[0]).not.toContain('cid=')
})
test('ambiguous POST failure makes exactly one attempt and requires verification', async () => {
  setup()
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    throw new TypeError('Failed to fetch')
  }) as any
  try {
    await sendPublishReq({ securityId: 's', encryptJobId: 'j' })
    throw new Error('expected rejection')
  } catch (e) {
    expect((e as any).fatal).toBe(true)
    expect((e as any).uncertain).toBe(true)
  }
  expect(calls).toBe(1)
})
test('cancelled request scope cannot issue another POST', async () => {
  setup()
  cancelPageOperations()
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return Response.json({ code: 0 })
  }) as any
  await expect(sendPublishReq({ securityId: 's', encryptJobId: 'j' })).rejects.toThrow()
  expect(calls).toBe(0)
})
test('missing login prevents any network write', async () => {
  setup()
  ;(globalThis as any).window.Cookie.get = () => ''
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
  }) as any
  await expect(sendPublishReq({ securityId: 's', encryptJobId: 'j' })).rejects.toThrow('登录')
  expect(calls).toBe(0)
})
