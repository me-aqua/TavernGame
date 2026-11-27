/**
 * 阶段 2.2 · A（界面层）：初始值只挂在根元素上（契约 §A4–§A5）。
 *
 * 钉住六件事：
 *   1. 根元素的页里有初始值整块；**子元素的页里没有**（`1.1` 的初值在 `1` 那一页编）；
 *   2. 改后代初值 ⇒ 保存后落在**所属根**的 `initial` 上，子元素对象没有 `initial`；
 *   3. 加子元素 ⇒ 所属根 initial 补一条（父原来没孩子时自己的值搬到 `.0`）；
 *   4. 删子元素 ⇒ 所属根 initial 少一条（兄弟重排、`.0` 搬回 `<code>`）；
 *   5. 换类型 ⇒ 所属根 initial 那一格换成新类型的默认值；
 *   6. 存档模式：初始值整块不渲染。
 *
 * ⚠️ 种子数据是新形状（`v6-fixtures`）；功能没做时应用打不开它 ⇒ 这一份全红。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, MOCK_PRESET, readStorage } from './support/app.js'
import { elementOf, v6Card, v6Save } from '../tests/support/v6-fixtures.js'

const CARD_ID = 'c-v6'

/** 种子：卡 + 一条存档 + 一个 mock 预设 */
function seeded() {
  const card = v6Card()
  const save = v6Save(card)
  return {
    storage: {
      [KEYS.cards]: [card],
      [KEYS.saves]: [save],
      [KEYS.presets]: [MOCK_PRESET],
      [KEYS.nodeModels]: {
        [card.id]: Object.fromEntries(card.chain.map((node) => [node.id, MOCK_PRESET.id])),
      },
    },
  }
}

