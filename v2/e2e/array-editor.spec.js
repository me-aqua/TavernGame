/**
 * 阶段 3 · 数组节点的编辑器（数组契约 §四）。
 *
 * 这一份量的是**玩家在界面上点得到的那几件事**：
 *   · 数组值在初始值块里是结构化的 item 列表：字段显示中文名、值用控件改；
 *   · 加 / 删 item：默认值、空数组、删第一项后的位置前移与索引重排；
 *   · 加 / 删 item 字段：新字段默认值补进所有现存 item，删字段时 item 的键跟着重排；
 *   · 卡模式落盘到 `initial['2.4']`；存档模式当前数组只读、没有增删；
 *   · 状态树里没有 `2.4.0`；标量字段也有「加子元素」（2026-11-28 翻面：字段可以有自己的值 + 孩子）。
 *
 * 判据只用契约 §4.2 的 data-* 钩子；界面文案不在这里钉（字段中文名来自卡数据）。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { holdCard, holdItems, holdSave, nestedCard } from '../tests/support/array-fixtures.js'

const ARRAY = '[data-array="2.4"]'
const ITEMS = `${ARRAY} [data-array-item]`
const row = (code) => `[data-state-item="${code}"]`

/** 开卡编辑器：种一张数组卡 + mock 预设，直接进 `#/edit/:cardId` */
async function openEditor(page, card) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
}

/** 选中状态元素（S2） */
async function selectElement(page, code) {
  await page.locator(row(code)).click()
  await expect(page.locator(`${row(code)}.selected, ${row(code)}[data-selected]`)).toHaveCount(1)
}

/** 点保存并等结果出现；返回中文错误清单条数（0 = 成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

/** 某个 item 行（1 基位置） */
function itemAt(index) {
  return `${ARRAY} [data-array-item][data-array-index="${index}"]`
}

/** 读盘上的 2.4 初始值 */
async function storedItems(page) {
  const card = (await readStorage(page, KEYS.cards))[0]
  return card.state.find((element) => element.code === '2').initial['2.4']
}

