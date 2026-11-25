/**
 * SPEC §5 的列表操作：**重命名**与**删除确认**（首页两条默认动作）。
 *
 * 为什么单开一份：这两条最容易「看起来能用」——
 * 重命名没落盘（刷新就回去了）、删除没有确认（误点就没了）、删卡留下悬空存档。
 * 所以每条都读盘对账，不看界面猜。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, makeCard, makeSave, MOCK_PRESET, readStorage, route } from './support/app.js'

const CARD_ID = 'c1'

function seed() {
  const card = makeCard()
  return { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [MOCK_PRESET] }
}

test('卡带重命名：回车提交并落盘，刷新后还在', async ({ page }) => {
  await boot(page, { storage: seed() })
  await page.locator(`[data-card-id="${CARD_ID}"] [data-card-rename]`).click()
  const input = page.locator('[data-rename-input]')
  await expect(input).toBeVisible()
  await input.fill('CARD_RENAMED')
  await input.press('Enter')

  await expect(page.locator(`[data-card-id="${CARD_ID}"] [data-card-name]`)).toHaveText('CARD_RENAMED')
  expect((await readStorage(page, KEYS.cards))[0].name).toBe('CARD_RENAMED')

  await page.reload()
  await expect(page.locator(`[data-card-id="${CARD_ID}"] [data-card-name]`)).toHaveText('CARD_RENAMED')
})

test('存档重命名：落盘，且存档行仍显示卡名与回合', async ({ page }) => {
  await boot(page, { storage: seed() })
  await page.locator('[data-save-id] [data-save-rename]').first().click()
  const input = page.locator('[data-rename-input]')
  await expect(input).toBeVisible()
  await input.fill('SAVE_RENAMED')
  await input.press('Enter')

  await expect(page.locator('[data-save-name]').first()).toHaveText('SAVE_RENAMED')
  expect((await readStorage(page, KEYS.saves))[0].name).toBe('SAVE_RENAMED')
})

test('删除确认：取消就什么都不删，确认才删', async ({ page }) => {
  await boot(page, { storage: seed() })
  await page.locator(`[data-card-id="${CARD_ID}"] [data-card-delete]`).click()
  await expect(page.locator('[data-confirm]')).toBeVisible()

  await page.locator('[data-confirm-cancel]').click()
  await expect(page.locator('[data-confirm]')).toHaveCount(0)
  expect((await readStorage(page, KEYS.cards)).length).toBe(1)
  await expect(page.locator(`[data-card-id="${CARD_ID}"]`)).toBeVisible()

  await page.locator(`[data-card-id="${CARD_ID}"] [data-card-delete]`).click()
  await page.locator('[data-confirm-ok]').click()
  await expect(page.locator('[data-card-id]')).toHaveCount(0)
  expect(await readStorage(page, KEYS.cards)).toEqual([])
})

test('存档行点击进对话页；卡行点「编辑」进编辑器（点行本身只是选中）', async ({ page }) => {
  await boot(page, { storage: seed() })
  await page.locator('[data-save-id]').first().click()
  await expect(page.locator('[data-page="play"]')).toBeVisible()

  await page.goto(`${APP_PATH}${route.home}`)
  await page.locator(`[data-card-id="${CARD_ID}"]`).click()
  // 点行不跳页：它是「选中这张卡」，新建存档要用这个选中态
  await expect(page.locator('[data-page="home"]')).toBeVisible()
  await page.locator(`[data-card-id="${CARD_ID}"] [data-card-edit]`).click()
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
})
