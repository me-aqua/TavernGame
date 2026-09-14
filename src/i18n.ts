/**
 * i18n setup.
 *
 * ⚠️ `src/locales/*.json` is the **only** place Chinese is allowed in code.
 * Everything else — identifiers, object keys, string literals — must be ASCII.
 * That rule is enforced by .githooks/checks/ascii.mjs.
 *
 * Language has three states, mirroring the theme:
 *   'system' (follow the browser) / 'zh-CN' / 'en'
 *
 * ⚠️ The **model language follows the UI language** (user decision, 2026-09-14):
 * switching the UI to English makes the GM write in English, prompts included.
 */
import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN.json'
import en from './locales/en.json'

export type LanguageMode = 'system' | 'zh-CN' | 'en'
export type Locale = 'zh-CN' | 'en'

const STORAGE_KEY = 'tavernGame.lang'

/** Resolve 'system' to a concrete locale */
export function resolveLocale(mode: LanguageMode): Locale {
  if (mode === 'zh-CN' || mode === 'en') return mode
  const browser = typeof navigator !== 'undefined' ? navigator.language : 'en'
  return browser.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function readStoredLanguage(): LanguageMode {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'zh-CN' || raw === 'en' || raw === 'system' ? raw : 'system'
}

export function storeLanguage(mode: LanguageMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
}

/**
 * ⚠️ Loading this module must have **no side effects**: it must not touch
 * localStorage. Otherwise importing anything that transitively pulls in i18n
 * (every core module does, via the `t` helper) would explode in Node tests,
 * where the localStorage shim is installed after the import graph is evaluated.
 * The stored preference is applied later by useLanguage().
 */
export const i18n = createI18n({
  legacy: false,
  locale: resolveLocale('system'),
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN, en },
})

/** Current locale, e.g. for choosing prompts and tool schemas */
export function currentLocale(): Locale {
  return (i18n.global.locale as unknown as { value: Locale }).value
}

/** Translate outside components (stores, core modules) */
export function t(key: string, named?: Record<string, unknown>): string {
  return i18n.global.t(key, named ?? {})
}
