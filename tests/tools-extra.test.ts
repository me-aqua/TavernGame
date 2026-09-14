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

describe('advance_time 遇到非法时刻', () => {
  it('返回 ⚠ 推进失败文案（由 state.advanceTime 兜住，不抛到 runTool）', () => {
    const state = new GameState(createInitialState())
    state.data.time.iso = '坏掉的时刻'

    const out = runTool(state, 'advance_time', '{"step":1}')
    expect(out).toContain('推进失败')
    expect(out).not.toContain('时间推进')
  })

  it('空参数字符串被当作 {}（可空参数的工具）', () => {
    const state = new GameState(createInitialState())
    expect(runTool(state, 'advance_time', '')).toContain('时间推进')
  })

  it('正常时刻推进成功', () => {
    const state = new GameState(createInitialState())
    expect(runTool(state, 'advance_time', '{"step":1}')).toContain('时间推进')
  })
})
