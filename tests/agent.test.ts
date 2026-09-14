/**
 * agent 循环测试 —— 项目的灵魂。
 *
 * ⚠️ 2026-09-14 起走**原生 tool calling**：模型在协议层声明工具调用，
 * 我们不再解析文本。所以这里断言的重点是：
 *   - 循环是否正确处理 tool_calls / 工具结果回传（role:'tool' + tool_call_id）
 *   - 出错时是否把结构化错误回传给模型（而不是自己纠正）
 *   - 补写那一步是否**不给工具**（协议层保证它写不了工具调用）
 *
 * Message assertions go through t('key') so they keep proving the right locale key
 * is wired; fixtures are ASCII constants so this file stays ASCII-only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameState } from '../src/game/GameState'
import { createInitialState } from '../src/game/save'
import { runTurn, type AgentEvent } from '../src/agent/agent'
import { saveConfig } from '../src/agent/config'
import { i18n, t } from '../src/i18n'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

/** ASCII fixtures: what the fake model "writes" and what the player "types" */
const REPLY_PLAIN = 'The rain has stopped.'
const REPLY_AFTER_WAIT = 'The wind finally died down.'
const REPLY_WAITING = 'You wait for a long while.'
const REPLY_NIGHT = 'It is dark now.'
const REPLY_ONE = 'First paragraph.'
const REPLY_TWO = 'Second paragraph.'
const REPLY_HISTORY = 'Text carried into the history.'
const REPLY_CONTINUE = 'Continuing.'
const REPLY_FORCED = 'The scene, written afterwards.'
const REPLY_UNUSED = 'reply that must not be used'
const ACTION_LOOK_OUT = 'look out the window'
const ACTION_WAIT_WEEK = 'wait a week'
const ACTION_WAIT = 'wait a bit'
const ACTION_ENTER = 'I push the door open'
const ACTION_SOMETHING = 'do something'
const ACTION_STEP_ONE = 'first step'
const ACTION_STEP_TWO = 'second step'
const ACTION_LATE = 'too late'
const ACTION_TRY = 'try it'

let fake: FakeLlm

beforeEach(() => {
  // agent 依赖配置里的 maxAgentSteps/temperature 等
  saveConfig({
    provider: 'custom',
    apiKey: 'k',
    apiBase: 'https://example.test/v1',
    model: 'm',
    maxAgentSteps: 5,
  })
})

afterEach(() => {
  fake?.restore()
  vi.restoreAllMocks()
})

/** 每个用例一个干净状态 */
function freshState() {
  return new GameState(createInitialState())
}

/** 造一次 advance_time 的协议层调用 */
function advanceCall(args: string) {
  return { name: 'advance_time', arguments: args }
}

