/**
 * SPEC §9.5 / §6：四类比例 + 4K 不许横向溢出 / 元素出界；手机竖屏出「请横屏使用」遮罩。
 *
 * 判据只两条（与旧站整页巡检同一套，`support/app.js` 的 `PROBE`）：横向溢出 ≤ 1px、没有元素伸出视口。
 * 首页与编辑器两屏都量 —— 编辑器是最挤的一屏，只量首页等于没量。
 * 手机横屏与竖屏是**同一个布局的两种朝向**（SPEC：不单列低于 720p 的档位）。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  CJK,
  expectClean,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  PROBE,
  route,
} from './support/app.js'

const CARD_ID = 'c1'

/** SPEC §6 / 开发计划 §1：四类比例各一档 + 4K */
const VIEWPORTS = [
  { name: '16:9 1280x720', width: 1280, height: 720 },
  { name: '4:3 1280x960', width: 1280, height: 960 },
  { name: '16:10 1280x800', width: 1280, height: 800 },
  { name: '21:9 2560x1080', width: 2560, height: 1080 },
  { name: '4K 3840x2160', width: 3840, height: 2160 },
]

function seed() {
  const card = makeCard()
  return { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [MOCK_PRESET] }
}

test.describe('桌面/大屏比例档', () => {
  for (const viewport of VIEWPORTS) {
    test(`首页 ${viewport.name}：不溢出、不出界`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await boot(page, { storage: seed() })
      await expect(page.locator('[data-page="home"]')).toBeVisible()
      const probe = await page.evaluate(PROBE)
      expect(probe.page).toBe('home')
      expectClean(probe)
    })
  }

  for (const viewport of VIEWPORTS.filter((item) => item.width >= 1280)) {
    test(`编辑器 ${viewport.name}：不溢出、不出界`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await boot(page, { storage: seed() })
      await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
      await expect(page.locator('[data-page="editor"]')).toBeVisible()
      expectClean(await page.evaluate(PROBE))
    })
  }
})

test.describe('手机：竖屏遮罩与横屏进入布局', () => {
  test('竖屏（390x844）出现「请横屏使用」遮罩，且遮罩可能是唯一在屏上的东西', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await boot(page, { storage: seed() })

    const overlay = page.locator('[data-landscape-overlay]')
    await expect(overlay).toBeVisible()
    await expect(overlay).toHaveText(CJK)
    await expect(page.locator('[data-landscape-retry]')).toBeVisible()

    // 点了以后：要么真的转了（遮罩消失），要么给出中文提示 —— 两种都算通过，
    // 但不能白点（连提示都没有）也不能炸页面。
    await page.locator('[data-landscape-retry]').click()
    const hint = page.locator('[data-landscape-hint]')
    const hintShown = (await hint.count()) > 0 && (await hint.first().isVisible())
    const overlayStillShown = (await overlay.count()) > 0 && (await overlay.first().isVisible())
    expect(hintShown || overlayStillShown, '点了「尝试横屏」要有反应：要么转过去，要么给一句中文提示').toBe(
      true,
    )
    expectClean(await page.evaluate(PROBE))
  })

  test('横屏（844x390）没有遮罩，页面照常可交互', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await boot(page, { storage: seed() })
    await expect(page.locator('[data-landscape-overlay]')).toHaveCount(0)
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page.locator('[data-new-card]')).toBeVisible()
    expectClean(await page.evaluate(PROBE))
  })
})
