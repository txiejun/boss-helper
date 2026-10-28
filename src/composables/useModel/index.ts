import { ref, toRaw } from 'vue'

import { storage } from '#imports'
import { grantModelPermission } from '@/ai/client'
import { counter } from '@/message'
import { migrateModels } from '@/reliability/modelStorage'

import type { OpenaiLLMConf } from './openai'
import { openai } from './openai'

export * from './chatModel'

const toast = useToast()
export const confModelKey = 'conf-model'
export const llms = [openai.info]

export type ModelConfData = OpenaiLLMConf

export interface ModelConf {
  key: string
  name: string
  color?: string
  data?: ModelConfData
  // vip?: {
  //   description: string
  //   price: {
  //     input: string
  //     output: string
  //   }
  // }
}

const modelData = ref<ModelConf[]>([])

export const useModel = () => {
  async function init() {
    const data = await migrateModels<ModelConf>(storage)
    modelData.value = data
  }

  async function save() {
    for (const m of modelData.value)
      if (m.data?.base_url && m.data.api_key) await grantModelPermission(m.data.base_url)
    await counter.storageSet(confModelKey, toRaw(modelData.value))
    toast.add({
      title: '保存成功',
      color: 'success',
    })
  }

  return {
    initModel: init,
    modelData,
    saveModel: save,
  }
}
