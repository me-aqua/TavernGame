/**
 * 设置页的「可选项按钮族」：选中 = **深底浅字**（active 那一对，对比度 ≥ 4.5），未选中 = 浅底深字，悬停只换边框。
 *
 * 现状：设置页里唯一带 `aria-pressed` 的按钮族是**主题**（`[data-theme="light"|"dark"]`，两枚）；
 * 其余控件是 `<select>` / 输入框，不是「按钮族」。判据里带一条 `[aria-pressed]` 计数守卫：
 * 以后再加新的可选按钮族，这一条会先红 —— 提醒把它也纳入同样的口径，而不是漏判。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, makeCard, MOCK_PRESET, route } from './support/app.js'

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

/** 读一个元素的计算样式 + 根上几对 token */
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
      pressed: element.getAttribute('aria-pressed'),
      background: style.backgroundColor,
      color: style.color,
      border: style.borderTopColor,
      accent: resolve('--accent'),
      accentInk: resolve('--accent-ink'),
      activeBg: resolve('--active-bg'),
      activeInk: resolve('--active-ink'),
      panel: resolve('--panel'),
      ink: resolve('--ink'),
    }
  })()`)
}

/** 选中态（不预设深浅）：用 active 那一对 token + 对比度 ≥ 4.5（深色主题下 accent 本身是浅色） */
function expectSelectedPair(reading, label) {
  expect(reading.missing, `${label}：元素不存在`).toBeUndefined()
  expect(reading.pressed, `${label}：不是 aria-pressed="true"`).toBe('true')
  expect([reading.accent, reading.activeBg], `${label}：底色既不是 --accent 也不是 --active-bg`).toContain(
    reading.background,
  )
  expect([reading.accentInk, reading.activeInk], `${label}：字色不是浅字那一对`).toContain(reading.color)
  const ratio = contrast(reading.color, reading.background)
  expect(ratio, `${label}：字底对比度只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
}

/** 选中态：深底浅字（`--accent` / `--active-bg` 那一对都算），字比底亮，对比度 ≥ 4.5 */
function expectSelected(reading, label) {
  expectSelectedPair(reading, label)
  expect(luminance(reading.color), `${label}：字不是浅色（应当比底色亮）`).toBeGreaterThan(
    luminance(reading.background),
  )
}

/** 未选中态：浅底（panel）+ 深字（ink） */
function expectUnselected(reading, label) {
  expect(reading.missing, `${label}：元素不存在`).toBeUndefined()
  expect(reading.pressed, `${label}：不是 aria-pressed="false"`).toBe('false')
  expect(reading.background, `${label}：底色不是 --panel`).toBe(reading.panel)
  expect(reading.color, `${label}：字色不是 --ink`).toBe(reading.ink)
  expect(luminance(reading.color), `${label}：不是「浅底深字」`).toBeLessThan(luminance(reading.background))
  expect(reading.background, `${label}：未选中却用了 active 深底`).not.toBe(reading.activeBg)
}

test.beforeEach(async ({ page }) => {
  await boot(page, {
    storage: { [KEYS.cards]: [makeCard()], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.settings,
  })
  await expect(page.locator('[data-page="settings"]')).toBeVisible()
})

test('主题：选中的一枚是深底浅字，另一枚是浅底深字；悬停只换边框', async ({ page }) => {
  // 守卫：设置页里「可选按钮族」目前只有主题那两枚；出现新的族要一起纳入判据
  await expect(
    page.locator('[aria-pressed]'),
    '设置页出现了新的可选按钮族 —— 它也要按同一口径判（见本文件头）',
  ).toHaveCount(2)

  const light = await readStyle(page, 'button[data-theme="light"]')
  const dark = await readStyle(page, 'button[data-theme="dark"]')
  expectSelected(light, '选中的「浅色」')
  expectUnselected(dark, '未选中的「深色」')

  // 悬停「只许改边框」：选中项的底色 / 字色一个都不许变（边框变不变都行 —— 本来就可能同色）
  await page.locator('button[data-theme="light"]').hover()
  const hoveredSelected = await readStyle(page, 'button[data-theme="light"]')
  expect(hoveredSelected.background, '悬停把选中项的底色改了').toBe(light.background)
  expect(hoveredSelected.color, '悬停把选中项的字色改了').toBe(light.color)

  // 未选中项悬停：只换边框（底色 / 字色不动）
  await page.locator('button[data-theme="dark"]').hover()
  const hoveredUnselected = await readStyle(page, 'button[data-theme="dark"]')
  expect(hoveredUnselected.border, '未选中项悬停应当换边框（边框却没变）').not.toBe(dark.border)
  expect(hoveredUnselected.background, '悬停把未选中项的底色改了').toBe(dark.background)
  expect(hoveredUnselected.color, '悬停把未选中项的字色改了').toBe(dark.color)
})

test('切到深色主题：选中的那一枚跟着换（用 active 那一对 + 对比度 ≥ 4.5），另一枚仍用 panel / ink', async ({
  page,
}) => {
  await page.locator('button[data-theme="dark"]').click()
  await expect(page.locator('button[data-theme="dark"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('button[data-theme="light"]')).toHaveAttribute('aria-pressed', 'false')

  // 深色主题下 `--accent` 本身是浅色 ⇒ 这一格只判「用的是 active 那一对 + 对比度」，不预设谁深谁浅
  expectSelectedPair(await readStyle(page, 'button[data-theme="dark"]'), '深色主题下选中的「深色」')
  const light = await readStyle(page, 'button[data-theme="light"]')
  expect(light.pressed).toBe('false')
  expect(light.background, '深色主题下未选中项的底色不是 --panel').toBe(light.panel)
  expect(light.color, '深色主题下未选中项的字色不是 --ink').toBe(light.ink)
})