describe('runTurn -- main path', () => {
  it('a single reply with no tool call ends the turn in one step', async () => {
    fake = installFakeLlm([REPLY_PLAIN])
    const state = freshState()
    const events: AgentEvent[] = []

    const result = await runTurn(state, { action: ACTION_LOOK_OUT, onEvent: (e) => events.push(e) })

    expect(result.steps).toBe(1)
    expect(result.text).toBe(REPLY_PLAIN)
    expect(result.toolResults).toEqual([])
    expect(fake.calls).toHaveLength(1)
    // 请求里带了工具声明（协议契约）
    expect(fake.calls[0].body.tools).toBeDefined()
    expect(events.filter((e) => e.type === 'narration')).toHaveLength(1)
  })

  it('tool call then finishing reply loops twice and really advances time', async () => {
    fake = installFakeLlm([
      {
        content: REPLY_WAITING,
        toolCalls: [advanceCall('{"step":1,"unit":"week","reason":"waited seven days"}')],
      },
      REPLY_AFTER_WAIT,
    ])
    const state = freshState()
    const before = Date.parse(state.iso)
    const events: AgentEvent[] = []

    const result = await runTurn(state, { action: ACTION_WAIT_WEEK, onEvent: (e) => events.push(e) })

    expect(result.steps).toBe(2)
    expect(Date.parse(state.iso) - before).toBe(7 * 86400000)
    expect(events.some((e) => e.type === 'tool' && e.tool === 'advance_time')).toBe(true)
    expect(events.some((e) => e.type === 'toolResult')).toBe(true)
  })

  it('tool results go back as role:"tool" with a matching tool_call_id', async () => {
    fake = installFakeLlm([{ content: REPLY_WAITING, toolCalls: [advanceCall('{"step":1}')] }, REPLY_NIGHT])
    const state = freshState()
    await runTurn(state, { action: ACTION_WAIT })

    const secondRoundMessages = fake.calls[1].body.messages ?? []
    const assistant = secondRoundMessages.find((m) => m.role === 'assistant' && m.tool_calls?.length)
    const toolMsg = secondRoundMessages.find((m) => m.role === 'tool')

    expect(assistant?.tool_calls?.[0].function.name).toBe('advance_time')
    expect(toolMsg).toBeDefined()
    // id 必须与那次调用一致
    expect(toolMsg?.tool_call_id).toBe(assistant?.tool_calls?.[0].id)
    // 结果里的时钟标记由 locale 表提供，本文件因此不必写非 ASCII 字符
    const messages = i18n.global.getLocaleMessage(i18n.global.locale.value) as {
      tools: Record<string, string>
    }
    expect(String(toolMsg?.content)).toContain(messages.tools.advanceResult.split('{')[0].trim())
  })

  it('narration and action are both logged so a refresh can restore them', async () => {
    fake = installFakeLlm([REPLY_ONE, REPLY_TWO])
    const state = freshState()
    await runTurn(state, { action: ACTION_ENTER })

    const kinds = state.data.log.map((l) => l.kind)
    expect(kinds).toContain('action')
    expect(kinds).toContain('narration')
    expect(state.data.log.find((l) => l.kind === 'action')?.text).toBe(ACTION_ENTER)
  })

  it('turn increments and is persisted (readable after a reload)', async () => {
    fake = installFakeLlm([REPLY_ONE])
    const state = new GameState({ storage: localStorage })
    await runTurn(state, { action: ACTION_SOMETHING })

    expect(state.turn).toBe(1)
    // 重新读档：持久化的是「引擎自己的存储」，不经存储层就别指望能读回来
    const reloaded = GameState.open(localStorage)
    expect(reloaded.turn).toBe(1)
  })

  it('this turn narration is carried into history for the next turn', async () => {
    fake = installFakeLlm([REPLY_HISTORY])
    const state = freshState()
    const r = await runTurn(state, { action: ACTION_STEP_ONE })

    expect(r.history).toHaveLength(2)
    expect(r.history[1].content).toContain(REPLY_HISTORY)

    fake.restore()
    fake = installFakeLlm([REPLY_CONTINUE])
    await runTurn(state, { action: ACTION_STEP_TWO, history: r.history })
    expect(JSON.stringify(fake.calls[0].body.messages)).toContain(REPLY_HISTORY)
  })
})

describe('runTurn -- errors are handed back to the model', () => {
  it('unknown unit: the error is returned as a tool result so the model can retry', async () => {
    fake = installFakeLlm([
      { content: REPLY_WAITING, toolCalls: [advanceCall('{"step":1,"unit":"lightyear"}')] },
      'That one worked.',
    ])
    const state = freshState()
    const before = Date.parse(state.iso)

    const result = await runTurn(state, { action: ACTION_WAIT })

    // 时间**没有**被推进（引擎不猜）
    expect(Date.parse(state.iso)).toBe(before)
    // 但错误进了工具结果，模型看得到
    expect(result.toolResults[0]).toContain('Unknown time unit')
    const toolMsg = (fake.calls[1].body.messages ?? []).find((m) => m.role === 'tool')
    expect(toolMsg?.content).toContain('Unknown time unit')
  })

  it('malformed JSON arguments are returned as an error instead of crashing', async () => {
    fake = installFakeLlm([{ content: 'waiting', toolCalls: [advanceCall('{"broken')] }, 'ok'])
    const state = freshState()
    const result = await runTurn(state, { action: 'wait' })

    expect(result.toolResults[0]).toContain('JSON')
    expect(state.turn).toBe(1) // 回合正常结束
  })
})

