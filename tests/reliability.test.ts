import { describe, expect, test } from 'bun:test'

import {
  assertContactAllowed,
  blocksRepeat,
  contactCount,
  originPattern,
  recoverInterrupted,
  sanitize,
} from '../src/reliability/core'
import type { ActionRecord } from '../src/reliability/core'
import { DeliveryJournal } from '../src/reliability/journal'
const record = (extra: Partial<ActionRecord> = {}): ActionRecord => ({
  id: 'a',
  runId: 'r',
  account: 'u',
  jobId: 'j',
  hrId: 'h',
  companyId: 'c',
  stage: 'contact',
  status: 'confirmed',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...extra,
})
function fixture(initial: ActionRecord[] = []) {
  let persisted = structuredClone(initial),
    now = Date.now(),
    seq = 0
  const store = {
    load: async () => structuredClone(persisted),
    save: async (v: ActionRecord[]) => {
      persisted = structuredClone(v)
    },
  }
  const journal = new DeliveryJournal(
    store,
    () => now,
    () => `id-${++seq}`,
  )
  return {
    journal,
    store,
    persisted: () => persisted,
    advance: (ms: number) => {
      now += ms
    },
  }
}
describe('correct identity and conservative delivery state', () => {
  test('company and HR deduplication use their own IDs, with account isolation', () => {
    const entries = [record()]
    expect(() => assertContactAllowed(entries, 'u', 'another', 120, 'h', 'other', 0, -1)).toThrow(
      'HR',
    )
    expect(() => assertContactAllowed(entries, 'u', 'another', 120, 'other', 'c', -1, 0)).toThrow(
      '公司',
    )
    expect(() =>
      assertContactAllowed(entries, 'another-account', 'j', 120, 'h', 'c', 0, 0),
    ).not.toThrow()
  })
  test('failed/cancelled contacts do not block; pending and uncertain contacts do', () => {
    expect(blocksRepeat(record({ status: 'failed' }))).toBe(false)
    expect(blocksRepeat(record({ status: 'cancelled' }))).toBe(false)
    expect(blocksRepeat(record({ status: 'uncertain' }))).toBe(true)
    expect(blocksRepeat(record({ status: 'pending' }))).toBe(true)
  })
  test('only confirmed contacts count, once per day and account', () => {
    const now = Date.now()
    expect(
      contactCount(
        [
          record(),
          record({ stage: 'message' }),
          record({ status: 'uncertain' }),
          record({ account: 'other' }),
          record({ createdAt: now - 86400000 }),
        ],
        'u',
        now,
      ),
    ).toBe(1)
  })
  test('limit is checked before contact and cannot be bypassed with invalid settings', () => {
    expect(() => assertContactAllowed([record()], 'u', 'j2', 1)).toThrow('上限')
    for (const limit of [NaN, 0, -1])
      expect(() => assertContactAllowed([], 'u', 'j', limit)).toThrow()
  })
  test('expired optional company rules do not override mandatory job deduplication', () => {
    const entries = [record({ createdAt: Date.now() - 100000 })]
    expect(() => assertContactAllowed(entries, 'u', 'other', 120, 'h', 'c', 1, 1)).not.toThrow()
    expect(() => assertContactAllowed(entries, 'u', 'j', 120)).toThrow('岗位')
  })
})
describe('background serialization, locks and crash recovery', () => {
  test('simultaneous tabs cannot acquire the same account', async () => {
    const { journal } = fixture()
    const results = await Promise.allSettled([journal.acquire('u', 1), journal.acquire('u', 2)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })
  test('a filter-only run writes no delivery record', async () => {
    const { journal, persisted } = fixture()
    const run = await journal.acquire('u', 1)
    await journal.release('u', run, 1)
    expect(persisted()).toEqual([])
  })
  test('writes are persisted before execution; closing a tab marks an unfinished action uncertain', async () => {
    const { journal, persisted } = fixture()
    const runId = await journal.acquire('u', 1)
    const a = await journal.begin(
      { runId, account: 'u', jobId: 'j', stage: 'contact' },
      1,
      120,
      -1,
      -1,
    )
    expect(persisted()[0]?.status).toBe('pending')
    await journal.update(a.id, 'running', 1)
    await journal.closeTab(1)
    expect(persisted()[0]?.status).toBe('uncertain')
    const newRun = await journal.acquire('u', 2)
    await expect(
      journal.begin({ runId: newRun, account: 'u', jobId: 'j', stage: 'contact' }, 2, 120, -1, -1),
    ).rejects.toThrow('岗位')
  })
  test('worker restart invalidates leases and recovers unfinished actions without resending', async () => {
    const f = fixture()
    const runId = await f.journal.acquire('u', 1)
    await f.journal.begin({ runId, account: 'u', jobId: 'j', stage: 'contact' }, 1, 120, -1, -1)
    const restarted = new DeliveryJournal(f.store)
    await expect(restarted.heartbeat('u', runId, 1)).rejects.toThrow('运行锁')
    expect((await restarted.list('u'))[0]?.status).toBe('uncertain')
  })
  test('confirmed contact survives a later failed greeting and cannot be repeated', async () => {
    const f = fixture()
    const runId = await f.journal.acquire('u', 1)
    const base = { runId, account: 'u', jobId: 'j', hrId: 'h', companyId: 'c' }
    const contact = await f.journal.begin({ ...base, stage: 'contact' }, 1, 120, -1, -1)
    await f.journal.update(contact.id, 'running', 1)
    await f.journal.update(contact.id, 'confirmed', 1)
    const msg = await f.journal.begin({ ...base, stage: 'message' }, 1, 120, -1, -1)
    await f.journal.update(msg.id, 'failed', 1)
    expect(contactCount(await f.journal.list('u'), 'u')).toBe(1)
    await expect(f.journal.begin({ ...base, stage: 'contact' }, 1, 120, -1, -1)).rejects.toThrow(
      '岗位',
    )
  })
  test('a different tab cannot modify actions; expired owner cannot continue', async () => {
    const f = fixture()
    const runId = await f.journal.acquire('u', 1)
    const a = await f.journal.begin(
      { runId, account: 'u', jobId: 'j', stage: 'contact' },
      1,
      120,
      -1,
      -1,
    )
    await expect(f.journal.update(a.id, 'running', 2)).rejects.toThrow('运行锁')
    f.advance(21000)
    await expect(f.journal.update(a.id, 'running', 1)).rejects.toThrow('运行锁')
  })
  test('manual verification is blocked during a run and permits retry only after a negative verification', async () => {
    const f = fixture([record({ status: 'uncertain' })])
    const runId = await f.journal.acquire('u', 1)
    await expect(f.journal.resolve('a', 'failed')).rejects.toThrow('停止')
    await f.journal.release('u', runId, 1)
    await f.journal.resolve('a', 'failed')
    expect(blocksRepeat((await f.journal.list('u'))[0]!)).toBe(false)
  })
  test('daily shared limit counts confirmed contact even if another tab acquires next', async () => {
    const f = fixture([record()])
    const runId = await f.journal.acquire('u', 2)
    await expect(
      f.journal.begin({ runId, account: 'u', jobId: 'j2', stage: 'contact' }, 2, 1, -1, -1),
    ).rejects.toThrow('上限')
  })
})
describe('credential and export safety', () => {
  test('nested secrets and cyclic diagnostic data are sanitized', () => {
    const x: any = {
      api_key: 'private',
      nested: { Authorization: 'Bearer private', securityId: 'session' },
      text: 'Bearer sk-private',
    }
    x.self = x
    const safe = JSON.stringify(sanitize(x))
    expect(safe).not.toContain('private')
    expect(safe).not.toContain('session')
    expect(safe).toContain('Circular')
  })
  test('custom API permissions are scoped by origin and insecure remote endpoints rejected', () => {
    expect(originPattern('https://example.com/api/v1')).toBe('https://example.com/*')
    expect(originPattern('http://localhost:11434/v1')).toBe('http://localhost/*')
    for (const base of [
      'http://example.com',
      'file:///etc/passwd',
      'https://key:secret@example.com',
    ])
      expect(() => originPattern(base)).toThrow()
  })
  test('recovery preserves completed outcomes', () => {
    expect(
      recoverInterrupted([record(), record({ id: 'b', status: 'running' })]).map((a) => a.status),
    ).toEqual(['confirmed', 'uncertain'])
  })
})
