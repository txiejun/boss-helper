import type { ChatMessageProps } from '@nuxt/ui'
import type { ChatState, ChatStatus, ModelMessage, UIMessage } from 'ai'
import type { ShallowReactive } from 'vue'

import { streamModel } from '@/ai/client'
import type { FormDataAi } from '@/types/formData'
import { renderTemplate } from '@/utils/ai'

import type { ModelConf } from '.'
import type { WorkflowData } from '../useApplying/type'
import type { HelperContext } from '../useHelper'

const role = ['system', 'user', 'assistant', 'boss', 'jd', 'filtering', 'greetings'] as const
type MessageRole = (typeof role)[number]

export interface Message extends ChatMessageProps {
  uiRole: MessageRole
  // messages?: ModelMessage[]
}

export class VueChatState<UI_MESSAGE extends UIMessage> implements ChatState<UI_MESSAGE> {
  messagesRef: ShallowRef<UI_MESSAGE[]>
  statusRef = shallowRef<ChatStatus>('ready')
  errorRef = shallowRef<Error | undefined>(undefined)

  constructor(messages?: UI_MESSAGE[]) {
    this.messagesRef = shallowRef(messages ?? [])
  }

  get messages(): UI_MESSAGE[] {
    return this.messagesRef.value
  }

  set messages(messages: UI_MESSAGE[]) {
    this.messagesRef.value = messages
  }

  get status(): ChatStatus {
    return this.statusRef.value
  }

  set status(status: ChatStatus) {
    this.statusRef.value = status
  }

  get error(): Error | undefined {
    return this.errorRef.value
  }

  set error(error: Error | undefined) {
    this.errorRef.value = error
  }

  pushMessage = (message: UI_MESSAGE) => {
    this.messagesRef.value = [...this.messagesRef.value, message]
    triggerRef(this.messagesRef)
  }

  popMessage = () => {
    this.messagesRef.value = this.messagesRef.value.slice(0, -1)
    triggerRef(this.messagesRef)
  }

  replaceMessage = (index: number, message: UI_MESSAGE) => {
    // message is cloned here because vue's deep reactivity shows unexpected behavior, particularly when updating tool invocation parts
    this.messagesRef.value[index] = { ...message }
    triggerRef(this.messagesRef)
  }

  snapshot = <T>(value: T): T => value
}

export class ChatModel {
  states: ShallowReactive<Map<string, VueChatState<Message>>> = shallowReactive(new Map())
  jobs = ref<string[]>([])
  agents = new Map<MessageRole, { key: string; conf: ModelConf; form: FormDataAi; json: boolean }>()
  private controllers = new Set<AbortController>()
  constructor(public ctx: HelperContext<any, any, any>) {}
  cancel() {
    for (const c of this.controllers) c.abort(new DOMException('请求已取消', 'AbortError'))
    this.controllers.clear()
  }
  createAgent(form: FormDataAi, name: MessageRole, opt?: { json?: boolean }) {
    const conf = this.ctx.models.modelData.value.find((m) => m.key === form.model)
    if (!conf?.data?.api_key || !conf.data.base_url || !conf.data.model || !form.model) return false
    this.agents.set(name, {
      key: form.model,
      conf,
      form: jsonClone(form),
      json: opt?.json === true,
    })
    return true
  }
  async chat(
    name: MessageRole,
    data: WorkflowData<any, any>,
    { disableMessages = false }: { disableMessages?: boolean } = {},
  ) {
    const agent = this.agents.get(name)
    if (!agent) throw new Error('AI 模型未配置')
    const controller = new AbortController()
    this.controllers.add(controller)
    const messages: ModelMessage[] = jsonClone(agent.form.prompt)
    for (const m of messages)
      if (typeof m.content === 'string') m.content = renderTemplate(m.content, data)
    let state = this.states.get(data.jobData.key)
    if (!state) {
      state = new VueChatState<Message>()
      state.pushMessage({
        id: crypto.randomUUID(),
        role: 'system',
        uiRole: 'jd',
        parts: [
          {
            type: 'text',
            text: `${data.jobData.jobName}\n${data.jobData.salary}\n${data.jobData.brand?.name ?? ''}\n${data.jobData.jobDescription}`,
          },
        ],
        avatar: { src: data.jobData.brand?.logo },
      })
      if (!disableMessages) {
        this.states.set(data.jobData.key, state)
        this.jobs.value.unshift(data.jobData.key)
      }
    }
    state.error = undefined
    state.status = 'streaming'
    const msg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      uiRole: name,
      parts: [],
      side: 'right',
      avatar: { src: agent.conf.data?.avatar, alt: agent.conf.data?.model },
    }
    state.pushMessage(msg)
    const index = state.messages.length - 1
    try {
      const result = await streamModel(
        { modelKey: agent.key, messages, json: agent.json },
        (chunk) => {
          if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
            const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
            const previous = msg.parts[msg.parts.length - 1]
            if (previous?.type === type && 'text' in previous) {
              previous.text += chunk.text
            } else {
              msg.parts.push({ type, text: chunk.text, state: 'streaming' })
            }
            state!.replaceMessage(index, msg)
          }
        },
        controller.signal,
      )
      for (const part of msg.parts) if ('state' in part) part.state = 'done'
      state.replaceMessage(index, msg)
      state.status = 'ready'
      return {
        text: Promise.resolve(result.text),
        finalStep: Promise.resolve({ reasoningText: result.reasoningText }),
      }
    } catch (e) {
      state.status = 'error'
      state.error = e as Error
      throw e
    } finally {
      this.controllers.delete(controller)
    }
  }
}
