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
import { DEFAULT_PRESETS } from './presets'
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
  /**
   * 盘上有卡但读不出来（旧格式 / 坏了一份）：**不种示例、不写标记、也不在这里抛**。
   * 抛出去会把本模块打断 ⇒ 应用连挂都挂不上，中文错误页也没了；种下去则会把它整表覆盖。
   * 所以这条错误留给首页的读盘路径去撞、去显示（`HomePage` 的 `loadFailed`），这里一个字节都不写。
   */
  let stored: Card[] | null = null
  try {
    stored = storage.loadCards()
  } catch {
    // 见上：错误由首页的读盘路径显示，这里只负责「别种、别写、别炸」
  }
  if (stored !== null) {
    if (stored.length === 0) storage.saveCards([sample as Card])
    storage.saveSettings({ ...settings, sampleSeeded: true } as Settings)
  }
}

// 新装的默认模型预设：只在 `tg2.presets` 这个键完全不存在时铺一次；删光了不再长回来。
if (localStorage.getItem('tg2.presets') === null) storage.savePresets(DEFAULT_PRESETS)

provideStorage(storage)
document.title = t('app.title')

createApp(App).mount('#app')