test('示例卡 2.4 背包：三项 item、字段显示中文名、值正确、没有 .0 行', async ({ page }) => {
  await boot(page, { sample: true })
  const cards = await readStorage(page, KEYS.cards)
  await page.goto(`${APP_PATH}${route.edit(cards[0].id)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()

  // 状态树：2.4 与两个字段行都在，2.4.0 不出行
  await expect(page.locator(row('2.4'))).toBeVisible()
  await expect(page.locator(row('2.4.1'))).toBeVisible()
  await expect(page.locator(row('2.4.2'))).toBeVisible()
  await expect(page.locator(row('2.4.0'))).toHaveCount(0)

  await selectElement(page, '2')
  await expect(page.locator(ITEMS)).toHaveCount(3)
  for (let at = 1; at <= 3; at += 1) {
    await expect(page.locator(`${itemAt(at)} [data-array-field-name="2.4.1"]`)).toHaveText('物品')
    await expect(page.locator(`${itemAt(at)} [data-array-field-name="2.4.2"]`)).toHaveText('数量')
  }
  await expect(page.locator(`${itemAt(1)} [data-array-field="2.4.1"]`)).toHaveValue('短剑')
  await expect(page.locator(`${itemAt(1)} [data-array-field="2.4.2"]`)).toHaveValue('1')
  await expect(page.locator(`${itemAt(3)} [data-array-field="2.4.1"]`)).toHaveValue('银币')
  await expect(page.locator(`${itemAt(3)} [data-array-field="2.4.2"]`)).toHaveValue('3')

  const text = await page.locator(ARRAY).innerText()
  expect(text, '可见文字里不许出现字段 code').not.toContain('2.4.1')
  expect(text).not.toContain('2.4.2')
})

test('加一项：默认值（物品空串 / 数量 0），保存后初始值多一项', async ({ page }) => {
  await openEditor(page, holdCard())
  await selectElement(page, '2')
  await page.locator(`${ARRAY} [data-array-add]`).click()
  await expect(page.locator(ITEMS)).toHaveCount(4)
  await expect(page.locator(`${itemAt(4)} [data-array-field="2.4.1"]`)).toHaveValue('')
  await expect(page.locator(`${itemAt(4)} [data-array-field="2.4.2"]`)).toHaveValue('0')

  expect(await save(page)).toBe(0)
  const items = await storedItems(page)
  expect(items).toHaveLength(4)
  expect(items[3]).toEqual({ '2.4.1': '', '2.4.2': 0 })
})

test('删第一项：位置前移、索引重排成 1..n、保存后只剩原来的第 2 / 3 项', async ({ page }) => {
  await openEditor(page, holdCard())
  await selectElement(page, '2')
  await page.locator(`${itemAt(1)} [data-array-remove]`).click()

  await expect(page.locator(ITEMS)).toHaveCount(2)
  const indices = await page
    .locator(ITEMS)
    .evaluateAll((rows) => rows.map((item) => item.getAttribute('data-array-index')))
  expect(indices, '删掉后索引要重排').toEqual(['1', '2'])
  await expect(page.locator(`${itemAt(1)} [data-array-field="2.4.1"]`)).toHaveValue('斗篷')
  await expect(page.locator(`${itemAt(2)} [data-array-field="2.4.1"]`)).toHaveValue('银币')

  expect(await save(page)).toBe(0)
  expect(await storedItems(page)).toEqual([
    { '2.4.1': '斗篷', '2.4.2': 1 },
    { '2.4.1': '银币', '2.4.2': 3 },
  ])
})

test('空数组：显示空态、能加一项、保存 []；刷新后仍是空数组', async ({ page }) => {
  const card = holdCard()
  card.state.find((element) => element.code === '2').initial['2.4'] = []
  await openEditor(page, card)
  await selectElement(page, '2')

  await expect(page.locator(ITEMS)).toHaveCount(0)
  await expect(page.locator(`${ARRAY} [data-array-empty]`)).toBeVisible()
  expect(await save(page)).toBe(0)
  expect(await storedItems(page)).toEqual([])

  await page.locator(`${ARRAY} [data-array-add]`).click()
  await expect(page.locator(ITEMS)).toHaveCount(1)
  expect(await save(page)).toBe(0)
  expect(await storedItems(page)).toEqual([{ '2.4.1': '', '2.4.2': 0 }])

  await page.reload()
  await selectElement(page, '2')
  await expect(page.locator(ITEMS)).toHaveCount(1)
})

test('编辑 item 字段：文本与整数都落到 initial["2.4"]', async ({ page }) => {
  await openEditor(page, holdCard())
  await selectElement(page, '2')
  await page.locator(`${itemAt(1)} [data-array-field="2.4.1"]`).fill('长弓')
  await page.locator(`${itemAt(1)} [data-array-field="2.4.2"]`).fill('7')
  await page.locator(`${itemAt(2)} [data-array-field="2.4.2"]`).fill('42')

  expect(await save(page)).toBe(0)
  const items = await storedItems(page)
  expect(items[0]).toEqual({ '2.4.1': '长弓', '2.4.2': 7 })
  expect(items[1]).toEqual({ '2.4.1': '斗篷', '2.4.2': 42 })
  expect(items[2]).toEqual({ '2.4.1': '银币', '2.4.2': 3 })
})

test('加字段：2.4.3 默认值补进所有现存 item，保存后每项都有', async ({ page }) => {
  await openEditor(page, holdCard())
  await selectElement(page, '2.4')
  await page.locator('[data-add-child="2.4"]').click()
  await expect(page.locator(row('2.4.3'))).toBeVisible()

  await selectElement(page, '2')
  await expect(page.locator(ITEMS)).toHaveCount(3)
  for (let at = 1; at <= 3; at += 1) {
    await expect(page.locator(`${itemAt(at)} [data-array-field="2.4.3"]`)).toHaveValue('')
  }

  expect(await save(page)).toBe(0)
  const items = await storedItems(page)
  for (const item of items) expect(item['2.4.3']).toBe('')
  expect(items[0]).toEqual({ '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '' })
})

test('删字段：删 2.4.1，item 的键重排（旧 2.4.2 变 2.4.1），保存后只剩数量', async ({ page }) => {
  await openEditor(page, holdCard())
  await selectElement(page, '2.4.1')
  await page.locator(`${row('2.4.1')} [data-delete-state]`).click()
  await expect(page.locator('[data-confirm]')).toBeVisible()
  await page.locator('[data-confirm-ok]').click()
  await expect(page.locator(row('2.4.1')), '旧 2.4.2 应当重排成 2.4.1').toHaveCount(1)
  await expect(page.locator(`${row('2.4.1')} [data-state-name]`)).toHaveText('数量')

  await selectElement(page, '2')
  await expect(page.locator(`${ARRAY} [data-array-item] [data-array-field]`)).toHaveCount(3)
  await expect(page.locator(`${itemAt(1)} [data-array-field="2.4.1"]`)).toHaveValue('1')
  await expect(page.locator(`${itemAt(1)} [data-array-field="2.4.2"]`)).toHaveCount(0)

  expect(await save(page)).toBe(0)
  expect(await storedItems(page)).toEqual([{ '2.4.1': 1 }, { '2.4.1': 1 }, { '2.4.1': 3 }])
})

test('类型下拉有「数组」；2.4 的当前类型是 array；标量字段也有加子元素', async ({ page }) => {
  await openEditor(page, holdCard())
  await selectElement(page, '2.4')
  await expect(page.locator('[data-state-type]')).toHaveValue('array')
  const types = await page
    .locator('[data-state-type] option')
    .evaluateAll((options) => options.map((option) => option.getAttribute('value')))
  expect(types).toContain('array')

  // 选中标量字段：加子元素与删除都在（2026-11-28 翻面：标量字段可以有自己的值 + 孩子）
  await selectElement(page, '2.4.1')
  await expect(page.locator('[data-add-child="2.4.1"]')).toHaveCount(1)
  await expect(page.locator(`${row('2.4.1')} [data-delete-state]`)).toHaveCount(1)
})

test('嵌套字段在初始值块里递归显示中文名，且能保存原值', async ({ page }) => {
  await openEditor(page, nestedCard())
  await selectElement(page, '2')
  await expect(page.locator(ITEMS)).toHaveCount(1)
  await expect(page.locator('[data-array="2.4"] [data-array-object="2.4.2"]')).toBeVisible()
  await expect(
    page.locator('[data-array="2.4"] [data-array-object="2.4.2"] [data-array-field-name="2.4.2.1"]'),
  ).toHaveText('品质')
  await expect(page.locator('[data-array="2.4"] [data-array="2.4.2.2"]')).toBeVisible()
  await expect(
    page.locator('[data-array="2.4"] [data-array="2.4.2.2"] [data-array-field-name="2.4.2.2.1"]'),
  ).toHaveText('名称')

  const text = await page.locator(ARRAY).innerText()
  for (const code of ['2.4.1', '2.4.2', '2.4.2.1', '2.4.2.2']) expect(text).not.toContain(code)
  expect(await save(page)).toBe(0)
  const items = await storedItems(page)
  expect(items).toEqual([
    {
      '2.4.1': '短剑',
      '2.4.2': {
        '2.4.2.1': '普通',
        '2.4.2.2': [{ '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }],
      },
    },
  ])
})

test('存档编辑器：选中根 2 看 2.4 当前数组（只读、中文名、没有增删）', async ({ page }) => {
  const card = holdCard()
  const save0 = holdSave(card)
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.saves]: [save0], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.editSave(save0.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await selectElement(page, '2')

  // 非根元素没有自己的当前值块：2.4 的只读当前数组挂在根元素的当前值树里
  const current = page.locator('[data-current-tree="2"] [data-current-array="2.4"]')
  await expect(current).toBeVisible()
  await expect(current.locator('[data-array-item]')).toHaveCount(3)
  await expect(current.locator('[data-array-field-name="2.4.1"]').first()).toHaveText('物品')
  await expect(current.locator('[data-array-field="2.4.1"]').first()).toHaveValue('短剑')
  await expect(current.locator('[data-array-field="2.4.1"]').first()).toBeDisabled()
  await expect(current.locator('[data-array-add]')).toHaveCount(0)
  await expect(current.locator('[data-array-remove]')).toHaveCount(0)
  // 只读：点保存不写坏这一份存档
  expect(await save(page)).toBe(0)
  expect((await readStorage(page, KEYS.saves))[0].tree['2.4']).toEqual(holdItems())
})
