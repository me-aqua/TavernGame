/**
 * agent.ts 补充测试 —— 覆盖未走到的分支。
 *
 * 重点：开场分支、催稿分支（tool_call_id 那条）。
 *（「落盘失败要出声」归组合根 stores/turn.ts，用例在 tests/store-extra.test.ts。）
 *
 * 文案断言都走 t('key')（证明 key 接对了，本文件也保持 ASCII）；夹具是 ASCII 常量。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runTurn, type AgentEvent } from '../src/agent/agent'
import { t } from '../src/i18n'
import { forcedNarrationInstruction, toolCallsWithoutNarration } from '../src/agent/prompts'
import { configureFakeProvider, createAgentContext } from './support/game-fixtures'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

/** ASCII 夹具 */
const REPLY_WAKE = 'You wake up in an inn.'
const REPLY_FORCED = 'The forced narration.'
const ACTION_WAIT = 'wait a bit'

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
})

afterEach(() => {
  fake?.restore()
  fake = null
  vi.restoreAllMocks()
})

describe('opening branch (no action passed)', () => {
  it('logs as system and sends the opening instruction instead of a player action', async () => {
    fake = installFakeLlm([REPLY_WAKE])
    const ctx = createAgentContext()
    const events: AgentEvent[] = []

    const result = await runTurn(ctx, { onEvent: (e) => events.push(e) })

    expect(result.text).toBe(REPLY_WAKE)
    // 日志的第一条是 system（而非 action）
    expect(ctx.state.data.events[0].kind).toBe('system')
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
    const ctx = createAgentContext()

    const result = await runTurn(ctx, { action: ACTION_WAIT })

    expect(result.text).toBe(REPLY_FORCED)
    // 最后一次请求的末尾应是催稿指令，且该次请求**不带 tools**
    const lastCall = fake.calls.at(-1)
    const lastMessage = lastCall?.body.messages?.at(-1)
    // 走的是 tool_call_id 分支：必须用「只写叙事」那条，而不是通用催稿那条
    expect(lastMessage?.content).toBe(toolCallsWithoutNarration())
    expect(lastMessage?.content).not.toBe(forcedNarrationInstruction())
    expect(lastCall?.body.tools).toBeUndefined()
  })
})
