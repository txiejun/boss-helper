import { expect, test, mock } from 'bun:test'

import { ref, shallowRef, computed } from 'vue'
const logger: any = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  withContext() {
    return logger
  },
}
Object.assign(globalThis, {
  ref,
  shallowRef,
  computed,
  logger,
  jsonClone: structuredClone,
  errorHandle: (e: any) => e?.message ?? String(e),
  delay: async () => {},
})
mock.module('../src/composables/usePipelineCache', () => ({ PipelineCacheManager: class {} }))
mock.module('../src/composables/useApplying/handles', () => ({
  DependencyMissingError: class extends Error {},
}))
const { useDeliveryWorkflow } = await import('../src/composables/useApplying/index')
function fixture(tasks: any[]) {
  const calls: string[] = []
  const helper: any = {
    jobList: ref([{ key: '1' }, { key: '2' }]),
    jobMaps: new Map(),
    jobResultMaps: new Map(),
    currentJob: ref(null),
    models: { initModel: async () => {} },
    conf: {
      formData: {
        delayDeliveryStarts: 0,
        delayDeliveryInterval: 0,
        delayDeliveryPageNext: 0,
        deliveryLimit: { value: 120 },
      },
    },
    statistics: { todayData: ref({ total: 0, success: 0, tasks: {} }) },
    controller: new AbortController(),
    get signal() {
      return this.controller.signal
    },
    beginRun: async () => {
      calls.push('begin')
    },
    endRun: async () => {
      calls.push('end')
    },
    refreshDeliveryStatistics: async () => {},
    stop() {
      helper.controller.abort()
      helper.workflow.stop()
    },
    notification: async () => {},
    loadMoreJob: async () => false,
  }
  return { helper, calls, tasks }
}
const task = (id: string, run: any) => ({ id, task: run, deps: [], before: [], after: [] })
test('invalid enabled configuration prevents all sends and releases resources', async () => {
  let sent = 0
  const f = fixture([
    task('AI筛选', () => {
      throw new Error('模型未配置')
    }),
    task('投递', () => async () => {
      sent++
    }),
  ])
  const w = await useDeliveryWorkflow(f.tasks, f.helper)
  f.helper.workflow = w
  await w.executeAll(new Map())
  expect(sent).toBe(0)
  expect(f.calls).toEqual(['end'])
  expect(w.status.value).toBe('error')
  expect(w.errorMessage.value).toContain('模型未配置')
})
test('rate limit halts the entire batch rather than only the current job', async () => {
  let attempts = 0,
    after = 0
  const f = fixture([
    task('投递', () => async () => {
      attempts++
      throw Object.assign(new Error('操作频繁'), { fatal: true })
    }),
    task('招呼', () => async () => {
      after++
    }),
  ])
  const w = await useDeliveryWorkflow(f.tasks, f.helper)
  f.helper.workflow = w
  await w.executeAll(
    new Map([
      ['1', {}],
      ['2', {}],
    ]),
  )
  expect(attempts).toBe(1)
  expect(after).toBe(0)
  expect(w.status.value).toBe('stop')
  expect(w.errorMessage.value).toContain('频繁')
  expect(f.calls).toEqual(['begin', 'end'])
})
test('uncertain response is not retried or followed by another send', async () => {
  let attempts = 0
  const f = fixture([
    task('投递', () => async () => {
      attempts++
      throw Object.assign(new Error('网络中断'), { uncertain: true })
    }),
  ])
  const w = await useDeliveryWorkflow(f.tasks, f.helper)
  f.helper.workflow = w
  await w.executeAll(
    new Map([
      ['1', {}],
      ['2', {}],
    ]),
  )
  expect(attempts).toBe(1)
  expect(w.status.value).toBe('stop')
})
test('manual stop during a pending step prevents subsequent send and success state', async () => {
  let started!: () => void,
    release!: () => void,
    sent = 0
  const ready = new Promise<void>((r) => {
    started = r
  })
  const gate = new Promise<void>((r) => {
    release = r
  })
  const f = fixture([
    task('生成', () => async () => {
      started()
      await gate
    }),
    task('发送', () => async () => {
      sent++
    }),
  ])
  const w = await useDeliveryWorkflow(f.tasks, f.helper)
  f.helper.workflow = w
  const running = w.executeAll(
    new Map([
      ['1', {}],
      ['2', {}],
    ]),
  )
  await ready
  f.helper.stop()
  release()
  await running
  expect(sent).toBe(0)
  expect(f.helper.jobResultMaps.get('1')?.status).not.toBe('success')
})
test('rebuilding does not accumulate hooks', async () => {
  let before = 0
  const definition = task('投递', () => ({
    fn: async () => {},
    before: [
      async () => {
        before++
      },
    ],
  }))
  const f = fixture([definition])
  const w = await useDeliveryWorkflow(f.tasks, f.helper)
  f.helper.workflow = w
  await w.rebuild()
  await w.rebuild()
  await w.executeAll(
    new Map([
      ['1', {}],
      ['2', {}],
    ]),
  )
  expect(before).toBe(2)
})
