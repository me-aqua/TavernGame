/**
 * SPEC §9.6：编辑器三栏可拖宽、**工作流细条宽度固定**、双击恢复默认、刷新后保留。
 *
 * 🔴 **方向是判据的一部分**（第 1 轮评审 P1）：
 *   · `[data-splitter="left"]` 在**左栏的右缘** ⇒ 往**右**拖 = 左栏变宽；
 *   · `[data-splitter="right"]` 在**右栏的左缘** ⇒ 往**左**拖 = 右栏变宽。
 *   两个分隔条的位置不同、方向就相反 —— 上一版用例把「往左拖右栏变窄」当期望，
 *   于是它跟着 bug 一起绿了。所以这一版**两个方向都量**。
 *
 * 🔴 **上限是「视口相关」的，不是常数**（第 2 轮评审 P2）：中栏必须永远 ≥ 320px，
 *   所以一栏能拖到多宽取决于**另一栏当前多宽**。写死「左 480 / 右 560」在 1280 宽下
 *   会把中栏挤到 132px —— 那样断言的就是 bug。这里的上限一律现算：
 *   `min(该栏最大, 行宽 - 另一栏 - 细条 - 320 - 分隔条)`。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  dragSplitter,
  KEYS,
  makeCard,
  MOCK_PRESET,
  readStorage,
  route,
  widthOf,
} from './support/app.js'

const CARD_ID = 'c1'
const LEFT = '[data-col="left"]'
const MIDDLE = '[data-col="middle"]'
const RIGHT = '[data-col="right"]'
const STRIP = '[data-workflow-strip]'

/** 契约 §8.2 的绝对上下界（中栏下限单独一条，见 §MIDDLE_MIN） */
const LEFT_MIN = 200
const LEFT_MAX = 480
const RIGHT_MIN = 240
const RIGHT_MAX = 560
const MIDDLE_MIN = 320

async function openEditor(page, storage = { [KEYS.cards]: [makeCard()], [KEYS.presets]: [MOCK_PRESET] }) {
  await boot(page, { storage })
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator(STRIP)).toBeVisible()
}

/** 现量布局：三栏 + 细条 + 分隔条总宽（不写死 1280，也不写死分隔条有几条） */
async function layoutOf(page) {
  const splitters = await page
    .locator('[data-splitter]')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width))
  const left = await widthOf(page, LEFT)
  const middle = await widthOf(page, MIDDLE)
  const right = await widthOf(page, RIGHT)
  const strip = await widthOf(page, STRIP)
  const gap = Math.round(splitters.reduce((sum, width) => sum + width, 0))
  return { left, middle, right, strip, gap, row: left + middle + right + strip + gap }
}

/** 左栏能拖到多宽：绝对上限与「中栏还剩 320」两者取小 */
const maxLeftIn = (layout) =>
  Math.min(LEFT_MAX, layout.row - layout.right - layout.strip - MIDDLE_MIN - layout.gap)

/** 右栏能拖到多宽（同理，看的是左栏当前多宽） */
const maxRightIn = (layout) =>
  Math.min(RIGHT_MAX, layout.row - layout.left - layout.strip - MIDDLE_MIN - layout.gap)

test('默认宽度；拖左栏分隔条（往右）只动左栏与中栏', async ({ page }) => {
  await openEditor(page)
  const before = await layoutOf(page)
  expect(before.left, '左栏默认宽 280（CONTRACT §8.2）').toBe(280)
  expect(before.right, '右栏默认宽 320').toBe(320)
  expect(before.strip).toBeGreaterThan(0)
  expect(before.middle).toBeGreaterThanOrEqual(MIDDLE_MIN)

  await dragSplitter(page, 'left', 80)
  const after = await layoutOf(page)
  expect(after.left, '左分隔条往右拖 ⇒ 左栏变宽').toBeGreaterThan(before.left + 40)
  expect(after.middle, '中栏吸收').toBeLessThan(before.middle - 40)
  expect(after.right, '拖左栏不许动右栏').toBe(before.right)
  expect(after.strip, '细条宽度固定，不参与拖拽').toBe(before.strip)
})

