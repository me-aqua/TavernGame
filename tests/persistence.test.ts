/**
 * persistence 测试 —— 系统边界的模块：读档、迁移、备份坏数据。
 *
 * 这里的每条断言都对应「玩家实际会遇到的坏情况」：
 * 旧版本存档、被手改的存档、私隐模式下写不进去。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInitialState,
  normalize,
  migrateLegacy,
  loadState,
  parseSave,
  readSave,
  writeSave,
  SAVE_KEY,
  LEGACY_KEYS,
} from '../src/core/persistence'
import { t } from '../src/i18n'

// Fixtures: legacy save data the migration must carry over, a player name, and
// the garbage values the system boundary has to reject.
const LEGACY_SCENE_NAME = 'Old scene'
const LEGACY_SCENE_DESCRIPTION = 'Old description'
const LEGACY_LOG_TEXT = 'Old narration'
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

  it('wraps a legacy save as __legacy for the migration path', () => {
    localStorage.setItem(
      LEGACY_KEYS[0],
      JSON.stringify({ meta: { turn: 7 }, scene: { name: LEGACY_SCENE_NAME } }),
    )
    const raw = readSave() as { __legacy?: unknown }
    expect(raw.__legacy).toBeTruthy()
  })
})

describe('migrateLegacy', () => {
  it('keeps the scene and turn count, restarting the clock from today', () => {
    const old = {
      meta: { turn: 7 },
      scene: { name: LEGACY_SCENE_NAME, description: LEGACY_SCENE_DESCRIPTION },
      log: [{ kind: 'narration', text: LEGACY_LOG_TEXT }],
    }
    const migrated = migrateLegacy(old)
    expect(migrated.meta.turn).toBe(7)
    expect(migrated.scene.name).toBe(LEGACY_SCENE_NAME)
    expect(migrated.log).toHaveLength(1)
    // 旧版是「第 N 天」，无法换算 → 时间重置为现在
    expect(Number.isNaN(Date.parse(migrated.time.iso))).toBe(false)
    expect(migrated.meta.version).toBe(3)
  })

  it('migrates an entirely empty legacy save', () => {
    expect(() => migrateLegacy(null)).not.toThrow()
    expect(migrateLegacy(undefined).meta.turn).toBe(0)
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

  it('migrates a legacy save and treats it as normal (no error)', () => {
    localStorage.setItem(LEGACY_KEYS[0], JSON.stringify({ meta: { turn: 3 } }))
    const { data, error } = loadState()
    expect(error).toBeNull()
    expect(data?.meta.turn).toBe(3)
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
    expect(localStorage.getItem(`${SAVE_KEY}.broken-` + 'x')).toBeNull() // 只是确认键名格式
    // 备份确实写进去了
    let found = 0
    for (let i = 0; ; i += 1) {
      const k = localStorage.key(i)
      if (k === null) break
      if (k.startsWith(`${SAVE_KEY}.broken-`)) found += 1
    }
    expect(found).toBe(1)
  })
})

describe('normalize fallbacks', () => {
  it('fills missing fields with the initial values', () => {
    const d = normalize({})
    expect(d.player.name).toBe(t('player.defaultName'))
    expect(d.time.calendar).toBe('real')
  })

  it('does not crash on wrong field types (number, null, nested array)', () => {
    const d = normalize({
      player: { name: 123 },
      scene: { name: null, description: [] },
      time: { iso: 456, calendar: {} },
      log: 'not-an-array',
      timeline: { nope: true },
    })
    expect(typeof d.player.name).toBe('string')
    expect(d.log).toEqual([])
    expect(d.timeline).toEqual([])
  })
})
