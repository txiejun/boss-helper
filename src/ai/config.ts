import { createOpenAI } from '@ai-sdk/openai'

import type { OpenaiLLMConf } from '@/composables/useModel/openai'
export function modelOptions(conf: OpenaiLLMConf) {
  const a = conf.advanced ?? {}
  const parseObject = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
  const headers = parseObject(a.extra_headers) as Record<string, string> | undefined
  const provider = createOpenAI({ baseURL: conf.base_url, apiKey: conf.api_key, headers })
  return {
    model: conf.responses ? provider.responses(conf.model) : provider.chat(conf.model),
    temperature: a.temperature,
    topP: a.top_p,
    presencePenalty: a.presence_penalty,
    frequencyPenalty: a.frequency_penalty,
    providerOptions: { openai: { ...(parseObject(a.extra_body) ?? {}) } },
    timeout: conf.other?.timeout ?? 60000,
    maxRetries: 0,
  }
}
