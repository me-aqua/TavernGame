/**
 * 节点拿到的工具由 `writable` 决定，**不看节点类型**（设计更正）。
 *
 * 判据在请求体上：真 provider 路径用 `page.route` 拦下来，读每次调用的 `tools` —— 这才是「这个节点
 * 拿到了哪几个工具」的直接证据（mock 只回一种调用，看不出「两个都给」）。
 *
 * 期望（按链顺序：time → check → extra → output）：
 *   · `time` 的 writable `['0','1']` ⇒ `advance_time` + `write_state`；
 *   · `check`（normal）的 writable `['0','1']` ⇒ `advance_time` + `write_state`；
 *   · `extra`（normal）的 writable `['2']` ⇒ 只有 `write_state`；
 *   · `output` 什么也不写 ⇒ 没有工具。
 */
import { expect, test } from '@playwright/test'
import { boot, createSave, KEYS, makeCard, openAiSse, openStory, playTurn, slowMock } from './support/app.js'

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

/** 卡：按节点替换 writable（其余字段照契约夹具） */
function cardWithWritable(byNode) {
  const card = makeCard()
  card.chain = card.chain.map((node) =>
    byNode[node.id] === undefined ? node : { ...node, writable: byNode[node.id] },
  )
  return card
}

/**
 * 一次调用里拿到了哪些工具（名字排序，便于比集合）。
 * AI SDK 把 `tools` 序列化成**数组**（`[{type:'function', function:{name}}]`）或对象（按名字做键）
 * 都可能 —— 两种都读，别把「数组下标」当成工具名（第一版就栽在这）。
 */
function toolNamesOf(request) {
  const tools = request.body.tools ?? []
  if (Array.isArray(tools)) {
    return tools
      .map((entry) => entry?.function?.name ?? entry?.name)
      .filter((name) => typeof name === 'string')
      .sort()
  }
  return Object.keys(tools).sort()
}

/** 一次请求里的某个工具定义（数组 / 按名字做键两种形状都收） */
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

/** 一个 JSON Schema 接受哪些 type（含 anyOf / oneOf / type 数组） */
function acceptedTypesOf(schema) {
  const accepted = new Set()
  const collect = (node) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.type === 'string') accepted.add(node.type)
    if (Array.isArray(node.type)) for (const type of node.type) accepted.add(type)
    for (const branch of [...(node.anyOf ?? []), ...(node.oneOf ?? [])]) collect(branch)
  }
  collect(schema)
  return [...accepted]
}

test('工具参数 schema：advance_time 用 amount + unit；write_state 的 value 收数字与 JSON 字符串', async ({
  page,
}) => {
  const requests = []
  await page.route('**/chat/completions', async (route) => {
    requests.push({ body: route.request().postDataJSON() })
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: openAiSse(['OK']),
    })
  })

  // time 节点同时写 0 与文本 1 ⇒ 两个工具都在这一个请求里
  const card = cardWithWritable({ time: ['0', '1'], check: [], extra: [], output: [] })
  await boot(page, { storage: { [KEYS.cards]: [card], [KEYS.presets]: [REAL_PRESET] } })
  const saveId = await createSave(page, CARD_ID)
  await openStory(page, CARD_ID, saveId)
  await playTurn(page, 'act one', 1)
  const body = requests[0].body
  const advance = parametersOf(toolShapeOf(body, 'advance_time'))
  expect(advance, 'advance_time 的工具 schema 不在请求里').toBeTruthy()
  expect(advance.properties?.amount?.type, 'amount 是整数').toBe('integer')
  expect(advance.properties?.hours, '旧的 hours 参数不许还在').toBeUndefined()
  expect(advance.properties?.unit?.enum, 'unit 必须是 TIME_UNITS 那六个（秒没有了）').toEqual([
    'year',
    'month',
    'week',
    'day',
    'hour',
    'minute',
  ])
  expect(advance.required, 'amount + unit 都必填').toEqual(expect.arrayContaining(['amount', 'unit']))

  const write = parametersOf(toolShapeOf(body, 'write_state'))
  expect(write, 'write_state 的工具 schema 不在请求里').toBeTruthy()
  expect(write.properties?.path?.type, 'path 是字符串').toBe('string')
  const valueTypes = acceptedTypesOf(write.properties?.value)
  expect(valueTypes, 'value 必须收 JSON 字符串（模型可能回字符串）').toContain('string')
  expect(
    valueTypes.some((type) => type === 'number' || type === 'integer'),
    `value 必须收整数（模型写数字元素时不能只给 string）：实际 ${JSON.stringify(valueTypes)}`,
  ).toBe(true)
})

test('工具由 writable 决定：含 0 给 advance_time，含文本 code 给 write_state', async ({ page }) => {
  const requests = []
  await page.route('**/chat/completions', async (route) => {
    requests.push({ body: route.request().postDataJSON() })
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: openAiSse(['OK']),
    })
  })

  const card = cardWithWritable({
    time: ['0', '1'],
    check: ['0', '1'],
    extra: ['2'],
    output: [],
  })
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [REAL_PRESET] },
  })
  const saveId = await createSave(page, CARD_ID)
  await openStory(page, CARD_ID, saveId)
  await playTurn(page, 'act one', 1)

  expect(requests.length, '一个节点一次调用').toBe(4)
  expect(toolNamesOf(requests[0]), 'time 节点的 writable 含 0 与文本 ⇒ 两个工具').toEqual([
    'advance_time',
    'write_state',
  ])
  expect(toolNamesOf(requests[1]), 'normal 节点的 writable 含 0 与文本 ⇒ 两个工具').toEqual([
    'advance_time',
    'write_state',
  ])
  expect(toolNamesOf(requests[2]), '只有文本 code ⇒ 只有 write_state').toEqual(['write_state'])
  expect(toolNamesOf(requests[3]), '输出节点没有工具').toEqual([])
})
