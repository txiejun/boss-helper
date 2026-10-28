import ui from '@nuxt/ui/vue-plugin'
import { createApp } from 'vue'

import Options from './Options.vue'

import '@/assets/main.css'
createApp(Options).use(ui).mount('#app')
