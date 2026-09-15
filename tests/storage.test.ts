/**
 * storage 测试 —— localStorage 适配层：读写、坏档报告、备份。
 *
 * 键名与备份策略都属于存储层，形状校验在 game/save.ts。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { localStorageStore, backupBrokenSave, SAVE_KEY } from '../src/utils/storage'
import { createInitialState } from '../src/game/save'
import { currentCard } from '../src/game/current-card'
import { t } from '../src/i18n'

/** 存档写入失败时用的假实现（隐私模式 / 配额满） */
function throwingStorage(): Storage {
  return {
    ...localStorage,
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
    /** 不需要删键 */
    removeItem: () => {},
    /** 不需要清空 */
    clear: () => {},
    key: () => null,
    length: 0,
  } as Storage
}

beforeEach(() => {
  localStorage.clear()
})

describe('localStorageStore.load', () => {
  it('returns null when there is no save', () => {
    expect(localStorageStore(localStorage).load()).toBeNull()
  })

  it('returns the parsed result when a save exists', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify(createInitialState(currentCard)))
    const raw = localStorageStore(localStorage).load() as { meta?: { card?: unknown } }
    expect(raw.meta?.card).toBeTruthy()
  })

  it('reports broken JSON as a corrupted save (with the parser message)', () => {
    localStorage.setItem(SAVE_KEY, '{ broken')
    expect(() => localStorageStore(localStorage).load()).toThrow(
      t('save.corrupted', { message: '' }).replace('{message}', '').trim(),
    )
  })

  it('rejects data that parses but is not a save object', () => {
    localStorage.setItem(SAVE_KEY, '"a string"')
    expect(() => localStorageStore(localStorage).load()).toThrow(t('save.notValid'))
  })
})

describe('localStorageStore.save', () => {
  it('returns true and really writes the data', () => {
    const data = createInitialState(currentCard)
    ;(data.state.lead as Record<string, unknown>).name = 'Tester'
    expect(localStorageStore(localStorage).save(data)).toBe(true)
    expect(localStorage.getItem(SAVE_KEY)).toContain('Tester')
  })

  it('returns false when the write fails (the caller must show the player)', () => {
    expect(localStorageStore(throwingStorage()).save(createInitialState(currentCard))).toBe(false)
  })
})

describe('backupBrokenSave', () => {
  it('keeps one copy of the broken data, not one per launch', () => {
    localStorage.setItem(SAVE_KEY, '{ broken')
    backupBrokenSave(localStorage)
    backupBrokenSave(localStorage)
    backupBrokenSave(localStorage)

    let n = 0
    for (let i = 0; ; i += 1) {
      const k = localStorage.key(i)
      if (k === null) break
      if (k.startsWith(SAVE_KEY + '.broken-')) n += 1
    }
    expect(n).toBe(1)
  })

  it('does nothing when there is no save to back up', () => {
    expect(() => backupBrokenSave(localStorage)).not.toThrow()
    expect(localStorage.length).toBe(0)
  })
})
