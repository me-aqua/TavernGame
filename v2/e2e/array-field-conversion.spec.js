/**
 * 本票 DOM 判据：**有字段的数组字段**（数组子树里）→ `text` / `integer` / `enum`。
 *
 * 口径见 `.team/test/2026-11-28/契约-数组字段转标量-类型下拉-撤销重做.md` §2：
 *   · 类型下拉给四档（`text` / `integer` / `enum` / `array`）；
 *   · 丢弃数 > 0 先弹 `[data-confirm]`，文案含丢弃数；取消 ⇒ 草稿不动、下拉回 `array`；
 *   · 确定 ⇒ 每个外层实例取第一个内层 item（字段值成孩子值、自己的默认值写 `<字段>.0`），其余丢弃；
 *   · 0 丢弃不弹确认；enum 的白名单从源元素保留；
 *   · 落盘后卡仍合法，值仍住在每个外层 item 里（不写根初始值表）。
 *
 * 判据只用 `data-*` 钩子；界面文案不在这里钉（只钉「是中文」与数字）。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { holdCard, withInitialValue } from '../tests/support/array-fixtures.js'

const row = (code) => `[data-state-item="${code}"]`
const typeSelect = '[data-state-type]'
const ARRAY = '[data-array="2.4"]'
const ITEMS = `${ARRAY} [data-array-item]`
const field = (code) => `[data-array-field="${code}"]`

/**
 * 在 `holdCard` 上给 `2.4` 加一个有字段的数组字段（与单测夹具同一形状）：
 *
 * ```text
 * 2.4 背包（array）
 *   2.4.1 物品（text）
 *   2.4.2 数量（integer）
 *   2.4.3 附魔（array）
 *     2.4.3.1 词条（text）
 *     2.4.3.2 强度（integer 0..10）
 * ```
 *
 * 三个外层实例的内层数组长度 2 / 1 / 0（丢弃数 = 1）。
 */
function fieldArrayCard(over = {}) {
  const base = holdCard()
  const at = base.state.findIndex((item) => item.code === '2.4.2') + 1
  const card = {
    ...base,
    state: [
      ...base.state.slice(0, at),
      { code: '2.4.3', name: '附魔', note: '', type: 'array' },
      { code: '2.4.3.1', name: '词条', note: '', type: 'text' },
      { code: '2.4.3.2', name: '强度', note: '', type: 'integer', min: 0, max: 10 },
      ...base.state.slice(at),
    ],
    ...over,
  }
  return withInitialValue(card, '2.4', [
    {
      '2.4.1': '短剑',
      '2.4.2': 1,
      '2.4.3': [
        { '2.4.3.1': '锋利', '2.4.3.2': 3 },
        { '2.4.3.1': '旧词条', '2.4.3.2': 9 },
      ],
    },
    { '2.4.1': '斗篷', '2.4.2': 1, '2.4.3': [{ '2.4.3.1': '轻柔', '2.4.3.2': 4 }] },
    { '2.4.1': '银币', '2.4.2': 3, '2.4.3': [] },
  ])
}

/** 每项内层数组都 ≤ 1：丢弃数为 0（不该弹确认） */
function oneInnerEachCard(over = {}) {
  const card = withInitialValue(fieldArrayCard(), '2.4', [
    { '2.4.1': '短剑', '2.4.2': 1, '2.4.3': [{ '2.4.3.1': '锋利', '2.4.3.2': 3 }] },
    { '2.4.1': '斗篷', '2.4.2': 1, '2.4.3': [] },
    { '2.4.1': '银币', '2.4.2': 3, '2.4.3': [{ '2.4.3.1': '微光', '2.4.3.2': 2 }] },
  ])
  return { ...card, ...over }
}

/** 开卡编辑器、选中一个元素 */
async function openEditor(page, card, code = '2.4.3') {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator(row(code)).click()
  await expect(page.locator(typeSelect)).toBeVisible()
}

/** 类型下拉的每一档（value） */
async function typeValues(page) {
  return page.locator(`${typeSelect} option`).evaluateAll((options) => options.map((option) => option.value))
}

/** 点保存并等结果出现；返回中文错误清单条数（0 = 成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

/** 盘上第一张卡的某个元素 / 根初始值表 */
async function stored(page, code) {
  const card = (await readStorage(page, KEYS.cards))[0]
  return {
    card,
    element: card.state.find((item) => item.code === code),
    children: card.state.filter((item) => item.code.startsWith(`${code}.`)).map((item) => item.code),
    table: card.state.find((item) => item.code === '2').initial,
  }
}

