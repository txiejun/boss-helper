<script setup lang="ts">
import LLMModelManage from '@/components/AI/LLMModelManage.vue'
import { useModel } from '@/composables/useModel'
const model = useModel()
const ready = ref(false)
const error = ref('')
onMounted(async () => {
  try {
    await model.initModel()
    ready.value = true
  } catch (e) {
    error.value = errorHandle(e)
  }
})
</script>
<template>
  <UApp
    ><main class="p-8 max-w-3xl mx-auto space-y-4">
      <h1 class="text-2xl">BossHelper 模型配置</h1>
      <p>
        API Key 仅保存在扩展本地。保存或测试时按域名请求权限。配置完成后返回 BOSS 页面重新启动任务。
      </p>
      <p v-if="error">{{ error }}</p>
      <LLMModelManage v-if="ready"><UButton>管理模型与密钥</UButton></LLMModelManage>
    </main></UApp
  >
</template>
