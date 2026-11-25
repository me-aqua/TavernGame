/**
 * P1 · 旧数据安全（第 3 轮评审）—— 盘上有旧格式数据时，界面**不许**变成「一次点击就覆盖它」。
 *
 * 为什么单开一份：这类坏数据的危险不在「报错」本身，而在**报错之后界面还留着可写的入口** ——
 * 玩家点一下「新建卡带」，`saveCards([新卡])` 就把盘上那张他再也拿不回来的旧卡覆盖掉了。
 * 所以每条判据都量三样：
 *   ① 中文 `E_VALIDATION`（不是白屏、不是英文）；
 *   ② **没有可写的入口**（首页的新建按钮、对话页的输入框 / 发送）；
 *   ③ 就算入口真的还在，点下去也**不许改盘**（`tg2.cards` / `tg2.saves` 的**原始字符串**逐字相同）。
 *
 * 覆盖两种旧形状：带校对节点、`readsUpstream` 是布尔（老板 2026-11-25：不迁移，直接拒）。
 */
import { expect, test } from '@playwright/test'
import {
  boot,
  CJK,
  KEYS,
  makeCard,
  makeNode,
  makeSave,
  MOCK_PRESET,
  readRaw,
  route,
} from './support/app.js'

const CARD_ID = 'c1'

/** 旧格式之一：多一个校对节点 */
function legacyWithProof() {
  const base = makeCard()
  return { ...base, chain: [...base.chain, makeNode('proof', 'proof')] }
}

/** 旧格式之二：`readsUpstream` 还是布尔 */
function legacyWithBooleanUpstream() {
  const base = makeCard()
  return { ...base, chain: base.chain.map((node) => ({ ...node, readsUpstream: node.id === 'output' })) }
}

/** 报错那一格：中文码 + 中文正文 + 中文下一步 */
async function expectValidationError(page) {
  const panel = page.locator('[data-error]')
  await expect(panel).toBeVisible()
  await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
  await expect(panel).toHaveText(CJK)
  await expect(page.locator('[data-error-next]')).toBeVisible()
  await expect(page.locator('[data-error-next]')).toHaveText(CJK)
}

test.describe('P1 首页：旧卡读不出来时，不许给「新建」入口', () => {
  test('旧卡（带校对节点）⇒ 中文 E_VALIDATION，且没有新建卡 / 新建存档 / 卡行', async ({ page }) => {
    const card = legacyWithProof()
    const raw = JSON.stringify([card])
    await boot(page, { storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] } })

    await expectValidationError(page)
    await expect(page.locator('[data-new-card]')).toHaveCount(0)
    await expect(page.locator('[data-new-save]')).toHaveCount(0)
    await expect(page.locator('[data-card-id]')).toHaveCount(0)
    // 一条能被点的行都不许留（否则「选中 + 新建存档」是另一条覆盖路）
    await expect(page.locator('[data-card-rename], [data-card-delete], [data-card-edit]')).toHaveCount(0)
    expect(await readRaw(page, KEYS.cards), '读失败之后盘上的字节变了').toBe(raw)
  })

  test('旧卡（readsUpstream 是布尔）⇒ 同样被拒、同样没有入口', async ({ page }) => {
    const card = legacyWithBooleanUpstream()
    const raw = JSON.stringify([card])
    await boot(page, { storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] } })

    await expectValidationError(page)
    await expect(page.locator('[data-new-card]')).toHaveCount(0)
    await expect(page.locator('[data-new-save]')).toHaveCount(0)
    expect(await readRaw(page, KEYS.cards)).toBe(raw)
  })

  test('数据安全兜底：哪怕页面上真有个新建按钮，点下去也不许改盘', async ({ page }) => {
    const card = legacyWithProof()
    const raw = JSON.stringify([card])
    await boot(page, { storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] } })
    await expectValidationError(page)

    // 这一条不依赖「按钮有没有被藏起来」：有就点，没有就跳过 —— 两种情况都不许动盘
    for (const selector of ['[data-new-card]', '[data-new-save]']) {
      const button = page.locator(selector)
      if ((await button.count()) > 0) await button.first().click({ force: true })
    }
    await page.waitForTimeout(200)
    expect(await readRaw(page, KEYS.cards), '一次点击把盘上的旧卡覆盖了').toBe(raw)
    // 报错不许被那次点击「顺手清掉」
    await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
  })
})

test.describe('P1 对话页：存档里的卡是旧格式时，不许给输入入口', () => {
  test('旧卡快照 ⇒ 中文 E_VALIDATION，且没有输入框 / 发送按钮', async ({ page }) => {
    const card = makeCard()
    const save = { ...makeSave(card), cardSnapshot: legacyWithProof() }
    const rawSaves = JSON.stringify([save])
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [save], [KEYS.presets]: [MOCK_PRESET] },
      hash: route.play(CARD_ID, save.id),
    })

    await expectValidationError(page)
    await expect(page.locator('[data-action-input]')).toHaveCount(0)
    await expect(page.locator('[data-send]')).toHaveCount(0)
    await expect(page.locator('[data-stop]')).toHaveCount(0)
    expect(await readRaw(page, KEYS.saves), '打开坏存档不许改盘').toBe(rawSaves)
  })

  test('坏存档本身（tree 的 0 不是 {day,hour}）⇒ 中文 E_VALIDATION，且没有输入框 / 发送按钮', async ({
    page,
  }) => {
    const card = makeCard()
    const save = { ...makeSave(card), tree: { ...makeSave(card).tree, 0: 'day 1 hour 8' } }
    const rawSaves = JSON.stringify([save])
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [save], [KEYS.presets]: [MOCK_PRESET] },
      hash: route.play(CARD_ID, save.id),
    })

    await expectValidationError(page)
    await expect(page.locator('[data-action-input]')).toHaveCount(0)
    await expect(page.locator('[data-send]')).toHaveCount(0)
    expect(await readRaw(page, KEYS.saves)).toBe(rawSaves)
  })
})
