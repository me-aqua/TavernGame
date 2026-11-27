/**
 * 节点「调用重试次数」（阶段 2.4 第 2 关）—— 编辑器那一层。
 *
 * 钉四件事：
 *   ① DOM 顺序：模型预设 → 调用重试次数 → 读取历史回合（字段夹在中间）；
 *   ② 旧卡没有 `retryCount` 时显示默认 0；
 *   ③ 卡模式 / 存档模式都能改、都落到各自该落的地方，刷新读回；
 *   ④ UI 不合法值（6）不落盘。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  readRaw,
  readStorage,
  route,
} from './support/app.js'

const CARD_ID = 'c1'
const SAVE_ID = 's1'
const RETRY_LABEL = '调用重试次数'

function seededCard() {
  const card = makeCard()
  // 旧卡：把夹具可能自带的 retryCount 摘掉，确保测到的是「缺省 = 0」
  card.chain.forEach((node) => delete node.retryCount)
  return { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] }
}

function seededSave() {
  const card = makeCard()
  // 旧存档：快照里的节点也没有 retryCount
  card.chain.forEach((node) => delete node.retryCount)
  return {
    [KEYS.cards]: [card],
    [KEYS.saves]: [makeSave(card)],
    [KEYS.presets]: [MOCK_PRESET],
  }
}

async function openCardEditor(page) {
  await boot(page, { storage: seededCard() })
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
}

async function openSaveEditor(page) {
  await boot(page, { storage: seededSave() })
  await page.goto(`${APP_PATH}#/edit-save/${SAVE_ID}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
}

test.describe('NodeForm：调用重试次数的位置与形状', () => {
  test('DOM 顺序是 preset → retry → history；标签逐字、数字框属性对', async ({ page }) => {
    await openCardEditor(page)
    await page.locator('[data-node-id="check"]').click()

    const retry = page.locator('[data-node-retry]')
    await expect(retry).toHaveCount(1)
    await expect(
      page.locator('[data-col="middle"] [data-node-retry]'),
      '重试次数字段必须在中栏的节点表单里',
    ).toHaveCount(1)
    await expect(retry).toHaveAttribute('type', 'number')
    await expect(retry).toHaveAttribute('min', '0')
    await expect(retry).toHaveAttribute('max', '5')
    await expect(retry).toHaveAttribute('step', '1')

    const order = await page.evaluate(`(() => {
      const find = (selector) => document.querySelector(selector)
      const preset = find('[data-node-preset]')
      const retryInput = find('[data-node-retry]')
      const history = find('[data-node-history]')
      if (!preset || !retryInput || !history) return null
      const FOLLOWING = 4
      return {
        presetBeforeRetry: Boolean(preset.compareDocumentPosition(retryInput) & FOLLOWING),
        retryBeforeHistory: Boolean(retryInput.compareDocumentPosition(history) & FOLLOWING),
      }
    })()`)
    expect(order, '三个控件必须同时存在').toEqual({
      presetBeforeRetry: true,
      retryBeforeHistory: true,
    })

    const row = page
      .locator('[data-col="middle"] .field-row')
      .filter({ has: page.locator('[data-node-retry]') })
    await expect(row.locator('.field-label')).toHaveText(RETRY_LABEL)
  })

  test('旧卡没有 retryCount ⇒ 输入框显示默认 0', async ({ page }) => {
    await openCardEditor(page)
    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-retry]')).toHaveValue('0')
  })
})

test.describe('NodeForm：卡模式落盘', () => {
  test('填 2 → 保存 → 卡上 check.retryCount=2；刷新读回', async ({ page }) => {
    await openCardEditor(page)
    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-retry]'), '卡模式没有调用重试次数字段').toHaveCount(1)
    await page.locator('[data-node-retry]').fill('2')
    await page.locator('[data-node-retry]').dispatchEvent('change')
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const stored = (await readStorage(page, KEYS.cards))[0]
    expect(stored.chain.find((node) => node.id === 'check').retryCount).toBe(2)
    expect(stored.chain.find((node) => node.id === 'time').retryCount ?? 0).toBe(0)

    await page.reload()
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-retry]')).toHaveValue('2')
  })
})

test.describe('NodeForm：存档模式落盘', () => {
  test('填 4 → 保存 → 落到 save.cardSnapshot；卡带库字节不动；刷新读回', async ({ page }) => {
    await openSaveEditor(page)
    const cardsBefore = await readRaw(page, KEYS.cards)

    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-retry]'), '存档模式没有调用重试次数字段').toHaveCount(1)
    await page.locator('[data-node-retry]').fill('4')
    await page.locator('[data-node-retry]').dispatchEvent('change')
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const saved = (await readStorage(page, KEYS.saves))[0]
    expect(saved.cardSnapshot.chain.find((node) => node.id === 'check').retryCount).toBe(4)
    expect(await readRaw(page, KEYS.cards), '存档编辑器改到了卡带库').toBe(cardsBefore)

    await page.reload()
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-retry]')).toHaveValue('4')
  })
})

test.describe('NodeForm：默认值与非法输入', () => {
  test('新建卡的三个节点都显式带 retryCount: 0', async ({ page }) => {
    await boot(page, { storage: { [KEYS.presets]: [MOCK_PRESET] } })
    await page.locator('[data-new-card]').click()
    const cards = await readStorage(page, KEYS.cards)
    expect(cards).toHaveLength(1)
    expect(cards[0].chain.map((node) => node.retryCount)).toEqual([0, 0, 0])
  })

  test('填 6（越界）不落盘：保存后盘上仍是原来的 2', async ({ page }) => {
    const card = makeCard()
    card.chain[1] = { ...card.chain[1], retryCount: 2 }
    await boot(page, { storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] } })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()

    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-retry]'), '越界用例的前提：字段存在').toHaveCount(1)
    await page.locator('[data-node-retry]').fill('6')
    await page.locator('[data-node-retry]').dispatchEvent('change')
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const stored = (await readStorage(page, KEYS.cards))[0]
    expect(stored.chain.find((node) => node.id === 'check').retryCount).toBe(2)
    await page.reload()
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-retry]'), '刷新后读的是落盘的 2，不是输入过的 6').toHaveValue('2')
  })
})
