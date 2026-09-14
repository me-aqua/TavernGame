/**
 * UI language, mirroring useTheme.
 *
 * Three states: 'system' (follow the browser) / 'zh-CN' / 'en'.
 *
 * ⚠️ The model language follows this (user decision, 2026-09-14): switching to
 * English makes the GM write in English, prompts included.
 */
import { ref, watch } from 'vue'
import { i18n, readStoredLanguage, resolveLocale, storeLanguage, type LanguageMode } from '../i18n'

const mode = ref<LanguageMode>('system')
let initialized = false

/** Apply the mode to vue-i18n and the <html lang> attribute */
function apply(next: LanguageMode): void {
  const locale = resolveLocale(next, navigator.language)
  ;(i18n.global.locale as unknown as { value: string }).value = locale
  document.documentElement.lang = locale
}

/** 界面语言（三态循环），与 useTheme 同构 */
export function useLanguage() {
  if (!initialized) {
    initialized = true
    mode.value = readStoredLanguage()
    apply(mode.value)

    watch(mode, (next) => {
      storeLanguage(next)
      apply(next)
    })
  }

  /** Cycle: system -> zh-CN -> en -> system */
  function cycle(): void {
    mode.value = mode.value === 'system' ? 'zh-CN' : mode.value === 'zh-CN' ? 'en' : 'system'
  }

  /** Pick a language directly (settings drawer), instead of cycling */
  function select(next: LanguageMode): void {
    mode.value = next
  }

  return { mode, cycle, select }
}

/** Current concrete locale — core modules use it to pick prompts and tool schemas */
export function currentLocale(): 'zh-CN' | 'en' {
  return i18n.global.locale.value as 'zh-CN' | 'en'
}
