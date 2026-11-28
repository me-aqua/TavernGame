/**
 * 阶段 3 · 数组：模型整表写入的**引擎链路**（数组契约 §六）。
 *
 * `page.route` 顶替服务商（不联外网），回一段真 provider 形状的 `tool_calls`：
 *   第 1 个请求（时间节点）回正文，第 2 个请求（判定节点）回 `write_state({ path: '2.4', value: [...] })`，
 *   第 3 个请求（输出节点）回正文。
 *
 * 钉四件事：
 *   1. 合法数组整份写进 `save.tree['2.4']`，故事照常产出；
 *   2. item 形状不对 ⇒ `E_VALIDATION`、没有故事、存档一个字不动；
 *   3. 写 `2.4.0`（不是引用）⇒ `E_CHAIN`；**容器写 `2.4` 授权字段写 `2.4.1`**（整列落盘）；
 *   4. 判定节点收到的提示词里是中文键数组（`2.4「背包」`、物品 / 数量），不是字段 code。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, KEYS, boot, route } from './support/app.js'
import { holdCard, holdItems, holdSave } from '../tests/support/array-fixtures.js'

const CARD_ID = 'c-array-write'
const SAVE_ID = 's-array-write'

/** 一个「真」预设：请求会被 `page.route` 拦掉，不联外网 */
const REAL_PRESET = {
  id: 'p-real',
  name: 'real',
  provider: 'openai-compatible',
  baseUrl: 'https://api.example.invalid/v1',
  model: 'fake-model',
  apiKey: 'sk-test',
  reasoning: 'off',
}

/** SSE 帧（OpenAI 形状） */
function sseFrame(delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fake-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

/** 只回一个工具调用 */
function toolCallSse(name, args) {
  return (
    sseFrame({ role: 'assistant', content: '' }) +
    sseFrame({
      tool_calls: [
        { index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
      ],
    }) +
    sseFrame({}, 'tool_calls') +
    'data: [DONE]\n\n'
  )
}

/** 只回正文 */
function textSse(text) {
  return sseFrame({ role: 'assistant', content: text }) + sseFrame({}, 'stop') + 'data: [DONE]\n\n'
}

/** 种卡 + 存档 + 真预设 */
function seeded() {
  const card = holdCard({ id: CARD_ID })
  const save = holdSave(card, { id: SAVE_ID })
  return {
    [KEYS.cards]: [card],
    [KEYS.saves]: [save],
    [KEYS.presets]: [REAL_PRESET],
    [KEYS.nodeModels]: { [card.id]: Object.fromEntries(card.chain.map((node) => [node.id, REAL_PRESET.id])) },
  }
}

/**
 * 把服务商顶掉：第 1 / 3 个请求回正文，第 2 个（判定节点）回给定的工具调用；
 * `seen` 收集每次请求体（最后一条是判定节点拿到的提示词）。
 */
async function routeSecondCall(page, name, args, seen) {
  let calls = 0
  await page.route('**/chat/completions', async (intercepted) => {
    calls += 1
    const body = intercepted.request().postData() ?? ''
    seen.push(body)
    const payload = calls === 2 ? toolCallSse(name, args) : textSse(calls === 1 ? 'OK' : 'STORY')
    await intercepted.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: payload,
    })
  })
}

/** 发一句行动 */
async function sendAction(page) {
  await page.goto(`${APP_PATH}${route.play(CARD_ID, SAVE_ID)}`)
  await expect(page.locator('[data-page="play"]')).toBeVisible()
  await page.locator('[data-action-input]').fill('act')
  await page.locator('[data-send]').click()
}

/** 盘上这一份存档的 2.4 */
async function storedItems(page) {
  const saves = await readLocal(page, KEYS.saves)
  return saves.find((save) => save.id === SAVE_ID).tree['2.4']
}

/** 读 localStorage 的某个键（解析） */
async function readLocal(page, key) {
  return page.evaluate(`JSON.parse(window.localStorage.getItem(${JSON.stringify(key)}) ?? 'null')`)
}

test('模型 write_state 整份数组：合法值落盘、故事照常产出、提示词是中文键数组', async ({ page }) => {
  const seen = []
  await boot(page, { storage: seeded() })
  const next = [
    { '2.4.1': '长弓', '2.4.2': 7 },
    { '2.4.1': '火把', '2.4.2': 2 },
  ]
  await routeSecondCall(page, 'write_state', { path: '2.4', value: next }, seen)
  await sendAction(page)

  await expect(page.locator('[data-line="narration"]')).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator('[data-error]')).toHaveCount(0)
  expect(await storedItems(page)).toEqual(next)

  expect(seen.length, '三个节点各一次请求').toBe(3)
  const checkPrompt = seen[1]
  expect(checkPrompt, '判定节点的请求里要有数组那一行').toContain('2.4「背包」')
  expect(checkPrompt, '字段用中文名').toContain('物品')
  expect(checkPrompt).toContain('数量')
  expect(checkPrompt, '提示词里不许出现字段 code').not.toContain('2.4.1')
})

test('item 缺字段 ⇒ E_VALIDATION、没有故事、存档不动', async ({ page }) => {
  const seen = []
  await boot(page, { storage: seeded() })
  await routeSecondCall(page, 'write_state', { path: '2.4', value: [{ '2.4.1': '长弓' }] }, seen)
  await sendAction(page)

  await expect(page.locator('[data-error]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
  await expect(page.locator('[data-error-next]')).toHaveText(/[\u4e00-\u9fff]/)
  await expect(page.locator('[data-line="narration"]')).toHaveCount(0)
  expect(await storedItems(page)).toEqual(holdItems())
})

test('写 2.4.0（不是引用）⇒ E_CHAIN、存档不动', async ({ page }) => {
  const seen = []
  await boot(page, { storage: seeded() })
  await routeSecondCall(page, 'write_state', { path: '2.4.0', value: 'X' }, seen)
  await sendAction(page)

  await expect(page.locator('[data-error]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-error-code]')).toHaveText('E_CHAIN')
  await expect(page.locator('[data-line="narration"]')).toHaveCount(0)
  expect(await storedItems(page)).toEqual(holdItems())
})

test('容器写 2.4 授权字段写 2.4.1：整列落盘、item 数不变、兄弟字段不动', async ({ page }) => {
  const seen = []
  await boot(page, { storage: seeded() })
  await routeSecondCall(page, 'write_state', { path: '2.4.1', value: ['长弓', '火把', '盾'] }, seen)
  await sendAction(page)

  await expect(page.locator('[data-line="narration"]')).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator('[data-error]')).toHaveCount(0)
  expect(await storedItems(page)).toEqual([
    { '2.4.1': '长弓', '2.4.2': 1 },
    { '2.4.1': '火把', '2.4.2': 1 },
    { '2.4.1': '盾', '2.4.2': 3 },
  ])
})
