/**
 * 术语：界面上说「游戏卡」，不说「卡带」（老板 2026-11-26 改的名）。
 *
 * 判的是**看得见的字**：代码标识符与存储键（`tg2.cards` / `Card` / `cardId` …）一个字都不动，
 * 所以这里只用 `innerText` 取真正渲染出来的文本，不碰任何标识符。
 *
 * 四处**可见**文案必须换成新词（`v2/src/locales/zh-CN.json`）：
 *   · 首页栏标题 `home.cardsTitle`、新建按钮 `home.newCard`、空态 `home.emptyCards`
 *   · 删除确认 `home.deleteCardConfirm`
 *   · 错误文案 `error.missingCard` / `error.cardIdMismatch` / `error.E_VALIDATION.nextStep` / `error.E_CHAIN.message`
 * 判据只认「游戏卡 / 卡带」这两个词，不抄整句 —— 措辞可以改，术语不能回退。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, makeCard, makeSave, MOCK_PRESET, route } from './support/app.js'

/** 新词 / 旧词（判据只认这两个字符串） */
const NEW = '游戏卡'
const OLD = '卡带'

/** 一屏**渲染出来**的文本（`innerText` 不含 display:none 的内容） */
async function visibleText(page, selector = 'body') {
  return page.locator(selector).innerText()
}

test.describe('术语：可见文案用「游戏卡」，不出现「卡带」', () => {
  test('首页空态：栏标题 / 新建按钮 / 空态文案都是游戏卡，整页没有卡带', async ({ page }) => {
    await boot(page, { storage: { [KEYS.presets]: [MOCK_PRESET] } })
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page.locator('[data-empty-cards]')).toBeVisible()

    // 栏标题是独立的一段文字（按钮 / 空态各带前缀，所以「恰好一处」= 标题）
    await expect(page.getByText(NEW, { exact: true })).toHaveCount(1)
    await expect(page.getByText(NEW, { exact: true })).toBeVisible()

    // 新建按钮与空态文案
    await expect(page.locator('[data-new-card]')).toContainText(NEW)
    await expect(page.locator('[data-empty-cards]')).toContainText(NEW)
    await expect(page.locator('[data-new-card]')).not.toContainText(OLD)
    await expect(page.locator('[data-empty-cards]')).not.toContainText(OLD)

    // 整页一个旧词都不许留
    expect(await visibleText(page), '首页还看得见「卡带」').not.toContain(OLD)
  })

  test('有卡时：列表与删除确认都用游戏卡，整页没有卡带', async ({ page }) => {
    const card = makeCard()
    await boot(page, { storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] } })
    await expect(page.locator('[data-card-id]').first()).toBeVisible()

    await page.locator('[data-card-id] [data-card-delete]').first().click()
    await expect(page.locator('[data-confirm]')).toBeVisible()
    await expect(page.locator('[data-confirm]')).toContainText(NEW)
    await expect(page.locator('[data-confirm]')).not.toContainText(OLD)
    await page.locator('[data-confirm-cancel]').click()

    expect(await visibleText(page), '首页还看得见「卡带」').not.toContain(OLD)
  })

  test('错误文案：打开不存在的游戏卡 ⇒ 错误条用游戏卡，没有卡带', async ({ page }) => {
    await boot(page, {
      storage: { [KEYS.presets]: [MOCK_PRESET] },
      hash: route.edit('no-such-card'),
    })
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-error]')).toContainText(NEW)
    await expect(page.locator('[data-error]')).not.toContainText(OLD)
    expect(await visibleText(page), '错误页还看得见「卡带」').not.toContain(OLD)
  })

  test('对话页 / 设置页：可见文案里也没有卡带', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card)],
        [KEYS.presets]: [MOCK_PRESET],
      },
      hash: route.play('c1', 's1'),
    })
    await expect(page.locator('[data-page="play"]')).toBeVisible()
    expect(await visibleText(page), '对话页还看得见「卡带」').not.toContain(OLD)

    await page.goto(`${APP_PATH}${route.settings}`)
    await expect(page.locator('[data-page="settings"]')).toBeVisible()
    expect(await visibleText(page), '设置页还看得见「卡带」').not.toContain(OLD)
  })
})
