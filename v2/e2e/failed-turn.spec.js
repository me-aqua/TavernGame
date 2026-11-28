/**
 * 失败回合留存 · 对话页（契约 `契约-失败回合留存.md` §4 / §6.2）。
 *
 * 四条路各一条：
 *   E1 种子存档：调试卡画 action / 错误 / nextStep / 半截正文 / trace + turnStats；非调试不画；
 *   E2 真 provider 401：turn / tree / events 一个字不动，只落 failedTurn；输入框与卡片都有，刷新不变；
 *   E3 重发再失败：旧槽被**替换**（action / text / trace 都是新的），不是叠加；
 *   E4 重发成功：失败槽被**删掉**，turn +1，调试开着也没有卡片。
 *
 * 🔴 断言只用 `data-*` 钩子；种子数据走 `boot()` 的 addInitScript；真 provider 的 401 用 `page.route`。
 * 🔴 E2 / E3 / E4 都显式 `fill` 行动再发送 —— 别让「输入框预填」这条判据替发送路径背锅。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  CJK,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  nodeModelsFor,
  openAiSse,
  readStorage,
  route,
  turnEvents,
} from './support/app.js'

const CARD_ID = 'c1'
const AT = '2026-11-28T06:30:00.000Z'

/** 真 provider 预设：请求会被 `page.route` 拦下，不会联外网 */
const REAL_PRESET = {
  ...MOCK_PRESET,
  id: 'p-real',
  name: 'real',
  provider: 'openai-compatible',
  baseUrl: 'https://mock.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
}

/** 一条 trace 事件（形状与引擎落进 save.events 的一致） */
function traceEvent(nodeId, turn, over = {}) {
  return {
    type: 'trace',
    text: nodeId,
    at: AT,
    detail: {
      nodeId,
      nodeName: nodeId,
      nodeType: 'normal',
      presetId: 'p-mock',
      prompt: `PROMPT ${nodeId}`,
      thinking: '',
      toolCalls: [],
      attempts: [],
      output: '',
      usage: null,
      durationMs: 1,
      tps: null,
      turn,
      ...over,
    },
  }
}

/** 一条 turnStats 事件 */
function statsEvent(turn) {
  return {
    type: 'turnStats',
    text: `turn ${turn}`,
    at: AT,
    detail: { turn, totalMs: 1, usage: null, tps: null },
  }
}

/** 一份合法的 failedTurn（默认带 nextStep；单测已覆盖可选性，这里只造界面需要的形状） */
function failedTurn(over = {}) {
  return {
    action: 'act failed',
    at: AT,
    error: { code: 'E_PROVIDER', message: '鉴权失败', nextStep: '去设置里检查 Key' },
    events: [],
    text: '',
    ...over,
  }
}

/** 种一份存档并打开对话页；`nodeModels` 只在需要时写 */
async function openSeeded(page, { card, save, presets = [MOCK_PRESET], nodeModels, debug = false }) {
  const storage = {
    [KEYS.cards]: [card],
    [KEYS.saves]: [save],
    [KEYS.presets]: presets,
  }
  if (nodeModels) storage[KEYS.nodeModels] = nodeModels
  await boot(page, { storage })
  // 不走 `openStory()`：那份助手用 `[data-story]` strict mode，本票正好要钉「这个钩子全页唯一」
  await page.goto(`${APP_PATH}${debug ? '?debug=1' : ''}${route.play(card.id, save.id)}`)
  await expect(page.locator('[data-page="play"]')).toBeVisible()
  await expect(page.locator('[data-story]'), '失败卡的读数不许再嵌一个 [data-story]').toHaveCount(1)
}

/** 服务商 401（英文原文可以进 detail，但不许成为玩家看到的那一句） */
function unauthorized(intercepted) {
  return intercepted.fulfill({
    status: 401,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: { message: 'Invalid API key provided', type: 'invalid_request_error' } }),
  })
}

