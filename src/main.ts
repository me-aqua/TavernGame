/**
 * Application entry point.
 *
 * Vite starts bundling here: install i18n, mount the root component,
 * pull in global styles.
 *
 * ⚠️ `src/locales/*.json` is the only place Chinese is allowed in code;
 * everything else is ASCII (enforced by .githooks/checks/ascii.mjs).
 */
import { createApp } from 'vue'
import App from './App.vue'
import { i18n, readStoredLanguage, resolveLocale, type Locale } from './i18n'
import { isDevHost, readStoredDebug, resolveDebug, useGame } from './stores/game'
import './styles/main.css'

/**
 * Apply the player's language *before* mounting.
 *
 * ⚠️ The store builds the initial save while the module graph is evaluated (App's
 * setup calls useGame), which happens before useLanguage() can run on mount.
 * Without this, a first-run game is written in the fallback language and stored
 * that way — the sidebar showed "Unknown place" under a Chinese UI.
 */
const locale: Locale = resolveLocale(readStoredLanguage(), navigator.language)
;(i18n.global.locale as unknown as { value: Locale }).value = locale
document.documentElement.lang = locale

// 调试模式：显式选过就照它（顶栏开关会记住），没选过则本机开发默认打开 ——
// 线上域名两条都不命中，玩家看不到模型 I/O。入口是唯一知道 location 的地方。
const game = useGame()
game.devHost.value = isDevHost(location.hostname)
game.debugMode.value = resolveDebug(readStoredDebug(), game.devHost.value)

createApp(App).use(i18n).mount('#app')

// Exposed for the e2e run (and for poking at translations in the console). The
// e2e asserts app messages through this table instead of hard-coding a copy of
// the text, so a wording change cannot make the suite assert stale text.
window.__dshE2E = { i18n }
