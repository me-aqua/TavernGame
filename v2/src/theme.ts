/**
 * 主题：浅色 / 深色。
 *
 * 真源是 **`<html>` 上的 `data-theme` 属性**（CSS 只认它），组件不各存一份；
 * 设置页点一下就先改属性、再落盘 —— 视觉立刻变，刷新后由 `main.ts` 读回来。
 */
import { ref } from 'vue'

export type Theme = 'light' | 'dark'

export const theme = ref<Theme>('light')

// 切主题：先改 <html data-theme>（视觉立刻生效），再更新 ref
export function setTheme(next: Theme): void {
  theme.value = next
  document.documentElement.dataset.theme = next
}
