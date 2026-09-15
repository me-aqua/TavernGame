/**
 * 工具测试：动作白名单的协议契约 + 参数边界。
 *
 *   - toolSchemas() 必须合法（模型照着它调用；一个 typo 就让工具调不动）
 *   - runTool 只认白名单里的工具；参数由 llm.ts 解析成对象或一句结构化错误
 *   - Object.prototype 上的名字绝不能解析成真工具（回归网）
 *
 * 断言锚在工具名与「运行时从 locale 表取的标记」上（不写进本文件，保持 ASCII），
 * locale 切换不会让用例因为错误的原因通过或失败。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { runTool, TOOLS, toolSchemas } from '../src/agent/tools'
import { i18n, t } from '../src/i18n'
import * as game from '../src/game/state'
import { createGame } from './support/game-fixtures'
import type { ToolArguments, ToolCallRequest } from '../src/agent/llm'

beforeAll(() => {
  i18n.global.locale.value = 'zh-CN'
})

function unknownToolMessage(name: string): string {
  return t('tools.unknown', { name, available: Object.keys(TOOLS).join(', ') })
}

/**
 * 造一次工具调用：参数已经是 llm.ts 解析出来的形状
 * （参数字符串 → 对象的解析在那一层，见 tests/llm.test.ts）。
 */
function call(name: string, value: Record<string, unknown> = {}): ToolCallRequest {
  return { id: 'call_1', name, arguments: JSON.stringify(value), args: { ok: true, value } }
}

/**
 * 结果文案的前导标记（第一个占位符之前的部分）。
 * 从 locale 表读，成功/失败标记就不会出现在本文件里。
 */
function resultMarker(key: 'advanceResult' | 'advanceFailed'): string {
  const messages = i18n.global.getLocaleMessage(i18n.global.locale.value) as {
    tools: Record<string, string>
  }
  return messages.tools[key].split('{')[0].trim()
}

describe('toolSchemas(): the contract handed to the model', () => {
  it('every declaration has a name, a description and a parameter schema', () => {
    expect(toolSchemas().length).toBeGreaterThan(0)
    for (const schema of toolSchemas()) {
      expect(schema.type).toBe('function')
      expect(schema.function.name).toBeTruthy()
      expect(schema.function.description.length).toBeGreaterThan(10)
      expect(schema.function.parameters.type).toBe('object')
    }
  })

  it('declarations and implementations correspond one-to-one', () => {
    const declared = toolSchemas()
      .map((s: { function: { name: string } }) => s.function.name)
      .sort()
    expect(declared).toEqual(Object.keys(TOOLS).sort())
  })

  it('advance_time constrains unit with an enum (protocol blocks a misspelled unit)', () => {
    const params = toolSchemas()[0].function.parameters as {
      properties: { unit: { enum: string[] } }
    }
    expect(params.properties.unit.enum).toEqual(['segment', 'hour', 'day', 'week', 'month', 'year'])
  })

  it('schema descriptions come from the locale table (not hardcoded)', () => {
    expect(toolSchemas()[0].function.description).toBe(t('tools.advanceTime.description'))
  })
})

describe('runTool', () => {
  it('returns a hint instead of throwing when the tool does not exist', () => {
    expect(runTool(createGame(), call('no-such-tool'))).toBe(unknownToolMessage('no-such-tool'))
  })

  it('names from Object.prototype must not resolve to a real tool', () => {
    // ⚠️ 不能写成 TOOLS[name]：constructor / toString 会从 Object.prototype 上取到真值，
    // 绕过「没有这个工具」的分支并抛 TypeError，异常穿出 runTurn ——
    // 时间推进了，叙事却没落盘。
    for (const bad of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(() => runTool(createGame(), call(bad))).not.toThrow()
      expect(runTool(createGame(), call(bad))).toBe(unknownToolMessage(bad))
    }
  })

  it('hands a failed argument parse back to the model unchanged (never guesses)', () => {
    const broken: ToolArguments = { ok: false, message: 'ARGUMENTS-BROKEN' }
    const state = createGame()
    const before = game.iso(state)
    const out = runTool(state, { id: 'c', name: 'advance_time', arguments: 'x', args: broken })
    expect(out).toBe('ARGUMENTS-BROKEN')
    expect(game.iso(state)).toBe(before)
  })

  it('empty arguments are valid (step has a default)', () => {
    const state = createGame()
    const before = Date.parse(game.iso(state))
    // 成功文案带着时钟标记（locale 提供）
    expect(runTool(state, call('advance_time'))).toContain(resultMarker('advanceResult'))
    expect(Date.parse(game.iso(state)) - before).toBe(4 * 3600000)
  })

  it('valid arguments execute normally', () => {
    const state = createGame()
    const before = Date.parse(game.iso(state))
    runTool(state, call('advance_time', { step: 3, unit: 'day', reason: 'slept three days' }))
    expect(Date.parse(game.iso(state)) - before).toBe(3 * 86400000)
  })

  it('a unit outside the enum becomes a structured error (the engine never guesses)', () => {
    // schema 里有 enum，但客户端仍可能收到越界值（服务商宽松、载荷被手改），
    // 引擎必须返回**可重试**的错误，而不是静默挑一个单位
    for (const bad of ['lightyear', 'days', 'HOUR']) {
      const state = createGame()
      const before = game.iso(state)
      const out = runTool(state, call('advance_time', { step: 1, unit: bad }))
      // 这条错误文案由 utils/calendar.ts 的 advanceTime 直接拼英文（不走 locale 表：
      // 它是给模型看的结构化提示）。这里断言实际契约：拒绝 + 列出可用单位。
      expect(out, 'unit "' + bad + '" must be rejected').toContain('Unknown time unit')
      expect(out, 'unit "' + bad + '" must be rejected').toContain(bad)
      expect(out, 'unit "' + bad + '" must be rejected').toContain('segment')
      expect(game.iso(state), 'unit "' + bad + '" must not change the time').toBe(before)
    }
  })

  it('an invalid stored timestamp surfaces as an advance failure, not a time jump', () => {
    // runTool 没有 try/catch：工具抛的错不会被它转成结果。唯一的工具 advance_time
    // 在 game/state.ts 内部就把失败转成告警文案了。
    const state = createGame()
    state.data.time.iso = 'not-a-valid-time'
    const out = runTool(state, call('advance_time', { step: 1 }))
    expect(out).toContain(resultMarker('advanceFailed')) // the warning marker
    expect(out).not.toContain(resultMarker('advanceResult')) // no clock means no successful jump
    expect(game.iso(state)).toBe('not-a-valid-time')
  })

  it('the tool table holds only advance_time and no prompt content', () => {
    expect(Object.keys(TOOLS)).toEqual(['advance_time'])
    // 说明文字在 prompts/<lang>/tools.md —— 代码里只留实现
    expect(Object.keys(TOOLS.advance_time)).toEqual(['run'])
  })
})
