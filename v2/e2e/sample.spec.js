/**
 * 内置示例卡「晨风镇」（老板 2026-11-25 新增要求）：**首次打开有它，删了就不再回来**。
 *
 * 三件事非钉不可：
 *   ① **首次打开**（`tg2.settings.sampleSeeded` 还没落盘的机器）首页就有一张 `晨风镇`，
 *      结构是 v5 契约 §7 那棵树：时间 / 世界 / 玩家（`1.1` 区域 + `1.1.1` 地点）、
 *      3 个固定节点（id 是 `time/check/output`）、卡里**没有** `presetId`；
 *   ② **能删**：删掉之后列表真的空了，`tg2.cards` 也空了；
 *   ③ **不许复种**：刷新 / 再打开都不许把它种回来（标记一旦落盘就是一次性的）——
 *      这一条是「数据与项目本体分离」的实测口径：卡是数据、能被玩家彻底删掉。
 *
 * 🔴 **资产名不进玩家侧**（老板 2026-11-25 晚）：示例卡资产是 `v2/src/data/sample-card.json`，
 *    但种进盘里的卡是**克隆 + 运行时不透明 id** `c-<uuid>`（与新建卡同一套生成器）。
 *    ⇒ 首页 / 对话页 / 编辑器的 URL 里都只许有 `c-…` / `s-…`，不许出现 `morningwind` / `sample-card`。
 *
 * ⚠️ 这是唯一用 `boot(page, { sample: true })` 的用例（它不写标记 = 模拟真·首次打开）。
 *    其它所有用例靠 `boot()` 的默认标记躲开这张卡。
 */
import { URL } from 'node:url'
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, readStorage, route } from './support/app.js'

/** 内置样例的事实（来自 `v2/src/data/sample-card.json`；文案与结构都在这儿对一遍） */
const SAMPLE = {
  name: '晨风镇',
  // v5 §7.1：时间 / 世界（1.1 区域 + 1.1.1 地点 / 1.2 天气 / 1.3 氛围）/ 玩家（2.1–2.4）
  stateCodes: ['0', '1', '1.1', '1.1.1', '1.2', '1.3', '2', '2.1', '2.2', '2.3', '2.4'],
  nodeIds: ['time', 'check', 'output'],
}

/** 种下去的 id 是运行时不透明 id（`c-<uuid>`，与首页新建卡同一套生成器） */
const CARD_ID = /^c-[0-9a-f-]{36}$/
const SAVE_ID = /^s-[0-9a-f-]{36}$/

/** 页面 URL 的 hash：只许有运行时不透明 id（资产名一个字符都不许出现） */
const PLAY_HASH = /^#\/play\/c-[0-9a-f-]{36}\/s-[0-9a-f-]{36}$/
const EDIT_HASH = /^#\/edit\/c-[0-9a-f-]{36}$/

