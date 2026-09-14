/**
 * agent.ts 补充测试 —— 覆盖未走到的分支。
 *
 * 重点：存档写入失败时玩家必须收到警告（绝不静默）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameState } from '../src/core/state'
import { createInitialState } from '../src/core/persistence'
import { runTurn, type AgentEvent } from '../src/core/agent'
import { saveConfig } from '../src/core/config'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

let fake: FakeLlm | null = null

beforeEach(() => {
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
  fake = null
  vi.restoreAllMocks()
})

describe('存档失败必须出声', () => {
  it('save() 返回 false 时发出警告事件（而不是静默继续）', async () => {
    fake = installFakeLlm(['写完了。'])
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const state = new GameState(createInitialState())
    const events: AgentEvent[] = []
    await runTurn(state, { action: '做点什么', onEvent: (e) => events.push(e) })

    const warnings = events.filter((e) => e.type === 'warn')
    expect(warnings.some((w) => w.type === 'warn' && w.message.includes('存档写入失败'))).toBe(true)

    spy.mockRestore()
  })

  it('存档正常时不发这条警告', async () => {
    fake = installFakeLlm(['写完了。'])
    const state = new GameState(createInitialState())
    const events: AgentEvent[] = []
    await runTurn(state, { action: '做点什么', onEvent: (e) => events.push(e) })

    const warnings = events.filter((e) => e.type === 'warn')
    expect(warnings.some((w) => w.type === 'warn' && w.message.includes('存档写入失败'))).toBe(false)
  })
})

describe('开场分支（不传 action）', () => {
  it('用系统身份记日志，并用开场指令而不是「玩家的行动」', async () => {
    fake = installFakeLlm(['你在一间客栈里醒来。'])
    const state = new GameState(createInitialState())
    const events: AgentEvent[] = []

    const result = await runTurn(state, { onEvent: (e) => events.push(e) })

    expect(result.text).toContain('醒来')
    // 日志的第一条是 system（而非 action）
    expect(state.data.log[0].kind).toBe('system')
    // 发给模型的第一条 user 消息带【游戏开始】
    const firstUser = fake.calls[0].body.messages?.find((m) => m.role === 'user')
    expect(String(firstUser?.content)).toContain('【游戏开始】')
  })
})

describe('补写指令的选择', () => {
  it('已经调过工具时用「只写叙事」那条催稿指令（tool_call_id 分支）', async () => {
    const invocation = { toolCalls: [{ name: 'advance_time', arguments: '{"step":1}' }] }
    fake = installFakeLlm([invocation, invocation, invocation, invocation, invocation, '补写文字。'])
    const state = new GameState(createInitialState())

    const result = await runTurn(state, { action: '等一下' })

    expect(result.text).toBe('补写文字。')
    // 最后一次请求的末尾应是催稿指令，且该次请求**不带 tools**
    const lastCall = fake.calls.at(-1)
    const lastMessage = lastCall?.body.messages?.at(-1)
    expect(String(lastMessage?.content)).toContain('只写叙事')
    expect(lastCall?.body.tools).toBeUndefined()
  })
})
