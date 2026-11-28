/**
 * 第 2 关 · 修复 B：枚举白名单 textarea 的草稿 / 提交（`[data-field="values"]`）。
 *
 * 钉住的东西（契约 `.team/test/2026-11-28/契约-编辑器两处修复.md` §3）：
 *   · 打字只改本地草稿：DOM 值逐字保留（末行回车加空行、空行 / 只含空白的行不被吞）；
 *   · blur / 保存才提交：按行 trim、丢掉空行与只含空白的行，textarea 归一化，`values` 写进卡；
 *   · 打字期间不重置枚举初始值；提交后旧值不在新列表里 ⇒ 才重置为第一项；
 *   · 存档模式同一套草稿 / 提交，`save.tree` 不动。
 *
 * 判据只认契约 §3 的钩子与 `values` 数据；界面文案不在这里钉。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { element, v5Card, v5Save } from '../tests/support/state-fixtures.js'

const TEXTAREA = '[data-field="values"]'
const row = (code) => `[data-state-item="${code}"]`

async function openCardEditor(page, card) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
}

async function selectElement(page, code) {
  await page.locator(row(code)).click()
  await expect(page.locator('[data-field="name"]')).toBeVisible()
}

/** 点保存并等结果；返回中文错误清单条数（0 = 成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

/** 根元素是 enum 的卡：用来观察「打字期间初始值不许重置」 */
function enumCard() {
  const base = v5Card()
  return {
    ...base,
    id: 'c-enum-root',
    state: [...base.state, element('3', 'enum', { name: 'mood', values: ['A', 'B'], initial: { 3: 'A' } })],
  }
}

test('B1 末行回车：textarea 保留新空行，不被打回旧值', async ({ page }) => {
  await openCardEditor(page, v5Card())
  await selectElement(page, '1.1')

  const values = page.locator(TEXTAREA)
  await expect(values).toHaveValue('A1\nA2')
  // 光标在末行末尾按回车：草稿多一行空行，DOM 必须原样保留
  await values.fill('A1\nA2')
  await values.press('Enter')
  await expect(values, '末行回车后应当多一个空行').toHaveValue('A1\nA2\n')

  // 在空行里继续输入：新行是独立的一行，不是拼到上一行尾巴上
  await values.pressSequentially('B')
  await expect(values).toHaveValue('A1\nA2\nB')
})

test('B2 连续输入多行：每行独立；提交后 values 与落盘都是这三行', async ({ page }) => {
  const card = v5Card()
  await openCardEditor(page, card)
  await selectElement(page, '1.1')

  const values = page.locator(TEXTAREA)
  await values.fill('A1')
  await values.press('Enter')
  await values.pressSequentially('B')
  await values.press('Enter')
  await values.pressSequentially('C')
  await expect(values, '打字时三行都在').toHaveValue('A1\nB\nC')

  await page.locator('[data-field="note"]').click() // blur ⇒ 提交
  await expect(values).toHaveValue('A1\nB\nC')
  expect(await save(page)).toBe(0)
  const saved = (await readStorage(page, KEYS.cards))[0]
  expect(saved.state.find((item) => item.code === '1.1').values).toEqual(['A1', 'B', 'C'])
})

test('B3 空行：打字时逐字保留，blur 后剥掉，落盘 values 不含空行', async ({ page }) => {
  const card = v5Card()
  await openCardEditor(page, card)
  await selectElement(page, '1.1')

  const values = page.locator(TEXTAREA)
  await values.fill('A1\n\nA2\n')
  await expect(values, '打字时草稿不许被归一化（空行还在）').toHaveValue('A1\n\nA2\n')

  await page.locator('[data-field="note"]').click()
  await expect(values, 'blur 后空行剥掉').toHaveValue('A1\nA2')
  expect(await save(page)).toBe(0)
  const saved = (await readStorage(page, KEYS.cards))[0]
  expect(saved.state.find((item) => item.code === '1.1').values).toEqual(['A1', 'A2'])
})

test('B4 只含空白的行：打字时保留，blur 后剥掉；保留行也 trim', async ({ page }) => {
  const card = v5Card()
  await openCardEditor(page, card)
  await selectElement(page, '1.1')

  const values = page.locator(TEXTAREA)
  await values.fill(' A1 \n   \n\t\n A2 ')
  await expect(values, '打字时只含空白的行也要原样留着').toHaveValue(' A1 \n   \n\t\n A2 ')

  await page.locator('[data-field="note"]').click()
  await expect(values).toHaveValue('A1\nA2')
  expect(await save(page)).toBe(0)
  const saved = (await readStorage(page, KEYS.cards))[0]
  expect(saved.state.find((item) => item.code === '1.1').values).toEqual(['A1', 'A2'])
})

test('B5 保存路径：textarea 还带焦点时点保存，落盘 values 已归一化', async ({ page }) => {
  const card = v5Card()
  await openCardEditor(page, card)
  await selectElement(page, '1.1')

  const values = page.locator(TEXTAREA)
  await values.fill('A1\n\n  \nA2\n')
  // 真实鼠标点击：mousedown 先 blur（提交），再 click（保存）
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-ok]')).toBeVisible()
  await expect(values).toHaveValue('A1\nA2')

  const saved = (await readStorage(page, KEYS.cards))[0]
  expect(saved.state.find((item) => item.code === '1.1').values).toEqual(['A1', 'A2'])
})

test('B6 打字期间不重置枚举初值；提交后才按新列表重置', async ({ page }) => {
  const card = enumCard()
  await openCardEditor(page, card)
  await selectElement(page, '3')

  const values = page.locator(TEXTAREA)
  const initial = page.locator('[data-field="initial"]')
  await expect(values).toHaveValue('A\nB')
  await expect(initial).toHaveValue('A')

  await values.fill('')
  await values.pressSequentially('B')
  await expect(values).toHaveValue('B')
  await expect(initial, '打字期间旧值 A 暂时不在列表里，也不许重置').toHaveValue('A')

  await values.press('Enter')
  await values.pressSequentially('C')
  await expect(values).toHaveValue('B\nC')
  await expect(initial, '还没提交，初始值仍是 A').toHaveValue('A')

  await page.locator('[data-field="name"]').click() // blur ⇒ 提交
  await expect(values).toHaveValue('B\nC')
  await expect(initial, '提交后旧值 A 不在新列表 ⇒ 重置为第一项 B').toHaveValue('B')
  expect(await save(page)).toBe(0)
  const saved = (await readStorage(page, KEYS.cards))[0]
  expect(saved.state.find((item) => item.code === '3').values).toEqual(['B', 'C'])
  expect(saved.state.find((item) => item.code === '3').initial['3']).toBe('B')
})

test('B7 存档模式：白名单写进快照，save.tree 逐字段不变', async ({ page }) => {
  const card = v5Card()
  const save0 = v5Save(card, { id: 's-enum-values' })
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.saves]: [save0], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.editSave(save0.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await selectElement(page, '1.1')

  const values = page.locator(TEXTAREA)
  await values.fill('A1\n\nB2\n')
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-ok]')).toBeVisible()
  await expect(values).toHaveValue('A1\nB2')

  const saved = (await readStorage(page, KEYS.saves))[0]
  expect(saved.cardSnapshot.state.find((item) => item.code === '1.1').values).toEqual(['A1', 'B2'])
  expect(saved.tree, '改白名单不许动这一局的当前树').toEqual(save0.tree)
})
