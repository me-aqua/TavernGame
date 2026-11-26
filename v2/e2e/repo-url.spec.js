/**
 * 库址条（`[data-repo-url]`）：**每一屏的页栏正中都有项目仓库地址**。
 *
 * 现状：它不是「页面顶上单独一行」，而是**页栏里绝对居中的一行小字**
 * （`App.vue` 的 `.repo-center` 铺满页栏、`pointer-events: none`；链接本身接指针）。
 * 所以判据钉五样（1280×720）：
 *   ① `[data-repo-url]` 可见，`href` 与 `data-repo-url` 逐字是仓库地址；
 *   ② **文字**在整个视口的正中（±1px）—— 量文字（`Range`），不量盒子；
 *      盒子/包裹层是铺满页栏的，拿它判「居中」等于空断言；
 *   ③ 落在页栏里（纵向不越出页栏 = 「在顶上」，不是浮在页面中间）；
 *   ④ 不压页栏里的**其它内容**（页标题 / 返回 / 回合数 / 状态 / 调试开关 / 页栏按钮）——
 *      几何上不许相交；`.repo-center` 那层 `pointer-events: none` 只保「点得到按钮」，
 *      保不了「看着不叠字」，所以这一条要量盒子；
 *   ⑤ 高度不超过一行控件（≤ 24px），别把页栏撑高。
 *
 * ⚠️ 六屏都量：首页 / 编辑器 / 对话页 / 设置 / 启动失败 / 未知路由 —— 库址条挂在外壳上，
 * 不随路由走；错误页也是同一套页栏。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, makeCard, makeSave, MOCK_PRESET, route } from './support/app.js'

const CARD_ID = 'c1'
/** 作业时钉死的仓库地址（与 `App.vue` 的 REPO_URL 同一个字面量） */
const REPO = 'https://github.com/me-aqua/TavernGame'
/** 这一层的工位（`playwright.visual.config.mjs` 的视口；e2e 的 Desktop Chrome 也是它） */
const VIEWPORT = { width: 1280, height: 720 }
/** 页栏里「其它内容」：这些盒子与库址条不许相交 */
const OTHER_IN_BAR = [
  '.page-title',
  '[data-back]',
  '[data-turn]',
  '[data-status]',
  '[data-debug-toggle]',
  'header button',
]

/** 一屏的公共种子：一张卡 + 一份存档 + 一个 mock 预设 */
function seeded() {
  const card = makeCard()
  return { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [MOCK_PRESET] }
}

/**
 * 量库址条：链接盒子 + **文字**矩形 + 页栏盒子 + 页栏里其它内容的盒子。
 * 文字用 `Range` 取矩形（模板里的换行 / 缩进在同一个文本节点里，先把首尾空白切掉）。
 */
async function readStrip(page) {
  return page.evaluate(`(() => {
    const strip = document.querySelector('[data-repo-url]')
    const bar = document.querySelector('[data-page] header')
    if (!strip || !bar) return { missing: !strip ? 'strip' : 'bar' }
    const boxOf = (element) => {
      const r = element.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    const range = document.createRange()
    const node = strip.firstChild
    if (node && node.nodeType === 3) {
      const raw = node.textContent
      range.setStart(node, raw.length - raw.trimStart().length)
      range.setEnd(node, raw.trimEnd().length)
    } else {
      range.selectNodeContents(strip)
    }
    const text = range.getBoundingClientRect()
    const others = []
    for (const selector of ${JSON.stringify(OTHER_IN_BAR)}) {
      for (const element of document.querySelectorAll(selector)) {
        if (element.contains(strip) || strip.contains(element)) continue
        others.push({ selector, ...boxOf(element) })
      }
    }
    return {
      href: strip.getAttribute('href'),
      hook: strip.getAttribute('data-repo-url'),
      tag: strip.tagName.toLowerCase(),
      box: boxOf(strip),
      bar: boxOf(bar),
      text: { left: text.left, right: text.right, centerX: text.left + text.width / 2 },
      others,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }
  })()`)
}

/** 相交面积（>0 即「叠上了」） */
function overlapArea(a, b) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return width > 0 && height > 0 ? width * height : 0
}

/** 五样判据一次判完；`label` 只用来让失败信息指名是哪一屏 */
function expectStrip(reading, label) {
  expect(reading.missing, `${label}：页面上找不到库址条 / 页栏`).toBeUndefined()
  expect(reading.tag, `${label}：库址条不是链接`).toBe('a')
  expect(reading.href, `${label}：href 不是仓库地址`).toBe(REPO)
  expect(reading.hook, `${label}：data-repo-url 与 href 不是同一个地址`).toBe(REPO)
  expect(reading.viewportWidth).toBe(VIEWPORT.width)
  expect(reading.viewportHeight).toBe(VIEWPORT.height)

  // ② 文字在视口正中（±1px）：量文字，不量铺满页栏的盒子
  expect(
    Math.abs(reading.text.centerX - reading.viewportWidth / 2),
    `${label}：库址条文字没有居中（中心 ${reading.text.centerX}，视口中心 ${reading.viewportWidth / 2}）`,
  ).toBeLessThanOrEqual(1)

  // ③ 落在页栏里（= 在顶上），且只有一行控件高
  expect(reading.box.top, `${label}：库址条跑到页栏上面去了`).toBeGreaterThanOrEqual(reading.bar.top - 0.5)
  expect(reading.box.bottom, `${label}：库址条越出页栏下缘`).toBeLessThanOrEqual(reading.bar.bottom + 0.5)
  expect(reading.box.height, `${label}：库址条太高（${reading.box.height}px）`).toBeGreaterThan(0)
  expect(reading.box.height, `${label}：库址条太高（${reading.box.height}px）`).toBeLessThanOrEqual(24)

  // ④ 不压页栏里的其它内容（至少要有页标题，否则这一条空转）
  expect(reading.others.length, `${label}：页栏里没有可判的内容（判据会空转）`).toBeGreaterThan(0)
  for (const other of reading.others) {
    expect(
      overlapArea(reading.box, other),
      `${label}：库址条压住了 ${other.selector}（条子 ${JSON.stringify(reading.box)}，对方 ${JSON.stringify(other)}）`,
    ).toBe(0)
  }
}

test.describe('库址条：六屏页栏正中、文字居中、不压页栏里的其它内容', () => {
  test('首页', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page), '首页')
  })

  test('编辑器', async ({ page }) => {
    await boot(page, { storage: seeded(), hash: route.edit(CARD_ID) })
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page), '编辑器')
  })

  test('对话页', async ({ page }) => {
    await boot(page, { storage: seeded(), hash: route.play(CARD_ID, 's1') })
    await expect(page.locator('[data-page="play"]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page), '对话页')
  })

  test('设置页', async ({ page }) => {
    await boot(page, { storage: seeded(), hash: route.settings })
    await expect(page.locator('[data-page="settings"]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page), '设置页')
  })

  test('启动失败（坏 settings）：错误页也有，且不压页栏', async ({ page }) => {
    await boot(page, { sample: true, storage: { [KEYS.settings]: '{not json' } })
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page), '启动失败')
  })

  test('未知路由：错误页也有，且不压页栏', async ({ page }) => {
    await boot(page, { hash: '#/no-such-page' })
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page), '未知路由')
  })
})
