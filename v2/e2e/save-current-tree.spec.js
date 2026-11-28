/**
 * 第 2 关 · 修复 A：存档编辑器的根元素当前值树（`#/edit-save/:saveId`）。
 *
 * 钉住的东西（契约 `.team/test/2026-11-28/契约-编辑器两处修复.md` §2）：
 *   · 选中**根元素**（code 不含 `.`）⇒ 一块只读 `[data-current-tree="<root>"]`，按 `pathsOf` 顺序
 *     把 `save.tree` 里这棵子树的当前值一次列全；数组值复用只读 `[data-current-array]`；
 *   · 数组里的值（`2.4` 背包的 item / 字段）在**根元素那一屏**就能读到，不必先选中 `2.4`；
 *   · 子元素 / 数组元素 / 卡编辑器都不出现这块树；保存不动 `save.tree`。
 *
 * 判据只认契约 §2.2 的 data-* 钩子；界面文案（「当前值」这类）不在这里钉。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { holdCard, holdItems, holdSave } from '../tests/support/array-fixtures.js'

const SAVE_ID = 's-root-current'
const CARD_ID = 'c-array'

const row = (code) => `[data-state-item="${code}"]`
const tree = (code) => `[data-current-tree="${code}"]`
const treeRow = (path) => `${tree('2')} [data-current-tree-row="${path}"]`

/**
 * 与示例卡同形的「2 玩家」：`2` 是 **text 带自身值（`2.0`）+ 孩子**，`2.4` 是背包数组。
 * 初值用只出现在 `cardSnapshot.initial` 里的 ASCII 记号，当前值用另一组，好分辨读的是哪一份。
 */
function playerCard() {
  const base = holdCard()
  return {
    ...base,
    state: base.state.map((element) =>
      element.code === '2'
        ? {
            ...element,
            type: 'text',
            initial: {
              '2.0': '',
              2.1: 'INIT_HERO',
              2.2: 80,
              2.3: '正常',
              2.4: holdItems(),
            },
          }
        : element,
    ),
  }
}

/** 这一份存档的当前值：与初值故意不同（`CUR_*` / 62 / 受伤 / 长弓） */
function currentSave(card) {
  const base = holdSave(card, { id: SAVE_ID, name: 'root current save' })
  return {
    ...base,
    tree: {
      ...base.tree,
      '2.0': 'CUR_OWN',
      2.1: 'CUR_HERO',
      2.2: 62,
      2.3: '受伤',
      2.4: [
        { '2.4.1': '长弓', '2.4.2': 7 },
        { '2.4.1': '银币', '2.4.2': 3 },
      ],
    },
  }
}

