/**
 * 工具与解析器测试。
 *
 * 这些断言对应 v0.5.4 修掉的两个缺陷：
 *   - 工具名撞上 Object.prototype
 *   - 解析器静默吞内容
 */
import { describe, expect, it } from 'vitest'
import { runTool, parseToolCalls, toolsPrompt, TOOLS } from '../src/core/tools'
import { GameState } from '../src/core/state'
import { createInitialState } from '../src/core/persistence'

function fresh() {
  return new GameState(createInitialState())
}

/** markdown 围栏（三个反引号）。写成常量是为了让下面的用例保持可读 */
const F = String.fromCharCode(96).repeat(3)
const NL = String.fromCharCode(10)

describe('runTool', () => {
  it('没有这个工具时返回提示而不是抛错', () => {
    expect(runTool(fresh(), '不存在的工具', {})).toContain('没有名为')
    expect(runTool(fresh(), null, {})).toContain('没有名为')
  })

  it('原型链上的名字不能被当成真工具（防回归）', () => {
    // 曾经写成 TOOLS[name]，于是 constructor / toString 会取到
    // Object.prototype 上的真值，绕过判断后抛 TypeError，
    // 异常穿出 runTurn，导致叙事不落盘、时间却已改
    for (const bad of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(() => runTool(fresh(), bad, {})).not.toThrow()
      expect(runTool(fresh(), bad, {})).toContain('没有名为')
    }
  })

  it('advance_time 允许空参数（step 有默认值）', () => {
    const s = fresh()
    expect(runTool(s, 'advance_time', {})).toContain('时间推进')
  })

  it('时刻坏掉时推进失败被兜住，不抛异常（存档被手改才会走到）', () => {
    const s = fresh()
    s.data.time.iso = '坏掉的时刻' // 让日历的 advance 抛 RangeError
    const out = runTool(s, 'advance_time', { step: 1 })
    // ⚠️ 兜底在 state.advanceTime 的 try/catch 里（返回 ⚠ 提示），
    //    不是 runTool 的 ❌ 分支 —— 这条断言曾写错，测试因此报红
    expect(out).toContain('推进失败')
    expect(out).not.toContain('时间推进')
  })

  it('工具说明里包含唯一的工具名', () => {
    expect(Object.keys(TOOLS)).toEqual(['advance_time'])
    expect(toolsPrompt()).toContain('advance_time')
  })
})

describe('parseToolCalls', () => {
  it('解析标准工具块，并从正文里删掉', () => {
    const text = ['你等了很久。', '', '```tool', '{"tool":"advance_time","args":{"step":1,"unit":"week"}}', '```', ''].join(NL)
    const { blocks, clean, errors } = parseToolCalls(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].tool).toBe('advance_time')
    expect(blocks[0].args).toEqual({ step: 1, unit: 'week' })
    expect(clean).toBe('你等了很久。')
    expect(errors).toHaveLength(0)
  })
  it('支持同行围栏（围栏与 JSON 之间不换行）', () => {
    const text = ['文字', '```tool {"tool":"advance_time","args":{}}', '```', ''].join(NL)
    expect(parseToolCalls(text).blocks).toHaveLength(1)
  })
  it('支持数组形式的多个工具', () => {
    const text = ['叙事', '```tool', '[{"tool":"advance_time","args":{"step":1}},{"tool":"advance_time","args":{"step":2}}]', '```', ''].join(NL)
    expect(parseToolCalls(text).blocks).toHaveLength(2)
  })
  it('JSON 解析失败要出声，并且不把裸 JSON 留在正文里', () => {
    const text = ['文字', '```tool', '{坏掉的 json}', '```', ''].join(NL)
    const { clean, errors } = parseToolCalls(text)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('工具块解析失败')
    expect(clean).toBe('文字')
  })
  it('工具块缺少 tool 字段时报错并删除', () => {
    const text = ['文字', '```tool', '{"args":{}}', '```', ''].join(NL)
    const { blocks, errors, clean } = parseToolCalls(text)
    expect(blocks).toHaveLength(0)
    expect(errors[0]).toContain('没有 "tool" 字段')
    expect(clean).toBe('文字')
  })
  it('普通 json 数据块要保留在正文里（不是工具块）', () => {
    const text = ['数据如下', '```json', '{"a":1}', '```', '结束'].join(NL)
    const { blocks, clean } = parseToolCalls(text)
    expect(blocks).toHaveLength(0)
    expect(clean).toContain('"a":1')
  })
  it('没有工具块时原样返回正文', () => {
    const { blocks, clean } = parseToolCalls('只有故事，没有工具。')
    expect(blocks).toHaveLength(0)
    expect(clean).toBe('只有故事，没有工具。')
  })
})