test.describe('失败回合 · 调试卡与刷新（种子存档）', () => {
  test('E1 非调试不显示；打开调试 ⇒ action / 错误 / nextStep / 半截正文 / trace + turnStats 都在；输入框预填', async ({
    page,
  }) => {
    const card = makeCard()
    const save = makeSave(card, {
      turn: 2,
      events: turnEvents(1, 'past action', 'past narration'),
      failedTurn: failedTurn({
        action: 'act failed',
        text: 'PARTIAL_TEXT',
        events: [traceEvent('check', 3), statsEvent(3)],
      }),
    })
    await openSeeded(page, { card, save })

    // 刷新 / 重开：行动从存档回到输入框（这一条在基线是红的）
    await expect(page.locator('[data-turn]')).toHaveText('2')
    await expect(page.locator('[data-action-input]')).toHaveValue('act failed')

    // 非调试：卡片不存在（守卫）
    await expect(page.locator('[data-failed-turn]')).toHaveCount(0)

    await page.locator('[data-debug-toggle]').click()
    const failedCard = page.locator('[data-failed-turn]')
    await expect(failedCard).toHaveCount(1)
    await expect(page.locator('[data-story]'), '卡片出现后故事流钩子仍然只有一个').toHaveCount(1)
    await expect(page.locator('[data-failed-action]')).toHaveText('act failed')
    await expect(page.locator('[data-failed-error]')).toContainText('E_PROVIDER')
    await expect(page.locator('[data-failed-error]')).toContainText('鉴权失败')
    await expect(page.locator('[data-failed-error]')).toHaveText(CJK)
    await expect(page.locator('[data-failed-next]')).toHaveText('去设置里检查 Key')
    await expect(page.locator('[data-failed-text]')).toHaveText('PARTIAL_TEXT')

    // 卡内的 trace / turnStats 复用故事流同一套钩子（作用域限定在卡里）
    await expect(
      page.locator('[data-failed-turn] [data-trace][data-trace-node="check"][data-trace-turn="3"]'),
    ).toHaveCount(1)
    await expect(page.locator('[data-failed-turn] [data-turn-stats][data-turn-stats-turn="3"]')).toHaveCount(
      1,
    )

    // 卡片不改变故事流本身
    await expect(page.locator('[data-line="action"]')).toHaveCount(1)
    await expect(page.locator('[data-line="action"]')).toHaveText('past action')
    await expect(page.locator('[data-line="narration"]')).toHaveCount(1)
  })
})

