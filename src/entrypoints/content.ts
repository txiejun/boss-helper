import { defineContentScript, injectScript } from '#imports'
import { initCounter } from '@/message'
import { startIsolatedApp } from '@/platform/bossContext'

import './boss/inject.css'
export default defineContentScript({
  matches: ['*://zhipin.com/*', '*://*.zhipin.com/*'],
  runAt: 'document_idle',
  world: 'ISOLATED',
  async main() {
    initCounter()
    await injectScript('/boss.js', { keepInDom: true })
    // The adapter installs its listener after locating the BOSS Vue root.
    let last: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await startIsolatedApp()
        return
      } catch (e) {
        last = e
      }
    }
    console.error('BossHelper 初始化失败', last instanceof Error ? last.stack : '页面适配失败')
  },
})
