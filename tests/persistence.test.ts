/**
 * persistence 测试 —— 系统边界的模块：读档、校验、备份坏数据。
 *
 * 这里的每条断言都对应「玩家实际会遇到的坏情况」：
 * 被手改的存档、被截断的 JSON、隐私模式下写不进去。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInitialState,
  normalize,
  loadState,
  parseSave,
  readSave,
  writeSave,
  SAVE_KEY,
} from '../src/core/persistence'
import { t } from '../src/i18n'

// Fixtures: a player name and the garbage values the system boundary has to reject.
const PLAYER_NAME = 'Tester'
const TRUNCATED_JSON = '{ broken'
const INVALID_JSON = '{ not valid JSON'
const JSON_STRING = '"a string"'

beforeEach(() => {
  localStorage.clear()
})

describe('createInitialState', () => {
  it('returns a fresh timestamp on every call (not the same object)', () => {
    const a = createInitialState()
    const b = createInitialState()
    expect(a).not.toBe(b)
    expect(Number.isNaN(Date.parse(a.time.iso))).toBe(false)
  })
})

describe('readSave', () => {
  it('returns null when there is no save', () => {
    expect(readSave()).toBeNull()
  })

  it('returns the parsed result when a save exists', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify(createInitialState()))
    const raw = readSave() as { player?: unknown }
    expect(raw.player).toBeTruthy()
  })

  it('throws when the player field is missing', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ meta: {} }))
    expect(() => readSave()).toThrow(t('save.missingPlayer'))
  })
})

describe('writeSave', () => {
  it('returns true and really writes the data', () => {
    const data = createInitialState()
    data.player.name = PLAYER_NAME
    expect(writeSave(data)).toBe(true)
    expect(localStorage.getItem(SAVE_KEY)).toContain(PLAYER_NAME)
  })

  it('returns false when the write fails (the caller must show the player)', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(writeSave(createInitialState())).toBe(false)
    spy.mockRestore()
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

describe('loadState - the startup path', () => {
  it('returns the data and no error when a valid save exists', () => {
    const data = createInitialState()
    data.meta.turn = 5
    writeSave(data)
    const { data: loaded, error } = loadState()
    expect(error).toBeNull()
    expect(loaded?.meta.turn).toBe(5)
  })

  it('does not pile up backups when a corrupt save is read repeatedly (that would drain the quota)', () => {
    localStorage.setItem(SAVE_KEY, TRUNCATED_JSON)
    loadState()
    loadState()
    loadState()
    let n = 0
    for (let i = 0; ; i += 1) {
      const k = localStorage.key(i)
      if (k === null) break
      if (k.startsWith(`${SAVE_KEY}.broken-`)) n += 1
    }
    expect(n).toBe(1)
  })

  it('corrupt save: returns an error and backs up the bad data (the player can still export it)', () => {
    localStorage.setItem(SAVE_KEY, INVALID_JSON)
    const { data, error } = loadState()
    expect(data).toBeNull()
    expect(error).toContain(t('save.corrupted', { message: '' }).replace('{message}', '').trim())

    // 备份确实写进去了，而且键名带时间戳（用来只保留最新一份）
    const backupKeys: string[] = []
    for (let i = 0; ; i += 1) {
      const k = localStorage.key(i)
      if (k === null) break
      if (k.startsWith(`${SAVE_KEY}.broken-`)) backupKeys.push(k)
    }
    expect(backupKeys).toHaveLength(1)
    const stamp = backupKeys[0].replace(`${SAVE_KEY}.broken-`, '')
    expect(stamp).toMatch(/^\d+$/)
    expect(Number(stamp)).toBeGreaterThan(0)
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
