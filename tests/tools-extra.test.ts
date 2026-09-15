/**
 * tools.ts 补充测试 —— 参数边界（非法参数、未知工具）已在 tests/tools.test.ts 覆盖。
 *
 * 这里补的是「时刻本身非法」：失败在 advanceTime 内部（utils/calendar.ts）就被
 * 转成 tools.advanceFailed 文案返回，不会抛到 runTool —— runTool 里没有 try/catch，
 * 理由见该文件末尾的注释。
 */
import { describe, expect, it } from 'vitest'
import { runTool } from '../src/agent/tools'
import * as game from '../src/game/state'
import { t } from '../src/i18n'
import { ADVANCE_OK_MARKER } from './support/locale-patterns'
import { createGame } from './support/game-fixtures'
import type { ToolCallRequest } from '../src/agent/llm'

/** 非法时刻 fixture（存档被手改成这种值时走的就是这条路径） */
const INVALID_TIME = 'not-a-valid-time'

/**
 * 引擎对非法日期调用 Date#toISOString 抛出的 RangeError 文本 —— 引擎文案，不是产品文案；
 * 产品只把它套进 tools.advanceFailed。
 */
const INVALID_TIME_ERROR = 'Invalid time value'

/** 一次参数合法的调用 —— 参数解析那一层由 tests/llm.test.ts 负责 */
function call(value: Record<string, unknown>): ToolCallRequest {
  return { id: 'call_1', name: 'advance_time', arguments: JSON.stringify(value), args: { ok: true, value } }
}

describe('advance_time with an invalid time', () => {
  it('returns the advance-failed line (caught inside advanceTime, never thrown to runTool)', () => {
    const state = createGame()
    state.data.time.iso = INVALID_TIME
    const current = game.timeLabel(state)

    const out = runTool(state, call({ step: 1 }))
    expect(out).toBe(t('tools.advanceFailed', { message: INVALID_TIME_ERROR, current }))
    expect(out).not.toContain(ADVANCE_OK_MARKER)
  })

  it('advances successfully from a valid time and reports before / after', () => {
    const state = createGame()
    const before = game.timeLabel(state)

    const out = runTool(state, call({ step: 1 }))
    expect(out).toContain(t('tools.advanceResult', { before, after: game.timeLabel(state) }))
  })

  it('names the reason in the result the model sees (it goes on the timeline)', () => {
    const state = createGame()
    const out = runTool(state, call({ step: 1, unit: 'day', reason: 'kept walking' }))
    expect(out).toContain(t('tools.advanceReason', { reason: 'kept walking' }))
    expect(state.data.timeline[0].reason).toBe('kept walking')
  })
})
