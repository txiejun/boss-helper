<script lang="ts" setup>
import { createReusableTemplate } from '@vueuse/core'
import { ref } from 'vue'

import Alert from '@/components/Alert.vue'
import type { ModelConf } from '@/composables/useModel'
import { useModel } from '@/composables/useModel'
import deepmerge, { jsonClone } from '@/utils/deepmerge'
import { exportJson, importJson } from '@/utils/jsonImportExport'

import CreateLLM from './LLMModelEdit.vue'

defineProps<{ inline?: boolean }>()
const [DefineModelList, ModelList] = createReusableTemplate()
const [DefineActions, Actions] = createReusableTemplate()

const modelStore = useModel()
async function clearKeys() {
  for (const model of modelStore.modelData.value)
    if (model.data) {
      model.data.api_key = ''
      model.data.advanced.extra_headers = {}
    }
  await modelStore.saveModel()
}
const createBoxShow = ref(false)
const toast = useToast()
const open = ref(false)

function del(d: ModelConf) {
  modelStore.modelData.value = modelStore.modelData.value.filter((v) => d.key !== v.key)
}

function copy(d: ModelConf) {
  d = jsonClone(d)
  d.key = new Date().getTime().toString()
  d.name = `${d.name} 副本`
  modelStore.modelData.value.push(d)
}

const createModelData = ref()

function edit(d: ModelConf) {
  createModelData.value = d
  createBoxShow.value = true
}

function newllm() {
  createModelData.value = undefined
  createBoxShow.value = true
}

function create(d: ModelConf) {
  if (d.key) {
    const old = modelStore.modelData.value.find((v) => v.key === d.key)
    if (old) {
      deepmerge(old, d, { clone: false })
    } else {
      d.key = new Date().getTime().toString()
      modelStore.modelData.value.push(d)
    }
  } else {
    d.key = new Date().getTime().toString()
    modelStore.modelData.value.push(d)
  }
  createBoxShow.value = false
}
function close() {
  modelStore.initModel()
  open.value = false
}

function exportllm() {
  const data = jsonClone(modelStore.modelData.value)
  for (const model of data)
    if (model.data) {
      model.data.api_key = ''
      model.data.advanced.extra_headers = {}
    }
  exportJson(data, 'Ai模型配置（不含密钥）')
}

function importllm() {
  importJson<ModelConf[]>().then((data) => {
    modelStore.modelData.value = data
    toast.add({
      title: '导入成功, 请手动保存',
      color: 'success',
    })
  })
}
</script>

<template>
  <DefineModelList>
    <UTable
      :data="modelStore.modelData.value"
      :columns="[
        { id: 'model', header: '模型' },
        { id: 'desc', header: '描述' },
        { id: 'manage', header: '管理' },
      ]"
      style="width: 100%"
    >
      <template #model-cell="{ row }">
        <div style="align-items: center; display: flex">
          <UAvatar :src="row.original.data?.avatar" :alt="row.original.name" />
          <span style="margin-left: 8px">{{ row.original.name }}</span>
        </div>
      </template>
      <template #desc-cell="{ row }">
        <p class="max-w-80 truncate" :title="row.original.data?.base_url">
          {{ row.original.data && row.original.data.base_url }}
        </p>
      </template>
      <template #manage-cell="{ row }">
        <div class="flex flex-wrap gap-1">
          <UButton variant="link" color="primary" size="sm" @click="del(row.original)">
            删除
          </UButton>
          <UButton variant="link" color="primary" size="sm" @click="copy(row.original)">
            复制
          </UButton>
          <UButton variant="link" color="primary" size="sm" @click="edit(row.original)">
            编辑
          </UButton>
        </div>
      </template>
    </UTable>
    <CreateLLM
      v-if="createBoxShow"
      v-model="createBoxShow"
      :model="createModelData"
      @create="create"
    />
  </DefineModelList>
  <DefineActions>
    <div class="flex w-full flex-wrap justify-end gap-2">
      <UButton v-if="!inline" color="neutral" variant="outline" @click="close"> 取消 </UButton>
      <UButton color="success" @click="exportllm"> 导出 </UButton>
      <UButton color="success" @click="importllm"> 导入 </UButton>
      <UButton color="warning" @click="clearKeys">清除全部密钥</UButton>
      <UButton v-if="!inline" @click="newllm"> 新建 </UButton>
      <UButton @click="modelStore.saveModel"> 保存 </UButton>
    </div>
  </DefineActions>
  <section v-if="inline" class="rounded-xl border border-default bg-default shadow-sm">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-default p-4 sm:p-5"
    >
      <div>
        <h2 class="text-lg font-semibold">模型与密钥</h2>
        <p class="mt-1 text-sm text-muted">
          共 {{ modelStore.modelData.value.length }} 个模型，支持 OpenAI 兼容接口
        </p>
      </div>
      <UButton @click="newllm">新建模型</UButton>
    </div>
    <div class="min-w-0 overflow-x-auto p-2 sm:p-4"><ModelList /></div>
    <div class="border-t border-default p-4 sm:p-5"><Actions /></div>
  </section>
  <UModal
    v-else
    v-model:open="open"
    title="AI模型配置"
    :ui="{ content: 'w-[calc(100vw-2rem)] max-w-5xl' }"
    :dismissible="false"
  >
    <slot />
    <template #body><ModelList /></template>
    <template #footer><Actions /></template>
  </UModal>
</template>
