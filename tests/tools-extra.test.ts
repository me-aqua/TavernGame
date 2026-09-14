/**
 * tools.ts 补充测试 —— 参数边界（非法 JSON、非对象）已在 tests/tools.test.ts 覆盖。
 *
 * 这里补的是「时刻本身非法」：失败在 advanceTime 内部（utils/calendar.ts）就被
 * 转成 tools.advanceFailed 文案返回，不会抛到 runTool —— runTool 里没有 try/catch，
 * 理由见该文件第 98 行的注释。
 */
import { describe, expect, it } from 'vitest'
import { runTool } from '../src/agent/tools'
import * as game from '../src/game/state'
import { t } from '../src/i18n'
import { ADVANCE_OK_MARKER } from './support/locale-patterns'
import { createGame } from './support/game-fixtures'

/** 非法时刻 fixture（存档被手改成这种值时走的就是这条路径） */
const INVALID_TIME = 'not-a-valid-time'

/**
 * 引擎对非法日期调用 Date#toISOString 抛出的 RangeError 文本 —— 引擎文案，不是产品文案；
 * 产品只把它套进 tools.advanceFailed。
 */
const INVALID_TIME_ERROR = 'Invalid time value'

describe('advance_time with an invalid time', () => {
  it('returns the advance-failed line (caught inside advanceTime, never thrown to runTool)', () => {
    const state = createGame()
    state.data.time.iso = INVALID_TIME
    const current = game.timeLabel(state)

    const out = runTool(state, 'advance_time', '{"step":1}')
    expect(out).toBe(t('tools.advanceFailed', { message: INVALID_TIME_ERROR, current }))
    expect(out).not.toContain(ADVANCE_OK_MARKER)
  })

  it('treats an empty arguments string as {} (the tool takes no required params)', () => {
    const state = createGame()
    const before = game.timeLabel(state)

    const out = runTool(state, 'advance_time', '')
    expect(out).toContain(t('tools.advanceResult', { before, after: game.timeLabel(state) }))
  })

  it('advances successfully from a valid time', () => {
    const state = createGame()
    const before = game.timeLabel(state)

    const out = runTool(state, 'advance_time', '{"step":1}')
    expect(out).toContain(t('tools.advanceResult', { before, after: game.timeLabel(state) }))
  })
})
