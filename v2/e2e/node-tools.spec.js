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
