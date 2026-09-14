/**
 * agent 循环测试 —— 项目的灵魂。
 *
 * ⚠️ 2026-09-14 起走**原生 tool calling**：模型在协议层声明工具调用，
 * 我们不再解析文本。所以这里断言的重点是：
 *   - 循环是否正确处理 tool_calls / 工具结果回传（role:'tool' + tool_call_id）
 *   - 出错时是否把结构化错误回传给模型（而不是自己纠正）
 *   - 补写那一步是否**不给工具**（协议层保证它写不了工具调用）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameState } from '../src/core/state'
import { createInitialState, loadState } from '../src/core/persistence'
import { runTurn, type AgentEvent } from '../src/core/agent'
import { saveConfig } from '../src/core/config'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

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

function freshState() {
  return new GameState(createInitialState())
}

/** 造一次 advance_time 的协议层调用 */
function advanceCall(args: string) {
  return { name: 'advance_time', arguments: args }
}

describe('runTurn —— 主要路径', () => {
  it('模型一次说清（无工具调用）→ 一步结束', async () => {
    fake = installFakeLlm(['雨停了。'])
    const state = freshState()
    const events: AgentEvent[] = []

    const result = await runTurn(state, { action: '看看窗外', onEvent: (e) => events.push(e) })

    expect(result.steps).toBe(1)
    expect(result.text).toBe('雨停了。')
    expect(result.toolResults).toEqual([])
    expect(fake.calls).toHaveLength(1)
    // 请求里带了工具声明（协议契约）
    expect(fake.calls[0].body.tools).toBeDefined()
    expect(events.filter((e) => e.type === 'narration')).toHaveLength(1)
  })

  it('模型先调工具再收尾 → 循环两步，时间真的推进', async () => {
    fake = installFakeLlm([
      { content: '你等了很久。', toolCalls: [advanceCall('{"step":1,"unit":"week","reason":"等了七天"}')] },
      '七天后，风终于停了。',
    ])
    const state = freshState()
    const before = Date.parse(state.iso)
    const events: AgentEvent[] = []

    const result = await runTurn(state, { action: '等七天', onEvent: (e) => events.push(e) })

    expect(result.steps).toBe(2)
    expect(Date.parse(state.iso) - before).toBe(7 * 86400000)
    expect(events.some((e) => e.type === 'tool' && e.tool === 'advance_time')).toBe(true)
    expect(events.some((e) => e.type === 'toolResult')).toBe(true)
  })

  it('⚠️ 工具结果以 role:"tool" + tool_call_id 回传（协议要求，否则模型对不上）', async () => {
    fake = installFakeLlm([{ content: '等了一会儿。', toolCalls: [advanceCall('{"step":1}')] }, '天黑了。'])
    const state = freshState()
    await runTurn(state, { action: '等一下' })

    const secondRoundMessages = fake.calls[1].body.messages ?? []
    const assistant = secondRoundMessages.find((m) => m.role === 'assistant' && m.tool_calls?.length)
    const toolMsg = secondRoundMessages.find((m) => m.role === 'tool')

    expect(assistant?.tool_calls?.[0].function.name).toBe('advance_time')
    expect(toolMsg).toBeDefined()
    // id 必须与那次调用一致
    expect(toolMsg?.tool_call_id).toBe(assistant?.tool_calls?.[0].id)
    expect(toolMsg?.content).toContain('时间推进')
  })

  it('叙事与行动都写进日志，供刷新后恢复', async () => {
    fake = installFakeLlm(['第一段。', '第二段。'])
    const state = freshState()
    await runTurn(state, { action: '我推门进去' })

    const kinds = state.data.log.map((l) => l.kind)
    expect(kinds).toContain('action')
    expect(kinds).toContain('narration')
    expect(state.data.log.find((l) => l.kind === 'action')?.text).toBe('我推门进去')
  })

  it('turn +1 并落盘（刷新后能读回来）', async () => {
    fake = installFakeLlm(['写完了。'])
    const state = freshState()
    await runTurn(state, { action: '做点什么' })

    expect(state.turn).toBe(1)
    const reloaded = new GameState(loadState().data!)
    expect(reloaded.turn).toBe(1)
  })

  it('把本回合叙事带进历史，供下一回合拼接', async () => {
    fake = installFakeLlm(['带到历史里的文字。'])
    const state = freshState()
    const r = await runTurn(state, { action: '第一步' })

    expect(r.history).toHaveLength(2)
    expect(r.history[1].content).toContain('带到历史里的文字。')

    fake.restore()
    fake = installFakeLlm(['继续。'])
    await runTurn(state, { action: '第二步', history: r.history })
    expect(JSON.stringify(fake.calls[0].body.messages)).toContain('带到历史里的文字。')
  })
})

