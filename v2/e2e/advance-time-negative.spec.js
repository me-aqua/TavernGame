/**
 * 阶段 2.2 · P2：`advance_time` 负向的**引擎链路**判据（契约 §B7）。
 *
 * 这一份用**真 provider 形状的 tool call** 走完整条路：`page.route` 顶替服务商（不联外网），
 * 回一段带 `tool_calls` 的 SSE ⇒ 引擎解析工具调用 ⇒ `runTool` ⇒ `advanceTime`。
 *
 * 钉四件事：
 *   1. 单位越界（卡片的 `granularityUpper='hour'`，模型却要推 `day`）⇒ `E_VALIDATION`、中文、存档不变；
 *      同一份卡把上界放宽成 `day` ⇒ 同一次调用成功 —— **实现漏掉 upper/lower 检查时，第一条会变绿 ⇒ 判据红**；
 *   2. 缺 `amount` ⇒ 拒绝（不会被默认成 1）；
 *   3. 缺 `unit` ⇒ 拒绝（不会被默认成 day）；
 *   4. 不认识的 `unit` ⇒ 拒绝。
 *
 * 正控（第 1 条的后半段）保证「拒绝」不是「整条链路根本跑不起来」。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, route } from './support/app.js'
import { v6Card, v6Save } from '../tests/support/v6-fixtures.js'

const CARD_ID = 'c-advance'
const SAVE_ID = 's-advance'

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

/** SSE 帧（OpenAI 形状）；`delta` 与 `finish_reason` 分开传 */
function sseFrame(delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fake-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

/** 一段「只回一个工具调用」的 SSE：arguments 是 JSON 字符串 */
function toolCallSse(name, args) {
  return (
    sseFrame({ role: 'assistant', content: '' }) +
    sseFrame({
      tool_calls: [
        {
          index: 0,
          id: 'call_1',
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    }) +
    sseFrame({}, 'tool_calls') +
    'data: [DONE]\n\n'
  )
}

/** 一段「只回正文」的 SSE（正控里给后面的节点用） */
function textSse(text) {
  return sseFrame({ role: 'assistant', content: text }) + sseFrame({}, 'stop') + 'data: [DONE]\n\n'
}

/** 卡片 + 存档 + 一个真预设；`upper` / `lower` 决定时间颗粒度 */
function seeded({ upper = 'day', lower = 'minute' } = {}) {
  const card = v6Card()
  card.id = CARD_ID
  card.state[0].granularityUpper = upper
  card.state[0].granularityLower = lower
  const save = v6Save(card, { id: SAVE_ID })
  return {
    [KEYS.cards]: [card],
    [KEYS.saves]: [save],
    [KEYS.presets]: [REAL_PRESET],
    [KEYS.nodeModels]: { [card.id]: Object.fromEntries(card.chain.map((node) => [node.id, REAL_PRESET.id])) },
  }
}

/** 把服务商顶掉：第 1 个请求（时间节点）回给定的 tool call，后面的请求回正文 */
async function routeToolCall(page, name, args) {
  let calls = 0
  await page.route('**/chat/completions', async (intercepted) => {
    calls += 1
    const body = calls === 1 ? toolCallSse(name, args) : textSse('OK')
    await intercepted.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body,
    })
  })
}

/** 发一句行动（不等正文：错误路径没有正文） */
async function sendAction(page, action) {
  await page.goto(APP_PATH + route.play(CARD_ID, SAVE_ID))
  await expect(page.locator('[data-page="play"]')).toBeVisible()
  await page.locator('[data-action-input]').fill(action)
  await page.locator('[data-send]').click()
}

/** 读这一份存档在盘上的时间值 */
async function storedTime(page) {
  const saves = await page.evaluate(
    `JSON.parse(window.localStorage.getItem(${JSON.stringify(KEYS.saves)}) ?? '[]')`,
  )
  return saves.find((save) => save.id === SAVE_ID).tree['0']
}

/** 期望这一回合以中文 E_VALIDATION 收尾、存档一个字没动 */
async function expectRejectedTurn(page, note) {
  await expect(page.locator('[data-error]'), `${note}：要显示错误面板`).toBeVisible()
  await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
  await expect(page.locator('[data-error-next]')).toHaveText(/[\u4e00-\u9fff]/)
  await expect(page.locator('[data-line="narration"]'), `${note}：不许产出故事`).toHaveCount(0)
  expect(await storedTime(page), `${note}：存档的时间不许被推进`).toEqual({
    year: 2024,
    month: 2,
    day: 10,
    hour: 8,
    minute: 30,
  })
}

test.describe('advance_time 负向（引擎链路）', () => {
  test('单位越界（卡片上界 hour，模型要 day）⇒ E_VALIDATION、存档不变', async ({ page }) => {
    await boot(page, { storage: seeded({ upper: 'hour', lower: 'hour' }) })
    await routeToolCall(page, 'advance_time', { amount: 1, unit: 'day' })
    await sendAction(page, 'wait')
    await expectRejectedTurn(page, 'upper=hour 却推 day')
  })

  // 正控：**同一次调用**在上界放宽成 day 的卡上必须成功。
  // （与上一条成对：实现把 upper/lower 检查删掉 ⇒ 上一条变绿；把工具调用整条链路弄坏 ⇒ 这一条变红。）
  test('正控：上界 day 的卡上，同一次 advance_time(day) 真的推进了时间', async ({ page }) => {
    await boot(page, { storage: seeded({ upper: 'day', lower: 'minute' }) })
    await routeToolCall(page, 'advance_time', { amount: 1, unit: 'day' })
    await sendAction(page, 'wait')
    await expect(page.locator('[data-line="narration"]')).toHaveCount(1, { timeout: 15_000 })
    await expect(page.locator('[data-error]')).toHaveCount(0)
    expect(await storedTime(page)).toMatchObject({ year: 2024, month: 2, day: 11, hour: 8, minute: 30 })
  })

  test('缺 amount ⇒ E_VALIDATION（不被默认成 1）', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await routeToolCall(page, 'advance_time', { unit: 'day' })
    await sendAction(page, 'wait')
    await expectRejectedTurn(page, '缺 amount')
  })

  test('缺 unit ⇒ E_VALIDATION（不被默认成 day）', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await routeToolCall(page, 'advance_time', { amount: 1 })
    await sendAction(page, 'wait')
    await expectRejectedTurn(page, '缺 unit')
  })

  test('不认识的 unit ⇒ E_VALIDATION', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await routeToolCall(page, 'advance_time', { amount: 1, unit: 'decade' })
    await sendAction(page, 'wait')
    await expectRejectedTurn(page, '不认识的 unit')
  })
})
