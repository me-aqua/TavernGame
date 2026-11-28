/**
 * 阶段 2.3 · 时间编辑页：类型行 = 模式 + 节日勾选单行（契约 §A–§B）。
 *
 * 钉四件事（A 组）：
 *   1. 时间元素的 `[data-field="type"]` 就是模式下拉：3 个选项、value = 模式 id、卡模式可改；
 *      同一个 DOM 节点仍带 `data-state-type`（既有判据按它找）；单独的时间模式行与颗粒度行**都不存在**；
 *   2. 换模式先确认；取消 ⇒ 模式与格子都不动；
 *   3. 确认 ⇒ 时间值重置、`days-minute` 删节日勾选、保存后 `type` 仍是 `time`；
 *   4. 存档模式：类型行显示模式但锁死。
 *
 * 钉三件事（B 组）：
 *   1. 三个节日勾选在**同一水平行、左对齐**（不是三行）；
 *   2. 自定义外观：`appearance: none`、盒子 12–16px、勾上不是原生蓝；
 *   3. 传统节日旁的小字 `仅支持 1900–2100` 在同一条线上；勾选 / 保存行为不变。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, MOCK_PRESET, readStorage } from './support/app.js'
import { cardWithTime, v6Save } from '../tests/support/v6-fixtures.js'

const CARD_ID = 'c-time-row'
const DAYS_ID = 'c-time-days'
const SAVE_ID = 's-time-row'

/** 两张卡（年-分钟 / 天数-分钟）+ 一份存档 + 一个 mock 预设 */
function seeded() {
  const yearMinute = cardWithTime({ id: CARD_ID })
  const days = cardWithTime({
    id: DAYS_ID,
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

async function openTime(page, cardId = CARD_ID) {
  await page.goto(`${APP_PATH}#/edit/${cardId}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator('[data-state-item="0"]').click()
}

/** 读盘上的那张卡 */
async function readCard(page, cardId = CARD_ID) {
  const cards = await readStorage(page, KEYS.cards)
  return cards.find((card) => card.id === cardId)
}

/** 一个元素的位置（找不到就是 null —— 调用方自己断言） */
async function boxOf(locator) {
  return locator.boundingBox()
}

test.describe('A 时间元素：第一行「类型」就是模式', () => {
  test('类型行是三个模式；底层没有单独的时间模式行 / 颗粒度行', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openTime(page)

    const type = page.locator('[data-field="type"]')
    await expect(type, '类型行必须带 data-field="type"').toHaveCount(1)
    await expect(type, '卡模式：时间元素的类型行可改（它是模式选择器）').toBeEnabled()
    await expect(type).toHaveValue('year-minute')
    expect(
      await type.locator('option').evaluateAll((options) => options.map((option) => option.value)),
    ).toEqual(['year-minute', 'year-date', 'days-minute'])
    expect(
      await type
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.textContent.trim())),
    ).toEqual(['年-分钟', '年-日期', '天数-分钟'])

    // 兼容：同一个 DOM 节点仍要带 2.2 的钩子（既有 200+ 条判据按它找）
    const same = await page.evaluate(
      `document.querySelector('[data-field="type"]') === document.querySelector('[data-state-type]')`,
    )
    expect(same, 'data-field="type" 与 data-state-type 必须是同一个元素').toBe(true)

    await expect(page.locator('[data-field="time-mode"]'), '单独的时间模式行不存在了').toHaveCount(0)
    await expect(page.locator('[data-field="granularity-upper"]'), '颗粒度上界不存在了').toHaveCount(0)
    await expect(page.locator('[data-field="granularity-lower"]'), '颗粒度下界不存在了').toHaveCount(0)
  })

  test('换模式先弹确认；取消 ⇒ 模式与时间格子都不动', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openTime(page)

    const type = page.locator('[data-field="type"]')
    await type.selectOption('year-date')
    await expect(page.locator('[data-confirm]')).toBeVisible()
    await page.locator('[data-confirm-cancel]').click()

    await expect(type, '取消后类型行拨回原模式').toHaveValue('year-minute')
    await expect(page.locator('[data-time-unit]'), '取消后仍是五格').toHaveCount(5)
    await expect(page.locator('[data-field="time-year"]')).toHaveValue('2024')
  })

  test('确认换模式 ⇒ 初值重置、格子跟着换、底层 type 仍是 time', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openTime(page)

    const type = page.locator('[data-field="type"]')
    await type.selectOption('days-minute')
    await page.locator('[data-confirm-ok]').click()

    await expect(type).toHaveValue('days-minute')
    await expect(page.locator('[data-time-unit]'), '天数模式三格').toHaveCount(3)
    await expect(page.locator('[data-holiday]'), '天数模式没有节日勾选').toHaveCount(0)
    await expect(page.locator('[data-field="time-day"]')).toHaveValue('1')

    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()
    const card = await readCard(page)
    expect(card.state[0].timeMode).toBe('days-minute')
    expect(card.state[0].type, '底层类型仍是 time').toBe('time')
    expect(card.state[0]).not.toHaveProperty('holidays')
    expect(card.state[0].initial).toEqual({ day: 1, hour: 8, minute: 0 })
  })

  test('非时间元素：类型行五档（文字 / 数字 / 下拉 / 数组 / 引用），没有时间', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await page.goto(`${APP_PATH}#/edit/${CARD_ID}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-state-item="2.1"]').click()

    const type = page.locator('[data-field="type"]')
    await expect(type).toHaveValue('text')
    const types = await type.locator('option').evaluateAll((options) => options.map((option) => option.value))
    expect(types, '非时间行的类型下拉五档（作者四档 + 引用）').toEqual([
      'text',
      'integer',
      'enum',
      'array',
      'ref',
    ])
    expect(types, '非时间行不许出现 time（时间只住在根 0）').not.toContain('time')
  })

  test('存档模式：类型行显示快照的模式，整格锁死', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await page.goto(`${APP_PATH}#/edit-save/${SAVE_ID}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-state-item="0"]').click()

    const type = page.locator('[data-field="type"]')
    await expect(type).toHaveValue('year-minute')
    await expect(type, '存档模式锁死').toBeDisabled()
    await expect(page.locator('[data-initial-block]')).toHaveCount(0)
  })
})

test.describe('B 节日勾选：一行、左对齐、自定义外观', () => {
  test('三个勾选在同一水平行、从左到右、贴着左边缘', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openTime(page)

    const international = await boxOf(page.locator('[data-holiday="international"]'))
    const china = await boxOf(page.locator('[data-holiday="china"]'))
    const traditional = await boxOf(page.locator('[data-holiday="traditional"]'))
    const row = await boxOf(page.locator('[data-holidays]'))
    expect(international && china && traditional && row).toBeTruthy()

    for (const [one, note] of [
      [china, '现代中国'],
      [traditional, '传统'],
    ]) {
      expect(
        Math.abs(one.y - international.y),
        `${note}勾选要与第一个在同一行（top 差 ≤2px）`,
      ).toBeLessThanOrEqual(2)
      expect(one.height).toBeLessThanOrEqual(20)
    }
    expect(international.x, '从左到右').toBeLessThan(china.x)
    expect(china.x).toBeLessThan(traditional.x)
    expect(international.x - row.x, '整行左对齐（不居中、不右靠）').toBeLessThanOrEqual(12)
  })

  test('传统节日旁的小字在右边同一条线上，文案逐字', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openTime(page)

    const traditional = await boxOf(page.locator('[data-holiday="traditional"]'))
    const note = page.locator('[data-holiday-note]')
    await expect(note).toBeVisible()
    await expect(note).toHaveText('仅支持 1900–2100')
    const noteBox = await boxOf(note)
    expect(Math.abs(noteBox.y - traditional.y), '小字与勾选同一条线').toBeLessThanOrEqual(4)
    expect(noteBox.x, '小字在勾选右边').toBeGreaterThan(traditional.x)
  })

  test('自定义勾选框：appearance none、小方盒、勾上不是浏览器原生蓝', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openTime(page)

    const international = page.locator('[data-holiday="international"]')
    const shapes = await page.evaluate(`(() => {
      const el = document.querySelector('[data-holiday="international"]')
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return { appearance: style.appearance, width: rect.width, height: rect.height }
    })()`)
    expect(shapes.appearance, '自定义绘制（关掉原生外观）').toBe('none')
    expect(shapes.width).toBeGreaterThanOrEqual(12)
    expect(shapes.width).toBeLessThanOrEqual(16)
    expect(Math.abs(shapes.width - shapes.height), '正方盒').toBeLessThanOrEqual(1)

    await international.check()
    await expect(international).toBeChecked()
    const checkedBackground = await page.evaluate(
      `getComputedStyle(document.querySelector('[data-holiday="international"]')).backgroundColor`,
    )
    expect(checkedBackground, '不许是原生勾选蓝').not.toBe('rgb(0, 117, 255)')
  })

  test('勾选照旧只改草稿、保存才落盘；存档模式照旧可点', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openTime(page)

    const china = page.locator('[data-holiday="china"]')
    await expect(china).not.toBeChecked()
    await china.check()
    expect((await readCard(page)).state[0].holidays.china, '没保存前盘上不动').toBe(false)

    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()
    expect((await readCard(page)).state[0].holidays.china).toBe(true)

    // 存档模式：勾选照旧在、照旧可点（节日影响提示词，不影响这一局的状态）
    await page.goto(`${APP_PATH}#/edit-save/${SAVE_ID}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-state-item="0"]').click()
    await expect(page.locator('[data-holiday]')).toHaveCount(3)
    await expect(page.locator('[data-holiday="traditional"]')).toBeEnabled()
  })
})
