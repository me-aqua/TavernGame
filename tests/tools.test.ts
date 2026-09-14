/**
 * 工具测试。
 *
 * ⚠️ 2026-09-14 起工具走**原生 tool calling**，所以这里不再测「文本解析器」
 * （它已被删除）—— 改测协议契约与参数边界：
 *   - TOOL_SCHEMAS 是否合法（模型按它调用，写错了模型就无法正确调用）
 *   - runTool 对 JSON 参数的处理（这是**边界**：参数来自模型）
 *   - 原型链上的名字不能被当成真工具（防回归）
 */
import { describe, expect, it } from 'vitest'
import { runTool, TOOLS, TOOL_SCHEMAS, TOOL_NAMES } from '../src/core/tools'
import { GameState } from '../src/core/state'
import { createInitialState } from '../src/core/persistence'

function fresh() {
  return new GameState(createInitialState())
}

describe('TOOL_SCHEMAS —— 给模型的契约', () => {
  it('每个声明都有名字、描述与参数 schema', () => {
    expect(TOOL_SCHEMAS.length).toBeGreaterThan(0)
    for (const schema of TOOL_SCHEMAS) {
      expect(schema.type).toBe('function')
      expect(schema.function.name).toBeTruthy()
      expect(schema.function.description.length).toBeGreaterThan(10)
      expect(schema.function.parameters.type).toBe('object')
    }
  })

  it('⚠️ 声明与实现必须一一对应（少一个模型就调不动）', () => {
    const 声明名 = TOOL_SCHEMAS.map((s) => s.function.name).sort()
    expect(声明名).toEqual([...TOOL_NAMES].sort())
  })

  it('advance_time 的 unit 用 enum 约束（协议层挡住拼错的单位）', () => {
    const 参数 = TOOL_SCHEMAS[0].function.parameters as {
      properties: { unit: { enum: string[] } }
    }
    expect(参数.properties.unit.enum).toEqual(['segment', 'hour', 'day', 'week', 'month', 'year'])
  })
})

describe('runTool', () => {
  it('没有这个工具时返回提示而不是抛错', () => {
    expect(runTool(fresh(), '不存在的工具', '{}')).toContain('没有名为')
  })

  it('⚠️ 原型链上的名字不能被当成真工具（防回归）', () => {
    // 曾经写成 TOOLS[name]，于是 constructor / toString 会取到
    // Object.prototype 上的真值，绕过判断后抛 TypeError，
    // 异常穿出 runTurn，导致叙事不落盘、时间却已改
    for (const bad of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(() => runTool(fresh(), bad, '{}')).not.toThrow()
      expect(runTool(fresh(), bad, '{}')).toContain('没有名为')
    }
  })

  it('空参数是合法的（step 有默认值）', () => {
    const s = fresh()
    const before = Date.parse(s.iso)
    expect(runTool(s, 'advance_time', '{}')).toContain('时间推进')
    expect(Date.parse(s.iso) - before).toBe(4 * 3600000)
  })

  it('参数是合法 JSON 时正常执行', () => {
    const s = fresh()
    const before = Date.parse(s.iso)
    runTool(s, 'advance_time', '{"step":3,"unit":"day","reason":"睡了三天"}')
    expect(Date.parse(s.iso) - before).toBe(3 * 86400000)
  })

  it('参数不是合法 JSON → 返回错误文案（交给模型重试，不抛异常）', () => {
    const out = runTool(fresh(), 'advance_time', '{坏掉的')
    expect(out).toContain('❌')
    expect(out).toContain('不是合法 JSON')
  })

  it('参数是数组或字面量 → 明确拒绝', () => {
    expect(runTool(fresh(), 'advance_time', '[1,2]')).toContain('必须是 JSON 对象')
    expect(runTool(fresh(), 'advance_time', '"字符串"')).toContain('必须是 JSON 对象')
  })

  it('单位不认识时把错误交给模型（引擎不猜、不静默纠正）', () => {
    const out = runTool(fresh(), 'advance_time', '{"step":1,"unit":"光年"}')
    expect(out).toContain('不认识的时间单位')
  })

  it('工具执行抛错时被兜住，返回错误文案', () => {
    const s = fresh()
    s.data.time.iso = '坏掉的时刻' // 让日历的 advance 抛 RangeError
    const out = runTool(s, 'advance_time', '{"step":1}')
    expect(out).toContain('推进失败')
    expect(out).not.toContain('时间推进')
  })

  it('工具表里只有 advance_time，且不带任何提示词内容', () => {
    expect(TOOL_NAMES).toEqual(['advance_time'])
    // 说明文字在 prompts/tools.md —— 代码里只留执行体
    expect(Object.keys(TOOLS.advance_time)).toEqual(['run'])
  })
})
