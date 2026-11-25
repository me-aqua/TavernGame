/**
 * SPEC §9.2 的最小闭环（验收的主路径）。
 *
 * 新建卡 → 改 2 个文本元素 + 初值 + 2 块公共提示词 → 新建存档 → 输入行动连跑 3 回合（流式）
 * → 刷新，卡 / 存档 / 回合数 / 故事都还在。
 *
 * 全程走界面（不 seed 卡）：这条用例的价值就在于「玩家点得出来」。
 * 唯一的种子是 mock 预设（没有 Key 的机器也要能跑）。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, MOCK_PRESET, openStory, playTurn, readStorage, route } from './support/app.js'

test('建卡 → 编内容 → 存档 → 三回合 → 刷新还在', async ({ page }) => {
  await boot(page, { storage: { [KEYS.presets]: [MOCK_PRESET] } })

  // ---- 首页：空态里新建一张卡
  await expect(page.locator('[data-empty-cards]')).toBeVisible()
  await page.locator('[data-new-card]').click()
  await expect(page.locator('[data-card-id]')).toHaveCount(1)
  const cardId = await page.locator('[data-card-id]').first().getAttribute('data-card-id')

  // ---- 编辑器：两个文本元素 + 初值（`0` 是时间元素，动不了也不需要动）
  await page.goto(`${APP_PATH}${route.edit(cardId)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-item="0"]')).toBeVisible()

  await page.locator('[data-add-state]').click()
  await page.locator('[data-state-item="1"]').click()
  await page.locator('[data-field="name"]').fill('place')
  await page.locator('[data-field="initial"]').fill('VAL_PLACE_A1')

  await page.locator('[data-add-state]').click()
  await page.locator('[data-state-item="2"]').click()
  await page.locator('[data-field="name"]').fill('mood')
  await page.locator('[data-field="initial"]').fill('VAL_MOOD_B2')

  // ---- 两块公共提示词
  await page.locator('[data-add-prompt]').click()
  await page.locator('[data-prompt-block]').nth(0).locator('[data-prompt-title]').fill('tone')
  await page.locator('[data-prompt-block]').nth(0).locator('[data-prompt-body]').fill('BODY_ONE')
  await page.locator('[data-add-prompt]').click()
  await page.locator('[data-prompt-block]').nth(1).locator('[data-prompt-title]').fill('style')
  await page.locator('[data-prompt-block]').nth(1).locator('[data-prompt-body]').fill('BODY_TWO')

  // ---- 判定节点拿到对元素 1 的写权限（笔）。新建的元素不会自动进 writable。
  await page.locator('[data-node-id="check"]').click()
  await page.locator('[data-state-item="1"] [data-eyes="write"]').click()
  await expect(page.locator('[data-state-item="1"] [data-eyes="write"]')).toHaveAttribute('data-on', 'true')

  // ---- 编辑器没有保存按钮：改动必须已经落盘
  await page.reload()
  const cards = await readStorage(page, KEYS.cards)
  expect(cards).toHaveLength(1)
  expect(cards[0].state.map((element) => element.name)).toEqual(['time', 'place', 'mood'])
  expect(cards[0].state[1].initial).toBe('VAL_PLACE_A1')
  expect(cards[0].state[2].initial).toBe('VAL_MOOD_B2')
  expect(cards[0].prompts.map((prompt) => prompt.body)).toEqual(['BODY_ONE', 'BODY_TWO'])
  expect(cards[0].prompts.map((prompt) => prompt.title)).toEqual(['tone', 'style'])
  const injected = cards[0].chain.find((node) => node.id === 'check')
  expect(injected.writable).toContain('1')
  expect(cards[0].chain).toHaveLength(4)

  // ---- 模型绑定不进卡：卡里没有 presetId，映射在 tg2.nodeModels 里（首次打开就铺好）
  for (const node of cards[0].chain) expect(Object.keys(node)).not.toContain('presetId')
  const models = await readStorage(page, KEYS.nodeModels)
  const slice = models[cards[0].id]
  expect(slice, '打开编辑器后这张卡应该有模型映射（CONTRACT §2.5）').toBeTruthy()
  expect(Object.keys(slice).sort()).toEqual(['check', 'output', 'proof', 'time'])
  expect(Object.values(slice)).toEqual(Array(4).fill(MOCK_PRESET.id))

  // ---- 新建存档（基于选中的卡）
  await page.goto(`${APP_PATH}${route.home}`)
  await page.locator(`[data-card-id="${cardId}"]`).click()
  await page.locator('[data-new-save]').click()
  await expect(page.locator('[data-save-id]')).toHaveCount(1)
  const saveId = await page.locator('[data-save-id]').first().getAttribute('data-save-id')

  // ---- 三回合（流式；mock 提供方）
  await openStory(page, cardId, saveId)
  await playTurn(page, 'act one', 1)
  await playTurn(page, 'act two', 2)
  await playTurn(page, 'act three', 3)
  await expect(page.locator('[data-turn]')).toHaveText('3')
  await expect(page.locator('[data-status]')).not.toHaveText('')

  // ---- 刷新：卡 / 存档 / 回合 / 故事都在
  await page.reload()
  await expect(page.locator('[data-page="play"]')).toBeVisible()
  const start = page.locator('[data-start]')
  if (await start.count()) await start.click()
  await expect(page.locator('[data-line="action"]')).toHaveCount(3)
  await expect(page.locator('[data-line="narration"]')).toHaveCount(3)
  await expect(page.locator('[data-line="narration"]').nth(2)).toContainText('[mock] turn 3: act three')
  await expect(page.locator('[data-turn]')).toHaveText('3')

  const saves = await readStorage(page, KEYS.saves)
  expect(saves).toHaveLength(1)
  expect(saves[0].turn).toBe(3)
  expect(saves[0].cardId).toBe(cardId)
  expect(saves[0].tree['0']).toEqual({ day: 1, hour: 11 })
  expect(saves[0].tree['1']).toBe('mock-t3')
  expect(saves[0].tree['2']).toBe('VAL_MOOD_B2')
})

test('存档行读得出「卡带名 · 第 N 回合」，刷新后还在', async ({ page }) => {
  await boot(page, { storage: { [KEYS.presets]: [MOCK_PRESET] } })
  await page.locator('[data-new-card]').click()
  const cardId = await page.locator('[data-card-id]').first().getAttribute('data-card-id')

  await page.goto(`${APP_PATH}${route.home}`)
  await page.locator(`[data-card-id="${cardId}"]`).click()
  await page.locator('[data-new-save]').click()
  const saveId = (await readStorage(page, KEYS.saves)).slice(-1)[0].id

  // 跑一回合，让「第 N 回合」不再是 0
  await openStory(page, cardId, saveId)
  await playTurn(page, 'act one', 1)

  await page.goto(`${APP_PATH}${route.home}`)
  await page.reload()
  await expect(page.locator('[data-save-id]')).toHaveCount(1)
  const cardName = (await readStorage(page, KEYS.cards))[0].name
  const meta = await page.locator('[data-save-meta]').textContent()
  expect(meta).not.toBeNull()
  expect(meta.includes(cardName), '存档行要带卡带名').toBe(true)
  expect(meta.includes('1'), '存档行要带回合数').toBe(true)
})
