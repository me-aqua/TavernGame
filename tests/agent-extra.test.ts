/**
 * 引擎的补充测试 —— tools.test.ts / graph.test.ts 拆掉之后，那些边界都收在这里。
 *
 * 重点：
 *   · minutes = 0 是合法的（这一轮时间没动）；
 *   · 协议层的坏参数（不是 JSON、引擎不认识的工具）回传给模型，不是抛错；
 *   · 只调工具不写字 → 一条 warn；一轮的四种调试事件都带上了面板要的原料；
 *   · **另一张卡**（cards/night-watch.json：两个节点、自定义历法）照样能跑 ——
 *     引擎不认卡，只认声明。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runTurn, type AgentEvent } from '../src/agent/agent'
import { availableActions } from '../src/game/card-actions'
import { createInitialState } from '../src/game/save'
import { clockIn } from '../src/game/card-time'
import { currentCard } from '../src/game/current-card'
import { t } from '../src/i18n'
import { loadCard, NIGHT_WATCH_CARD } from './support/card-fixtures'
import { configureFakeProvider, createAgentContext } from './support/game-fixtures'
import {
  cardPassReplies,
  cardTurnReplies,
  CARD_TOPOLOGY,
  redoCall,
  storyNodeOf,
  timeNodeOf,
} from './support/card-replies'
import { installFakeLlm, type FakeLlm, type FakeReply } from './support/fakeLlm'

/* ---- 测试自己编的 fixture，不是产品文案 ---- */
const PLAYER_ACTION = 'look around'
const STORY_TEXT = 'Rain on the window.'
const LOG_NAME = 'newcomer'
const BROKEN_ARGS = '{not json'
const UNKNOWN_TOOL = 'not_a_tool'

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

/** 用第一张能写状态的节点（update_role 在卡里只给了两个节点，取第一个） */
const CAST = CARD_TOPOLOGY.find((id) => availableActions(currentCard, id).includes('update_role')) as string
const STORY = storyNodeOf()

/** `update_role` 的 map 键参数叫什么 —— 段 3 之后作者起的键名是中文，从卡里现取 */
const ROLE_KEY = (currentCard.actions as Record<string, { key?: string }>).update_role.key as string

const TIME = timeNodeOf()

describe('advance_time with minutes = 0', () => {
  it('is legal: the clock stands still and the result says so', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_TEXT, time: { minutes: 0 } }))
    const ctx = createAgentContext()
    const before = { ...clockIn(ctx.data.state) }

    await runTurn(ctx, { action: PLAYER_ACTION })

    expect(clockIn(ctx.data.state)).toEqual(before)
    expect(ctx.data.timeline).toEqual([])
    const followUp = fake.calls[CARD_TOPOLOGY.indexOf(TIME) + 1].body.messages ?? []
    const result = followUp.find((message) => message.role === 'tool')
    expect(result?.content).toContain(String(0))
  })
})

describe('bad protocol input goes back to the model, never throws', () => {
  it('hands a JSON parse error back as the tool result', async () => {
    fake = installFakeLlm(
      cardTurnReplies({
        story: STORY_TEXT,
        node: (id) =>
          id === CAST
            ? [{ toolCalls: [{ name: 'update_role', arguments: BROKEN_ARGS }] }, 'cast done']
            : undefined,
      }),
    )
    const ctx = createAgentContext()
    await runTurn(ctx, { action: PLAYER_ACTION })

    const followUp = fake.calls[CARD_TOPOLOGY.indexOf(CAST) + 1].body.messages ?? []
    const result = followUp.find((message) => message.role === 'tool')
    // 回传的是 llm 层的「参数不是合法 JSON」提示，并原样带上模型给的那个字符串
    expect(result?.content.toLowerCase()).toContain('json')
    expect(result?.content).toContain(BROKEN_ARGS)
  })

  it('hands "unknown action" back as the tool result', async () => {
    fake = installFakeLlm(
      cardTurnReplies({
        story: STORY_TEXT,
        node: (id) =>
          id === CAST ? [{ toolCalls: [{ name: UNKNOWN_TOOL, arguments: '{}' }] }, 'cast done'] : undefined,
      }),
    )
    const ctx = createAgentContext()
    await runTurn(ctx, { action: PLAYER_ACTION })

    const followUp = fake.calls[CARD_TOPOLOGY.indexOf(CAST) + 1].body.messages ?? []
    expect(
      followUp.some((message) => message.role === 'tool' && message.content.includes(UNKNOWN_TOOL)),
    ).toBe(true)
  })

  it('refuses a redo target that is not an earlier node (no rollback happens)', async () => {
    const VERIFY = CARD_TOPOLOGY.find((id) => availableActions(currentCard, id).includes('redo')) as string
    fake = installFakeLlm(
      cardTurnReplies({
        story: STORY_TEXT,
        node: (id) => (id === VERIFY ? [redoCall('no-such-node', 'nope'), 'verified'] : undefined),
      }),
    )
    const ctx = createAgentContext()
    const events: AgentEvent[] = []
    const result = await runTurn(ctx, { action: PLAYER_ACTION, onEvent: (evt) => events.push(evt) })

    expect(result.text).toBe(STORY_TEXT)
    const followUp = fake.calls[CARD_TOPOLOGY.indexOf(VERIFY) + 1].body.messages ?? []
    expect(
      followUp.some((message) => message.role === 'tool' && message.content.includes('no-such-node')),
    ).toBe(true)
    // 被拒的 redo 在痕迹上是**失败**：面板靠这个 failed 标红，不靠「有没有写状态」反推
    // （成功的 redo 同样不写状态 —— 反推会把这一条一起放过）
    expect(events).toContainEqual({
      type: 'toolResult',
      node: VERIFY,
      tool: 'redo',
      result: expect.stringContaining('from must be one of'),
      failed: true,
    })
  })
})

