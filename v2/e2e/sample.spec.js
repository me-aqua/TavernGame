/**
 * 内置示例卡「晨风镇」（老板 2026-11-25 新增要求）：**首次打开有它，删了就不再回来**。
 *
 * 三件事非钉不可：
 *   ① **首次打开**（`tg2.settings.sampleSeeded` 还没落盘的机器）首页就有一张 `晨风镇`，
 *      结构完整：5 个状态元素、3 个固定节点（id 是 `time/check/output`）、卡里**没有** `presetId`；
 *   ② **能删**：删掉之后列表真的空了，`tg2.cards` 也空了；
 *   ③ **不许复种**：刷新 / 再打开都不许把它种回来（标记一旦落盘就是一次性的）——
 *      这一条是「数据与项目本体分离」的实测口径：卡是数据、能被玩家彻底删掉。
 *
 * ⚠️ 这是唯一用 `boot(page, { sample: true })` 的用例（它不写标记 = 模拟真·首次打开）。
 *    其它所有用例靠 `boot()` 的默认标记躲开这张卡。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, readStorage, route } from './support/app.js'

/** 内置样例的事实（来自 `v2/src/data/morningwind.json`；文案与结构都在这儿对一遍） */
const SAMPLE = {
  id: 'card-morningwind',
  name: '晨风镇',
  stateCodes: ['0', '1', '2', '3', '4'],
  nodeIds: ['time', 'check', 'output'],
}

/** 删掉当前唯一那张卡（走确认层） */
async function deleteOnlyCard(page) {
  await page.locator('[data-card-id] [data-card-delete]').first().click()
  await expect(page.locator('[data-confirm]')).toBeVisible()
  await page.locator('[data-confirm-ok]').click()
  await expect(page.locator('[data-card-id]')).toHaveCount(0)
}

test('首次打开就有「晨风镇」：结构完整、卡里没有 presetId', async ({ page }) => {
  await boot(page, { sample: true })

  await expect(page.locator('[data-page="home"]')).toBeVisible()
  await expect(page.locator('[data-card-id]')).toHaveCount(1)
  await expect(page.locator('[data-card-name]')).toHaveText(SAMPLE.name)
  await expect(page.locator('[data-empty-cards]')).toHaveCount(0)
  // 示例卡没有存档（它是拿来「开局」的，不是替玩家开好局）
  await expect(page.locator('[data-empty-saves]')).toBeVisible()

  const cards = await readStorage(page, KEYS.cards)
  expect(cards).toHaveLength(1)
  expect(cards[0].id).toBe(SAMPLE.id)
  expect(cards[0].name).toBe(SAMPLE.name)
  expect(cards[0].state.map((element) => element.code)).toEqual(SAMPLE.stateCodes)
  expect(cards[0].chain.map((node) => node.id)).toEqual(SAMPLE.nodeIds)
  expect(cards[0].chain.map((node) => node.type)).toEqual(['time', 'normal', 'output'])
  for (const node of cards[0].chain) expect(Object.keys(node)).not.toContain('presetId')
  // 也带了「开场」那一块（§2.1：缺它就是不合法的卡）
  expect(cards[0].prompts.some((prompt) => prompt.id === 'opening')).toBe(true)
  // 标记要在种完之后立刻落盘，否则每次打开都会再种一张
  expect((await readStorage(page, KEYS.settings)).sampleSeeded).toBe(true)
})

test('删掉它：列表空了、卡也真没了', async ({ page }) => {
  await boot(page, { sample: true })
  await expect(page.locator('[data-card-id]')).toHaveCount(1)

  await deleteOnlyCard(page)
  await expect(page.locator('[data-empty-cards]')).toBeVisible()
  expect(await readStorage(page, KEYS.cards)).toEqual([])
})

test('删掉之后刷新：不许把示例卡种回来', async ({ page }) => {
  await boot(page, { sample: true })
  await deleteOnlyCard(page)

  await page.reload()
  await expect(page.locator('[data-page="home"]')).toBeVisible()
  await expect(page.locator('[data-empty-cards]')).toBeVisible()
  await expect(page.locator('[data-card-id]')).toHaveCount(0)
  expect(await readStorage(page, KEYS.cards)).toEqual([])
  // 标记还在（删卡不许把它一起清掉 —— 那等于允许复种）
  expect((await readStorage(page, KEYS.settings)).sampleSeeded).toBe(true)
})

test('删掉之后自己建卡：能建、能进编辑器，刷新后还是自己那一张', async ({ page }) => {
  await boot(page, { sample: true })
  await deleteOnlyCard(page)

  await page.locator('[data-new-card]').click()
  await expect(page.locator('[data-card-id]')).toHaveCount(1)
  const cardId = await page.locator('[data-card-id]').first().getAttribute('data-card-id')
  expect(cardId, '新建的卡不是示例卡').not.toBe(SAMPLE.id)

  await page.goto(`${APP_PATH}${route.edit(cardId)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-item="0"]')).toBeVisible()

  await page.goto(`${APP_PATH}${route.home}`)
  await page.reload()
  await expect(page.locator('[data-card-id]')).toHaveCount(1)
  expect((await readStorage(page, KEYS.cards)).map((card) => card.id)).toEqual([cardId])
})
