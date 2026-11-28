/**
 * 存档编辑器的根元素当前值：**同一个当前值只许渲染一处**（`#/edit-save/:saveId`）。
 *
 * 钉住的形状（评测口径）：
 *   · 选中**数组根** ⇒ 恰好一块只读 `[data-current-array="<root>"]`，item 值读自 `save.tree`；
 *   · 选中**整数根** ⇒ 恰好一处当前值（`[data-current-value]` 或 `[data-current-tree-value]`），值读自 `save.tree`；
 *   · 非根元素**不再有自己的当前值块**（当前值只在根元素的 `[data-current-tree]` 里）。
 *
 * 判据只认 `data-*` 钩子；值用只出现在 `cardSnapshot.initial` / `save.tree` 里的 ASCII 记号分辨。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, route } from './support/app.js'
import { element, holdCard, holdSave } from '../tests/support/array-fixtures.js'

const SAVE_ID = 's-root-current-block'
const CARD_ID = 'c-root-current-block'

const row = (code) => `[data-state-item="${code}"]`

/** 数组根的当前值 / 初值故意不同：值断言能证明读的是 `save.tree`（item 自带隐藏 id） */
const INIT_ITEMS = [{ id: 'id_1', 3.1: 'INIT_ITEM', 3.2: 1 }]
const CURRENT_ITEMS = [
  { id: 'id_1', 3.1: 'CUR_SWORD', 3.2: 5 },
  { id: 'id_2', 3.1: 'CUR_COIN', 3.2: 9 },
]

/**
 * 在 `holdCard()` 上再加两个根元素：
 *   · `3` 数组根（字段 `3.1` 物品 / `3.2` 数量）；
 *   · `4` 整数根（只判当前值只渲染一处）。
 * 根编号 0..4 连续；数组字段不带宽 `initial` 之外的东西。
 */
function rootCard() {
  const base = holdCard()
  return {
    ...base,
    id: CARD_ID,
    name: 'root current card',
    state: [
      ...base.state,
      element('3', 'array', { name: '根背包', initial: { 3: INIT_ITEMS } }),
      element('3.1', 'text', { name: '物品' }),
      element('3.2', 'integer', { name: '数量', min: 0, max: 99 }),
      element('4', 'integer', {
        name: '根数字',
        min: 0,
        max: 100,
        stepMin: 1,
        stepMax: 10,
        initial: { 4: 7 },
      }),
    ],
  }
}

function seeded() {
  const card = rootCard()
  const save = holdSave(card, { id: SAVE_ID, name: 'root current save' })
  save.tree = {
    ...save.tree,
    3: CURRENT_ITEMS,
    4: 42,
  }
  return {
    card,
    save,
    storage: {
      [KEYS.cards]: [card],
      [KEYS.saves]: [save],
      [KEYS.presets]: [MOCK_PRESET],
    },
  }
}

async function openSaveEditor(page) {
  const { storage, save } = seeded()
  await boot(page, { storage, hash: route.editSave(save.id) })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
}

test('R1 选中数组根 3：当前数组只渲染一块 `[data-current-array]`', async ({ page }) => {
  await openSaveEditor(page)
  await page.locator(row('3')).click()

  // 基线（修复前）：自身当前值块 + 根当前值树的数组行各一份 = 2。
  await expect(
    page.locator('[data-current-array]'),
    '选中数组根：当前数组只许有一块 `[data-current-array]`（不许自身块与当前值树各渲染一份）',
  ).toHaveCount(1)
  await expect(
    page.locator('[data-current-array], [data-current-value], [data-current-tree-value]'),
    '选中数组根：当前值整体只许渲染一处',
  ).toHaveCount(1)

  const block = page.locator('[data-current-array="3"]')
  await expect(block).toBeVisible()
  await expect(block.locator('[data-array-item]')).toHaveCount(2)
  await expect(block.locator('[data-array-field="3.1"]').nth(0)).toHaveValue('CUR_SWORD')
  await expect(block.locator('[data-array-field="3.2"]').nth(0)).toHaveValue('5')
  await expect(block.locator('[data-array-field="3.1"]').nth(1)).toHaveValue('CUR_COIN')
  await expect(block.locator('[data-array-field="3.2"]').nth(1)).toHaveValue('9')
  await expect(block.locator('[data-array-field="3.1"]').first()).toBeDisabled()
  await expect(block, '数组根的当前值要读 save.tree，不是卡快照初值').not.toContainText('INIT_ITEM')
})

test('R2 选中整数根 4：当前值只渲染一处', async ({ page }) => {
  await openSaveEditor(page)
  await page.locator(row('4')).click()

  // 基线（修复前）：自身 `[data-current-value]` + 当前值树 `[data-current-tree-value]` = 2。
  const values = page.locator('[data-current-value], [data-current-tree-value]')
  await expect(values, '选中数字根：当前值只许渲染一处（不许自身块与当前值树各渲染一份）').toHaveCount(1)
  await expect(values).toHaveText('42')
  await expect(page.locator('[data-current-array]')).toHaveCount(0)
})

test('R3 非根数组元素 2.4：不再有自己的当前值块', async ({ page }) => {
  await openSaveEditor(page)
  await page.locator(row('2.4')).click()

  // 当前值只在根元素的当前值树里；非根选中时不渲染单块。
  await expect(
    page.locator('[data-current-array], [data-current-value], [data-current-tree]'),
    '非根元素不许有自己的当前值块',
  ).toHaveCount(0)
})

// 卡模式没有「这一局」的 save.tree：两个钩子都不该出现（防止判据只在存档模式成立）
test('R4 卡编辑器：根数组 / 根整数都没有当前值块', async ({ page }) => {
  const { storage } = seeded()
  await boot(page, { storage, hash: route.edit(CARD_ID) })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()

  await page.locator(row('3')).click()
  await expect(page.locator('[data-current-array], [data-current-value]')).toHaveCount(0)
  await page.locator(row('4')).click()
  await expect(page.locator('[data-current-array], [data-current-value]')).toHaveCount(0)
})
