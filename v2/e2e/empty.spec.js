/**
 * SPEC §9.1 / §9 跨阶段规矩：**空项目能用，删空之后还能用**。
 *
 * 项目本体不许带任何卡 / 存档（数据与本体完全分离）：第一次打开是空列表，
 * 一张卡都没有时首页不能白屏，删光所有卡与存档之后每一个机制还要照常跑。
 * 这一份是**唯一**能证明「项目里真的没种数据」的判据 —— 单测只能证明存储层不种。
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

  test('打开时不会自己长出一张示例卡（读一遍也不写盘）', async ({ page }) => {
    await boot(page)
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    // 空态里点一下「刷新」这条路走不通（hash 不变），所以直接重新加载页面
    await page.reload()
    await expect(page.locator('[data-empty-cards]')).toBeVisible()
    await expect(page.locator('[data-card-id]')).toHaveCount(0)
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

    // 再删卡（带确认；它的存档与模型映射跟着一起走）
    await page.locator('[data-card-id] [data-card-delete]').first().click()
    await expect(page.locator('[data-confirm]')).toBeVisible()
    await page.locator('[data-confirm-ok]').click()
    await expect(page.locator('[data-card-id]')).toHaveCount(0)
    await expect(page.locator('[data-empty-cards]')).toBeVisible()
    expect(await readStorage(page, KEYS.cards)).toEqual([])
    expect(await readStorage(page, KEYS.nodeModels), '删卡要清掉它的模型映射').toEqual({})

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
