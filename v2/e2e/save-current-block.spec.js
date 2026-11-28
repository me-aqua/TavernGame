/**
 * 存档编辑器 · 当前值只在根元素的 `[data-current-tree]` 里显示（契约 `.team/test/2026-11-28/契约-顶栏回合与存档当前块.md` §2）。
 *
 * 钉住的东西：
 *   · 选中**非根元素**（标量 `2.2` / 数组 `2.4`）⇒ `[data-current-value]` / `[data-current-array]` /
 *     `[data-current-tree]` 一个都不出现；中栏也不许出现 `save.tree` 的当前值记号；
 *   · 选中**根元素** `2` ⇒ 恰好一块 `[data-current-tree="2"]`，值读 `save.tree`，数组行
 *     `[data-current-array="2.4"]` 在树**内部**；
 *   · 根 → 非根切换：树消失且不冒单块；切回根：树回来；
 *   · 卡编辑器没有「这一局」的 `save.tree` ⇒ 任何元素都没有当前值块。
 *
 * 判据只认 data-* 钩子；值用只出现在 `save.tree` 里的 ASCII 记号分辨（与卡快照初值不同）。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, MOCK_PRESET, route } from './support/app.js'
import { holdCard, holdSave } from '../tests/support/array-fixtures.js'

const SAVE_ID = 's-current-block'
const CARD_ID = 'c-array'

const row = (code) => `[data-state-item="${code}"]`
/** 三个「当前值」钩子：非根选中时应当一个都不出现 */
const CURRENT = '[data-current-value], [data-current-array], [data-current-tree]'

/** `save.tree` 的当前值：与 `holdCard()` 的初值（旅人 / 80 / 正常 / 短剑…）故意不同（item 自带隐藏 id） */
const CURRENT_ITEMS = [
  { id: 'id_1', '2.4.1': 'CUR_SWORD_ONLY', '2.4.2': 7 },
  { id: 'id_2', '2.4.1': 'CUR_COIN_ONLY', '2.4.2': 3 },
]

function seeded() {
  const card = holdCard()
  const save = holdSave(card, { id: SAVE_ID, name: 'current block save' })
  save.tree = {
    ...save.tree,
    2.1: 'CUR_HERO_ONLY',
    2.2: 73,
    2.3: '受伤',
    2.4: CURRENT_ITEMS,
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
  const { storage } = seeded()
  await boot(page, { storage, hash: route.editSave(SAVE_ID) })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
}

async function select(page, code) {
  await page.locator(row(code)).click()
  await expect(page.locator(`${row(code)}.selected, ${row(code)}[data-selected]`)).toHaveCount(1)
}

/** 中栏（状态表单）的文字：非根选中时不许把当前值显示在这里 */
function middle(page) {
  return page.locator('[data-col="middle"]')
}

test('S1 非根整数 2.2：没有任何当前值块，中栏不出现 save.tree 的值', async ({ page }) => {
  await openSaveEditor(page)
  await select(page, '2.2')

  await expect(page.locator(CURRENT), '非根标量不许有自己的当前值块').toHaveCount(0)
  await expect(middle(page), '非根选中时 save.tree 的当前值不许出现在中栏').not.toContainText('73')
})

test('S2 非根数组 2.4：没有任何当前值块，数组 item 不出现', async ({ page }) => {
  await openSaveEditor(page)
  await select(page, '2.4')

  await expect(page.locator(CURRENT), '非根数组不许有自己的当前值块').toHaveCount(0)
  await expect(middle(page), '非根选中时数组当前值不许出现在中栏').not.toContainText('CUR_SWORD_ONLY')
})

test('S3 根元素 2：当前值只在那块树里，值读 save.tree，数组行在树内', async ({ page }) => {
  await openSaveEditor(page)
  await select(page, '2')

  const tree = page.locator('[data-current-tree="2"]')
  await expect(tree, '选中根元素必须有一块当前值树').toHaveCount(1)
  await expect(tree).toBeVisible()

  // 行 = pathsOf(2)：2.1 名字 / 2.2 体力 / 2.3 状态 / 2.4 背包（object 没有自身值）
  await expect(tree.locator('[data-current-tree-row]')).toHaveCount(4)
  await expect(tree.locator('[data-current-tree-value="2.1"]')).toHaveText('CUR_HERO_ONLY')
  await expect(tree.locator('[data-current-tree-value="2.2"]')).toHaveText('73')
  await expect(tree.locator('[data-current-tree-value="2.3"]')).toHaveText('受伤')
  await expect(tree, '当前值树要读 save.tree，不是卡快照初值').not.toContainText('旅人')

  // 2.4 的当前数组只在当前值树内部；不许另有单格块
  const bag = tree.locator('[data-current-array="2.4"]')
  await expect(bag, '2.4 的当前数组要挂在根当前值树里').toBeVisible()
  await expect(bag.locator('[data-array-item]')).toHaveCount(2)
  await expect(bag.locator('[data-array-field="2.4.1"]').nth(0)).toHaveValue('CUR_SWORD_ONLY')
  await expect(bag.locator('[data-array-field="2.4.2"]').nth(0)).toHaveValue('7')
  await expect(bag.locator('[data-array-field="2.4.1"]').nth(1)).toHaveValue('CUR_COIN_ONLY')
  await expect(bag.locator('[data-array-field="2.4.2"]').nth(1)).toHaveValue('3')
  await expect(bag.locator('[data-array-field="2.4.1"]').first()).toBeDisabled()
  await expect(page.locator('[data-current-value]'), '根树里的标量走 tree-value，不走单格块').toHaveCount(0)
})

test('S4 根 → 非根：树消失且不冒单块；切回根：树回来', async ({ page }) => {
  await openSaveEditor(page)
  await select(page, '2')
  await expect(page.locator('[data-current-tree="2"]')).toHaveCount(1)

  await select(page, '2.4')
  await expect(page.locator('[data-current-tree]'), '切到非根后当前值树必须消失').toHaveCount(0)
  await expect(page.locator(CURRENT), '切到非根后不许冒出一块单格当前值').toHaveCount(0)

  await select(page, '2')
  await expect(page.locator('[data-current-tree="2"]')).toHaveCount(1)
  await expect(page.locator('[data-current-tree-value="2.2"]')).toHaveText('73')
})

test('S5 卡编辑器：根 / 非根都没有当前值块（守卫）', async ({ page }) => {
  const { storage } = seeded()
  await boot(page, { storage, hash: route.edit(CARD_ID) })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()

  await select(page, '2')
  await expect(page.locator(CURRENT), '卡模式没有 save.tree：根元素也没有当前值块').toHaveCount(0)
  await select(page, '2.4')
  await expect(page.locator(CURRENT), '卡模式没有 save.tree：非根也没有当前值块').toHaveCount(0)
})