describe('the debug events carry the raw material the panel needs', () => {
  it('request / model / tool / toolResult / stateChange are all reported', async () => {
    const writes = {
      toolCalls: [{ name: 'update_role', arguments: JSON.stringify({ [ROLE_KEY]: LOG_NAME }) }],
    } as FakeReply
    fake = installFakeLlm(
      cardPassReplies(CARD_TOPOLOGY, (id) => {
        if (id === STORY) return STORY_TEXT
        if (id === CAST) return [writes, 'cast done']
        return undefined
      }),
    )
    const ctx = createAgentContext()
    const events: Array<Record<string, unknown>> = []
    await runTurn(ctx, {
      action: PLAYER_ACTION,
      onEvent: (evt) => events.push(evt as unknown as Record<string, unknown>),
    })

    const kinds = events.map((event) => event.type)
    for (const kind of [
      'node',
      'thinking',
      'request',
      'model',
      'tool',
      'toolResult',
      'stateChange',
      'narration',
    ]) {
      expect(kinds, kind).toContain(kind)
    }
    // tool 带协议原样的参数 JSON；toolResult 带回传的结果；stateChange 带路径与值
    const tool = events.find((event) => event.type === 'tool')
    expect(tool?.args).toBe(JSON.stringify({ [ROLE_KEY]: LOG_NAME }))
    const toolResult = events.find((event) => event.type === 'toolResult')
    expect(String(toolResult?.result).length).toBeGreaterThan(0)
    const change = events.find((event) => event.type === 'stateChange')
    expect(change?.path).toBe('roles.' + LOG_NAME)
    expect(change?.value).toEqual({})
  })

  it('does not warn when the model writes text and calls a tool in the same step', async () => {
    const call: FakeReply = {
      content: 'let me check the clock',
      toolCalls: [{ name: 'advance_time', arguments: JSON.stringify({ minutes: 10 }) }],
    }
    fake = installFakeLlm(
      cardTurnReplies({ node: (id) => (id === timeNodeOf() ? [call, 'time checked'] : undefined) }),
    )
    const ctx = createAgentContext()
    const events: Array<Record<string, unknown>> = []
    await runTurn(ctx, {
      action: PLAYER_ACTION,
      onEvent: (evt) => events.push(evt as unknown as Record<string, unknown>),
    })

    expect(events.filter((evt) => evt.type === 'warn')).toEqual([])
    expect(clockIn(ctx.data.state)).not.toEqual(clockIn(createInitialState(currentCard).state))
  })

  it('warns when a step calls tools without writing any text', async () => {
    const call: FakeReply = {
      toolCalls: [{ name: 'update_role', arguments: JSON.stringify({ [ROLE_KEY]: LOG_NAME }) }],
    }
    fake = installFakeLlm(cardTurnReplies({ node: (id) => (id === CAST ? [call, 'cast done'] : undefined) }))
    const ctx = createAgentContext()
    const events: Array<Record<string, unknown>> = []
    await runTurn(ctx, {
      action: PLAYER_ACTION,
      onEvent: (evt) => events.push(evt as unknown as Record<string, unknown>),
    })

    const warn = events.find((event) => event.type === 'warn')
    expect(warn?.message).toBe(t('agent.toolsOnly', { step: CARD_TOPOLOGY.indexOf(CAST) + 1 }))
  })
})

describe('another card: the engine only reads declarations', () => {
  it('runs cards/night-watch.json (two nodes, its own calendar) end to end', async () => {
    const card = loadCard(NIGHT_WATCH_CARD)
    const state = { data: createInitialState(card), loadError: null }
    const ctx = createAgentContext(state, card)
    const minutes = 480
    fake = installFakeLlm(cardTurnReplies({ card, story: STORY_TEXT, time: { minutes } }))

    const emitted: AgentEvent[] = []
    const result = await runTurn(ctx, { action: PLAYER_ACTION, onEvent: (evt) => emitted.push(evt) })

    expect(result.text).toBe(STORY_TEXT)
    expect(state.data.events.map((event) => event.kind)).toEqual(['action', 'narration'])
    // 自定义历法真的生效：4 月 12 日 21:40 + 480 分钟 = 4 月 13 日 05:40
    expect(clockIn(state.data.state)).toEqual({ year: 1, month: 4, day: 13, hour: 5, minute: 40 })
    // 这张卡只声明了两个节点：模型只被问了两次（时间节点多一次工具往返）
    expect(fake.calls).toHaveLength(card.graph.topology.length + 1)
  })

  it('tags every tool event with the node id, the tool name and the written path', async () => {
    const card = loadCard(NIGHT_WATCH_CARD)
    const state = { data: createInitialState(card), loadError: null }
    const ctx = createAgentContext(state, card)
    const node = timeNodeOf(card)
    const minutes = 480
    fake = installFakeLlm(cardTurnReplies({ card, story: STORY_TEXT, time: { minutes } }))
    const emitted: AgentEvent[] = []

    await runTurn(ctx, { action: PLAYER_ACTION, onEvent: (evt) => emitted.push(evt) })

    // 调试面板要的三样（哪个节点、什么工具、写了哪条路径）都在事件本体上，不去反解文案
    expect(emitted.find((evt) => evt.type === 'tool')).toEqual({
      type: 'tool',
      node,
      tool: 'advance_time',
      args: JSON.stringify({ minutes, reason: '' }),
    })
    expect(emitted.find((evt) => evt.type === 'toolResult')).toMatchObject({
      node,
      tool: 'advance_time',
    })
    expect(emitted.find((evt) => evt.type === 'stateChange')).toEqual({
      type: 'stateChange',
      node,
      path: 'world.time',
      value: clockIn(state.data.state),
    })
  })
})