test.describe('失败回合 · 真 provider 401', () => {
  test('E2 turn / tree / events 不动，只落 failedTurn；输入框恢复、调试卡可见；刷新后盘上逐字不变', async ({
    page,
  }) => {
    const card = makeCard()
    const base = makeSave(card, { turn: 1, events: turnEvents(1, 'past action', 'past narration') })
    const treeBefore = JSON.parse(JSON.stringify(base.tree))
    const eventsBefore = JSON.parse(JSON.stringify(base.events))
    // 前三个节点走 mock（成功、各落一条 trace），output 节点走真 provider ⇒ 401
    const nodeModels = {
      [CARD_ID]: {
        time: MOCK_PRESET.id,
        check: MOCK_PRESET.id,
        extra: MOCK_PRESET.id,
        output: REAL_PRESET.id,
      },
    }
    await page.route('**/chat/completions', unauthorized)
    await openSeeded(page, {
      card,
      save: base,
      presets: [MOCK_PRESET, REAL_PRESET],
      nodeModels,
      debug: true,
    })

    const input = page.locator('[data-action-input]')
    await input.fill('act failed')
    await page.locator('[data-send]').click()
    await expect(page.locator('[data-error-code]')).toHaveText('E_PROVIDER')
    await expect(page.locator('[data-stop]')).toHaveCount(0)

    // 回合数 / 输入框 / 故事流：停在失败前
    await expect(page.locator('[data-turn]')).toHaveText('1')
    await expect(input).toBeEnabled()
    await expect(input).toHaveValue('act failed')
    await expect(page.locator('[data-line="action"]')).toHaveCount(1)
    await expect(page.locator('[data-line="action"]')).toHaveText('past action')

    // 调试卡：错误码 + 中文人话；半截正文为空 ⇒ 不画空框；前三个节点的 trace 都在
    await expect(page.locator('[data-failed-turn]')).toHaveCount(1)
    await expect(page.locator('[data-story]'), '失败卡不许再造一个 [data-story]').toHaveCount(1)
    await expect(page.locator('[data-failed-action]')).toHaveText('act failed')
    await expect(page.locator('[data-failed-error]')).toContainText('E_PROVIDER')
    await expect(page.locator('[data-failed-error]')).toHaveText(CJK)
    await expect(page.locator('[data-failed-next]')).toHaveText(CJK)
    await expect(page.locator('[data-failed-text]')).toHaveCount(0)
    await expect(page.locator('[data-failed-turn] [data-trace]')).toHaveCount(3)

    const stored = (await readStorage(page, KEYS.saves))[0]
    expect(stored.turn, 'turn 不许 +1').toBe(1)
    expect(stored.tree, '这次尝试写进去的 tree 一个都不许留下').toEqual(treeBefore)
    expect(stored.events, '失败回合一事件都不许并进事件流').toEqual(eventsBefore)
    expect(stored.failedTurn, '失败槽要落盘').toBeTruthy()
    expect(stored.failedTurn.action).toBe('act failed')
    expect(stored.failedTurn.text, '401 在第一个 chunk 之前失败').toBe('')
    expect(stored.failedTurn.error.code).toBe('E_PROVIDER')
    expect(stored.failedTurn.error.message).toMatch(CJK)
    expect(stored.failedTurn.error.nextStep).toMatch(CJK)
    expect(Number.isNaN(Date.parse(stored.failedTurn.at)), 'at 要是可解析的时间').toBe(false)

    const failedEvents = stored.failedTurn.events ?? []
    expect(Array.isArray(failedEvents), 'events 是数组').toBe(true)
    expect(
      failedEvents.some((event) => event.type === 'action'),
      '失败行动不进调试事件',
    ).toBe(false)
    const traces = failedEvents.filter((event) => event.type === 'trace')
    expect(traces.map((event) => event.detail.nodeId)).toEqual(['time', 'check', 'extra'])
    for (const trace of traces) expect(trace.detail.turn, 'trace 属于尝试中的那一回合').toBe(2)
    expect(
      failedEvents.filter((event) => event.type === 'turnStats'),
      '一回合没跑完没有合计行',
    ).toEqual([])

    // 刷新：数字 / 输入框 / 卡片 / 读数都还在，盘上那份存档逐字不变
    await page.reload()
    await expect(page.locator('[data-page="play"]')).toBeVisible()
    await expect(page.locator('[data-turn]')).toHaveText('1')
    await expect(page.locator('[data-action-input]')).toHaveValue('act failed')
    await expect(page.locator('[data-failed-turn]')).toHaveCount(1)
    await expect(page.locator('[data-failed-turn] [data-trace]')).toHaveCount(3)
    expect(await readStorage(page, KEYS.saves), '页面加载不许回写存档').toEqual([stored])
  })
})

