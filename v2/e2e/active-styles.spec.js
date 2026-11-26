/**
 * 选中 / 开启态的配色（老板这一版）：**active = 浅暖棕底 + 深字**，与 `--accent`（强调色）分开。
 *
 * 三处共用同一对 token：`--active-bg #b08a5e` · `--active-ink #2b2118`
 *   · 工作流细条的**选中节点**；
 *   · 状态树上**开着的**读 / 写 chip；
 *   · 对话页**开着的**调试开关（那条在 `play.spec.js` 里判，这里判前两处）。
 *
 * 判据钉五样：开着 = 这对 token（解析后的计算值逐字相等）+ 对比度 ≥ 4.5；
 * 关着保持原样（panel-2 / ink）；悬停不许把开着的改回强调色；未选中的节点保持普通按钮色。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, makeCard, MOCK_PRESET, route } from './support/app.js'

const CARD_ID = 'c1'

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

/** 对比度（浅字压深底 / 深字压浅底 都按这个公式） */
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
      activeBg: resolve('--active-bg'),
      activeInk: resolve('--active-ink'),
      panel: resolve('--panel'),
      panel2: resolve('--panel-2'),
      ink: resolve('--ink'),
      accent: resolve('--accent'),
    }
  })()`)
}

/** 开着的那一格：底色 / 字色 / 边框都是 active 那对 token，且字底对比度 ≥ 4.5 */
function expectActive(reading, label) {
  expect(reading.missing, `${label}：元素不存在`).toBeUndefined()
  expect(reading.background, `${label}：底色不是 --active-bg`).toBe(reading.activeBg)
  expect(reading.color, `${label}：字色不是 --active-ink`).toBe(reading.activeInk)
  const ratio = contrast(reading.color, reading.background)
  expect(ratio, `${label}：字底对比度只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
}

test.beforeEach(async ({ page }) => {
  await boot(page, {
    storage: { [KEYS.cards]: [makeCard()], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(CARD_ID),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
})

test('读 / 写 chip：开着用 active 那对 token（对比度 ≥ 4.5），关着不变，悬停不覆盖', async ({ page }) => {
  // 选中判定节点：reads 为空（读 chip 全关）、writable ['1','2']（元素 1/2 的写 chip 开）
  await page.locator('[data-node-id="check"]').click()

  const offChip = '[data-state-item="1"] [data-eyes="read"]'
  const onChip = '[data-state-item="1"] [data-eyes="write"]'
  await expect(page.locator(onChip)).toHaveAttribute('data-on', 'true')

  const on = await readStyle(page, onChip)
  expectActive(on, '开着的写 chip')
  expect(on.accent, '--active-bg 不该还是 --accent').not.toBe(on.activeBg)

  const off = await readStyle(page, offChip)
  expect(off.background, '关着的 chip 底色被改了').toBe(off.panel2)
  expect(off.color, '关着的 chip 字色被改了').toBe(off.ink)
  expect(off.background, '关着的 chip 也用了 active 底色').not.toBe(off.activeBg)

  // 悬停：开着的不许被 hover 规则改掉
  await page.locator(onChip).hover()
  const hovered = await readStyle(page, onChip)
  expect(hovered.background, '悬停把开着的 chip 底色改了').toBe(on.background)
  expect(hovered.color, '悬停把开着的 chip 字色改了').toBe(on.color)
})

test('工作流选中节点：用 active 那对 token（对比度 ≥ 4.5），未选中的保持普通按钮色', async ({ page }) => {
  await page.locator('[data-node-id="check"]').click()
  const selected = await readStyle(page, '[data-node-id="check"][data-selected="true"]')
  expectActive(selected, '选中的工作流节点')

  const idle = await readStyle(page, '[data-node-id="time"]')
  expect(idle.background, '未选中的节点底色被改了').toBe(idle.panel)
  expect(idle.color, '未选中的节点字色被改了').toBe(idle.ink)
  expect(idle.background, '未选中的节点也用了 active 底色').not.toBe(idle.activeBg)
})
