/**
 * P1 · 旧数据安全（第 3 轮评审）—— 盘上有旧格式数据时，界面**不许**把那一行改写 / 删掉。
 *
 * 现状（阶段 2 第一项）：整表读不再把首页挡在错误页后面 —— 旧格式那一条渲染成**非法行**
 * （`[data-invalid-card]` + 中文原因），能点的入口只有「新建」，而新建**只追加**：
 * 旧格式那一条的**值不变**。所以这一份量四样：
 *   ① 首页照常 + 坏项一行带中文原因（不是整页错误）；
 *   ② 坏项行点不进去（不跳页、不被选中 ⇒「新建存档」仍然禁用）；
 *   ③ 新建照常可用，而且只追加；
 *   ④ 坏项那一条的值与本机那份**深相等**（不丢项 / 不改字段 / 不把旧格式归一化）。
 *
 * ⚠️ 判的是**值**不是字节：存储是「整个数组一个 JSON 字符串」，写回必然重新序列化（缩进 / 数字写法
 * 都会变），所以「字节逐字不变」不是可判的不变量；可判的是解析值没被改写。
 *
 * 对话页那两格仍然是错误现场：按 id 打开一份坏存档（本体坏 / 快照里的卡是旧格式）
 * 照样中文 `E_VALIDATION`，且不给输入框 / 发送 —— 那两条留在本文件末尾。
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
  readStorage,
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

/** 盘上某个键的第 `index` 个元素的**解析值**（判据比的是值；存储写回会重新序列化） */
async function entryAt(page, key, index) {
  return (await readStorage(page, key))[index]
}

/** 坏项行的公共断言：首页照常、恰好一行非法 + 中文原因、行内没有任何入口 */
async function expectInvalidCardRow(page, cardId) {
  await expect(page.locator('[data-page="home"]')).toBeVisible()
  await expect(page.locator('[data-error]'), '旧卡又把首页挡成错误页了').toHaveCount(0)
  await expect(page.locator('[data-invalid-card]')).toHaveCount(1)
  await expect(page.locator(`[data-card-id="${cardId}"] [data-invalid-reason]`)).toHaveText(CJK)
  await expect(
    page.locator(
      '[data-invalid-card] [data-card-edit], [data-invalid-card] [data-card-rename], [data-invalid-card] [data-card-delete]',
    ),
  ).toHaveCount(0)
}

test.describe('P1 首页：旧卡渲染成「非法」行，新建只追加、不许改写它', () => {
  test('旧卡（带校对节点）⇒ 首页照常、坏项一行带中文原因、点不进去；新建后值不变', async ({ page }) => {
    const card = legacyWithProof()
    await boot(page, { storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] } })
    const homeUrl = page.url()
    const before = await entryAt(page, KEYS.cards, 0)

    await expectInvalidCardRow(page, CARD_ID)
    await expect(page.locator('[data-new-card]')).toBeEnabled()

    // 坏项行点不进去：不跳页、也不被选中（所以「新建存档」仍然禁用）
    await page.locator('[data-invalid-card]').click()
    await expect(page, '点坏项行不许跳页').toHaveURL(homeUrl)
    await expect(page.locator('[data-new-save]')).toBeDisabled()

    // 新建照常可用，而且只追加
    await page.locator('[data-new-card]').click()
    const cards = await readStorage(page, KEYS.cards)
    expect(cards).toHaveLength(2)
    expect(cards[0].id).toBe(CARD_ID)
    expect(cards[1].id).not.toBe(CARD_ID)
    await expect(page.locator(`[data-card-id="${cards[1].id}"] [data-card-edit]`)).toBeVisible()
    expect(await entryAt(page, KEYS.cards, 0), '新建把旧卡改写了').toEqual(before)

    // 刷新后仍如此
    await page.reload()
    await expectInvalidCardRow(page, CARD_ID)
    expect(await entryAt(page, KEYS.cards, 0), '刷新之后旧卡被改写了').toEqual(before)
  })

  test('旧卡（readsUpstream 是布尔）⇒ 同样照常：坏项一行带中文原因，新建可用且值不变', async ({ page }) => {
    const card = legacyWithBooleanUpstream()
    await boot(page, { storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] } })
    const before = await entryAt(page, KEYS.cards, 0)

    await expectInvalidCardRow(page, CARD_ID)
    await expect(page.locator('[data-new-card]')).toBeEnabled()

    await page.locator('[data-new-card]').click()
    expect((await readStorage(page, KEYS.cards)).length).toBe(2)
    expect(await entryAt(page, KEYS.cards, 0), '新建把旧卡改写了').toEqual(before)
  })

  test('数据安全兜底：新建卡 + 新建存档之后，旧卡那一条仍然值不变', async ({ page }) => {
    const card = legacyWithProof()
    await boot(page, { storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] } })
    const before = await entryAt(page, KEYS.cards, 0)

    await page.locator('[data-new-card]').click()
    // 新卡建完即被选中 ⇒ 新建存档可用；存档按新卡建，不碰旧卡那一条
    await expect(page.locator('[data-new-save]')).toBeEnabled()
    await page.locator('[data-new-save]').click()

    const saves = await readStorage(page, KEYS.saves)
    expect(saves).toHaveLength(1)
    const cards = await readStorage(page, KEYS.cards)
    expect(saves[0].cardId).toBe(cards[1].id)
    expect(await entryAt(page, KEYS.cards, 0), '一次新建把盘上的旧卡覆盖了').toEqual(before)
    await expect(page.locator('[data-invalid-card]')).toHaveCount(1)
  })
})

test.describe('P1 对话页：存档里的卡是旧格式时，不许给输入入口', () => {
  test('旧卡快照 ⇒ 中文 E_VALIDATION，且没有输入框 / 发送按钮', async ({ page }) => {
    const card = makeCard()
    const save = { ...makeSave(card), cardSnapshot: legacyWithProof() }
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [save], [KEYS.presets]: [MOCK_PRESET] },
      hash: route.play(CARD_ID, save.id),
    })

    await expectValidationError(page)
    await expect(page.locator('[data-action-input]')).toHaveCount(0)
    await expect(page.locator('[data-send]')).toHaveCount(0)
    await expect(page.locator('[data-stop]')).toHaveCount(0)
    expect(await readStorage(page, KEYS.saves), '打开坏存档不许改盘').toEqual([save])
  })

  test('坏存档本身（tree 的 0 还是阶段 1 的 {day,hour}）⇒ 中文 E_VALIDATION，且没有输入框 / 发送按钮', async ({
    page,
  }) => {
    const card = makeCard()
    const save = { ...makeSave(card), tree: { ...makeSave(card).tree, 0: { day: 1, hour: 8 } } }
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [save], [KEYS.presets]: [MOCK_PRESET] },
      hash: route.play(CARD_ID, save.id),
    })

    await expectValidationError(page)
    await expect(page.locator('[data-action-input]')).toHaveCount(0)
    await expect(page.locator('[data-send]')).toHaveCount(0)
    expect(await readStorage(page, KEYS.saves)).toEqual([save])
  })
})
