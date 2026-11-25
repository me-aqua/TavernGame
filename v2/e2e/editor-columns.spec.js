/**
 * SPEC §9.6：编辑器三栏可拖宽、**工作流细条宽度固定**、双击恢复默认、刷新后保留。
 *
 * 自由度只有两个（左栏宽、右栏宽），中栏是余量 —— 所以三条都要量：
 * 拖左边时右边不许动、拖右边时左边不许动、任何时候细条都不许动。
 * 阈值用「比之前宽/窄了至少 40px」这种方向性断言，不钉死像素（实现有 1px 边框余量）。
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

async function openEditor(page, storage = { [KEYS.cards]: [makeCard()], [KEYS.presets]: [MOCK_PRESET] }) {
  await boot(page, { storage })
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator(STRIP)).toBeVisible()
}

test('默认宽度与「拖左栏只动左栏」', async ({ page }) => {
  await openEditor(page)
  const left = await widthOf(page, LEFT)
  const middle = await widthOf(page, MIDDLE)
  const right = await widthOf(page, RIGHT)
  const strip = await widthOf(page, STRIP)

  expect(left, '左栏默认宽 280（CONTRACT §8.2）').toBe(280)
  expect(right, '右栏默认宽 320').toBe(320)
  expect(strip).toBeGreaterThan(0)

  await dragSplitter(page, 'left', 80)
  const leftAfter = await widthOf(page, LEFT)
  expect(leftAfter).toBeGreaterThan(left + 40)
  expect(await widthOf(page, MIDDLE)).toBeLessThan(middle - 40)
  expect(await widthOf(page, RIGHT), '拖左栏不许动右栏').toBe(right)
  expect(await widthOf(page, STRIP), '细条宽度固定，不参与拖拽').toBe(strip)
})

test('拖右栏只动右栏；双击分隔条恢复默认', async ({ page }) => {
  await openEditor(page)
  const left = await widthOf(page, LEFT)
  const middle = await widthOf(page, MIDDLE)
  const right = await widthOf(page, RIGHT)
  const strip = await widthOf(page, STRIP)

  await dragSplitter(page, 'right', -60)
  expect(await widthOf(page, RIGHT)).toBeLessThan(right - 40)
  expect(await widthOf(page, MIDDLE)).toBeGreaterThan(middle + 40)
  expect(await widthOf(page, LEFT), '拖右栏不许动左栏').toBe(left)
  expect(await widthOf(page, STRIP)).toBe(strip)

  await page.locator('[data-splitter="left"]').dblclick()
  expect(await widthOf(page, LEFT), '双击恢复默认 280').toBe(280)
  await page.locator('[data-splitter="right"]').dblclick()
  expect(await widthOf(page, RIGHT), '双击恢复默认 320').toBe(320)
})

test('栏宽刷新后保留，且夹在最小/最大之间', async ({ page }) => {
  await openEditor(page)
  await dragSplitter(page, 'left', 70)
  const dragged = await widthOf(page, LEFT)
  expect(dragged).toBeGreaterThan(300)

  await page.reload()
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  expect(await widthOf(page, LEFT), '刷新后栏宽要保留').toBe(dragged)
  expect((await readStorage(page, KEYS.settings)).editorColumns.left).toBe(dragged)

  // 往左拖到底也只有最小宽度（200）
  await dragSplitter(page, 'left', -900)
  expect(await widthOf(page, LEFT)).toBe(200)

  // 往右拖到底也只有最大宽度（480）
  await dragSplitter(page, 'left', 900)
  expect(await widthOf(page, LEFT)).toBe(480)
  expect(await widthOf(page, STRIP)).toBeGreaterThan(0)
})