describe('runTurn —— 把错误交回模型（不自己兜）', () => {
  it('单位不认识 → 错误作为工具结果回传，模型可以重试', async () => {
    fake = installFakeLlm([
      { content: '过了很久。', toolCalls: [advanceCall('{"step":1,"unit":"光年"}')] },
      '这次对了。',
    ])
    const state = freshState()
    const before = Date.parse(state.iso)

    const result = await runTurn(state, { action: '等一等' })

    // 时间**没有**被推进（引擎不猜）
    expect(Date.parse(state.iso)).toBe(before)
    // 但错误进了工具结果，模型看得到
    expect(result.toolResults[0]).toContain('Unknown time unit')
    const toolMsg = (fake.calls[1].body.messages ?? []).find((m) => m.role === 'tool')
    expect(toolMsg?.content).toContain('Unknown time unit')
  })

  it('参数不是合法 JSON → 同样回传错误而不是崩掉', async () => {
    fake = installFakeLlm([{ content: '等等。', toolCalls: [advanceCall('{坏掉的')] }, '好。'])
    const state = freshState()
    const result = await runTurn(state, { action: '等' })

    expect(result.toolResults[0]).toContain('不是合法 JSON')
    expect(state.turn).toBe(1) // 回合正常结束
  })
})

describe('runTurn —— 兜底与边界', () => {
  it('模型把步数全花在调工具上 → 补写，且补写那一步**不给工具**', async () => {
    // 每一步都带工具调用，循环才会耗尽步数、一次叙事都没产生
    const toolInvocation = { toolCalls: [advanceCall('{"step":1}')] }
    fake = installFakeLlm([
      toolInvocation,
      toolInvocation,
      toolInvocation,
      toolInvocation,
      toolInvocation,
      '补写的场景描写。',
    ])
    const state = freshState()
    const events: AgentEvent[] = []

    const result = await runTurn(state, { action: '等一下', onEvent: (e) => events.push(e) })

    expect(result.steps).toBe(5)
    expect(result.text).toBe('补写的场景描写。')
    // ⚠️ 关键：补写那一次请求不能带 tools（协议层保证它写不了工具调用）
    expect(fake.calls).toHaveLength(6)
    expect(fake.calls[5].body.tools).toBeUndefined()
    expect(events.some((e) => e.type === 'warn' && e.message.includes('步数上限'))).toBe(true)
    expect(state.data.log.at(-1)?.text).toContain('补写的场景描写。')
  })

  it('补写仍然没文字 → 警告，且不写入空叙事', async () => {
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

    const result = await runTurn(state, { action: '等一下', onEvent: (e) => events.push(e) })

    expect(result.text).toBe('')
    expect(events.some((e) => e.type === 'warn' && e.message.includes('依然没有输出文字'))).toBe(true)
    expect(state.data.log.some((l) => l.kind === 'narration')).toBe(false)
  })

  it('开工前已经取消 → 抛 AbortError，且不写日志', async () => {
    fake = installFakeLlm(['不该被用到的回复'])
    const state = freshState()
    const controller = new AbortController()
    controller.abort()

    await expect(runTurn(state, { action: '晚了', signal: controller.signal })).rejects.toThrow(/已取消/)
    expect(fake.calls).toHaveLength(0)
  })

  it('网络错误会抛出去（不吞），并且不产生回合数增量', async () => {
    fake = installFakeLlm(['x'])
    fake.failNextWith(new Error('网络断了'))
    const state = freshState()

    await expect(runTurn(state, { action: '试试' })).rejects.toThrow('网络断了')
    expect(state.turn).toBe(0)
  })

  it('空参数的工具调用走默认单位（segment = 4 小时）', async () => {
    fake = installFakeLlm([{ content: '过了半个下午。', toolCalls: [advanceCall('{}')] }, '天黑了。'])
    const state = freshState()
    const before = Date.parse(state.iso)
    await runTurn(state, { action: '待一下' })
    expect(Date.parse(state.iso) - before).toBe(4 * 3600000)
  })

  it('可以覆盖可用工具（传空数组 = 模型没有工具可用）', async () => {
    fake = installFakeLlm(['只写故事。'])
    const state = freshState()
    await runTurn(state, { action: '看看', tools: [] })
    expect(fake.calls[0].body.tools).toBeUndefined()
  })
})
