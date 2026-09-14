/**
 * 界面语言，与 useTheme 同构。
 *
 * 三态：'system'（跟随浏览器）/ 'zh-CN' / 'en'。
 *
 * ⚠️ **模型语言跟随它**（用户 2026-09-14 决定）：界面切到英文，GM 就用英文写故事，
 *    提示词也跟着换。
 */
import { ref, watch } from 'vue'
import { i18n, readStoredLanguage, resolveLocale, storeLanguage, t, type LanguageMode } from '../i18n'

const mode = ref<LanguageMode>('system')
let initialized = false

/**
 * 把语言模式落到 vue-i18n、<html lang> 与标签页标题上。
 *
 * ⚠️ 标题也必须在这里写：index.html 里那个 <title> 是 ASCII 占位（源码必须 ASCII），
 *    真正给玩家看的标题来自 locale —— 否则英文界面会顶着一个中文标签页。
 */
function apply(next: LanguageMode): void {
  const locale = resolveLocale(next, navigator.language)
  ;(i18n.global.locale as unknown as { value: string }).value = locale
  document.documentElement.lang = locale
  document.title = t('app.title')
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

  function cycle(): void {
    mode.value = mode.value === 'system' ? 'zh-CN' : mode.value === 'zh-CN' ? 'en' : 'system'
  }

  function select(next: LanguageMode): void {
    mode.value = next
  }

  return { mode, cycle, select }
}
