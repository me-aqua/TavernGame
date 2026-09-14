/**
 * save 测试 —— 外部数据的**纯校验**：初始状态、导入解析、字段补齐。
 *
 * localStorage 的读写与坏档备份在 tests/storage.test.ts。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState, normalize, parseSave } from '../src/game/save'
import { t } from '../src/i18n'

// 夹具：玩家名，以及系统边界必须拒绝的垃圾值
const TRUNCATED_JSON = '{ broken'
const JSON_STRING = '"a string"'

describe('createInitialState', () => {
  it('returns a fresh timestamp on every call (not the same object)', () => {
    const a = createInitialState()
    const b = createInitialState()
    expect(a).not.toBe(b)
    expect(Number.isNaN(Date.parse(a.time.iso))).toBe(false)
  })
})

describe('parseSave (the import-file path)', () => {
  it('accepts a valid save', () => {
    const json = JSON.stringify(createInitialState())
    expect(parseSave(json).player.name).toBe(t('player.defaultName'))
  })

  it('rejects non-objects, a missing player, and arrays', () => {
    for (const bad of ['[]', JSON_STRING, '{"player": 1}', '{}']) {
      expect(() => parseSave(bad)).toThrow(t('save.notValid'))
    }
  })

  it('throws a parse error on broken JSON', () => {
    expect(() => parseSave(TRUNCATED_JSON)).toThrow()
  })
})

describe('normalize fallbacks', () => {
  it('fills missing fields with the initial values', () => {
    const d = normalize({})
    expect(d.player.name).toBe(t('player.defaultName'))
    expect(Number.isNaN(Date.parse(d.time.iso))).toBe(false)
  })

  it('drops events with an unknown kind but keeps detail for the known ones', () => {
    const d = normalize({
      events: [
        { kind: 'narration', text: 'story' },
        { kind: 'nonsense', text: 'not a thing' },
        { kind: 'tool', text: 'tool call', detail: '{"a":1}' },
        { kind: 'reply', text: 'reply', detail: 42 },
      ],
    })

    expect(d.events.map((event) => event.kind)).toEqual(['narration', 'tool', 'reply'])
    expect(d.events[1].detail).toBe('{"a":1}')
    // detail 不是字符串就当没有，不让渲染层拿到数字
    expect(d.events[2].detail).toBeUndefined()
  })

  it('does not crash on wrong field types (number, null, nested array)', () => {
    const d = normalize({
      player: { name: 123 },
      scene: { name: null, description: [] },
      time: { iso: 456 },
      events: 'not-an-array',
      timeline: { nope: true },
    })
    expect(typeof d.player.name).toBe('string')
    expect(d.events).toEqual([])
    expect(d.timeline).toEqual([])
  })
})
