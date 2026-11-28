/**
 * 阶段 2.3 · 三模式 + 三组节日勾选（界面层，契约 §A–§B）。
 *
 * 钉五件事：
 *   1. 时间元素的**第一行「类型」就是模式下拉**（三个模式、默认 year-minute），没有单独的时间模式行；
 *   2. 时间初始值格子按模式给 5 / 3 / 3 格，**没有秒**；
 *   3. 年份模式有**三个**节日勾选（含「中国传统节日」与常驻备注）；天数模式**一个都没有**；
 *   4. 卡模式切换模式要先确认；取消 ⇒ 一个字不动；确认 ⇒ 初值重置成新模式默认、格子跟着换；
 *   5. 存档模式类型行锁死（select disabled）、初始值块不渲染。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, MOCK_PRESET, readStorage } from './support/app.js'
import { cardWithTime, v6Save } from '../tests/support/v6-fixtures.js'

const YEAR_MINUTE = 'c-year-minute'
const DAYS = 'c-days'
const SAVE_ID = 's-ym'

/** 两张卡（年份模式 / 天数模式）+ 一份存档 */
function seeded() {
  const yearMinute = cardWithTime({ id: YEAR_MINUTE })
  const days = cardWithTime({
    id: DAYS,
    mode: 'days-minute',
    time: { day: 3, hour: 9, minute: 15 },
  })
  return {
    [KEYS.cards]: [yearMinute, days],
    [KEYS.saves]: [v6Save(yearMinute, { id: SAVE_ID })],
    [KEYS.presets]: [MOCK_PRESET],
    [KEYS.nodeModels]: Object.fromEntries(
      [yearMinute, days].map((card) => [
        card.id,
        Object.fromEntries(card.chain.map((node) => [node.id, MOCK_PRESET.id])),
      ]),
    ),
  }
}

