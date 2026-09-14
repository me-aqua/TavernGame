/**
 * 文字能不能复制：正文（.story-text / .trace）必须可选，控件保持不可选。
 *
 * 判据是**计算样式**而不是「模拟拖选」：user-select 是浏览器用来决定
 * 「鼠标能不能选中」的开关，查它比模拟拖动稳定（拖动在无头环境里不可靠）。
 */
import { expect, test } from '@playwright/test'
import { CONFIG, openApp, saveWith } from './fixtures'

test('story text is selectable, the chrome is not', async ({ page }) => {
  await openApp(page, { save: saveWith(), config: CONFIG })

  const style = await page.evaluate(() => {
    const story = document.querySelector('.line.narration') ?? document.querySelector('.line')
    const chrome = document.querySelector('button[data-settings]')
    return {
      story: story ? getComputedStyle(story).userSelect : 'missing',
      chrome: chrome ? getComputedStyle(chrome).userSelect : 'missing',
    }
  })

  expect(style.story, '故事正文必须能选中复制').toBe('text')
  expect(style.chrome, '控件保持不可选').toBe('none')
})