describe('runTurn -- fallbacks and boundaries', () => {
  it('when every step spends its budget on tools, narration is forced and tools are withheld', async () => {
    // 每一步都带工具调用，循环才会耗尽步数、一次叙事都没产生
    const toolInvocation = { toolCalls: [advanceCall('{"step":1}')] }
    fake = installFakeLlm([
      toolInvocation,
      toolInvocation,
      toolInvocation,
      toolInvocation,
      toolInvocation,
      REPLY_FORCED,
    ])
    const state = freshState()
    const events: AgentEvent[] = []

    const result = await runTurn(state, { action: ACTION_WAIT, onEvent: (e) => events.push(e) })

    expect(result.steps).toBe(5)
    expect(result.text).toBe(REPLY_FORCED)
    // ⚠️ 关键：补写那一次请求不能带 tools（协议层保证它写不了工具调用）
    expect(fake.calls).toHaveLength(6)
    expect(fake.calls[5].body.tools).toBeUndefined()
    expect(
      events.some(
        (e) => e.type === 'warn' && e.message.includes(t('agent.stepLimit', { max: 5 }).split('{')[0].trim()),
      ),
    ).toBe(true)
    expect(state.data.log.at(-1)?.text).toContain(REPLY_FORCED)
  })

  it('a still-empty forced narration warns and is not written as an empty entry', async () => {
    const toolInvocation = { toolCalls: [advanceCall('{"step":1}')] }
    fake = installFakeLlm([
      toolInvocation,
      toolInvocation,
      toolInvocation,
      toolInvocation,
      toolInvocation,
      '   ',
    ])
    const state = freshState()
    const events: AgentEvent[] = []

    const result = await runTurn(state, { action: ACTION_WAIT, onEvent: (e) => events.push(e) })

    expect(result.text).toBe('')
    expect(events.some((e) => e.type === 'warn' && e.message === t('agent.stillNoText'))).toBe(true)
    expect(state.data.log.some((l) => l.kind === 'narration')).toBe(false)
  })

  it('aborting before the loop throws AbortError and writes no log', async () => {
    fake = installFakeLlm([REPLY_UNUSED])
    const state = freshState()
    const controller = new AbortController()
    controller.abort()

    // The message is protocol-level ('aborted'); assert the name, not the text.
    await expect(runTurn(state, { action: ACTION_LATE, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fake.calls).toHaveLength(0)
  })

  it('a network error propagates (not swallowed) and does not bump the turn counter', async () => {
    fake = installFakeLlm([REPLY_UNUSED])
    fake.failNextWith(new Error('network down'))
    const state = freshState()

    await expect(runTurn(state, { action: ACTION_TRY })).rejects.toThrow('network down')
    expect(state.turn).toBe(0)
  })

  it('an empty-argument tool call uses the default unit (segment = 4 hours)', async () => {
    fake = installFakeLlm([
      { content: 'Half the afternoon went by.', toolCalls: [advanceCall('{}')] },
      REPLY_NIGHT,
    ])
    const state = freshState()
    const before = Date.parse(state.iso)
    await runTurn(state, { action: ACTION_WAIT })
    expect(Date.parse(state.iso) - before).toBe(4 * 3600000)
  })

  it('the available tools can be overridden (empty array means the model has none)', async () => {
    fake = installFakeLlm(['story only'])
    const state = freshState()
    await runTurn(state, { action: 'look', tools: [] })
    expect(fake.calls[0].body.tools).toBeUndefined()
  })
})
