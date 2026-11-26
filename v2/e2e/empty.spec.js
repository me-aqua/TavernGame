/**
 * SPEC §9.1 / §9 跨阶段规矩：**没有卡的时候首页能用，删空之后还能用**。
 *
 * ⚠️ 这里的「没有卡」是靠 `boot()` 的默认标记（`tg2.settings.sampleSeeded: true`）造出来的：
 *    新版**首次打开会种一张内置示例卡（晨风镇）**，「首次打开」那件事归 `sample.spec.js` 管。
 *    这一份只量**空态本身**：空列表、能新建、删空之后机制照常。
 *    「项目本体不含卡」这一条由 `v2/tests/storage.test.js` 在存储层量（那才是它的地盘）。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  CJK,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  nodeModelsFor,
  readStorage,
  route,
} from './support/app.js'
test.describe('空项目', () => {
  test('一张卡都没有：首页空态可见、能新建、存档列表也是空态', async ({ page }) => {
    await boot(page)
    await expect(page.locator('[data-page="home"]')).toBeVisible()

    const emptyCards = page.locator('[data-empty-cards]')
    await expect(emptyCards).toBeVisible()
    await expect(emptyCards).toHaveText(CJK)
    await expect(page.locator('[data-empty-saves]')).toBeVisible()

    // 没有选中卡时，新建存档不该可用（禁止把存档建到不存在的卡上）
    await expect(page.locator('[data-new-save]')).toBeDisabled()

    await page.locator('[data-new-card]').click()
    await expect(page.locator('[data-card-id]')).toHaveCount(1)
    await expect(page.locator('[data-empty-cards]')).toHaveCount(0)
    expect((await readStorage(page, KEYS.cards)).length).toBe(1)
  })

  test('种过一次之后不会再种：刷新仍然是同一个空列表', async ({ page }) => {
    await boot(page)
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    // 标记必须在第一次导航之后就落盘（它是「别再种了」的唯一依据）
    expect((await readStorage(page, KEYS.settings)).sampleSeeded, '标记要在首次导航后落盘').toBe(true)

    await page.reload()
    await expect(page.locator('[data-empty-cards]')).toBeVisible()
    await expect(page.locator('[data-card-id]')).toHaveCount(0)
    // 从没建过卡 ⇒ `tg2.cards` 这个键可能压根没被写过（读回 null），那也算「空」
    expect((await readStorage(page, KEYS.cards)) ?? []).toEqual([])
  })
})

test.describe('删空之后', () => {
  test('删光存档与卡之后：新建卡 / 编辑器 / 设置照常，没往 tg2.* 之外写', async ({ page }) => {
    const card = makeCard()
    const save = makeSave(card)
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [save],
        [KEYS.presets]: [MOCK_PRESET],
        [KEYS.nodeModels]: { [card.id]: nodeModelsFor(card) },
      },
    })

    // 先删存档（带确认）
    await page.locator('[data-save-id] [data-save-delete]').first().click()
    await expect(page.locator('[data-confirm]')).toBeVisible()
    await page.locator('[data-confirm-ok]').click()
    await expect(page.locator('[data-save-id]')).toHaveCount(0)
    expect(await readStorage(page, KEYS.saves)).toEqual([])

    // 再删卡（带确认；存档与模型映射都**保留** —— 删卡不动存档）
    await page.locator('[data-card-id] [data-card-delete]').first().click()
    await expect(page.locator('[data-confirm]')).toBeVisible()
    await page.locator('[data-confirm-ok]').click()
    await expect(page.locator('[data-card-id]')).toHaveCount(0)
    await expect(page.locator('[data-empty-cards]')).toBeVisible()
    expect(await readStorage(page, KEYS.cards)).toEqual([])
    expect(await readStorage(page, KEYS.nodeModels), '删卡不许动它的模型映射').toEqual({
      [card.id]: nodeModelsFor(card),
    })

    // 机制照常：建卡 → 编辑器 → 设置
    await page.locator('[data-new-card]').click()
    const cardId = await page.locator('[data-card-id]').first().getAttribute('data-card-id')
    await page.goto(`${APP_PATH}${route.edit(cardId)}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await expect(page.locator('[data-state-item="0"]')).toBeVisible()

    await page.goto(`${APP_PATH}${route.settings}`)
    await expect(page.locator('[data-page="settings"]')).toBeVisible()

    const keys = await page.evaluate('Object.keys(window.localStorage)')
    expect(keys.filter((key) => key.startsWith('tg.'))).toEqual([])
  })
})
