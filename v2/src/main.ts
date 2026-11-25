/**
 * v2 入口：建存储、首次打开种示例卡、挂 App、设标题。
 *
 * 两条「不能白屏」的门槛都在这一层：
 *   · **设置读坏了**（坏 JSON / 形状不对）⇒ 用默认值把启动走完，**不写回** ——
 *     `App.vue` 会自己再读一次，把那份坏数据的中文错误页显示出来；
 *   · 示例卡只往「读得出来且为空」的卡表里种一次，种之前先过 `validateCard`。
 */
import { createApp } from 'vue'
import App from './App.vue'
import { provideStorage } from './app-context'
import { validateCard } from './core/schema'
import { createStorage, DEFAULT_SETTINGS } from './core/storage'
import type { Card, Settings } from './core/types'
import sample from './data/sample-card.json'
import { t } from './i18n'
import { DEFAULT_PRESETS } from './presets'
import './styles/main.css'

const storage = createStorage(localStorage)

/**
 * 读设置。读坏了（坏 JSON / 不是对象）就用默认值把启动走完 —— 不接住的话本模块当场中断，
 * 白屏，连 `App.vue` 的错误页都出不来。这份默认值**不写回**：`App.vue` 会自己再读一次，
 * 把那份坏数据的中文错误显示出来，别在这里把它盖掉。
 */
let settings = structuredClone(DEFAULT_SETTINGS) as Settings & { sampleSeeded?: boolean }
let settingsReadable = true
try {
  settings = storage.loadSettings() as Settings & { sampleSeeded?: boolean }
} catch {
  settingsReadable = false
}

/**
 * 首次打开：没有卡、也没有「已经种过示例」的标记 ⇒ 种一张晨风镇。
 *
 * 标记住在 `tg2.settings.sampleSeeded`（不新增第六个键）。玩家把示例卡删掉之后
 * 标记还在 ⇒ 不会再种回来；他清空整个 localStorage 才会重新看到示例。
 *
 * 🔴 **种下去的是克隆，玩家侧的 id 是运行时不透明 id**：资产里的 `id` 只是资产内部标识，
 * 种卡时换成 `c-<uuid>`（与首页新建卡同一套生成器）—— 资产名永远不进 URL / 存档。
 * **没有迁移**：已经种过的卡与旧存档一个字节都不改。
 *
 * 🔴 三种「读不出来」都**一个字节都不写**，启动照常：
 *   · 设置读不出来 ⇒ 整块跳过（页面已经在报那句数据错误，种卡也没人看得见）；
 *   · 盘上的卡读不出来（旧格式 / 坏了一份）⇒ 不种、不写标记（覆盖就再也拿不回来了），
 *     错误留给首页的读盘路径去撞、去显示（`HomePage` 的 `loadFailed`）；
 *   · 内置示例卡本校本就不合法 ⇒ 不种、也不写标记（坏的是随构建发布的资产，不是玩家数据），
 *     由 `v2/tests/boundaries.test.js` 在 CI 里拦，别等它在玩家机器上炸启动。
 */
if (settingsReadable && settings.sampleSeeded !== true) {
  let stored: Card[] | null = null
  try {
    stored = storage.loadCards()
  } catch {
    // 见上：错误由首页的读盘路径显示
  }
  if (stored !== null) {
    let sampleOk = true
    if (stored.length === 0) {
      try {
        validateCard(sample as Card)
      } catch {
        sampleOk = false
      }
    }
    if (sampleOk) {
      if (stored.length === 0) {
        // 克隆资产再换 id：种进盘里的卡不沿用资产 id，存档快照之后自然跟着这个运行时不透明 id
        const seeded = structuredClone(sample as Card)
        seeded.id = `c-${crypto.randomUUID()}`
        storage.saveCards([seeded])
      }
      storage.saveSettings({ ...settings, sampleSeeded: true } as Settings)
    }
  }
}

// 新装的默认模型预设：只在 `tg2.presets` 这个键完全不存在时铺一次；删光了不再长回来。
if (localStorage.getItem('tg2.presets') === null) storage.savePresets(DEFAULT_PRESETS)

provideStorage(storage)
document.title = t('app.title')

createApp(App).mount('#app')
