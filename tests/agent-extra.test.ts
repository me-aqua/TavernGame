/**
 * 引擎补充测试 —— 开场分支（不传玩家行动）。
 *
 * 开场也是一轮：同样照卡里的图跑九个节点，只是「玩家这一轮的原话」换成开场指令，
 * 日志第一条记 system 而不是 action。真实用户撞上的「生成开场失败」就出在这条路上，
 * 所以这里也走一遍**带工具**的开场（时间节点调 advance_time）。
 *
 * 文案断言都走 t('key')（证明 key 接对了，本文件也保持 ASCII）；夹具是 ASCII 常量。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runTurn } from '../src/agent/agent'
import { t } from '../src/i18n'
import { iso } from '../src/game/state'
import { configureFakeProvider, createAgentContext } from './support/game-fixtures'
import { advanceTimeCall, cardTurnReplies, CARD_TOPOLOGY } from './support/card-replies'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'
import { TIME_NODE } from '../src/agent/card-graph'

/** ASCII 夹具 */
const STORY_OUTPUT = 'You wake up in an inn.'
const TIME_TEXT = 'clock moved'
const HOUR_MS = 3600000
const EIGHT_HOURS = { step: 8, unit: 'hour', reason: 'slept through the night' }

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

describe('opening branch (no action passed)', () => {
  it('logs as system and sends the opening instruction to every node', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT }))
    const ctx = createAgentContext()

    const result = await runTurn(ctx)

    expect(result.text).toBe(STORY_OUTPUT)
    // 日志的第一条是 system（而非 action）
    expect(ctx.state.data.events[0].kind).toBe('system')
    // 每个节点的「玩家原话」都是开场指令，不是玩家的行动
    const gameStartPrefix = t('agent.gameStart', { instruction: '' }).split('{')[0].trim()
    const actionPrefix = t('agent.actionPrefix', { action: '' }).split('{')[0].trim()
    for (const call of fake.calls) {
      const text = JSON.stringify(call.body.messages)
      expect(text).toContain(gameStartPrefix)
      expect(text).not.toContain(actionPrefix)
    }
  })

  it('runs the opening through the tool path too (the time node advances the clock by tool call)', async () => {
    fake = installFakeLlm(
      cardTurnReplies({
        story: STORY_OUTPUT,
        node: (id) => (id === TIME_NODE ? [advanceTimeCall(EIGHT_HOURS), TIME_TEXT] : undefined),
      }),
    )
    const ctx = createAgentContext()
    const before = Date.parse(iso(ctx.state))

    const result = await runTurn(ctx)

    // 开场照样能推进时间：工具真的执行了，结果以 role:'tool' 回传（第二次问时间节点）
    expect(Date.parse(iso(ctx.state)) - before).toBe(8 * HOUR_MS)
    // 时间节点的第二次询问：下标 = 它在拓扑里的位置 + 1（工具往返多问一次）
    const followUp = fake.calls[CARD_TOPOLOGY.indexOf(TIME_NODE) + 1].body.messages ?? []
    expect(followUp.some((m) => m.role === 'tool')).toBe(true)
    expect(result.text).toBe(STORY_OUTPUT)
    expect(ctx.state.data.events.map((e) => e.kind)).toEqual(['system', 'narration'])
  })
})