test.describe('有字段的数组字段 → text（§2）', () => {
  test('四档下拉；>0 丢弃先确认（含数字）；取消不动；确定后每个外层实例取第一个内层 item', async ({
    page,
  }) => {
    const card = fieldArrayCard({ id: 'c-field-scalar-text' })
    await openEditor(page, card)

    expect(await typeValues(page), '有字段的数组字段也列四档').toEqual(['text', 'integer', 'enum', 'array'])

    await page.locator(typeSelect).selectOption('text')
    await expect(page.locator('[data-confirm]'), '丢弃数 1 > 0 必须先确认').toBeVisible()
    await expect(page.locator('[data-confirm]')).toContainText(/[\u4e00-\u9fff]/)
    await expect(page.locator('[data-confirm]'), '文案要说清丢几项').toContainText('1')
    await page.locator('[data-confirm-cancel]').click()
    await expect(page.locator(typeSelect), '取消后下拉拨回 array').toHaveValue('array')
    expect(await save(page), '取消后草稿没变，保存通过').toBe(0)

    const untouched = await stored(page, '2.4.3')
    expect(untouched.element.type).toBe('array')
    expect(
      untouched.table['2.4'].map((item) => item['2.4.3'].length),
      '取消后盘上内层数组还是 2 / 1 / 0',
    ).toEqual([2, 1, 0])

    await page.locator(typeSelect).selectOption('text')
    await page.locator('[data-confirm-ok]').click()
    await expect(page.locator(typeSelect)).toHaveValue('text')
    expect(await save(page)).toBe(0)

    const { element, children, table } = await stored(page, '2.4.3')
    expect(element.type).toBe('text')
    expect(children, '孩子定义一个都不许少 / 不许改名').toEqual(['2.4.3.1', '2.4.3.2'])
    expect(
      table['2.4'].map((item) => item['2.4.3']),
      '每个外层实例取第一个内层 item；空内层全默认；own 默认空串',
    ).toEqual([
      { '2.4.3.0': '', '2.4.3.1': '锋利', '2.4.3.2': 3 },
      { '2.4.3.0': '', '2.4.3.1': '轻柔', '2.4.3.2': 4 },
      { '2.4.3.0': '', '2.4.3.1': '', '2.4.3.2': 0 },
    ])
    expect(JSON.stringify(table['2.4']), '第 2 个内层 item 必须丢弃').not.toContain('旧词条')
    expect(table, '字段值不写回根初始值表').not.toHaveProperty('2.4.3')
  })

  test('转换后 item 卡按「自己的输入 + 孩子行」渲染（值住在每个外层 item 里）', async ({ page }) => {
    await openEditor(page, fieldArrayCard({ id: 'c-field-scalar-render' }))
    await page.locator(typeSelect).selectOption('text')
    await page.locator('[data-confirm-ok]').click()
    expect(await save(page)).toBe(0)

    await page.locator(row('2')).click()
    await expect(page.locator(ITEMS), '三个外层 item 不动').toHaveCount(3)
    const itemAt = (index) => `${ARRAY} [data-array-item][data-array-index="${index}"]`
    const first = itemAt(1)
    await expect(page.locator(`${first} ${field('2.4.3')}`), '自己的值 = 默认空串').toHaveValue('')
    await expect(page.locator(`${first} ${field('2.4.3.1')}`)).toHaveValue('锋利')
    await expect(page.locator(`${first} ${field('2.4.3.2')}`)).toHaveValue('3')
    const third = itemAt(3)
    await expect(page.locator(`${third} ${field('2.4.3.1')}`), '空内层 → 孩子默认值').toHaveValue('')
    await expect(page.locator(`${third} ${field('2.4.3.2')}`)).toHaveValue('0')
  })
})

test.describe('丢弃数为 0 / enum 白名单（§2）', () => {
  test('每项内层 ≤ 1：不弹确认，直接转换', async ({ page }) => {
    await openEditor(page, oneInnerEachCard({ id: 'c-field-scalar-no-confirm' }))
    await page.locator(typeSelect).selectOption('text', { timeout: 3_000 })
    await expect(page.locator('[data-confirm]'), '没有可丢弃的项就不弹确认').toHaveCount(0)
    await expect(page.locator(typeSelect)).toHaveValue('text')
    expect(await save(page)).toBe(0)
    const { table } = await stored(page, '2.4.3')
    expect(table['2.4'].map((item) => item['2.4.3'])).toEqual([
      { '2.4.3.0': '', '2.4.3.1': '锋利', '2.4.3.2': 3 },
      { '2.4.3.0': '', '2.4.3.1': '', '2.4.3.2': 0 },
      { '2.4.3.0': '', '2.4.3.1': '微光', '2.4.3.2': 2 },
    ])
  })

  test('enum：源白名单保留、own `.0` = 第一项、孩子值照搬', async ({ page }) => {
    const base = oneInnerEachCard({ id: 'c-field-scalar-enum' })
    const card = {
      ...base,
      state: base.state.map((item) => (item.code === '2.4.3' ? { ...item, values: ['甲', '乙'] } : item)),
    }
    await openEditor(page, card)
    await page.locator(typeSelect).selectOption('enum')
    await expect(page.locator('[data-confirm]')).toHaveCount(0)
    expect(await save(page)).toBe(0)

    const { element, table } = await stored(page, '2.4.3')
    expect(element.type).toBe('enum')
    expect(element.values).toEqual(['甲', '乙'])
    expect(table['2.4'].map((item) => item['2.4.3']['2.4.3.0'])).toEqual(['甲', '甲', '甲'])
    expect(table['2.4'][0]['2.4.3']['2.4.3.1']).toBe('锋利')
  })
})