/** 资产名 / 资产内部 id 的记号：玩家侧（URL、存储）一个都不许出现 */
const ASSET_MARKERS = ['morningwind', 'sample-card']

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
  // 种下去的是**运行时不透明 id**：不是资产里的 card-morningwind
  expect(cards[0].id, '示例卡种下去必须是 c-<uuid>').toMatch(CARD_ID)
  expect(cards[0].id, '不许沿用资产 id').not.toBe('card-morningwind')
  await expect(page.locator('[data-card-id]')).toHaveAttribute('data-card-id', CARD_ID)
  expect(cards[0].name).toBe(SAMPLE.name)
  expect(cards[0].state.map((element) => element.code)).toEqual(SAMPLE.stateCodes)
  expect(cards[0].chain.map((node) => node.id)).toEqual(SAMPLE.nodeIds)
  expect(cards[0].chain.map((node) => node.type)).toEqual(['time', 'normal', 'output'])
  // v5 §7.1 的树：时间 / 世界 / 玩家；1.1 是「区域」（enum + 自身值），1.1.1 是它下面的「地点」
  const stateOf = (code) => cards[0].state.find((element) => element.code === code)
  expect(stateOf('0')).toMatchObject({
    type: 'time',
    timeMode: 'year-minute',
    granularityUpper: 'day',
    granularityLower: 'minute',
    holidays: { international: false, china: false, traditional: false },
    initial: { year: 1024, month: 9, day: 17, hour: 18, minute: 30 },
  })
  // 2.2：世界 / 玩家是「text + 空自身值 + 子节点」，根 initial 是整棵子树的扁平表
  expect(stateOf('1'), '世界是 text + 空自身值 + 子节点').toMatchObject({ type: 'text' })
  expect(stateOf('2'), '玩家是 text + 空自身值 + 子节点').toMatchObject({ type: 'text' })
  expect(stateOf('1').initial['1.0']).toBe('')
  expect(stateOf('2').initial['2.0']).toBe('')
  expect(stateOf('1.1')).toMatchObject({ type: 'enum', values: ['晨风镇', '镇郊', '地牢', '官道', '码头'] })
  expect(stateOf('1.1')).not.toHaveProperty('initial')
  expect(stateOf('1').initial['1.1.0']).toBe('晨风镇')
  expect(stateOf('1.1.1')).toMatchObject({ type: 'text' })
  expect(stateOf('1').initial['1.1.1']).toBe('醉猫旅店 · 一楼')
  // 人物（字典）与线索不在 2.1 里：不许换个 code 偷偷留着
  expect(cards[0].state.map((element) => element.name)).not.toEqual(expect.arrayContaining(['人物', '线索']))
  for (const node of cards[0].chain) expect(Object.keys(node)).not.toContain('presetId')
  // 也带了「开场」那一块（§2.1：缺它就是不合法的卡）
  expect(cards[0].prompts.some((prompt) => prompt.id === 'opening')).toBe(true)
  // 资产名 / 资产内部 id 不进玩家存储
  const persisted = JSON.stringify(cards)
  for (const marker of ASSET_MARKERS) {
    expect(persisted.includes(marker), `存储里出现了资产名 ${marker}`).toBe(false)
  }
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
  // 示例卡是 c-<uuid>：先记下来，「新建的卡不是它」才有得比
  const sampleId = (await readStorage(page, KEYS.cards))[0].id
  await deleteOnlyCard(page)

  await page.locator('[data-new-card]').click()
  await expect(page.locator('[data-card-id]')).toHaveCount(1)
  const cardId = await page.locator('[data-card-id]').first().getAttribute('data-card-id')
  expect(cardId, '新建的卡不是示例卡').not.toBe(sampleId)

  await page.goto(`${APP_PATH}${route.edit(cardId)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-item="0"]')).toBeVisible()

  await page.goto(`${APP_PATH}${route.home}`)
  await page.reload()
  await expect(page.locator('[data-card-id]')).toHaveCount(1)
  expect((await readStorage(page, KEYS.cards)).map((card) => card.id)).toEqual([cardId])
})

test('示例卡的 id 是运行时不透明 id：对话页 / 编辑器 URL 里都没有资产名', async ({ page }) => {
  await boot(page, { sample: true })
  await expect(page.locator('[data-page="home"]')).toBeVisible()

  const cardId = (await readStorage(page, KEYS.cards))[0].id
  expect(cardId, '示例卡不是 c-<uuid>').toMatch(CARD_ID)
  for (const marker of ASSET_MARKERS) expect(cardId).not.toContain(marker)

  // 从示例卡新建一个存档，再点进对话页 —— URL 里只许有运行时不透明 id
  await page.locator(`[data-card-id="${cardId}"]`).click()
  await page.locator('[data-new-save]').click()
  const saves = await readStorage(page, KEYS.saves)
  expect(saves).toHaveLength(1)
  const saveId = saves[0].id
  expect(saveId, '存档 id 不是 s-<uuid>').toMatch(SAVE_ID)
  expect(saves[0].cardSnapshot.id, '存档快照里也得是运行时不透明 id').toBe(cardId)

  await page.locator(`[data-save-id="${saveId}"]`).click()
  await expect(page.locator('[data-page="play"]')).toBeVisible()
  const playHash = new URL(page.url()).hash
  expect(playHash, `对话页 URL 不是 #/play/c-<uuid>/s-<uuid>：${playHash}`).toMatch(PLAY_HASH)
  for (const marker of ASSET_MARKERS) {
    expect(page.url().includes(marker), `对话页 URL 里出现了资产名 ${marker}`).toBe(false)
  }

  // 编辑器 URL 也只有卡 id
  await page.goto(`${APP_PATH}${route.home}`)
  await page.locator(`[data-card-id="${cardId}"] [data-card-edit]`).click()
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  const editHash = new URL(page.url()).hash
  expect(editHash, `编辑器 URL 不是 #/edit/c-<uuid>：${editHash}`).toMatch(EDIT_HASH)
  for (const marker of ASSET_MARKERS) {
    expect(page.url().includes(marker), `编辑器 URL 里出现了资产名 ${marker}`).toBe(false)
  }
})
