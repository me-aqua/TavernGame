/**
 * tools.ts 补充测试 —— 参数边界（非法 JSON、非对象）已在 tests/tools.test.ts 覆盖。
 *
 * 这里只补一条：时刻非法时的行为。
 *
 * ⚠️ 结论（写进报告）：runTool 的 `catch`（把工具抛错转成 ❌ 文案）**当前不可达** ——
 * 唯一的工具 advance_time 内部（state.advanceTime）已经用 try/catch 把错误
 * 转成了 ⚠ 文案，不会抛到 runTool。该 catch 是给"将来新增会抛错的工具"留的兜底，
 * 属于为本项目纪律所不允许的「不可能发生的场景」写的防御代码（报给上游判断）。
 */
import { describe, expect, it } from 'vitest'
import { runTool } from '../src/core/tools'
import { GameState } from '../src/core/state'
import { createInitialState } from '../src/core/persistence'
import { t } from '../src/i18n'

/** 非法时刻 fixture（存档被手改成这种值时走的就是这条路径） */
const INVALID_TIME = 'not-a-valid-time'

/**
 * 引擎对非法日期调用 Date#toISOString 抛出的 RangeError 文本 —— 引擎文案，不是产品文案；
 * 产品只把它套进 tools.advanceFailed。
 */
const INVALID_TIME_ERROR = 'Invalid time value'

/**
 * 成功文案的固定开头（首行，占位符之外的部分）。
 * t() 不带具名参数时占位符会被替换成空串，所以传空串取模板、再截首行。
 */
const ADVANCE_OK_MARKER = t('tools.advanceResult', { before: '', after: '' }).split('\n')[0].trim()

describe('advance_time with an invalid time', () => {
  it('returns the advance-failed line (caught inside state.advanceTime, never thrown to runTool)', () => {
    const state = new GameState(createInitialState())
    state.data.time.iso = INVALID_TIME
    const current = state.timeLabel

    const out = runTool(state, 'advance_time', '{"step":1}')
    expect(out).toBe(t('tools.advanceFailed', { message: INVALID_TIME_ERROR, current }))
    expect(out).not.toContain(ADVANCE_OK_MARKER)
  })

  it('treats an empty arguments string as {} (the tool takes no required params)', () => {
    const state = new GameState(createInitialState())
    const before = state.timeLabel

    const out = runTool(state, 'advance_time', '')
    expect(out).toContain(t('tools.advanceResult', { before, after: state.timeLabel }))
  })

  it('advances successfully from a valid time', () => {
    const state = new GameState(createInitialState())
    const before = state.timeLabel

    const out = runTool(state, 'advance_time', '{"step":1}')
    expect(out).toContain(t('tools.advanceResult', { before, after: state.timeLabel }))
  })
})
