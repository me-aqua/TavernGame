/**
 * 深浅色主题。
 *
 * 三种取值：
 *   'system' —— 跟随系统（默认）
 *   'light' / 'dark' —— 玩家手动指定
 *
 * 为什么要有 'system'：大多数玩家不会去改设置，跟随系统开箱即用；
 * 手动指定则记住偏好（localStorage）。
 *
 * ⚠️ 首屏闪烁：index.html 里有一段内联脚本，在 Vue 挂载前就把 .dark
 *    加到 <html> 上 —— 否则会先亮一下再变暗。
 */
import { ref, watch } from 'vue'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'tavernGame.theme'
const mode = ref<ThemeMode>('system')
let initialized = false

/** 系统当前是否偏好深色 */
function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** 把模式落到 DOM 上 */
function apply(next: ThemeMode): void {
  const dark = next === 'dark' || (next === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

/** 读玩家存过的主题偏好；没存过或不合法都当 'system' */
function readStored(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/** 应用主题（App.vue 挂载时调用一次；重复调用无副作用） */
export function useTheme() {
  if (!initialized) {
    initialized = true
    mode.value = readStored()
    apply(mode.value)

    watch(mode, (next) => {
      localStorage.setItem(STORAGE_KEY, next)
      apply(next)
    })

    // 跟随系统时，系统换了主题要跟着换
    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (mode.value === 'system') apply('system')
      })
    }
  }

  /** 三态循环：system → light → dark → system */
  function cycle(): void {
    mode.value = mode.value === 'system' ? 'light' : mode.value === 'light' ? 'dark' : 'system'
  }

  /** 直接选（设置面板用），与 useLanguage 的 select 同构 */
  function select(next: ThemeMode): void {
    mode.value = next
  }

  return { mode, cycle, select }
}
