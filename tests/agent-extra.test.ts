/**
 * agent.ts 补充测试 —— 覆盖未走到的分支。
 *
 * 重点：存档写入失败时玩家必须收到警告（绝不静默）。
 *
 * Message assertions go through t('key') so they prove the key is wired and this
 * file stays ASCII-only; fixtures are ASCII constants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameState } from '../src/core/state'
import { createInitialState } from '../src/core/persistence'
import { runTurn, type AgentEvent } from '../src/core/agent'
import { saveConfig } from '../src/core/config'
import { t } from '../src/i18n'
import { FORCED_NARRATION_INSTRUCTION, TOOL_CALLS_WITHOUT_NARRATION } from '../src/core/prompts'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

/** ASCII fixtures */
const REPLY_DONE = 'Done writing.'
const REPLY_WAKE = 'You wake up in an inn.'
const REPLY_FORCED = 'The forced narration.'
const ACTION_SOMETHING = 'do something'
const ACTION_WAIT = 'wait a bit'

/** The warning the agent must emit when the save cannot be written */
const SAVE_FAILED = t('agent.saveFailed')

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

describe('a failed save must be announced', () => {
  it('save() returning false emits a warning event (instead of continuing silently)', async () => {
    fake = installFakeLlm([REPLY_DONE])
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const state = new GameState(createInitialState())
    const events: AgentEvent[] = []
    await runTurn(state, { action: ACTION_SOMETHING, onEvent: (e) => events.push(e) })

    const warnings = events.filter((e) => e.type === 'warn')
    expect(warnings.some((w) => w.type === 'warn' && w.message === SAVE_FAILED)).toBe(true)

    spy.mockRestore()
  })

  it('a successful save does not emit that warning', async () => {
    fake = installFakeLlm([REPLY_DONE])
    const state = new GameState(createInitialState())
    const events: AgentEvent[] = []
    await runTurn(state, { action: ACTION_SOMETHING, onEvent: (e) => events.push(e) })

    const warnings = events.filter((e) => e.type === 'warn')
    expect(warnings.some((w) => w.type === 'warn' && w.message === SAVE_FAILED)).toBe(false)
  })
})

describe('opening branch (no action passed)', () => {
  it('logs as system and sends the opening instruction instead of a player action', async () => {
    fake = installFakeLlm([REPLY_WAKE])
    const state = new GameState(createInitialState())
    const events: AgentEvent[] = []

    const result = await runTurn(state, { onEvent: (e) => events.push(e) })

    expect(result.text).toBe(REPLY_WAKE)
    // 日志的第一条是 system（而非 action）
    expect(state.data.log[0].kind).toBe('system')
    // 发给模型的第一条 user 消息带开场指令的前缀
    const firstUser = fake.calls[0].body.messages?.find((m) => m.role === 'user')
    const gameStartPrefix = t('agent.gameStart', { instruction: '' }).split('{')[0]
    expect(String(firstUser?.content)).toContain(gameStartPrefix.trim())
    // 且它不是玩家的行动
    expect(String(firstUser?.content)).not.toContain(
      t('agent.actionPrefix', { action: '' }).split('{')[0].trim(),
    )
  })
})

describe('choosing the forced-narration instruction', () => {
  it('uses the "narration only" nudge when a tool was already called (tool_call_id branch)', async () => {
    const invocation = { toolCalls: [{ name: 'advance_time', arguments: '{"step":1}' }] }
    fake = installFakeLlm([invocation, invocation, invocation, invocation, invocation, REPLY_FORCED])
    const state = new GameState(createInitialState())

    const result = await runTurn(state, { action: ACTION_WAIT })

    expect(result.text).toBe(REPLY_FORCED)
    // 最后一次请求的末尾应是催稿指令，且该次请求**不带 tools**
    const lastCall = fake.calls.at(-1)
    const lastMessage = lastCall?.body.messages?.at(-1)
    // 走的是 tool_call_id 分支：必须用「只写叙事」那条，而不是通用催稿那条
    expect(lastMessage?.content).toBe(TOOL_CALLS_WITHOUT_NARRATION)
    expect(lastMessage?.content).not.toBe(FORCED_NARRATION_INSTRUCTION)
    expect(lastCall?.body.tools).toBeUndefined()
  })
})
