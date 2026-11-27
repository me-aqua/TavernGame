/**
 * P2（缺陷回归）：`advance_time` 的**工具 schema 随卡片的时间模式收窄**（契约 §B7）。
 *
 * 缺陷现场：卡片切到 `year-date` 之后，工具 schema 仍把六个单位全广告给模型；模型照广告选
 * `advance_time({unit:'minute'})`，引擎按模式一判 ⇒ `E_VALIDATION`。这不是模型的错，是**广告与规则不一致**。
 *
 * 这一份在**请求体（provider wire）**上钉四件事：
 *   1. `advance_time.parameters.properties.unit.enum` **必须恰好等于**该模式的单位表：
 *      year-minute 六个 / year-date 四个（年·月·周·日）/ days-minute 三个（日·时·分）；
 *   2. 点名两条反向断言：year-date 里**没有 minute**、days-minute 里**没有 year**（year-minute 有 minute 作正控）；
 *   3. **工具描述与 schema 一致**：描述里出现的单位词都得在 enum 里；
 *   4. **prompt 与 schema 一致**：同一请求的提示词按该模式渲染时间（year-date 没有钟点、days-minute 没有日期）。
 *
 * 三个模式都必须绿；year-minute 额外作正控（`minute` 必须在）。
 * enum 一旦退回六单位全集，year-date / days-minute 两条会红 —— 这就是它咬的东西。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, openAiSse, openStory, playTurn } from './support/app.js'
import { cardWithTime, v6Save } from '../tests/support/v6-fixtures.js'

/** 一个「真」预设：请求会被 `page.route` 拦掉，不联外网 */
const REAL_PRESET = {
  id: 'p-real',
  name: 'real',
  provider: 'openai-compatible',
  baseUrl: 'https://mock.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
  reasoning: 'off',
}

/** 三个模式各自的单位表（判据侧的期望，不 import 产品模块） */
const UNITS = {
  'year-minute': ['year', 'month', 'week', 'day', 'hour', 'minute'],
  'year-date': ['year', 'month', 'week', 'day'],
  'days-minute': ['day', 'hour', 'minute'],
}

/** 三个模式各自的时间显示（提示词里那一行） */
const TIME_TEXT = {
  'year-minute': '2024-02-10 08:30（周六）',
  'year-date': '2024-02-10（周六）',
  'days-minute': '第 5 天 08:30',
}

/** 一次请求里的某个工具定义（数组 / 按名字做键两种形状都收，与 node-tools 同一套读法） */
function toolShapeOf(body, name) {
  const tools = body.tools ?? []
  const entries = Array.isArray(tools)
    ? tools
    : Object.entries(tools).map(([key, value]) => ({ ...value, name: value?.name ?? key }))
  const entry = entries.find((item) => (item?.function?.name ?? item?.name) === name)
  return entry?.function ?? entry
}

/** 工具的参数 JSON Schema（不同 AI SDK 版本叫 `parameters` 或 `inputSchema`） */
function parametersOf(shape) {
  return shape?.parameters ?? shape?.inputSchema ?? shape?.function?.parameters
}

/** 请求里的提示词正文（messages 的 content 可能是字符串，也可能是分片数组） */
function promptTextOf(body) {
  const parts = []
  for (const message of body.messages ?? []) {
    if (typeof message.content === 'string') {
      parts.push(message.content)
      continue
    }
    for (const piece of message.content ?? []) {
      if (typeof piece?.text === 'string') parts.push(piece.text)
    }
  }
  return parts.join('\n')
}

/** 描述里提到了哪些单位词（只认整词，避免 minutely 之类误伤） */
function unitsMentionedIn(description) {
  const text = String(description ?? '').toLowerCase()
  return Object.keys(UNITS['year-minute']).filter((unit) => new RegExp(`\\b${unit}\\b`).test(text))
}

