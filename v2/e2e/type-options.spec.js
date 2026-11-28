/**
 * 本票 DOM 判据：**非时间元素的类型下拉**。
 *
 * 口径见 `.team/test/2026-11-28/契约-数组字段转标量-类型下拉-撤销重做.md` §3：
 *   · 非时间元素恰好四档 `text` / `integer` / `enum` / `array`，**没有 `time`**；
 *   · 数组 → 标量之后仍是这四档（本条是回归：换过类型也不许多出时间）；
 *   · 时间行仍是三个模式选择器；
 *   · 例外（结构冻结）：数组子树里的对象字段只列 `object`。
 *
 * 判据只用 `data-*` 钩子；界面文案不在这里钉。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, route } from './support/app.js'
import { holdCard, nestedCard, withInitialValue } from '../tests/support/array-fixtures.js'

const row = (code) => `[data-state-item="${code}"]`
const typeSelect = '[data-state-type]'
const FOUR = ['text', 'integer', 'enum', 'array']

/** 在 `holdCard` 上给 `2.4` 加一个有字段的数组字段（与 array-field-conversion 同一形状） */
function fieldArrayCard(over = {}) {
  const base = holdCard()
  const at = base.state.findIndex((item) => item.code === '2.4.2') + 1
  const card = {
    ...base,
    state: [
      ...base.state.slice(0, at),
      { code: '2.4.3', name: '附魔', note: '', type: 'array' },
      { code: '2.4.3.1', name: '词条', note: '', type: 'text' },
      ...base.state.slice(at),
    ],
    ...over,
  }
  return withInitialValue(card, '2.4', [
    { '2.4.1': '短剑', '2.4.2': 1, '2.4.3': [{ '2.4.3.1': '锋利' }] },
    { '2.4.1': '斗篷', '2.4.2': 1, '2.4.3': [] },
  ])
}

/** 开卡编辑器 */
async function openEditor(page, card) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
}

/** 选中一个元素并读类型下拉的每一档（value） */
async function selectAndRead(page, code) {
  await page.locator(row(code)).click()
  await expect(page.locator(typeSelect)).toBeVisible()
  return page.locator(`${typeSelect} option`).evaluateAll((options) => options.map((option) => option.value))
}

test.describe('非时间元素：恰好四档、没有 time（§3.1）', () => {
  test('根 object / 普通元素 / 数组 / 标量字段 / 有字段的数组字段都是四档', async ({ page }) => {
    await openEditor(page, fieldArrayCard({ id: 'c-types-four' }))
    for (const code of ['2', '2.1', '2.4', '2.4.1', '2.4.3']) {
      const values = await selectAndRead(page, code)
      expect(values, `${code} 的类型下拉恰好四档`).toEqual(FOUR)
      expect(values, `${code} 不许出现 time`).not.toContain('time')
    }
  })

  test('数组 2.4 → text 之后：仍是四档、没有 time（本票点名的回归）', async ({ page }) => {
    await openEditor(page, holdCard({ id: 'c-types-after-convert' }))
    const before = await selectAndRead(page, '2.4')
    expect(before, '数组行先证明是四档').toEqual(FOUR)

    await page.locator(typeSelect).selectOption('text')
    await expect(page.locator('[data-confirm]'), '三项 → 先确认').toBeVisible()
    await page.locator('[data-confirm-ok]').click()
    await expect(page.locator(typeSelect)).toHaveValue('text')

    const after = await page
      .locator(`${typeSelect} option`)
      .evaluateAll((options) => options.map((option) => option.value))
    expect(after, '数组换标量之后仍是这四档').toEqual(FOUR)
    expect(after, '换过类型也不许冒出 time').not.toContain('time')
  })
})

test.describe('守卫：时间行 / 对象字段（§3.1）', () => {
  test('时间行仍是三个模式选择器，没有 text / array', async ({ page }) => {
    await openEditor(page, holdCard({ id: 'c-types-time' }))
    const values = await selectAndRead(page, '0')
    expect(values).toEqual(['year-minute', 'year-date', 'days-minute'])
    expect(values).not.toContain('text')
    expect(values).not.toContain('array')
    await expect(page.locator(typeSelect)).toHaveValue('year-minute')
  })

  test('数组子树里的对象字段只列 object（结构冻结）', async ({ page }) => {
    await openEditor(page, nestedCard({ id: 'c-types-object-field' }))
    const values = await selectAndRead(page, '2.4.2')
    expect(values, '对象字段不换类型').toEqual(['object'])
    expect(values).not.toContain('time')
  })
})
