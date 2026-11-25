/**
 * 模型绑定在卡外面（CONTRACT §2.5 / §4.1）：**卡与存档不带模型，映射住 `tg2.nodeModels`**。
 *
 * 三条要钉住的东西：
 *   ① 编辑器里逐节点改模型 ⇒ 只写映射，不动卡；刷新后还在；
 *   ② 跑一回合时**按节点**生效（一个节点用真预设、其余用 mock ⇒ 只发一次请求）；
 *   ③ 没有预设时那一格是禁用的，而且不许往盘上写假映射。
 *
 * 为什么值得单独一份：模型绑定是「玩家的本机设置」，一旦它偷偷回到卡里，
 * 卡就会夹带别人的 Key / 模型选择 —— 而那件事在界面上**看不出来**（跑起来都差不多）。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  createSave,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  MOCK_PRESET_B,
  openAiSse,
  openStory,
  playTurn,
  readStorage,
  route,
  slowMock,
} from './support/app.js'

const CARD_ID = 'c1'

/** 一个「真」预设：请求会被 `page.route` 拦掉，不联外网 */
const REAL_PRESET = {
  ...slowMock(0),
  id: 'p-real',
  name: 'real',
  provider: 'openai-compatible',
  baseUrl: 'https://mock.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
}

function seed(extra = {}) {
  const card = makeCard()
  return {
    [KEYS.cards]: [card],
    [KEYS.saves]: [makeSave(card)],
    [KEYS.presets]: [MOCK_PRESET, MOCK_PRESET_B],
    ...extra,
  }
}

test('编辑器里逐节点改模型：只写映射、不动卡，刷新后还在', async ({ page }) => {
  await boot(page, { storage: seed() })
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()

  // 默认值 = 池子里的第一个（这张卡还没有映射）
  await page.locator('[data-node-id="output"]').click()
  const select = page.locator('[data-node-preset]')
  await expect(select).toHaveValue(MOCK_PRESET.id)

  // 改成第二个预设
  await select.selectOption(MOCK_PRESET_B.id)
  await expect(select).toHaveValue(MOCK_PRESET_B.id)

  // 落盘的是映射，不是卡
  const models = await readStorage(page, KEYS.nodeModels)
  expect(models[CARD_ID].output).toBe(MOCK_PRESET_B.id)
  const cardJson = JSON.stringify((await readStorage(page, KEYS.cards))[0])
  expect(cardJson.includes(MOCK_PRESET_B.id), '卡里不许出现预设 id').toBe(false)

  // 刷新后还在
  await page.reload()
  await page.locator('[data-node-id="output"]').click()
  await expect(page.locator('[data-node-preset]')).toHaveValue(MOCK_PRESET_B.id)

  // 其它节点没被顺手改掉（第一次打开时铺的默认值要留住）
  const after = await readStorage(page, KEYS.nodeModels)
  expect(after[CARD_ID].time).toBe(MOCK_PRESET.id)
  expect(after[CARD_ID].proof).toBe(MOCK_PRESET.id)
})

test('跑一回合时逐节点生效：只有输出节点用真预设 ⇒ 只发一次请求', async ({ page }) => {
  const requests = []
  await page.route('**/chat/completions', async (intercepted) => {
    requests.push(intercepted.request().url())
    await intercepted.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: openAiSse(['ONLY', 'OUTPUT']),
    })
  })

  const card = makeCard()
  await boot(page, {
    storage: {
      [KEYS.cards]: [card],
      [KEYS.saves]: [makeSave(card)],
      [KEYS.presets]: [MOCK_PRESET, REAL_PRESET],
      // 只有 output 这一格指向真预设；其余走默认（第一个 = mock）
      [KEYS.nodeModels]: { [CARD_ID]: { output: REAL_PRESET.id } },
    },
  })
  await openStory(page, CARD_ID, 's1', { debug: true })
  await playTurn(page, 'act one', 1)

  expect(requests, '只有输出节点该走网络（其余三个节点用 mock）').toHaveLength(1)
  expect(requests[0]).toBe('https://mock.invalid/v1/chat/completions')
  await expect(page.locator('[data-line="narration"]')).toHaveText('ONLYOUTPUT')

  // 调试面板要能看出「这一步用了哪个预设」——模型住在本地映射，这是唯一看得见它的地方
  const presetsLine = await page.locator('[data-debug-presets]').textContent()
  expect((presetsLine ?? '').includes(REAL_PRESET.id)).toBe(true)
  expect((presetsLine ?? '').includes(MOCK_PRESET.id)).toBe(true)
})

test('一个预设都没有：那一格禁用，且不许往盘上写假映射', async ({ page }) => {
  const card = makeCard()
  await boot(page, { storage: { [KEYS.cards]: [card] } })
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await page.locator('[data-node-id="output"]').click()

  const select = page.locator('[data-node-preset]')
  await expect(select).toHaveAttribute('aria-disabled', 'true')
  await expect(select).toHaveValue('')
  expect(await readStorage(page, KEYS.nodeModels)).toBeNull()
})

test('映射里缺的节点用第一个预设；整张卡没有映射时也能玩', async ({ page }) => {
  const card = makeCard()
  await boot(page, {
    storage: {
      [KEYS.cards]: [card],
      [KEYS.saves]: [makeSave(card)],
      [KEYS.presets]: [MOCK_PRESET, MOCK_PRESET_B],
      [KEYS.nodeModels]: { [CARD_ID]: { check: MOCK_PRESET_B.id } },
    },
  })
  const saveId = await createSave(page, CARD_ID)
  await openStory(page, CARD_ID, saveId)
  await playTurn(page, 'act one', 1)
  await expect(page.locator('[data-turn]')).toHaveText('1')

  // 跑回合**不写**映射（铺默认值是编辑器 / 建卡的事，§2.5）：这一片还是种下去的样子
  expect(await readStorage(page, KEYS.nodeModels)).toEqual({ [CARD_ID]: { check: MOCK_PRESET_B.id } })
})
