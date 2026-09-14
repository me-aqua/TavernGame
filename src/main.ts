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
import { isDevHost, useGame } from './stores/game'
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

// 本机开发（localhost / 127.0.0.1）默认打开调试模式：故事区会多出
// 模型的输入输出与工具调用。线上域名不会命中，玩家看不到这些。
useGame().debugMode.value = isDevHost(location.hostname)

createApp(App).use(i18n).mount('#app')

// Exposed for the e2e run (and for poking at translations in the console). The
// e2e asserts app messages through this table instead of hard-coding a copy of
// the text, so a wording change cannot make the suite assert stale text.
window.__dshE2E = { i18n }