test.describe('失败回合 · 重发', () => {
  test('E3 重发再失败：旧槽被整体替换（action / text / trace 都是新的），turn / tree / events 不动', async ({
    page,
  }) => {
    const card = makeCard()
    const base = makeSave(card, {
      turn: 1,
      events: turnEvents(1, 'past action', 'past narration'),
      failedTurn: failedTurn({
        action: 'old action',
        text: 'OLD_PARTIAL',
        error: { code: 'E_PROVIDER', message: '旧的错误' },
        events: [traceEvent('old-node', 1)],
      }),
    })
    const treeBefore = JSON.parse(JSON.stringify(base.tree))
    const eventsBefore = JSON.parse(JSON.stringify(base.events))
    await page.route('**/chat/completions', unauthorized)
    // 所有节点都走真 provider ⇒ 第一个节点就 401，这次失败没有 trace
    await openSeeded(page, {
      card,
      save: base,
      presets: [MOCK_PRESET, REAL_PRESET],
      nodeModels: { [CARD_ID]: nodeModelsFor(card, REAL_PRESET.id) },
      debug: true,
    })

    await expect(page.locator('[data-action-input]')).toHaveValue('old action')
    await page.locator('[data-action-input]').fill('new action')
    await page.locator('[data-send]').click()
    await expect(page.locator('[data-error-code]')).toHaveText('E_PROVIDER')
    await expect(page.locator('[data-stop]')).toHaveCount(0)

    // 界面上只有一张卡，而且是新的那句；旧的半截正文与旧 trace 都不在
    await expect(page.locator('[data-failed-turn]')).toHaveCount(1)
    await expect(page.locator('[data-story]'), '失败卡不许再造一个 [data-story]').toHaveCount(1)
    await expect(page.locator('[data-failed-action]')).toHaveText('new action')
    await expect(page.locator('[data-failed-text]')).toHaveCount(0)
    await expect(page.locator('[data-failed-turn]')).not.toContainText('OLD_PARTIAL')
    await expect(page.locator('[data-failed-turn] [data-trace][data-trace-node="old-node"]')).toHaveCount(0)

    const stored = (await readStorage(page, KEYS.saves))[0]
    expect(Array.isArray(stored.failedTurn), '失败槽是一个对象，不是一个数组').toBe(false)
    expect(stored.failedTurn.action).toBe('new action')
    expect(stored.failedTurn.text, '旧半截正文不许残留').toBe('')
    expect(stored.failedTurn.error.code).toBe('E_PROVIDER')
    expect(stored.failedTurn.error.message).toMatch(CJK)
    const failedEvents = stored.failedTurn.events ?? []
    expect(
      failedEvents.some((event) => event.type === 'trace' && event.detail?.nodeId === 'old-node'),
      '旧 trace 被新一批读数替换',
    ).toBe(false)
    expect(stored.turn).toBe(1)
    expect(stored.tree).toEqual(treeBefore)
    expect(stored.events).toEqual(eventsBefore)
  })

  test('E4 重发成功：失败槽被删掉（不是留空对象），turn +1，输入框清空，调试开着也没有卡片', async ({
    page,
  }) => {
    const card = makeCard()
    const base = makeSave(card, {
      turn: 1,
      events: turnEvents(1, 'past action', 'past narration'),
      failedTurn: failedTurn({
        action: 'old action',
        text: 'OLD_PARTIAL',
        events: [traceEvent('old-node', 1)],
      }),
    })
    let mode = 'fail'
    await page.route('**/chat/completions', (intercepted) => {
      if (mode === 'fail') return unauthorized(intercepted)
      return intercepted.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: openAiSse(['OK']),
      })
    })
    await openSeeded(page, {
      card,
      save: base,
      presets: [MOCK_PRESET, REAL_PRESET],
      nodeModels: { [CARD_ID]: nodeModelsFor(card, REAL_PRESET.id) },
      debug: true,
    })

    const input = page.locator('[data-action-input]')
    await expect(input).toHaveValue('old action')
    mode = 'ok'
    await page.locator('[data-send]').click()
    await expect(page.locator('[data-turn]')).toHaveText('2')
    await expect(page.locator('[data-stop]')).toHaveCount(0)

    await expect(input).toHaveValue('')
    await expect(page.locator('[data-failed-turn]'), '调试开着也不许再有失败卡').toHaveCount(0)
    await expect(page.locator('[data-story]')).toHaveCount(1)
    await expect(page.locator('[data-line="action"]')).toHaveCount(2)
    await expect(page.locator('[data-line="narration"]')).toHaveCount(2)

    const stored = (await readStorage(page, KEYS.saves))[0]
    expect(stored.turn).toBe(2)
    expect('failedTurn' in stored, '成功回合不带这一格（不是 failedTurn: null）').toBe(false)
    expect(stored.failedTurn).toBeUndefined()
    expect(stored.events.length).toBeGreaterThan(2)
  })
})
