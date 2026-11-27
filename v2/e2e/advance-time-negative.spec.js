/**
 * `advance_time` 负向的**引擎链路**判据（契约 §F）。
 *
 * 这一份用**真 provider 形状的 tool call** 走完整条路：`page.route` 顶替服务商（不联外网），
 * 回一段带 `tool_calls` 的 SSE ⇒ 引擎解析工具调用 ⇒ `runTool` ⇒ `advanceTime`。
 *
 * 钉四件事：
 *   1. 模式外的单位一律拒绝（year-date 没有钟点：模型要 `hour` ⇒ `E_VALIDATION`、中文、存档不变）；
 *   2. **卡上残留的 `granularityUpper='hour'` 不再影响判决**：模型要推 `day` 必须成功
 *      ——「实现还在读上下界」时这一条会红；
 *   3. 缺 `amount` ⇒ 拒绝（不会被默认成 1）；
 *   4. 缺 `unit` / 不认识的 `unit` ⇒ 拒绝（不会被默认成 day）。
 *
 * 正控（第 2 条）保证「没有报错」不是「整条链路根本没跑」。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, route } from './support/app.js'
import { cardWithTime, v6Save } from '../tests/support/v6-fixtures.js'

const CARD_ID = 'c-advance'
const SAVE_ID = 's-advance'
const YEAR_MINUTE = { year: 2024, month: 2, day: 10, hour: 8, minute: 30 }
const YEAR_DATE = { year: 2024, month: 2, day: 10 }

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

/** 卡片 + 存档 + 一个真预设；`mode` 决定时间形状，`granularity` 是残留的旧字段 */
function seeded({ mode = 'year-minute', granularity = null } = {}) {
  const time = mode === 'year-date' ? { ...YEAR_DATE } : { ...YEAR_MINUTE }
  const card = cardWithTime({ id: CARD_ID, mode, time })
  if (granularity !== null) {
    card.state[0].granularityUpper = granularity
    card.state[0].granularityLower = granularity
  }
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

/** 期望这一回合以中文 E_VALIDATION 收尾、存档的时间一个字没动 */
async function expectRejectedTurn(page, expected, note) {
  await expect(page.locator('[data-error]'), `${note}：要显示错误面板`).toBeVisible()
  await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
  await expect(page.locator('[data-error-next]')).toHaveText(/[\u4e00-\u9fff]/)
  await expect(page.locator('[data-line="narration"]'), `${note}：不许产出故事`).toHaveCount(0)
  expect(await storedTime(page), `${note}：存档的时间不许被推进`).toEqual(expected)
}

test.describe('advance_time 负向（引擎链路）', () => {
  test('模式外的单位（year-date 要 hour）⇒ E_VALIDATION、存档不变', async ({ page }) => {
    await boot(page, { storage: seeded({ mode: 'year-date' }) })
    await routeToolCall(page, 'advance_time', { amount: 1, unit: 'hour' })
    await sendAction(page, 'wait')
    await expectRejectedTurn(page, YEAR_DATE, 'year-date 却推 hour')
  })

  // 正控 + 本票的判决点：卡上残留 upper=hour 也不许拦 day（上下界不再参与判决）。
  test('卡上残留 granularityUpper=hour：同一次 advance_time(day) 必须成功', async ({ page }) => {
    await boot(page, { storage: seeded({ granularity: 'hour' }) })
    await routeToolCall(page, 'advance_time', { amount: 1, unit: 'day' })
    await sendAction(page, 'wait')
    await expect(page.locator('[data-line="narration"]')).toHaveCount(1, { timeout: 15_000 })
    await expect(page.locator('[data-error]')).toHaveCount(0)
    expect(await storedTime(page)).toMatchObject({
      year: 2024,
      month: 2,
      day: 11,
      hour: 8,
      minute: 30,
    })
  })

  test('缺 amount ⇒ E_VALIDATION（不被默认成 1）', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await routeToolCall(page, 'advance_time', { unit: 'day' })
    await sendAction(page, 'wait')
    await expectRejectedTurn(page, YEAR_MINUTE, '缺 amount')
  })

  test('缺 unit ⇒ E_VALIDATION（不被默认成 day）', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await routeToolCall(page, 'advance_time', { amount: 1 })
    await sendAction(page, 'wait')
    await expectRejectedTurn(page, YEAR_MINUTE, '缺 unit')
  })

  test('不认识的 unit ⇒ E_VALIDATION', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await routeToolCall(page, 'advance_time', { amount: 1, unit: 'decade' })
    await sendAction(page, 'wait')
    await expectRejectedTurn(page, YEAR_MINUTE, '不认识的 unit')
  })
})
