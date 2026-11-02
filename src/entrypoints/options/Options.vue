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
  <UApp>
    <main class="min-h-dvh bg-muted/40 px-4 py-6 sm:px-8 sm:py-10">
      <div class="mx-auto w-full max-w-6xl space-y-6">
        <header class="space-y-2">
          <p class="text-sm font-semibold text-primary">BOSS HELPER</p>
          <h1 class="text-2xl font-semibold sm:text-3xl">模型配置</h1>
          <p class="text-sm leading-6 text-muted">
            管理 AI 模型连接、密钥与测试。配置完成后，返回 BOSS 页面重新启动任务。
          </p>
        </header>
        <UAlert
          color="info"
          variant="subtle"
          title="密钥保存在本地"
          description="API Key 仅保存在扩展本地，保存或测试时按域名请求权限。导出的配置不包含密钥。"
        />
        <UAlert v-if="error" color="error" title="模型配置加载失败" :description="error" />
        <LLMModelManage v-else-if="ready" inline />
        <p v-else class="py-12 text-center text-muted" role="status">正在加载模型配置…</p>
      </div>
    </main>
  </UApp>
</template>
