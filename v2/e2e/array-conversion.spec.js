/**
 * 阶段 3 · 扩充：数组 ⇄ 结构体的**编辑器**（契约增补 §十）。
 *
 * 这一份量的是玩家在卡编辑器里点得到的那几件事：
 *   · 数组行的类型锁：`[data-state-type]` 只有 array / object，没有 text / integer / enum / time；
 *   · 数组 → 结构体：>1 项**先弹确认**；取消一个字不动；确定后只留第 1 项、其余丢弃；
 *     0 / 1 项不弹确认；
 *   · 结构体 → 数组：当前对象值 = 一个 item；
 *   · 字段定义上 / 下、`reads` / `writable` 引用逐字不变；
 *   · **存档编辑器**里类型下拉对**所有**元素锁死（结构冻结）。
 *
 * 判据只用既有 `data-*` 钩子；确认文案与界面措辞不在这里钉。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { holdCard, holdSave } from '../tests/support/array-fixtures.js'

const row = (code) => `[data-state-item="${code}"]`
const typeSelect = '[data-state-type]'

/** 把 `check` 节点的两面眼睛换成给定清单（别的节点原样） */
function cardWithRefs(card, { reads = [], writable = [] } = {}) {
  return {
    ...card,
    chain: card.chain.map((node) => (node.id === 'check' ? { ...node, reads, writable } : node)),
  }
}

/** 根 `2` 的初始值表 */
function tableOf(card) {
  return card.state.find((item) => item.code === '2').initial
}

/** 换掉根 `2` 的整张初始值表 */
function withTable(card, table) {
  return {
    ...card,
    state: card.state.map((item) => (item.code === '2' ? { ...item, initial: table } : item)),
  }
}

/** 把 `2.4` 换成结构体，并给出它后代的值（扁平表键 = 完整 code） */
function objectCard(values) {
  const base = holdCard({ id: 'c-object' })
  const table = { ...tableOf(base) }
  delete table['2.4']
  Object.assign(table, values)
  return withTable(
    {
      ...base,
      state: base.state.map((item) => (item.code === '2.4' ? { ...item, type: 'object' } : item)),
    },
    table,
  )
}

/** 开卡编辑器、选中 `2.4`（类型下拉在中栏） */
async function openCard24(page, card) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator(row('2.4')).click()
  await expect(page.locator(typeSelect)).toBeVisible()
}

/** 点保存并等结果出现；返回中文错误清单条数（0 = 成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

/** 盘上第一张卡的某个元素 / 根初始值 */
async function stored(page, code) {
  const cards = await readStorage(page, KEYS.cards)
  const card = cards[0]
  return {
    card,
    element: card.state.find((item) => item.code === code),
    table: tableOf(card),
  }
}

