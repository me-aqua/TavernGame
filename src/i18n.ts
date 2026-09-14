/**
 * src/i18n.ts —— i18n 初始化。
 *
 * ⚠️ `src/locales/*.json` 是代码里**唯一**允许出现中文的地方；其余标识符、对象键、
 *    字符串字面量必须是 ASCII，这条由 .githooks/checks/ascii.mjs 强制。
 *
 * 语言三态（与主题一致）：'system'（跟随浏览器）/ 'zh-CN' / 'en'。
 *
 * ⚠️ **模型语言跟随界面语言**（用户 2026-09-14 决定）：界面切到英文，
 *    GM 就用英文写故事，提示词也跟着换。
 */
import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN.json'
import en from './locales/en.json'

export type LanguageMode = 'system' | 'zh-CN' | 'en'
export type Locale = 'zh-CN' | 'en'

const STORAGE_KEY = 'tavernGame.lang'

/**
 * 把 'system' 解析成具体语言。
 *
 * ⚠️ 语言标签作为**参数**传入，不在这里读 navigator：初始 locale 在模块加载时求值，
 *    而测试 import 这个模块远早于 jsdom/navigator 就绪 —— 在这里读会让 locale
 *    取决于跑测试的机器。
 */
export function resolveLocale(mode: LanguageMode, systemLanguage: string): Locale {
  if (mode === 'zh-CN' || mode === 'en') return mode
  return systemLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/** 读玩家存过的语言偏好；没存过或不合法都当 'system' */
export function readStoredLanguage(): LanguageMode {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'zh-CN' || raw === 'en' || raw === 'system' ? raw : 'system'
}

export function storeLanguage(mode: LanguageMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
}

/**
 * ⚠️ 加载本模块必须**没有副作用**：不许碰 localStorage。否则任何间接引入 i18n 的
 *    模块（几乎所有核心模块都经由 `t`）在 Node 测试里会直接炸 —— 那里的
 *    localStorage shim 是在 import 图求值之后才装的。存量偏好在 useLanguage() 里应用。
 */
export const i18n = createI18n({
  legacy: false,
  // 先落在兜底语言；'system' 与存过的选择由 useLanguage() 在挂载时应用。
  // 在那之前没有可观察的行为（App 挂载时才会调用这个 composable）。
  locale: 'en' satisfies Locale,
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN, en },
})

/** 在组件外翻译（stores、核心模块） */
export function t(key: string, named?: Record<string, unknown>): string {
  return i18n.global.t(key, named ?? {})
}
