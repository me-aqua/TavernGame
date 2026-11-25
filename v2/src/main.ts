/**
 * v2 入口：建存储、挂 App、设标题。
 *
 * 主题与设置的读取在 `App.vue` 里（读坏了也要能看见错误页，而不是白屏）；
 * 这里只负责把「浏览器 localStorage」这一份实例交给应用（core 层不碰全局）。
 */
import { createApp } from 'vue'
import App from './App.vue'
import { provideStorage } from './app-context'
import { createStorage } from './core/storage'
import type { Card, Settings } from './core/types'
import sample from './data/morningwind.json'
import { t } from './i18n'
import './styles/main.css'

/**
 * 首次打开：没有卡、也没有「已经种过示例」的标记 ⇒ 种一张晨风镇。
 *
 * 标记住在 `tg2.settings.sampleSeeded`（不新增第六个键）。玩家把示例卡删掉之后
 * 标记还在 ⇒ 不会再种回来；他清空整个 localStorage 才会重新看到示例。
 */
const storage = createStorage(localStorage)
const settings = storage.loadSettings() as Settings & { sampleSeeded?: boolean }
if (settings.sampleSeeded !== true) {
  if (storage.loadCards().length === 0) storage.saveCards([sample as Card])
  storage.saveSettings({ ...settings, sampleSeeded: true } as Settings)
}

provideStorage(storage)
document.title = t('app.title')

createApp(App).mount('#app')