test('拖右栏分隔条：往左 = 变宽，往右 = 变窄', async ({ page }) => {
  await openEditor(page)
  const before = await layoutOf(page)

  // ① 往左拖（右栏的左缘往左移）⇒ 右栏变宽、中栏变窄、左栏与细条不动
  await dragSplitter(page, 'right', -60)
  const wider = await layoutOf(page)
  expect(wider.right, '右分隔条往左拖 ⇒ 右栏变宽').toBeGreaterThan(before.right + 40)
  expect(wider.middle, '中栏吸收').toBeLessThan(before.middle - 40)
  expect(wider.left, '拖右栏不许动左栏').toBe(before.left)
  expect(wider.strip).toBe(before.strip)

  // ② 再往右拖回去 ⇒ 右栏变窄（同一个分隔条，方向反过来必须跟着反过来）
  await dragSplitter(page, 'right', 60)
  const back = await layoutOf(page)
  expect(back.right, '往右拖 ⇒ 右栏变窄').toBeLessThan(wider.right - 40)
  expect(back.middle).toBeGreaterThan(wider.middle + 40)
  expect(back.left).toBe(before.left)
  expect(back.strip).toBe(before.strip)
  expect(back.middle).toBeGreaterThanOrEqual(MIDDLE_MIN)
})

test('双击各自的分隔条恢复默认 280 / 320', async ({ page }) => {
  await openEditor(page)
  await dragSplitter(page, 'left', 90)
  await dragSplitter(page, 'right', -70)
  const dragged = await layoutOf(page)
  expect(dragged.left).toBeGreaterThan(280)
  expect(dragged.right).toBeGreaterThan(320)

  await page.locator('[data-splitter="left"]').dblclick()
  expect(await widthOf(page, LEFT), '双击恢复默认 280').toBe(280)
  await page.locator('[data-splitter="right"]').dblclick()
  expect(await widthOf(page, RIGHT), '双击恢复默认 320').toBe(320)
})

test('栏宽刷新后保留（两栏各存一份）', async ({ page }) => {
  await openEditor(page)
  await dragSplitter(page, 'left', 70)
  await dragSplitter(page, 'right', -70)
  const dragged = await layoutOf(page)
  expect(dragged.left).toBeGreaterThan(300)
  expect(dragged.right).toBeGreaterThan(350)

  await page.reload()
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  const reloaded = await layoutOf(page)
  expect(reloaded.left, '刷新后左栏宽要保留').toBe(dragged.left)
  expect(reloaded.right, '刷新后右栏宽要保留').toBe(dragged.right)
  expect(reloaded.strip, '细条宽度始终固定').toBe(dragged.strip)
  expect(await readStorage(page, KEYS.settings).then((settings) => settings.editorColumns)).toEqual({
    left: dragged.left,
    right: dragged.right,
  })
})

test('夹取：绝对上下界 + 中栏永远 ≥320（上限按视口现算）', async ({ page }) => {
  await openEditor(page)
  const atDefault = await layoutOf(page)

  // ---- 左栏：往左拖到底 = 200；往右拖到底 = min(480, 中栏留 320 那条线)
  await dragSplitter(page, 'left', -900)
  const leftMin = await layoutOf(page)
  expect(leftMin.left, '左栏最小 200').toBe(LEFT_MIN)
  expect(leftMin.middle, '中栏不许被挤到 320 以下').toBeGreaterThanOrEqual(MIDDLE_MIN)

  await dragSplitter(page, 'left', 900)
  const leftMax = await layoutOf(page)
  expect(leftMax.left, '左栏上限 = min(480, 行宽 - 右栏 - 细条 - 320 - 分隔条)').toBe(maxLeftIn(atDefault))
  expect(leftMax.middle, '中栏不许被挤到 320 以下').toBeGreaterThanOrEqual(MIDDLE_MIN)

  // ---- 右栏：先把左栏双击回默认，再量（上限取决于左栏多宽）
  await page.locator('[data-splitter="left"]').dblclick()
  const reset = await layoutOf(page)

  await dragSplitter(page, 'right', 900)
  const rightMin = await layoutOf(page)
  expect(rightMin.right, '右栏最小 240').toBe(RIGHT_MIN)
  expect(rightMin.middle).toBeGreaterThanOrEqual(MIDDLE_MIN)

  await dragSplitter(page, 'right', -900)
  const rightMax = await layoutOf(page)
  expect(rightMax.right, '右栏上限 = min(560, 行宽 - 左栏 - 细条 - 320 - 分隔条)').toBe(maxRightIn(reset))
  expect(rightMax.middle).toBeGreaterThanOrEqual(MIDDLE_MIN)
  expect(rightMax.strip, '细条宽度始终固定').toBe(atDefault.strip)
})
