/**
 * 选中 / 开启态的配色（**反色修正**）：active / selected = **深底浅字**，inactive = 浅底深字。
 *
 * 三处共用强调色那一对：`--accent`（深底）+ `--accent-ink`（浅字）
 *   · 工作流细条的**选中节点**；
 *   · 状态树上**开着的**读 / 写 chip；
 *   · 对话页**开着的**调试开关（那条在 `play.spec.js` 里判）。
 *
 * 判据钉五样：开着 = `--accent` / `--accent-ink`（计算值逐字相等）+ 字底对比度 ≥ 4.5 + **字比底亮**；
 * 关着 = 浅底（`panel-2` / `panel`）+ 深字（`ink`）；悬停不许把开着的改掉；未选中的节点保持普通按钮色。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, makeCard, MOCK_PRESET, route } from './support/app.js'

/** WCAG 相对亮度（只看前三个通道） */
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

/** 对比度（不假设谁深谁浅：亮的一侧在上） */
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** 读一个元素的计算样式 + 根上几对 token 的解析值 */
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
      weight: Number(style.fontWeight),
      accent: resolve('--accent'),
      accentInk: resolve('--accent-ink'),
      activeBg: resolve('--active-bg'),
      activeInk: resolve('--active-ink'),
      panel: resolve('--panel'),
      panel2: resolve('--panel-2'),
      ink: resolve('--ink'),
    }
  })()`)
}

/** 开着的那一格：**深底浅字**。卡面允许 `--accent` 那一对，也允许另一对深底 / 浅字 token；两种都算对。 */
function expectActive(reading, label) {
  expect(reading.missing, `${label}：元素不存在`).toBeUndefined()
  expect([reading.accent, reading.activeBg], `${label}：底色既不是 --accent 也不是 --active-bg`).toContain(
    reading.background,
  )
  expect(
    [reading.accentInk, reading.activeInk],
    `${label}：字色既不是 --accent-ink 也不是 --active-ink`,
  ).toContain(reading.color)
  expect(luminance(reading.color), `${label}：字不是浅色（应当比底色亮）`).toBeGreaterThan(
    luminance(reading.background),
  )
  const ratio = contrast(reading.color, reading.background)
  expect(ratio, `${label}：字底对比度只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
}

test.beforeEach(async ({ page }) => {
  await boot(page, {
    storage: { [KEYS.cards]: [makeCard()], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit('c1'),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
})

test('读 / 写 chip：开着 = 深底浅字（对比度 ≥ 4.5），关着 = 浅底深字，悬停不覆盖', async ({ page }) => {
  // 选中判定节点：reads 为空（读 chip 全关）、writable ['1','2']（元素 1/2 的写 chip 开）
  await page.locator('[data-node-id="check"]').click()

  const offChip = '[data-state-item="1"] [data-eyes="read"]'
  const onChip = '[data-state-item="1"] [data-eyes="write"]'
  await expect(page.locator(onChip)).toHaveAttribute('data-on', 'true')

  const on = await readStyle(page, onChip)
  expectActive(on, '开着的写 chip')
  expect(on.background, '开着的底色不是 --active-bg（这一版是 #927049）').toBe(on.activeBg)
  expect(on.activeBg, '--active-bg 不是 #927049').toBe('rgb(146, 112, 73)')
  expect(on.weight, '开着的 chip 不是 600 字重').toBeGreaterThanOrEqual(600)

  const off = await readStyle(page, offChip)
  expect(off.background, '关着的 chip 底色不是浅底').toBe(off.panel2)
  expect(off.color, '关着的 chip 字色不是深字').toBe(off.ink)
  expect(luminance(off.color), '关着的 chip 不是「浅底深字」').toBeLessThan(luminance(off.background))
  expect(off.weight, '关着的 chip 不该加粗（应是 400）').toBeLessThan(600)

  // 悬停：开着的不许被 hover 规则改掉
  await page.locator(onChip).hover()
  const hovered = await readStyle(page, onChip)
  expect(hovered.background, '悬停把开着的 chip 底色改了').toBe(on.background)
  expect(hovered.color, '悬停把开着的 chip 字色改了').toBe(on.color)
})

test('工作流选中节点：深底浅字 + 600（对比度 ≥ 4.5），未选中的保持普通按钮色 / 400', async ({ page }) => {
  await page.locator('[data-node-id="check"]').click()
  const selected = await readStyle(page, '[data-node-id="check"][data-selected="true"]')
  expectActive(selected, '选中的工作流节点')
  expect(selected.weight, '选中的节点不是 600 字重').toBeGreaterThanOrEqual(600)

  const idle = await readStyle(page, '[data-node-id="time"]')
  expect(idle.background, '未选中的节点底色被改了').toBe(idle.panel)
  expect(idle.color, '未选中的节点字色被改了').toBe(idle.ink)
  expect(luminance(idle.color), '未选中的节点不是「浅底深字」').toBeLessThan(luminance(idle.background))
  expect(idle.weight, '未选中的节点不该加粗（应是 400）').toBeLessThan(600)
})

test('状态树选中行：深底浅字 + 600（对比度 ≥ 4.5），未选中的保持浅底深字 / 400', async ({ page }) => {
  await page.locator('[data-node-id="check"]').click()
  // S2：点一行状态元素把它选中（状态行用 `.selected` 类标，不是 data 属性）
  await page.locator('[data-state-item="1"]').click()
  await expect(page.locator('[data-state-item="1"].selected')).toHaveCount(1)

  const selected = await readStyle(page, '[data-state-item="1"].selected')
  expectActive(selected, '选中的状态行')
  expect(selected.weight, '选中的状态行不是 600 字重').toBeGreaterThanOrEqual(600)

  const idle = await readStyle(page, '[data-state-item="2"]')
  expect(idle.background, '未选中的状态行底色不是 --panel').toBe(idle.panel)
  expect(idle.color, '未选中的状态行字色不是 --ink').toBe(idle.ink)
  expect(idle.weight, '未选中的状态行不该加粗（应是 400）').toBeLessThan(600)
})
