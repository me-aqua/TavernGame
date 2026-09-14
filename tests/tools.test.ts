/**
 * Tool tests.
 *
 * Since 2026-09-14 tools use **native tool calling**, so the old text parser is
 * gone. These tests cover the protocol contract and the parameter boundary:
 *   - toolSchemas() is valid (the model calls through it; a typo makes the tool uncallable)
 *   - runTool handles JSON arguments (a boundary: arguments come from the model)
 *   - names from Object.prototype must never resolve to a real tool (regression guard)
 *
 * Assertions anchor on the tool name and on markers taken from the locale table at
 * runtime (never written into this file, which stays ASCII), so a locale switch
 * cannot make a test pass or fail for the wrong reason.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { runTool, TOOLS, toolSchemas, TOOL_NAMES } from '../src/core/tools'
import { i18n, t } from '../src/i18n'
import { GameState } from '../src/core/state'
import { createInitialState } from '../src/core/persistence'

beforeAll(() => {
  i18n.global.locale.value = 'zh-CN'
})

/** 每个用例一个干净状态 */
function fresh() {
  return new GameState(createInitialState())
}

/** The 'tool missing' message for a given name, built from the locale table */
function unknownToolMessage(name: string): string {
  return t('tools.unknown', { name, available: TOOL_NAMES.join(', ') })
}

/**
 * The leading marker of a result message (everything before its first placeholder).
 * Read from the locale table so the success/failure markers never appear in this file.
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
    expect(declared).toEqual([...TOOL_NAMES].sort())
  })

  it('advance_time constrains unit with an enum (protocol blocks a misspelled unit)', () => {
    const params = toolSchemas()[0].function.parameters as {
      properties: { unit: { enum: string[] } }
    }
    expect(params.properties.unit.enum).toEqual(['segment', 'hour', 'day', 'week', 'month', 'year'])
  })

  it('schema descriptions come from the locale table (not hardcoded)', () => {
    const description = toolSchemas()[0].function.description
    expect(description).toBe(t('tools.advanceTime.description'))
  })
})

describe('runTool', () => {
  it('returns a hint instead of throwing when the tool does not exist', () => {
    const out = runTool(fresh(), 'no-such-tool', '{}')
    expect(out).toBe(unknownToolMessage('no-such-tool'))
  })

  it('names from Object.prototype must not resolve to a real tool', () => {
    // This used to be written as TOOLS[name], so constructor / toString resolved to a
    // truthy value on Object.prototype, skipped the "no such tool" branch and threw a
    // TypeError that escaped runTurn -- narrative was never persisted while time had moved.
    for (const bad of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(() => runTool(fresh(), bad, '{}')).not.toThrow()
      expect(runTool(fresh(), bad, '{}')).toBe(unknownToolMessage(bad))
    }
  })

  it('empty arguments are valid (step has a default)', () => {
    const state = fresh()
    const before = Date.parse(state.iso)
    // 成功文案带着时钟标记（locale 提供）
    expect(runTool(state, 'advance_time', '{}')).toContain(resultMarker('advanceResult'))
    expect(Date.parse(state.iso) - before).toBe(4 * 3600000)
  })

  it('valid JSON arguments execute normally', () => {
    const state = fresh()
    const before = Date.parse(state.iso)
    runTool(state, 'advance_time', '{"step":3,"unit":"day","reason":"slept three days"}')
    expect(Date.parse(state.iso) - before).toBe(3 * 86400000)
  })

  it('malformed JSON returns an error message for the model to retry (no throw)', () => {
    const raw = '{"broken'
    const out = runTool(fresh(), 'advance_time', raw)
    expect(out).toContain('JSON')
    expect(out).toContain(raw)
    expect(out).not.toContain(resultMarker('advanceResult'))
  })

  it('an array or a bare literal is rejected explicitly', () => {
    const arrayOut = runTool(fresh(), 'advance_time', '[1,2]')
    expect(arrayOut).toContain('[1,2]')
    expect(arrayOut).not.toContain(resultMarker('advanceResult'))

    const literalOut = runTool(fresh(), 'advance_time', '"a string"')
    expect(literalOut).toContain('a string')
    expect(literalOut).not.toContain(resultMarker('advanceResult'))
  })

  it('a unit outside the enum becomes a structured error (the engine never guesses)', () => {
    // The schema has an enum, but the client can still receive an out-of-range value
    // (lenient provider, hand-edited payload), so the engine must return a
    // *retryable* error rather than silently picking a unit.
    for (const bad of ['lightyear', 'days', 'HOUR']) {
      const state = fresh()
      const before = state.iso
      const out = runTool(state, 'advance_time', `{"step":1,"unit":"${bad}"}`)
      // NOTE (reported upstream): src/core/time.ts builds this message itself in
      // English -- it does NOT go through t('calendar.unknownUnit'), so that locale
      // key is currently unused. Assert the actual contract (rejected + listed units).
      expect(out, `unit "${bad}" must be rejected`).toContain('Unknown time unit')
      expect(out, `unit "${bad}" must be rejected`).toContain(bad)
      expect(out, `unit "${bad}" must be rejected`).toContain('segment')
      expect(state.iso, `unit "${bad}" must not change the time`).toBe(before)
    }
  })

  it('an invalid stored timestamp surfaces as an advance failure, not a time jump', () => {
    // NOTE (reported upstream): runTool no longer has a try/catch (it was dead code),
    // so a thrown tool error is NOT converted here -- unique tool advance_time turns the
    // failure into a warning inside state.advanceTime.
    const state = fresh()
    state.data.time.iso = 'not-a-valid-time'
    const out = runTool(state, 'advance_time', '{"step":1}')
    expect(out).toContain(resultMarker('advanceFailed')) // the warning marker
    expect(out).not.toContain(resultMarker('advanceResult')) // no clock means no successful jump
    expect(state.iso).toBe('not-a-valid-time')
  })

  it('the tool table holds only advance_time and no prompt content', () => {
    expect(TOOL_NAMES).toEqual(['advance_time'])
    // The prose lives in prompts/<lang>/tools.md -- code keeps only the implementation
    expect(Object.keys(TOOLS.advance_time)).toEqual(['run'])
  })
})
