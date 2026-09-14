/**
 * persistence 测试 —— 外部数据的**纯校验**：初始状态、导入解析、字段补齐。
 *
 * localStorage 的读写与坏档备份在 tests/storage.test.ts。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState, normalize, parseSave } from '../src/core/persistence'
import { t } from '../src/i18n'

// Fixtures: a player name and the garbage values the system boundary has to reject.
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

  it('does not crash on wrong field types (number, null, nested array)', () => {
    const d = normalize({
      player: { name: 123 },
      scene: { name: null, description: [] },
      time: { iso: 456 },
      log: 'not-an-array',
      timeline: { nope: true },
    })
    expect(typeof d.player.name).toBe('string')
    expect(d.log).toEqual([])
    expect(d.timeline).toEqual([])
  })
})
