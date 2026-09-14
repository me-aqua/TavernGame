/**
 * 功能冒烟 —— 在真实浏览器里跑构建产物，覆盖「玩家点得出来」的那些路径。
 *
 * 判据：**读运行时 DOM**，不读源码；每个用例结束都检查
 * 「没有页面异常、没有 4xx/5xx」（见文件末尾的 afterEach）。
 *
 * 等待一律用 Playwright 的自动等待：等的是「这个元素真的变成这样了」，不是固定 sleep。
 */
import { expect, test, type Page } from '@playwright/test'
import { CONFIG, DEBUG_KEY, LANG_KEY, NARRATION, openApp, saveWith, translate, watchErrors } from './fixtures'
// 只读卡的 JSON 与键名常量：不 import 应用模块（那条链会拖进 i18n 的 .json，
// Playwright 的 ESM 加载器需要 import attribute，而 Vite 构建不需要）
import cardJson from '../cards/morningwind.json' with { type: 'json' }
import * as K from '../src/game/card-keys'

/** 浅色主题的页面底色（与 src/styles/main.css 的 token 对应） */
const LIGHT_BG = 'rgb(242, 244, 247)'
/** 时间标签的形状由历法决定，这里只看形状，不写死具体日期 */
const TIME_PATTERN = /^\d{4} 年 \d+ 月 \d+ 日 · 星期[日一二三四五六] · (上午|下午|晚上)$/
/** 新游戏的场景名来自卡的开局（决定 #42）—— 期望值从卡里现读，不抄一份 */
const CARD_SCENE = (
  cardJson as unknown as Record<string, Record<string, Record<string, Record<string, string>>>>
)[K.KEY_DECL][K.KEY_OPENING][K.KEY_START][K.KEY_SCENE]

const watched = new WeakMap<Page, { runtimeErrors: string[]; badResponses: string[] }>()

test.beforeEach(async ({ page }) => {
  watched.set(page, watchErrors(page))
})

/**
 * 收尾检查：页面异常与 4xx/5xx 都必须为零。
 * 故意制造错误的用例（例如假模型返回 500）自己声明豁免。
 */
test.afterEach(async ({ page }, testInfo) => {
  const seen = watched.get(page)
  if (!seen) return
  expect(seen.runtimeErrors, '页面异常必须为零').toEqual([])
  const allowsBadResponses = testInfo.annotations.some((a) => a.type === 'allow-bad-responses')
  if (!allowsBadResponses) expect(seen.badResponses, '不能有 4xx/5xx').toEqual([])
})

test.describe('第一屏', () => {
  test('外壳、侧栏、时间标签、状态栏与按钮都在，且欢迎走状态行', async ({ page }) => {
    await openApp(page)

    // 状态浮层：时间、地点、回合都收在一小块里
    const pill = page.locator('aside')
    // 新游戏的场景名来自卡的开局（决定 #42）—— 不再是「未知地点」那句 i18n 兜底
    await expect(pill.locator('.scene-name')).toContainText(CARD_SCENE)
    await expect(pill.locator('[data-turn]')).toHaveText('0')
    // 侧栏在手机与桌面上是两种排布，:visible 只取当前那一份
    await expect(page.locator('.time-display:visible')).toHaveText(TIME_PATTERN)
    // 控件只剩两颗悬浮按钮：设置（带连接状态点）与（本机开发才有的）调试开关
    await expect(page.locator('button[data-settings]')).toBeVisible()
    await expect(page.locator('button[data-settings] span.rounded-full')).toHaveCount(1)

    // 没配 API 时：欢迎语是**状态行**，不是故事行
    await expect(page.locator('.line')).toHaveCount(0)
    await expect(page.locator('[data-status]')).toHaveText(await translate(page, 'app.welcome'))
  })

  test('本机地址默认开调试，开关能关掉、能记住、也能再打开', async ({ page }) => {
    await openApp(page)

    const toggle = page.locator('button[data-debug]')
    await expect(toggle).toHaveText(await translate(page, 'header.debugToggleOn'))

    // 它必须紧挨着设置按钮、一起在右上角（justify-between 曾把它推到屏幕正中）
    const debugBox = await toggle.boundingBox()
    const settingsBox = await page.locator('button[data-settings]').boundingBox()
    expect(debugBox?.x ?? 0).toBeLessThan(settingsBox?.x ?? 0)
    expect(settingsBox?.x ?? 0).toBeGreaterThan((page.viewportSize()?.width ?? 0) / 2)

    await toggle.click()
    await expect(toggle).toHaveText(await translate(page, 'header.debugToggleOff'))
    await expect(page.locator('[data-status]')).toHaveText(await translate(page, 'app.debugOff'))
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), DEBUG_KEY)).toBe('off')

    await toggle.click()
    await expect(toggle).toHaveText(await translate(page, 'header.debugToggleOn'))
  })
})

