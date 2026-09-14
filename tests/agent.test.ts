/**
 * agent 循环测试 —— 项目的灵魂，此前 0% 覆盖。
 *
 * 用假 fetch 精确控制「模型每步返回什么」，验证：
 *   循环直到模型不再调工具、工具结果回传、事件序列、兜底补写、落盘。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameState } from '../src/core/state'
import { createInitialState, loadState } from '../src/core/persistence'
import { runTurn } from '../src/core/agent'
import { saveConfig } from '../src/core/config'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'
import type { AgentEvent } from '../src/core/agent'

const 工具块 = (args: string) =>
  '```tool\n{"tool":"advance_time","args":' + args + '}\n```'

let fake: FakeLlm

beforeEach(() => {
  // agent 依赖配置里的 maxAgentSteps/temperature 等
  saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://example.test/v1', model: 'm', maxAgentSteps: 5 })
})

afterEach(() => {
  fake?.restore()
  vi.restoreAllMocks()
})

function freshState() {
  return new GameState(createInitialState())
}

describe('runTurn —— 主要路径', () => {
  it('模型一次说清（无工具调用）→ 一步结束', async () => {
    fake = installFakeLlm(['雨停了。'])
    const state = freshState()
    const events: AgentEvent[] = []

    const result = await runTurn(state, {
      action: '看看窗外',
      onEvent: (e) => events.push(e),
    })

    expect(result.steps).toBe(1)
    expect(result.text).toBe('雨停了。')
    expect(result.toolResults).toEqual([])
    expect(fake.calls).toHaveLength(1)
    expect(events.filter((e) => e.type === 'narration')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'thinking')).toHaveLength(1)
  })

  it('模型先调工具再收尾 → 循环两步，且工具结果回传给模型', async () => {
    fake = installFakeLlm([
      '你等了很久。\n' + 工具块('{"step":1,"unit":"week","reason":"等了七天"}'),
      '七天后，风终于停了。',
    ])
    const state = freshState()
    const before = Date.parse(state.iso)
    const events: AgentEvent[] = []

    const result = await runTurn(state, { action: '等七天', onEvent: (e) => events.push(e) })

    expect(result.steps).toBe(2)
    // 时间真的推进了 7 天
    expect(Date.parse(state.iso) - before).toBe(7 * 86400000)
    // 第二步请求里带上了工具执行结果（回传）
    const 第二步 = JSON.stringify(fake.calls[1].body.messages)
    expect(第二步).toContain('工具的实际执行结果')
    expect(第二步).toContain('时间推进')
    expect(events.some((e) => e.type === 'tool' && e.tool === 'advance_time')).toBe(true)
    expect(events.some((e) => e.type === 'toolResult')).toBe(true)
  })

  it('叙事与行动都写进日志，供刷新后恢复', async () => {
    fake = installFakeLlm(['第一段。', '第二段。'])
    const state = freshState()
    await runTurn(state, { action: '我推门进去' })

    const kinds = state.data.log.map((l) => l.kind)
    expect(kinds).toContain('action')
    expect(kinds).toContain('narration')
    expect(state.data.log.find((l) => l.kind === 'action')?.text).toBe('我推门进去')
    expect(state.data.log.find((l) => l.kind === 'narration')?.text).toContain('第一段。')
  })

  it('回合数 +1 并落盘（刷新后能读回来）', async () => {
    fake = installFakeLlm(['写完了。'])
    const state = freshState()
    await runTurn(state, { action: '做点什么' })

    expect(state.turn).toBe(1)
    const 重新读 = new GameState(loadState().data!)
    expect(重新读.turn).toBe(1)
    expect(重新读.data.log.at(-1)?.text).toContain('写完了。')
  })

  it('把本回合叙事带进历史，供下一回合拼接', async () => {
    fake = installFakeLlm(['带到历史里的文字。'])
    const state = freshState()
    const r = await runTurn(state, { action: '第一步' })

    expect(r.history).toHaveLength(2)
    expect(r.history[0].role).toBe('user')
    expect(r.history[1]).toMatchObject({ role: 'assistant' })
    expect(r.history[1].content).toContain('带到历史里的文字。')

    // 下一回合的请求里应该能看到上一回合的叙事
    fake.restore()
    fake = installFakeLlm(['继续。'])
    await runTurn(state, { action: '第二步', history: r.history })
    const 第二回合请求 = JSON.stringify(fake.calls[0].body.messages)
    expect(第二回合请求).toContain('带到历史里的文字。')
  })
})

describe('runTurn —— 兜底与边界', () => {
  it('模型把所有步数都花在调工具上 → 强制补写一次叙事', async () => {
    // 关键：**每一步都带工具块**，循环才会耗尽步数、一次叙事都没产生。
    // 如果某一步只回文字，循环就直接结束了 —— 那测的是正常路径，不是兜底。
    fake = installFakeLlm([
      工具块('{"step":1}'),   // 第 1 步
      工具块('{"step":1}'),   // 第 2 步
      工具块('{"step":1}'),   // 第 3 步
      工具块('{"step":1}'),   // 第 4 步
      工具块('{"step":1}'),   // 第 5 步（maxAgentSteps=5，到此耗尽）
      '补写的场景描写。',       // 第 6 次：兜底请求
    ])
    const state = freshState()
    const events: AgentEvent[] = []

    const result = await runTurn(state, { action: '等一下', onEvent: (e) => events.push(e) })

    expect(fake.calls).toHaveLength(6)
    expect(result.text).toBe('补写的场景描写。')
    expect(result.steps).toBe(5)

    // 兜底请求里必须**明确禁止它再调工具**，否则它会接着调工具、又一次没有叙事
    const 兜底消息 = fake.calls[5].body.messages ?? []
    const 最后一条 = 兜底消息.at(-1)?.content ?? ''
    expect(最后一条).toContain('请**只写叙事**')
    expect(最后一条).toContain('不要再调用任何工具')

    // 玩家要能看到「达到步数上限」和「正在补写」
    expect(events.some((e) => e.type === 'warn' && e.message.includes('步数上限'))).toBe(true)
    expect(events.some((e) => e.type === 'warn' && e.message.includes('叙事文字'))).toBe(true)

    // 补写的内容进日志（刷新后能看到）
    expect(state.data.log.at(-1)?.text).toContain('补写的场景描写。')
  })

  it('补写仍然没文字 → 警告，且不写入空叙事', async () => {
    // 注意：第一步必须**带工具块**才会走到补写那条腿 ——
    // 没有工具块时循环直接 break，走的是「模型只说了一句话」的正常路径
    fake = installFakeLlm([工具块('{"step":1}'), '   '])
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

    await expect(
      runTurn(state, { action: '晚了', signal: controller.signal }),
    ).rejects.toThrow(/已取消/)
    expect(fake.calls).toHaveLength(0)
  })

  it('网络错误会抛出去（不吞），并且不产生回合数增量', async () => {
    fake = installFakeLlm(['x'])
    fake.failNextWith(new Error('网络断了'))
    const state = freshState()

    await expect(runTurn(state, { action: '试试' })).rejects.toThrow('网络断了')
    expect(state.turn).toBe(0)
  })

  it('空参数的工具调用走默认单位（segment）', async () => {
    fake = installFakeLlm([
      '过了半个下午。\n' + 工具块('{}'),
      '天黑了。',
    ])
    const state = freshState()
    const before = Date.parse(state.iso)
    await runTurn(state, { action: '待一下' })
    expect(Date.parse(state.iso) - before).toBe(4 * 3600000)
  })
})