function seeded() {
  const card = playerCard()
  const save = currentSave(card)
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

test('A1 选中根 2 玩家：一块只读当前值树，2.4 背包一次列全（值读 save.tree）', async ({ page }) => {
  await openSaveEditor(page)
  await page.locator(row('2')).click()

  const block = page.locator(tree('2'))
  await expect(block, '根元素选中后必须有 [data-current-tree]').toHaveCount(1)
  await expect(block).toBeVisible()

  // 行 = pathsOf（自身值 2.0 在前，随后 2.1 / 2.2 / 2.3 / 2.4）；显示编号去掉 .0
  await expect(block.locator('[data-current-tree-row]')).toHaveCount(5)
  await expect(block.locator('[data-current-tree-code]')).toHaveText(['2', '2.1', '2.2', '2.3', '2.4'])
  await expect(block.locator('[data-current-tree-name="2.1"]')).toHaveText('名字')
  await expect(block.locator('[data-current-tree-name="2.2"]')).toHaveText('体力')
  await expect(block.locator('[data-current-tree-name="2.3"]')).toHaveText('状态')
  await expect(block.locator('[data-current-tree-name="2.4"]')).toHaveText('背包')

  // 值来自 save.tree，不是 cardSnapshot.initial
  await expect(page.locator(treeRow('2.0')).locator('[data-current-tree-value="2.0"]')).toHaveText('CUR_OWN')
  await expect(page.locator(treeRow('2.1')).locator('[data-current-tree-value="2.1"]')).toHaveText('CUR_HERO')
  await expect(page.locator(treeRow('2.2')).locator('[data-current-tree-value="2.2"]')).toHaveText('62')
  await expect(page.locator(treeRow('2.3')).locator('[data-current-tree-value="2.3"]')).toHaveText('受伤')
  await expect(block, '不许把卡快照的初值当成当前值').not.toContainText('INIT_HERO')

  // 2.4 背包：在根元素这一屏就有一份只读 item 列表
  const bag = page.locator(treeRow('2.4')).locator('[data-current-array="2.4"]')
  await expect(bag, '2.4 的当前数组要挂在根元素的当前值树里').toBeVisible()
  await expect(bag.locator('[data-array-item]')).toHaveCount(2)
  await expect(bag.locator('[data-array-field-name="2.4.1"]').first()).toHaveText('物品')
  await expect(bag.locator('[data-array-field-name="2.4.2"]').first()).toHaveText('数量')
  await expect(bag.locator('[data-array-field="2.4.1"]').nth(0)).toHaveValue('长弓')
  await expect(bag.locator('[data-array-field="2.4.2"]').nth(0)).toHaveValue('7')
  await expect(bag.locator('[data-array-field="2.4.1"]').nth(1)).toHaveValue('银币')
  await expect(bag.locator('[data-array-field="2.4.2"]').nth(1)).toHaveValue('3')
  await expect(bag.locator('[data-array-field="2.4.1"]').first()).toBeDisabled()
})

test('A2 选中时间根 0：当前时间按 formatTime 显示', async ({ page }) => {
  await openSaveEditor(page)
  await page.locator(row('0')).click()

  const block = page.locator(tree('0'))
  await expect(block, '时间根也要有当前值树').toHaveCount(1)
  await expect(block.locator('[data-current-tree-row]')).toHaveCount(1)
  const value = block.locator('[data-current-tree-value="0"]')
  await expect(value).toContainText('2024-02-10')
  await expect(value).toContainText('08:30')
})

test('A3 当前值树只读；保存前后 save.tree 逐字段不变', async ({ page }) => {
  await openSaveEditor(page)
  await page.locator(row('2')).click()

  const block = page.locator(tree('2'))
  await expect(block).toHaveCount(1)
  // 只读：块内没有任何仍可编辑的控件，也没有数组增删入口
  await expect(
    block.locator('input:not([disabled]), select:not([disabled]), textarea:not([disabled])'),
  ).toHaveCount(0)
  await expect(block.locator('[data-array-add]')).toHaveCount(0)
  await expect(block.locator('[data-array-remove]')).toHaveCount(0)

  const before = (await readStorage(page, KEYS.saves))[0].tree
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-ok]')).toBeVisible()
  const after = (await readStorage(page, KEYS.saves))[0].tree
  expect(after, '当前值树是只读的：保存不许改 save.tree').toEqual(before)
})

test('A4 只有根元素有这棵树：子元素 / 数组 / 卡编辑器都不出现', async ({ page }) => {
  const { storage } = seeded()
  await boot(page, { storage, hash: route.editSave(SAVE_ID) })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()

  await page.locator(row('2.1')).click()
  await expect(page.locator('[data-current-tree]'), '子元素不该有根当前值树').toHaveCount(0)

  await page.locator(row('2.4')).click()
  await expect(page.locator('[data-current-tree]'), '数组元素不该有根当前值树').toHaveCount(0)
  // 非根元素没有自己的当前值块：当前值只在根元素的当前值树里
  await expect(
    page.locator('[data-current-array], [data-current-value]'),
    '非根数组元素不许有自己的当前值块',
  ).toHaveCount(0)

  // 卡编辑器没有「这一局」的 save.tree ⇒ 任何元素都没有当前值树
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator(row('2')).click()
  await expect(page.locator('[data-current-tree]'), '卡编辑器不该显示当前值树').toHaveCount(0)
})