test.describe('设置面板', () => {
  test('打得开、列出服务商与字段、点背景关得上', async ({ page }) => {
    await openApp(page)
    await page.locator('button[data-settings]').click()

    const drawer = page.locator('.drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('select option')).toHaveCount(6)
    expect(await drawer.locator('label').count()).toBeGreaterThanOrEqual(5)
    await expect(drawer.locator('button[data-test-connection]')).toBeVisible()

    // 点面板外面（左上角）才是「点背景关闭」，点正中会落在面板上
    await drawer.click({ position: { x: 4, y: 4 } })
    await expect(page.locator('.drawer')).toHaveCount(0)
  })
})

test.describe('坏存档', () => {
  test('页面不白屏、说清楚坏了、并留一份备份', async ({ page }) => {
    await openApp(page, { save: '{not valid json' })

    await expect(page.locator('#app > *')).toHaveCount(1)
    const prefix = (await translate(page, 'app.startupCorrupted', { message: '' })).split('\n')[0]
    await expect(page.locator('[data-status="error"]')).toContainText(prefix)

    const backups = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.includes('.broken-')),
    )
    expect(backups).toHaveLength(1)
  })
})

test.describe('主题', () => {
  test('深色亮色都落在 <html> 上，底色确实不同', async ({ page }) => {
    await openApp(page, { theme: 'dark' })
    await expect(page.locator('html')).toHaveClass(/dark/)
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(darkBg).not.toBe(LIGHT_BG)

    await openApp(page, { theme: 'light' })
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(LIGHT_BG)
  })
})

test.describe('语言', () => {
  test('存储的选择优先于浏览器语言，切到英文后 html lang 与文案都跟着变', async ({ page }) => {
    await openApp(page, { lang: 'zh-CN' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await expect(page.locator('button[data-settings]')).toContainText(
      await translate(page, 'header.settings'),
    )

    // 语言与主题都收进了设置面板
    await page.locator('button[data-settings]').click()
    await page.locator('button[data-language-option]').nth(2).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('.drawer')).toContainText('Language')
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), LANG_KEY)).toBe('en')
  })
})

test.describe('接着上次玩', () => {
  test('有存档时不播报、故事在屏幕上、回合数在侧栏', async ({ page }) => {
    await openApp(page, { save: saveWith(), config: CONFIG })

    // 恢复是默认行为，不该有任何播报
    await expect(page.locator('[data-status]')).toHaveCount(0)
    await expect(page.locator('.line')).toHaveCount(2)
    // 手机上侧栏是紧凑条（[data-turn-compact]），桌面才是卡片；:visible 只取看得见的那个
    await expect(page.locator('aside [data-turn]:visible')).toHaveText('6')
  })

  test('提交一次行动：行动与叙事按顺序进故事，回合数 +1', async ({ page }) => {
    await openApp(page, { save: saveWith(), config: CONFIG, fake: 'narration' })

    const action = '我去码头看看'
    await page.locator('textarea').fill(action)
    await page.getByRole('button', { name: await translate(page, 'composer.submit') }).click()

    // 存档里已经有一条行动，所以看最后一条
    await expect(page.locator('.line.action').last()).toHaveText(action)
    await expect(page.locator('.line.narration').last()).toContainText(NARRATION)
    await expect(page.locator('aside [data-turn]:visible')).toHaveText('7')

    // 回合跑完状态行就该空了（进行中不是数据）
    await expect(page.locator('[data-status]')).toHaveCount(0)
  })

  test('模型出错时玩家看得到（这条允许 500）', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-bad-responses' })
    await openApp(page, { save: saveWith(), config: CONFIG, fake: 'error' })

    await page.locator('textarea').fill('我去码头看看')
    await page.getByRole('button', { name: await translate(page, 'composer.submit') }).click()

    const prefix = (await translate(page, 'store.failed', { message: '' })).split('{message}')[0].trim()
    await expect(page.locator('[data-status="error"]')).toContainText(prefix)
  })
})
