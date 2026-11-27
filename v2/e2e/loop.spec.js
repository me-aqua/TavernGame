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

  // ---- 编辑器：两个文本元素 + 初值（`0` 是时间元素，这一条不改它的初值）
  await page.goto(`${APP_PATH}${route.edit(cardId)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-item="0"]')).toBeVisible()

  // `+`（新增元素）只在 S2 出现（选中了某个元素）⇒ 先点任意一行进 S2
  await page.locator('[data-state-item="0"]').click()
  await expect(page.locator('[data-add-state]')).toHaveText('+')
  await page.locator('[data-add-state]').click()
  await page.locator('[data-state-item="1"]').click()
  await page.locator('[data-field="name"]').fill('place')
  await page.locator('[data-field="initial"]').fill('VAL_PLACE_A1')

  await page.locator('[data-add-state]').click()
  await page.locator('[data-state-item="2"]').click()
  await page.locator('[data-field="name"]').fill('mood')
  await page.locator('[data-field="initial"]').fill('VAL_MOOD_B2')

  // ---- 两块公共提示词：右栏只「选」，改名/正文在中栏的 PromptForm
  //      新增之后中栏会自动选中新块 ⇒ 直接往中栏那两个框里填
  await page.locator('[data-add-prompt]').click()
  await expect(page.locator('[data-prompt-block="pr1"]')).toHaveAttribute('data-selected', 'true')
  await page.locator('[data-prompt-title]').fill('tone')
  await page.locator('[data-prompt-body]').fill('BODY_ONE')
  await page.locator('[data-add-prompt]').click()
  await expect(page.locator('[data-prompt-block="pr2"]')).toHaveAttribute('data-selected', 'true')
  await page.locator('[data-prompt-title]').fill('style')
  await page.locator('[data-prompt-body]').fill('BODY_TWO')

  // ---- 判定节点拿到对元素 1 的写权限（笔）。新建的元素不会自动进 writable。
  await page.locator('[data-node-id="check"]').click()
  await page.locator('[data-state-item="1"] [data-eyes="write"]').click()
  await expect(page.locator('[data-state-item="1"] [data-eyes="write"]')).toHaveAttribute('data-on', 'true')

  // ---- v5 编辑器：编辑只改内存草稿，顶栏【保存】才校验 + 落盘
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-ok]'), '合法草稿点保存后要给成功提示').toBeVisible()
  await page.reload()
  const cards = await readStorage(page, KEYS.cards)
  expect(cards).toHaveLength(1)
  // 时间元素的名字是**文案**（`cards.ts` 给的是中文「时间」），我们新加的两个是作者自己起的
  expect(cards[0].state.map((element) => element.name)).toEqual(['时间', 'place', 'mood'])
  // 三个固定节点的名字也是文案（id 仍是 ASCII，选择器靠 id）；校对节点已删（CONTRACT §2.1）
  expect(cards[0].chain.map((node) => node.name)).toEqual(['时间', '判定', '输出'])
  expect(cards[0].chain.map((node) => node.id)).toEqual(['time', 'check', 'output'])
  expect(cards[0].chain.map((node) => node.type)).toEqual(['time', 'normal', 'output'])
  expect(cards[0].chain[2].readsUpstream, '新卡的输出节点默认读判定节点').toEqual(['check'])
  expect(cards[0].state[1].initial['1']).toBe('VAL_PLACE_A1')
  expect(cards[0].state[2].initial['2']).toBe('VAL_MOOD_B2')
  // 每张卡自带「开场」，且**排第一**（`cards.ts` 的 `freshCard`）
  expect(cards[0].prompts.map((prompt) => prompt.id)).toEqual(['opening', 'pr1', 'pr2'])
  expect(cards[0].prompts.map((prompt) => prompt.body)).toEqual(['', 'BODY_ONE', 'BODY_TWO'])
  expect(cards[0].prompts.map((prompt) => prompt.title)).toEqual(['开场', 'tone', 'style'])
  const injected = cards[0].chain.find((node) => node.id === 'check')
  expect(injected.writable).toContain('1')
  expect(cards[0].chain).toHaveLength(3)

  // ---- 模型绑定不进卡：卡里没有 presetId，映射在 tg2.nodeModels 里（首次打开就铺好）
  for (const node of cards[0].chain) expect(Object.keys(node)).not.toContain('presetId')
  const models = await readStorage(page, KEYS.nodeModels)
  const slice = models[cards[0].id]
  expect(slice, '打开编辑器后这张卡应该有模型映射（CONTRACT §2.5）').toBeTruthy()
  expect(Object.keys(slice).sort()).toEqual(['check', 'output', 'time'])
  expect(Object.values(slice)).toEqual(Array(3).fill(MOCK_PRESET.id))

  // ---- 新建存档（基于选中的卡）；先记下新卡的时间初值，回合之后按它判推进
  await page.goto(`${APP_PATH}${route.home}`)
  await page.locator(`[data-card-id="${cardId}"]`).click()
  await page.locator('[data-new-save]').click()
  await expect(page.locator('[data-save-id]')).toHaveCount(1)
  const saveId = await page.locator('[data-save-id]').first().getAttribute('data-save-id')
  const startTime = (await readStorage(page, KEYS.saves)).find((save) => save.id === saveId).tree['0']

  // ---- 三回合（流式；mock 提供方）
  await openStory(page, cardId, saveId)
  await playTurn(page, 'act one', 1)
  await playTurn(page, 'act two', 2)
  await playTurn(page, 'act three', 3)
  await expect(page.locator('[data-turn]')).toHaveText('3')
  await expect(page.locator('[data-status]')).not.toHaveText('')

  // ---- 刷新：卡 / 存档 / 回合 / 故事都在（没有封面、没有开始按钮，打开就在）
  await page.reload()
  await expect(page.locator('[data-page="play"]')).toBeVisible()
  await expect(page.locator('[data-start]')).toHaveCount(0)
  await expect(page.locator('[data-line="action"]')).toHaveCount(3)
  await expect(page.locator('[data-line="narration"]')).toHaveCount(3)
  await expect(page.locator('[data-line="narration"]').nth(2)).toContainText('[mock] turn 3: act three')
  await expect(page.locator('[data-turn]')).toHaveText('3')

  const saves = await readStorage(page, KEYS.saves)
  expect(saves).toHaveLength(1)
  expect(saves[0].turn).toBe(3)
  expect(saves[0].cardId).toBe(cardId)
  // v5 的 tree['0'] 是公历六格：mock 每回合推进一个「最粗的允许单位」（默认卡 = day）
  // ⇒ 三回合 = 日期 +3，时分秒不变。用 UTC 日历算期望，跨月也有确定答案。
  const endTime = saves[0].tree['0']
  // 用 2000 年做锚再 setUTCFullYear：`Date.UTC(1, …)` 会把 0..99 当 1900+year（默认卡是 1 年）
  const expectedDay = new Date(Date.UTC(2000, startTime.month - 1, startTime.day))
  expectedDay.setUTCFullYear(startTime.year)
  expectedDay.setUTCDate(expectedDay.getUTCDate() + 3)
  expect({ year: endTime.year, month: endTime.month, day: endTime.day }).toEqual({
    year: expectedDay.getUTCFullYear(),
    month: expectedDay.getUTCMonth() + 1,
    day: expectedDay.getUTCDate(),
  })
  expect(endTime.hour).toBe(startTime.hour)
  expect(endTime.minute).toBe(startTime.minute)
  expect('second' in endTime, '2.2 的 year-minute 只有五格，秒不是字段').toBe(false)
  expect(saves[0].tree['1']).toBe('mock-t3')
  expect(saves[0].tree['2']).toBe('VAL_MOOD_B2')
})

test('存档行读得出「游戏卡名 · 第 N 回合」，刷新后还在', async ({ page }) => {
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
  expect(meta.includes(cardName), '存档行要带游戏卡名').toBe(true)
  expect(meta.includes('1'), '存档行要带回合数').toBe(true)
})