/** 打开一张给定模式的卡、跑一回合，返回**时间节点那一次请求**的 body */
async function firstRequestFor(page, mode) {
  const card = cardWithTime({
    id: `c-${mode}`,
    mode,
    time: mode === 'days-minute' ? { day: 5, hour: 8, minute: 30 } : undefined,
  })
  // 时间节点自己读时间元素：这样**同一个请求**里既有工具 schema、又有按模式渲染的时间行，
  // 「prompt / schema 一致」才是在同一份输入上判的（不是两条路各测各的）。
  card.chain[0] = { ...card.chain[0], reads: ['0'] }
  const save = v6Save(card, { id: `s-${mode}` })
  const requests = []
  await page.route('**/chat/completions', async (intercepted) => {
    requests.push({ body: intercepted.request().postDataJSON() })
    await intercepted.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: openAiSse(['OK']),
    })
  })
  await boot(page, {
    storage: {
      [KEYS.cards]: [card],
      [KEYS.saves]: [save],
      [KEYS.presets]: [REAL_PRESET],
      [KEYS.nodeModels]: {
        [card.id]: Object.fromEntries(card.chain.map((node) => [node.id, REAL_PRESET.id])),
      },
    },
  })
  await openStory(page, card.id, save.id)
  await playTurn(page, 'wait', 1)
  expect(requests.length, '时间节点应当发出一次请求').toBeGreaterThan(0)
  return requests[0].body
}

test.describe('advance_time 的 unit 枚举跟着时间模式走（provider wire）', () => {
  for (const mode of ['year-minute', 'year-date', 'days-minute']) {
    test(`${mode}：unit.enum 恰好是 ${UNITS[mode].join(' / ')}`, async ({ page }) => {
      const body = await firstRequestFor(page, mode)
      const advance = toolShapeOf(body, 'advance_time')
      expect(advance, `${mode} 的请求里应当有 advance_time`).toBeTruthy()
      const parameters = parametersOf(advance)
      const units = parameters?.properties?.unit
      expect(units, `${mode}：unit 参数要声明`).toBeTruthy()

      // 1) 精确等于该模式的单位表（顺序也按粗 → 细）
      expect(units.enum, `${mode}：unit.enum 必须等于该模式的单位表`).toEqual(UNITS[mode])

      // 2) 点名反向断言：越界的单位不许被广告
      if (mode === 'year-date') {
        expect(units.enum, 'year-date 不许广告 minute').not.toContain('minute')
        expect(units.enum, 'year-date 不许广告 hour').not.toContain('hour')
      }
      if (mode === 'days-minute') {
        expect(units.enum, 'days-minute 不许广告 year').not.toContain('year')
        expect(units.enum, 'days-minute 不许广告 month').not.toContain('month')
      }
      if (mode === 'year-minute') {
        expect(units.enum, 'year-minute 是正控：minute 必须在').toContain('minute')
      }

      // 3) prompt / schema 一致：工具描述（工具级 + `unit` 参数级）里提到的单位词都得在 enum 里
      const mentioned = [...unitsMentionedIn(advance.description), ...unitsMentionedIn(units.description)]
      for (const unit of mentioned) {
        expect(units.enum, `${mode}：工具描述提到的 ${unit} 不在 unit.enum 里（广告与规则不一致）`).toContain(
          unit,
        )
      }
      // `unit` 参数的描述是把单位列了一遍的：列出来的必须正是 enum（不是「全集」）
      const listed = unitsMentionedIn(units.description)
      if (listed.length > 0) {
        expect(listed.sort(), `${mode}：unit 参数描述里列的单位要和 enum 一致`).toEqual(
          [...units.enum].sort(),
        )
      }

      // 4) prompt / schema 一致：同一请求的提示词按该模式渲染时间，不出现别的模式的形态
      const prompt = promptTextOf(body)
      expect(prompt, `${mode}：提示词里应当有该模式的时间行`).toContain(TIME_TEXT[mode])
      if (mode === 'year-date') {
        expect(prompt, 'year-date 的提示词不许出现钟点').not.toContain('08:30')
      }
      if (mode === 'days-minute') {
        expect(prompt, 'days-minute 的提示词不许出现年月日').not.toContain('2024-02-10')
      }
    })
  }
})
