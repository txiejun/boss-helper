import ui from '@nuxt/ui/vue-plugin'
import { createApp } from 'vue'

import App from './App.vue'
import type { HelperContext } from './composables/useHelper'
import { HelperKey } from './composables/useHelper'

import AppStyle from '@/assets/main.css?inline'

export async function run<C extends HelperContext<C, T, S>, T, S>(ctx: HelperContext<C, T, S>) {
  // Chrome's isolated world does not expose a CustomElementRegistry. Mount explicitly.
  ctx.mountUi = (root: HTMLElement) => {
    const shadow = root.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = AppStyle
    shadow.appendChild(style)
    const container = document.createElement('div')
    container.id = 'app-root'
    shadow.appendChild(container)
    const app = createApp(App)
    app.use(ui)
    app.provide(HelperKey, ctx as never)
    app.mount(container)
    return () => app.unmount()
  }
  await ctx.onMount()
}
