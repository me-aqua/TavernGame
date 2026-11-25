/**
 * 首开坏设置（第 4 轮评审）—— `main.ts` 的种子路径。
 *
 * 为什么单开一份：`tg2.settings` 坏掉时，`main.ts` 会**在挂载之前**读它（决定要不要种示例卡、
 * 主题是哪一个）。只要那一次读把异常抛出去，模块求值就断在那里 —— `#app` 是空的，
 * 玩家看到的是一片白：既没有中文错误页，也没有「下一步」。
 *
 * 判据三条，缺一条都不算过：
 *   ① `#app` **非空**（挂上了，不是白屏）；
 *   ② 上面是**中文 `E_VALIDATION`** 错误页（`[data-error-code]` + 中文正文 / 下一步）；
 *   ③ `tg2.settings` 的**原始字符串逐字不变**（坏数据不许被"顺手修好"，更不许被种子覆盖）。
 *
 * 另外钉一条种子安全：`tg2.settings` 坏着的时候**不许种示例卡** ——
 * 那时标记落不下去，种了卡就是一张玩家删不掉的重复卡（而且一次首开就会把存储写脏）。
 *
 * ⚠️ 种数据用 `sample: true`（`boot()` 不写 `sampleSeeded` 标记 = 真·首次打开），
 *    并且把 `tg2.settings` **当原始字符串**种（`boot()` 对字符串是原样写，不 JSON.stringify）。
 */
import { expect, test } from '@playwright/test'
import { boot, CJK, KEYS, readRaw } from './support/app.js'

/** 原始坏 JSON：不是合法 JSON，`JSON.parse` 当场抛 E_VALIDATION */
const BROKEN_JSON = '{not json'
/** 合法 JSON、但形状不对（设置必须是对象） */
const WRONG_SHAPE = '["nope"]'

test.describe('首开：tg2.settings 坏掉时也要挂得上、看得见中文错误', () => {
  test('坏 JSON ⇒ #app 非空 + 中文 E_VALIDATION，且 tg2.settings 逐字不变', async ({ page }) => {
    await boot(page, { sample: true, storage: { [KEYS.settings]: BROKEN_JSON } })

    // ① 挂上了：`#app` 里有东西（白屏时 innerText 是空串）
    await expect(page.locator('#app')).toBeAttached()
    const appText = (await page.locator('#app').innerText()).trim()
    expect(appText.length, '#app 是空的 —— 模块在挂载前就抛了（白屏）').toBeGreaterThan(0)

    // ② 中文 E_VALIDATION 错误页
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
    await expect(page.locator('[data-error]')).toHaveText(CJK)
    await expect(page.locator('[data-error-next]')).toHaveText(CJK)

    // ③ 坏数据不许被改写（种子 / 默认值都不许落进这个键）
    expect(await readRaw(page, KEYS.settings), '坏 settings 被改写了').toBe(BROKEN_JSON)
  })

  test('形状不对（不是对象）⇒ 同样挂得上 + 中文 E_VALIDATION + 字节不变', async ({ page }) => {
    await boot(page, { sample: true, storage: { [KEYS.settings]: WRONG_SHAPE } })

    const appText = (await page.locator('#app').innerText()).trim()
    expect(appText.length, '#app 是空的 —— 白屏').toBeGreaterThan(0)
    await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
    await expect(page.locator('[data-error]')).toHaveText(CJK)
    expect(await readRaw(page, KEYS.settings)).toBe(WRONG_SHAPE)
  })

  test('settings 坏着的时候不许种示例卡（否则一次首开就把存储写脏）', async ({ page }) => {
    await boot(page, { sample: true, storage: { [KEYS.settings]: BROKEN_JSON } })
    await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')

    // 没有卡键：种子路径连碰都不该碰它（写下去就再也收不回来）
    expect(await readRaw(page, KEYS.cards), '坏 settings 时把示例卡种进去了').toBeNull()
    // 标记同样不许落到 settings（那会把 ③ 的字节不变也一起破坏）
    expect(await readRaw(page, KEYS.settings)).toBe(BROKEN_JSON)
  })
})