async function openCardEditor(page, cardId) {
  await page.goto(`${APP_PATH}#/edit/${cardId}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator('[data-state-item="0"]').click()
}

/** 时间初始值的格子数（按单位标签数，类型行不算格子） */
const timeUnits = (page) => page.locator('[data-time-unit]')

/** 时间元素的类型行（就是模式下拉） */
const typeRow = (page) => page.locator('[data-field="type"]')

test.describe('B5 时间元素表单', () => {
  test('三个模式选项；默认 year-minute；五格 + 单位；没有秒', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openCardEditor(page, YEAR_MINUTE)

    const mode = typeRow(page)
    await expect(mode).toBeVisible()
    await expect(mode.locator('option')).toHaveCount(3)
    await expect(mode).toHaveValue('year-minute')
    expect(
      await mode.locator('option').evaluateAll((options) => options.map((option) => option.value)),
    ).toEqual(['year-minute', 'year-date', 'days-minute'])

    await expect(timeUnits(page)).toHaveCount(5)
    await expect(page.locator('[data-field="time-year"]')).toHaveValue('2024')
    await expect(page.locator('[data-field="time-minute"]')).toHaveValue('30')
    await expect(page.locator('[data-field="time-second"]'), '秒这一格不存在了').toHaveCount(0)
    await expect(page.locator('[data-field="time-mode"]'), '单独的时间模式行不存在了').toHaveCount(0)
  })

  test('年份模式有三个节日勾选，传统节日旁有「仅支持 1900–2100」备注', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openCardEditor(page, YEAR_MINUTE)

    await expect(page.locator('[data-holiday]')).toHaveCount(3)
    for (const group of ['international', 'china', 'traditional']) {
      await expect(page.locator(`[data-holiday="${group}"]`)).toBeVisible()
    }
    await expect(page.locator('[data-holiday-note]')).toBeVisible()
  })

  test('天数模式：一个节日勾选都没有、备注也没有，时间三格', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openCardEditor(page, DAYS)

    await expect(page.locator('[data-holiday]')).toHaveCount(0)
    await expect(page.locator('[data-holiday-note]')).toHaveCount(0)
    await expect(timeUnits(page)).toHaveCount(3)
    await expect(page.locator('[data-field="time-year"]')).toHaveCount(0)
    await expect(page.locator('[data-field="time-day"]')).toHaveValue('3')
  })

  test('传统节日勾选永远可点（表外年份也不置灰）', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openCardEditor(page, YEAR_MINUTE)
    const traditional = page.locator('[data-holiday="traditional"]')
    await expect(traditional).toBeEnabled()
    await traditional.check()
    await expect(traditional).toBeChecked()
  })
})

test.describe('B6 时间类型只属于时间元素', () => {
  test('非时间元素的类型行没有「时间」：五档、页面不崩', async ({ page }) => {
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await boot(page, { storage: seeded() })
    await openCardEditor(page, YEAR_MINUTE)

    // 选一个普通子元素（1.2 是 text）：它是非时间行，类型下拉里没有 time 这一档
    await page.locator('[data-state-item="1.2"]').click()
    await expect(typeRow(page)).toHaveValue('text')
    const types = await typeRow(page)
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value))
    expect(types, '非时间行的类型下拉五档（作者四档 + 引用）').toEqual([
      'text',
      'integer',
      'enum',
      'array',
      'ref',
    ])
    expect(types, '时间只住在根 0（它的行是模式选择器），非时间行不许出现 time').not.toContain('time')

    // 页面不崩：编辑器还在、没有未捕获异常
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    expect(pageErrors, `不许有未捕获异常：${pageErrors.join(' | ')}`).toEqual([])
  })
})

test.describe('B5 切换模式：确认与重置', () => {
  test('切换先弹确认；取消 ⇒ 模式与初值都不变', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openCardEditor(page, YEAR_MINUTE)

    const mode = typeRow(page)
    await mode.selectOption('year-date')
    await expect(page.locator('[data-confirm]')).toBeVisible()
    await page.locator('[data-confirm-cancel]').click()

    await expect(mode).toHaveValue('year-minute')
    await expect(timeUnits(page)).toHaveCount(5)
  })

  test('确认 ⇒ 初值重置成新模式默认（year-date：年/月/日 三格）', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openCardEditor(page, YEAR_MINUTE)

    await typeRow(page).selectOption('year-date')
    await page.locator('[data-confirm-ok]').click()

    await expect(typeRow(page)).toHaveValue('year-date')
    await expect(timeUnits(page)).toHaveCount(3)
    await expect(page.locator('[data-field="time-year"]')).toHaveValue('1024')
    await expect(page.locator('[data-field="time-month"]')).toHaveValue('1')
    await expect(page.locator('[data-field="time-day"]')).toHaveValue('1')
    await expect(page.locator('[data-field="time-hour"]')).toHaveCount(0)

    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()
    const cards = await readStorage(page, KEYS.cards)
    const card = cards.find((item) => item.id === YEAR_MINUTE)
    expect(card.state[0].timeMode).toBe('year-date')
    expect(card.state[0].type, '底层类型仍是 time').toBe('time')
    expect(card.state[0].initial).toEqual({ year: 1024, month: 1, day: 1 })
    expect(card.state[0].holidays).toBeTruthy()
  })

  test('确认切到 days-minute ⇒ 初值三格、节日勾选整块消失，保存后 holidays 键没了', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openCardEditor(page, YEAR_MINUTE)

    await typeRow(page).selectOption('days-minute')
    await page.locator('[data-confirm-ok]').click()
    await expect(timeUnits(page)).toHaveCount(3)
    await expect(page.locator('[data-holiday]')).toHaveCount(0)

    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()
    const cards = await readStorage(page, KEYS.cards)
    const card = cards.find((item) => item.id === YEAR_MINUTE)
    expect(card.state[0].timeMode).toBe('days-minute')
    expect(card.state[0].initial).toEqual({ day: 1, hour: 8, minute: 0 })
    expect(card.state[0]).not.toHaveProperty('holidays')
  })
})

test.describe('B5 存档模式：类型行锁死、初值不显示', () => {
  test('存档编辑器里类型行 disabled，初始值块不渲染，节日勾选照旧在', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await page.goto(`${APP_PATH}#/edit-save/${SAVE_ID}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-state-item="0"]').click()

    await expect(typeRow(page)).toHaveCount(1)
    await expect(typeRow(page)).toHaveValue('year-minute')
    await expect(typeRow(page)).toBeDisabled()
    await expect(page.locator('[data-initial-block]')).toHaveCount(0)
    await expect(page.locator('[data-holiday]')).toHaveCount(3)
  })
})
