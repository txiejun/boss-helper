<script lang="tsx" setup>
import { DevLoggerUI } from 'devlog-ui'

import { useHelper } from '@/composables/useHelper'
import { counter } from '@/message'
import type { ActionRecord } from '@/reliability/core'
const helper = useHelper()
const entries = ref<ActionRecord[]>([])
const toast = useToast()
async function reload() {
  entries.value = (await counter.journal(helper.uid)).slice().reverse()
}
async function resolveAction(record: ActionRecord, status: 'confirmed' | 'failed') {
  try {
    await counter.resolveAction(record.id, status)
    await reload()
    await helper.refreshDeliveryStatistics()
  } catch (e) {
    toast.add({ title: errorHandle(e), color: 'error' })
  }
}
onMounted(reload)
const labels = {
  pending: '待执行',
  running: '执行中',
  confirmed: '已确认',
  submitted: '已提交（送达待核实）',
  failed: '失败',
  uncertain: '结果待核实',
  cancelled: '已取消',
}
const stages = { contact: '建立沟通', message: '文字消息', image: '图片消息' }
const logsRef = useTemplateRef('logsRef')
onMounted(() => {
  if (logsRef.value) {
    DevLoggerUI.init({ body: logsRef.value })
  }
})
</script>

<template>
  <section class="space-y-3">
    <UButton @click="reload">刷新动作台账</UButton>
    <p>
      建立沟通、消息提交与附件发送分别记录。只有在 BOSS
      页面核实实际结果后，才使用下方按钮；不会自动重试。
    </p>
    <div class="overflow-auto max-h-96">
      <table class="w-full text-sm">
        <thead>
          <tr>
            <th>时间</th>
            <th>岗位标识</th>
            <th>动作</th>
            <th>状态</th>
            <th>核实</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in entries" :key="record.id">
            <td>{{ new Date(record.createdAt).toLocaleString() }}</td>
            <td>{{ record.jobId }}</td>
            <td>{{ stages[record.stage] }}</td>
            <td :title="record.error">{{ labels[record.status] }}</td>
            <td v-if="['uncertain', 'submitted'].includes(record.status)">
              <UButton
                size="xs"
                :disabled="helper.workflowRunning.value"
                @click="resolveAction(record, 'confirmed')"
                >已核实成功</UButton
              ><UButton
                size="xs"
                color="neutral"
                :disabled="helper.workflowRunning.value"
                @click="resolveAction(record, 'failed')"
                >已核实未执行</UButton
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <div ref="logsRef"></div>
</template>
