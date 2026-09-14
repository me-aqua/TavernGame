/**
 * src/main.ts —— 应用入口：装 i18n、挂载根组件、引入全局样式。
 */
import { createApp } from 'vue'
import App from './App.vue'
import { i18n, readStoredLanguage, resolveLocale, type Locale } from './i18n'
import { isDevHost, readStoredDebug, resolveDebug, useGame } from './stores/game'
import './styles/main.css'

/**
 * 挂载**之前**先把语言定下来。
 *
 * ⚠️ store 在模块图求值时就会建初始存档（App 的 setup 调 useGame），这早于
 *    useLanguage() 在挂载时运行。少了这一步，首局会以兜底语言写进存档 ——
 *    中文界面下侧栏会显示 "Unknown place"。
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

// 暴露给 e2e（也方便在控制台查文案）：e2e 通过它取文案而不是抄一份字符串，
// 改文案时断言不会对着过期文本继续通过。
window.__dshE2E = { i18n }
