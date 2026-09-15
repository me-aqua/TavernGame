/**
 * 引擎补充测试 —— 开场分支（不传玩家行动）。
 *
 * 开场也是一轮：同样照卡里的图跑九个节点，只是「玩家这一轮的原话」换成开场指令，
 * 日志第一条记 system 而不是 action。
 *
 * 文案断言都走 t('key')（证明 key 接对了，本文件也保持 ASCII）；夹具是 ASCII 常量。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runTurn } from '../src/agent/agent'
import { t } from '../src/i18n'
import { configureFakeProvider, createAgentContext } from './support/game-fixtures'
import { cardTurnReplies } from './support/card-replies'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

/** ASCII 夹具 */
const STORY_OUTPUT = 'You wake up in an inn.'

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
})
