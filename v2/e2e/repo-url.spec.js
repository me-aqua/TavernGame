/**
 * 库址条（`App.vue` 的 `.repo-strip`）：**每一屏顶上都有一条项目仓库地址**。
 *
 * 它挂在路由之外 —— 首页 / 编辑器 / 对话页 / 设置 / 启动失败 / 未知路由六种画面都该有；
 * 它是 `.app-root` 这个纵向 flex 的第一行，**占自己的高度**（19px），页栏整体下移一格：
 * 所以判据钉四样（1280×720）：
 *   ① `[data-repo-url]` 可见，`href` 逐字是仓库地址；
 *   ② **文字**在视口正中（±1px）—— 量文字（`Range`），不量盒子；
 *      盒子是满宽块级元素，中心永远等于视口中心，拿它判「居中」等于空断言；
 *   ③ 贴在顶上（top = 0，条高 ≤ 24），不是浮在中间；
 *   ④ 不压页栏：条子的下缘不得进到页面内容（页栏 / 错误面板）的上缘里。
 *
 * ⚠️ 为什么第 ④ 条要单独量：条子曾经的设计是「贴在顶上的浮层」——`position: fixed` 会压在
 * `.page-bar` 的字上（页栏从 y=0 起就有 8px 内边距）。改成占位的第一行之后，判据量的是**几何不重叠**，
 * 不是「看起来没事」。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, makeCard, makeSave, MOCK_PRESET, route } from './support/app.js'

const CARD_ID = 'c1'
/** 作业时钉死的仓库地址（与 `App.vue` 的 REPO_URL 同一个字面量） */
const REPO = 'https://github.com/me-aqua/TavernGame'
/** 这一层的工位（`playwright.visual.config.mjs` 的视口；e2e 的 Desktop Chrome 也是它） */
const VIEWPORT = { width: 1280, height: 720 }

/** 一屏的公共种子：一张卡 + 一份存档 + 一个 mock 预设 */
function seeded() {
  const card = makeCard()
  return { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [MOCK_PRESET] }
}

/**
 * 量库址条：盒子 + **文字** + 这一屏内容的上缘。
 * 文字用 `Range.selectNodeContents` 取矩形 —— 条子里只有一个文本节点。
 */
async function readStrip(page, contentSelector) {
  return page.evaluate(`(() => {
    const strip = document.querySelector('[data-repo-url]')
    const content = document.querySelector(${JSON.stringify(contentSelector)})
    const box = strip.getBoundingClientRect()
    // 量「文字本身」：模板里的换行 / 缩进会进同一个文本节点，先把首尾空白切掉再取矩形
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
    const other = content ? content.getBoundingClientRect() : null
    return {
      href: strip.getAttribute('href'),
      hook: strip.getAttribute('data-repo-url'),
      tag: strip.tagName.toLowerCase(),
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height },
      text: { left: text.left, right: text.right, centerX: text.left + text.width / 2 },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      contentTop: other ? other.top : null,
    }
  })()`)
}

/** 四样判据一次判完；`label` 只用来让失败信息指名是哪一屏 */
function expectStrip(reading, label) {
  expect(reading.tag, `${label}：库址条不是链接`).toBe('a')
  expect(reading.href, `${label}：href 不是仓库地址`).toBe(REPO)
  expect(reading.hook, `${label}：data-repo-url 与 href 不是同一个地址`).toBe(REPO)
  expect(reading.viewportWidth).toBe(VIEWPORT.width)
  expect(reading.viewportHeight).toBe(VIEWPORT.height)

  // ② 文字在视口正中（±1px）：量文字，不量满宽盒子
  expect(
    Math.abs(reading.text.centerX - reading.viewportWidth / 2),
    `${label}：库址条的文字没有居中（中心 ${reading.text.centerX}，视口中心 ${reading.viewportWidth / 2}）`,
  ).toBeLessThanOrEqual(1)

  // ③ 贴在顶上
  expect(reading.box.top, `${label}：库址条不在顶上（top=${reading.box.top}）`).toBeGreaterThanOrEqual(0)
  expect(reading.box.top, `${label}：库址条不在顶上（top=${reading.box.top}）`).toBeLessThanOrEqual(1)
  expect(reading.box.height, `${label}：库址条太高（${reading.box.height}px）`).toBeGreaterThan(0)
  expect(reading.box.height, `${label}：库址条太高（${reading.box.height}px）`).toBeLessThanOrEqual(24)

  // ④ 不压页栏：内容的上缘必须在条子下缘之下
  expect(reading.contentTop, `${label}：这一屏没有内容，没法量重叠`).not.toBeNull()
  expect(
    reading.contentTop,
    `${label}：库址条压住了页面内容（条子下缘 ${reading.box.bottom}，内容上缘 ${reading.contentTop}）`,
  ).toBeGreaterThanOrEqual(reading.box.bottom - 0.5)
}

test.describe('库址条：六屏都有、顶上居中、不压页栏', () => {
  test('首页', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    const strip = page.locator('[data-repo-url]')
    await expect(strip).toBeVisible()
    expectStrip(await readStrip(page, '[data-page="home"] header'), '首页')
  })

  test('编辑器', async ({ page }) => {
    await boot(page, { storage: seeded(), hash: route.edit(CARD_ID) })
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page, '[data-page="editor"] header'), '编辑器')
  })

  test('对话页', async ({ page }) => {
    await boot(page, { storage: seeded(), hash: route.play(CARD_ID, 's1') })
    await expect(page.locator('[data-page="play"]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page, '[data-page="play"] header'), '对话页')
  })

  test('设置页', async ({ page }) => {
    await boot(page, { storage: seeded(), hash: route.settings })
    await expect(page.locator('[data-page="settings"]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page, '[data-page="settings"] header'), '设置页')
  })

  test('启动失败（坏 settings）：错误页上也有，且不压错误面板', async ({ page }) => {
    await boot(page, { sample: true, storage: { [KEYS.settings]: '{not json' } })
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page, '[data-error]'), '启动失败')
  })

  test('未知路由：错误页上也有，且不压错误面板', async ({ page }) => {
    await boot(page, { hash: '#/no-such-page' })
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-repo-url]')).toBeVisible()
    expectStrip(await readStrip(page, '[data-error]'), '未知路由')
  })
})