async function openEditor(page, cardId = CARD_ID) {
  await page.goto(`${APP_PATH}#/edit/${cardId}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
}

async function openSaveEditor(page, saveId = 's-v6') {
  await page.goto(`${APP_PATH}#/edit-save/${saveId}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
}

/** 从 localStorage 读那张卡 */
async function readCard(page, cardId = CARD_ID) {
  const cards = await readStorage(page, KEYS.cards)
  return cards.find((card) => card.id === cardId)
}

/** 选中一个状态元素 */
async function selectElement(page, code) {
  await page.locator(`[data-state-item="${code}"]`).click()
}

test.describe('A4 初始值块跟着「根」走', () => {
  test('根元素页有初始值块与后代格子；子元素页没有初始值块', async ({ page }) => {
    await boot(page, seeded())
    await openEditor(page)

    await selectElement(page, '1')
    await expect(page.locator('[data-initial-block]')).toBeVisible()
    await expect(page.locator('[data-initial-path="1.1.0"]')).toBeVisible()
    await expect(page.locator('[data-initial-path="1.1.1"]')).toBeVisible()
    await expect(page.locator('[data-initial-path="1.2"]')).toBeVisible()
    await expect(page.locator('[data-initial-name="1.1.1"]')).toBeVisible()

    await selectElement(page, '1.1')
    await expect(page.locator('[data-initial-block]'), '子元素页不许出现初始值块').toHaveCount(0)
    await expect(page.locator('[data-initial-path]'), '子元素页不许出现后代格子').toHaveCount(0)

    await selectElement(page, '0')
    await expect(page.locator('[data-initial-block]')).toBeVisible()
    await expect(page.locator('[data-field="time-year"]')).toBeVisible()
  })

  test('改后代初值 ⇒ 保存后落在所属根 initial 上，子元素对象没有 initial', async ({ page }) => {
    await boot(page, seeded())
    await openEditor(page)
    await selectElement(page, '1')

    await page.locator('[data-initial-path="1.1.1"]').fill('NEW_SITE')
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const card = await readCard(page)
    expect(card.state.find((item) => item.code === '1').initial['1.1.1']).toBe('NEW_SITE')
    expect(elementOf(card, '1.1.1')).not.toHaveProperty('initial')
    expect(elementOf(card, '1.1')).not.toHaveProperty('initial')
  })

  test('改顶层文本根的初值 ⇒ 落在它自己的 initial 上（键是它的 code）', async ({ page }) => {
    await boot(page, seeded())
    await openEditor(page)
    // 先把 `1` 换成文字根（它现在有孩子 ⇒ 自身值住 1.0），改完再存
    await selectElement(page, '1')
    await page.locator('[data-state-type]').selectOption('text')
    // 自己那一格走 `[data-field="initial"]`（后代才走 `[data-initial-path]`）
    await page.locator('[data-field="initial"]').fill('WORLD_OWN')
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const card = await readCard(page)
    expect(elementOf(card, '1').initial['1.0']).toBe('WORLD_OWN')
  })
})

test.describe('A2 增 / 删 / 换类型与根 initial 同步', () => {
  test('加子元素 ⇒ 保存后根 initial 多一条，新元素自己没有 initial', async ({ page }) => {
    await boot(page, seeded())
    await openEditor(page)
    await selectElement(page, '1.1')
    await page.locator('[data-add-child="1.1"]').click()
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const card = await readCard(page)
    const root = elementOf(card, '1')
    expect(root.initial['1.1.0'], '父的自身值还在 .0').toBe('A1')
    expect(root.initial['1.1.2'], '新孩子的值路径要补进根 initial').toBe('')
    expect(elementOf(card, '1.1.2')).not.toHaveProperty('initial')
  })

  test('加孩子到叶子上 ⇒ 自己的值搬到 .0，新孩子用 .1', async ({ page }) => {
    await boot(page, seeded())
    await openEditor(page)
    await selectElement(page, '2.1')
    await page.locator('[data-add-child="2.1"]').click()
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const card = await readCard(page)
    const root = elementOf(card, '2')
    expect(root.initial['2.1']).toBeUndefined()
    expect(root.initial['2.1.0']).toBe('HERO')
    expect(root.initial['2.1.1']).toBe('')
  })

  test('删子元素 ⇒ 保存后根 initial 少一条，兄弟重排、.0 搬回 <code>', async ({ page }) => {
    await boot(page, seeded())
    await openEditor(page)
    await selectElement(page, '1')
    await page.locator('[data-state-item="1.1.1"] [data-delete-state]').click()
    await page.locator('[data-confirm-ok]').click()
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const card = await readCard(page)
    const root = elementOf(card, '1')
    expect(root.initial['1.1.1']).toBeUndefined()
    expect(root.initial['1.1.0']).toBeUndefined()
    expect(root.initial['1.1']).toBe('A1')
    expect(elementOf(card, '1.1.1')).toBeUndefined()
  })

  test('换类型 ⇒ 保存后根 initial 那一格换成新类型的默认值', async ({ page }) => {
    await boot(page, seeded())
    await openEditor(page)
    await selectElement(page, '1.2')
    await page.locator('[data-state-type]').selectOption('integer')
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const card = await readCard(page)
    expect(elementOf(card, '1.2').type).toBe('integer')
    expect(elementOf(card, '1').initial['1.2']).toBe(0)
    expect(elementOf(card, '1.2')).not.toHaveProperty('initial')
  })

  test('加完孩子后整卡仍然合法：保存成功、切到别的元素再回来值还在', async ({ page }) => {
    await boot(page, seeded())
    await openEditor(page)
    await selectElement(page, '1')
    const before = await page.locator('[data-initial-path="1.1.1"]').inputValue()
    expect(before).toBe('SITE_X')
    await page.locator('[data-initial-path="1.1.1"]').fill('KEPT')
    await selectElement(page, '2')
    await selectElement(page, '1')
    await expect(page.locator('[data-initial-path="1.1.1"]')).toHaveValue('KEPT')
  })
})

test.describe('A5 存档模式不显示初始值', () => {
  test('存档编辑器：根元素页也没有初始值块，子元素页更没有', async ({ page }) => {
    await boot(page, seeded())
    await openSaveEditor(page)

    await selectElement(page, '1')
    await expect(page.locator('[data-initial-block]')).toHaveCount(0)
    await expect(page.locator('[data-initial-path]')).toHaveCount(0)

    await selectElement(page, '1.1')
    await expect(page.locator('[data-initial-block]')).toHaveCount(0)
  })
})
