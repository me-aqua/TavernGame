/**
 * SPEC §5「设置」：**新装的默认模型预设**（老板 2026-11-25 口径）。
 *
 * 口径逐条：`tg2.presets` 这个键不存在（新装）时，设置页写两条**本地**预设，顺序固定：
 *   ① `deepseek-flash`（name = model = `deepseek-flash`，reasoning = medium）
 *   ② `deepseek-v4-pro`（name = model = `deepseek-v4-pro`，reasoning = off）
 * Base URL 都是 `https://api.deepseek.com/v1`，**Key 是空的**（不许预置任何 Key），玩家可改、只存本地。
 * 而且只种一次：删光之后再进来**不许**又长出来（键存在 = 已经不是新装了）。
 *
 * 为什么值得单独一份：这两条是玩家第一次打开就能用的东西，写错了（顺序、name≠model、预置 Key）
 * 界面上看着都正常 —— 只有读盘 + 逐字段断言能钉住。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, readStorage, route } from './support/app.js'

/** 期望的两条默认预设（顺序 = 界面顺序 = `tg2.presets` 顺序） */
const DEFAULTS = [
  { id: 'p-deepseek-flash', name: 'deepseek-flash', model: 'deepseek-flash', reasoning: 'medium' },
  { id: 'p-deepseek-v4-pro', name: 'deepseek-v4-pro', model: 'deepseek-v4-pro', reasoning: 'off' },
]
const BASE_URL = 'https://api.deepseek.com/v1'

/** 打开设置页（首次打开：不种 `tg2.presets`） */
async function openSettings(page) {
  await boot(page, { hash: route.settings })
  await expect(page.locator('[data-page="settings"]')).toBeVisible()
  await expect(page.locator('[data-preset]')).toHaveCount(DEFAULTS.length)
}

test.describe('新装默认预设', () => {
  test('恰好两条、顺序固定、name = model、思考强度 medium / off、Key 为空', async ({ page }) => {
    await openSettings(page)

    for (const [index, expected] of DEFAULTS.entries()) {
      const preset = page.locator(`[data-preset="${expected.id}"]`)
      await expect(preset, `第 ${index + 1} 条应是 ${expected.id}`).toHaveCount(1)
      await expect(preset.locator('[data-preset-name]')).toHaveValue(expected.name)
      await expect(preset.locator('[data-preset-model]'), 'name 与 model 必须一致').toHaveValue(
        expected.model,
      )
      await expect(preset.locator('[data-preset-baseurl]')).toHaveValue(BASE_URL)
      await expect(preset.locator('[data-preset-reasoning]')).toHaveValue(expected.reasoning)
      // 不许预置 Key：值必须是空串，而且是不回显明文的 password 框
      await expect(preset.locator('[data-preset-key]')).toHaveValue('')
      await expect(preset.locator('[data-preset-key]')).toHaveAttribute('type', 'password')
    }

    // 顺序也钉在盘上（界面顺序跟着它走）
    const stored = await readStorage(page, KEYS.presets)
    expect(stored.map((preset) => preset.id)).toEqual(DEFAULTS.map((preset) => preset.id))
    for (const [index, preset] of stored.entries()) {
      expect(preset.name).toBe(DEFAULTS[index].name)
      expect(preset.model).toBe(DEFAULTS[index].model)
      expect(preset.baseUrl).toBe(BASE_URL)
      expect(preset.reasoning).toBe(DEFAULTS[index].reasoning)
      expect(preset.apiKey, '盘上也不许有预置 Key').toBe('')
    }
  })

  test('再进来一次不会又种一遍（只有两条，不是四条）', async ({ page }) => {
    await openSettings(page)
    await page.reload()
    await expect(page.locator('[data-preset]')).toHaveCount(DEFAULTS.length)
    expect((await readStorage(page, KEYS.presets)).map((preset) => preset.id)).toEqual(
      DEFAULTS.map((preset) => preset.id),
    )
  })
})

test.describe('默认预设是可改可删的本地数据', () => {
  test('改 Key 与模型：落盘、刷新后还在，且不会多出第三条', async ({ page }) => {
    await openSettings(page)

    const flash = page.locator(`[data-preset="${DEFAULTS[0].id}"]`)
    await flash.locator('[data-preset-key]').fill('sk-local-only')
    await flash.locator('[data-preset-model]').fill('deepseek-flash-2')
    await flash.locator('[data-preset-reasoning]').selectOption('high')

    const stored = await readStorage(page, KEYS.presets)
    expect(stored).toHaveLength(2)
    expect(stored[0].apiKey).toBe('sk-local-only')
    expect(stored[0].model).toBe('deepseek-flash-2')
    expect(stored[0].reasoning).toBe('high')
    expect(stored[1].apiKey, '改第一条不许动第二条').toBe('')

    await page.reload()
    const again = page.locator(`[data-preset="${DEFAULTS[0].id}"]`)
    await expect(again.locator('[data-preset-key]')).toHaveValue('sk-local-only')
    await expect(again.locator('[data-preset-model]')).toHaveValue('deepseek-flash-2')
    await expect(page.locator('[data-preset]')).toHaveCount(2)
  })

  test('删掉一条：剩下那条还在，刷新也不复原', async ({ page }) => {
    await openSettings(page)
    await page.locator(`[data-preset="${DEFAULTS[0].id}"] [data-delete-preset]`).click()

    await expect(page.locator('[data-preset]')).toHaveCount(1)
    await expect(page.locator(`[data-preset="${DEFAULTS[1].id}"]`)).toHaveCount(1)
    expect((await readStorage(page, KEYS.presets)).map((preset) => preset.id)).toEqual([DEFAULTS[1].id])

    await page.reload()
    await expect(page.locator('[data-preset]')).toHaveCount(1)
  })

  test('两条都删光：不会又长回来（「新装」只发生一次）', async ({ page }) => {
    await openSettings(page)
    await page.locator(`[data-preset="${DEFAULTS[0].id}"] [data-delete-preset]`).click()
    await page.locator(`[data-preset="${DEFAULTS[1].id}"] [data-delete-preset]`).click()
    await expect(page.locator('[data-preset]')).toHaveCount(0)

    await page.reload()
    await expect(page.locator('[data-page="settings"]')).toBeVisible()
    await expect(page.locator('[data-preset]')).toHaveCount(0)
    expect(await readStorage(page, KEYS.presets), '盘上是空表，不是「没有这个键」').toEqual([])
  })
})
