/**
 * 列表行的三态样式（这一版口径）：**默认 `--panel` 底；悬停边框变深；选中 = 深强调底 + 浅字**。
 *
 * 管三类行：首页的卡行 / 存档行、编辑器右栏的公共提示词块。
 * 只认计算值：默认底 = `--panel`；悬停后边框的相对亮度**比默认更低**（「更深」按亮度量，不钉色号）；
 * 选中的底 / 字 = `--accent` / `--accent-ink`，且字底对比度 ≥ 4.5。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, makeCard, makeSave, MOCK_PRESET, route } from './support/app.js'

const CARD_ID = 'c1'

/** WCAG 相对亮度 */
function luminance(rgb) {
  const [r, g, b] = rgb
    .match(/\d+(?:\.\d+)?/g)
    .slice(0, 3)
    .map(Number)
  const channel = (value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** 读一个元素的计算样式 + 根上那几对 token */
async function readStyle(page, selector) {
  return page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return { missing: ${JSON.stringify(selector)} }
    const resolve = (name) => {
      const probe = document.createElement('span')
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      document.body.appendChild(probe)
      const value = getComputedStyle(probe).color
      probe.remove()
      return value
    }
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      color: style.color,
      border: style.borderTopColor,
      accent: resolve('--accent'),
      accentInk: resolve('--accent-ink'),
      panel: resolve('--panel'),
    }
  })()`)
}

test('首页卡行 / 存档行：默认 panel 底，悬停边框更深，选中的卡行 = 深强调底 + 浅字', async ({ page }) => {
  const card = makeCard()
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [MOCK_PRESET] },
  })
  await expect(page.locator('[data-page="home"]')).toBeVisible()

  const row = `[data-card-id="${CARD_ID}"]`
  const saveRow = '[data-save-id="s1"]'
  for (const selector of [row, saveRow]) {
    const idle = await readStyle(page, selector)
    expect(idle.missing, `${selector} 不存在`).toBeUndefined()
    expect(idle.background, `${selector} 默认底色不是 --panel`).toBe(idle.panel)

    await page.locator(selector).hover()
    const hovered = await readStyle(page, selector)
    expect(hovered.border, `${selector} 悬停边框没变`).not.toBe(idle.border)
    expect(
      luminance(hovered.border),
      `${selector} 悬停边框不是「更深」（亮度 ${luminance(hovered.border).toFixed(3)} ≥ 默认 ${luminance(idle.border).toFixed(3)}）`,
    ).toBeLessThan(luminance(idle.border))
    expect(hovered.background, `${selector} 悬停不该改底色`).toBe(idle.background)
    await page.mouse.move(2, 600)
  }

  // 选中卡行：深强调底 + 浅字
  await page.locator(row).click()
  const selected = await readStyle(page, row)
  expect(selected.background, '选中的卡行底色不是 --accent').toBe(selected.accent)
  expect(selected.color, '选中的卡行字色不是 --accent-ink').toBe(selected.accentInk)
  expect(contrast(selected.color, selected.background), '选中行对比度不足').toBeGreaterThanOrEqual(4.5)
})

test('公共提示词块：默认 panel 底，悬停边框更深，选中 = 深强调底 + 浅字', async ({ page }) => {
  await boot(page, {
    storage: { [KEYS.cards]: [makeCard()], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(CARD_ID),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()

  const block = '[data-prompt-block="pr1"]'
  const idle = await readStyle(page, block)
  expect(idle.background, '提示词块默认底色不是 --panel').toBe(idle.panel)

  await page.locator(block).hover()
  const hovered = await readStyle(page, block)
  expect(hovered.border, '提示词块悬停边框没变').not.toBe(idle.border)
  expect(luminance(hovered.border), '提示词块悬停边框不是「更深」').toBeLessThan(luminance(idle.border))

  await page.locator(block).click()
  await expect(page.locator(block)).toHaveAttribute('data-selected', 'true')
  const selected = await readStyle(page, block)
  expect(selected.background, '选中的提示词块底色不是 --accent').toBe(selected.accent)
  expect(selected.color, '选中的提示词块字色不是 --accent-ink').toBe(selected.accentInk)
  expect(contrast(selected.color, selected.background), '选中块对比度不足').toBeGreaterThanOrEqual(4.5)
})