test.describe('数组 → 结构体（卡编辑器）', () => {
  test('类型锁：数组行只有 array / object 两个选项', async ({ page }) => {
    await openCard24(page, holdCard({ id: 'c-conv-lock' }))
    const values = await page
      .locator(`${typeSelect} option`)
      .evaluateAll((options) => options.map((option) => option.value))
    expect(values, '数组行不许出现 text / integer / enum / time').toEqual(['array', 'object'])
  })

  test('3 项：先弹确认；取消不动；确定后只留第 1 项、字段还在、引用不变', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-conv-3' }), {
      reads: ['2.4', '2.4.1'],
      writable: ['2.4', '2.4.2'],
    })
    await openCard24(page, card)

    await page.locator(typeSelect).selectOption('object', { timeout: 3_000 })
    await expect(page.locator('[data-confirm]'), '>1 项必须先弹确认').toBeVisible()
    await expect(page.locator('[data-confirm]')).toContainText(/[\u4e00-\u9fff]/)
    await page.locator('[data-confirm-cancel]').click()
    await expect(page.locator(typeSelect)).toHaveValue('array')
    expect(await save(page)).toBe(0)
    expect((await stored(page, '2.4')).table['2.4']).toHaveLength(3)

    await page.locator(typeSelect).selectOption('object', { timeout: 3_000 })
    await page.locator('[data-confirm-ok]').click()
    await expect(page.locator(typeSelect)).toHaveValue('object')
    expect(await save(page)).toBe(0)

    const { card: saved, element, table } = await stored(page, '2.4')
    expect(element.type).toBe('object')
    expect(
      saved.state.filter((item) => item.code.startsWith('2.4.')).map((item) => item.code),
      '字段定义不许少 / 不许改名',
    ).toEqual(['2.4.1', '2.4.2'])
    expect(saved.chain).toEqual(card.chain)
    expect(table['2.4.1']).toBe('短剑')
    expect(table['2.4.2']).toBe(1)
    expect(table).not.toHaveProperty('2.4')
    expect(JSON.stringify(table), '第 2 / 3 项必须丢弃').not.toContain('斗篷')
  })

  test('0 项：不弹确认，直接转成字段默认值', async ({ page }) => {
    const card = withTable(holdCard({ id: 'c-conv-0' }), { ...tableOf(holdCard()), 2.4: [] })
    await openCard24(page, card)
    await page.locator(typeSelect).selectOption('object', { timeout: 3_000 })
    await expect(page.locator('[data-confirm]')).toHaveCount(0)
    expect(await save(page)).toBe(0)

    const { element, table } = await stored(page, '2.4')
    expect(element.type).toBe('object')
    expect(table['2.4.1']).toBe('')
    expect(table['2.4.2']).toBe(0)
    expect(table).not.toHaveProperty('2.4')
  })

  test('1 项：不弹确认，取第 1 项', async ({ page }) => {
    const card = withTable(holdCard({ id: 'c-conv-1' }), {
      ...tableOf(holdCard()),
      2.4: [{ '2.4.1': '长弓', '2.4.2': 7 }],
    })
    await openCard24(page, card)
    await page.locator(typeSelect).selectOption('object', { timeout: 3_000 })
    await expect(page.locator('[data-confirm]')).toHaveCount(0)
    expect(await save(page)).toBe(0)

    const { element, table } = await stored(page, '2.4')
    expect(element.type).toBe('object')
    expect(table['2.4.1']).toBe('长弓')
    expect(table['2.4.2']).toBe(7)
  })
})

test.describe('结构体 → 数组（卡编辑器）', () => {
  test('当前对象值 = 一个 item；字段下调、引用保留；不弹确认', async ({ page }) => {
    const card = cardWithRefs(objectCard({ '2.4.1': '短剑', '2.4.2': 7 }), {
      reads: ['2.4', '2.4.1'],
      writable: ['2.4.2'],
    })
    await openCard24(page, card)
    await page.locator(typeSelect).selectOption('array', { timeout: 3_000 })
    await expect(page.locator('[data-confirm]')).toHaveCount(0)
    expect(await save(page)).toBe(0)

    const { card: saved, element, table } = await stored(page, '2.4')
    expect(element.type).toBe('array')
    expect(table['2.4']).toEqual([{ '2.4.1': '短剑', '2.4.2': 7 }])
    expect(table).not.toHaveProperty('2.4.1')
    expect(table).not.toHaveProperty('2.4.2')
    expect(saved.chain).toEqual(card.chain)
  })
})

test.describe('存档编辑器：类型锁死（结构冻结）', () => {
  test('选中数组 / 文本元素，类型下拉都 disabled', async ({ page }) => {
    const card = holdCard({ id: 'c-conv-save' })
    const save = holdSave(card, { id: 's-conv-save' })
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [save], [KEYS.presets]: [MOCK_PRESET] },
      hash: route.editSave(save.id),
    })
    await expect(page.locator('[data-page="editor"]')).toBeVisible()

    await page.locator(row('2.4')).click()
    await expect(page.locator(typeSelect), '存档编辑器里数组类型必须锁死').toBeDisabled()

    await page.locator(row('2.1')).click()
    await expect(page.locator(typeSelect), '存档编辑器里所有类型都必须锁死').toBeDisabled()
  })
})
