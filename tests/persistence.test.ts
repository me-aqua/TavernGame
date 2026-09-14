/**
 * persistence 测试 —— 系统边界的模块：读档、迁移、备份坏数据。
 *
 * 这里的每条断言都对应「玩家实际会遇到的坏情况」：
 * 旧版本存档、被手改的存档、私隐模式下写不进去。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInitialState, normalize, migrateLegacy, loadState, parseSave,
  readSave, writeSave, SAVE_KEY, LEGACY_KEYS,
} from '../src/core/persistence'

beforeEach(() => {
  localStorage.clear()
})

describe('createInitialState', () => {
  it('每次调用都拿到新的时间戳（不是同一个对象）', () => {
    const a = createInitialState()
    const b = createInitialState()
    expect(a).not.toBe(b)
    expect(Number.isNaN(Date.parse(a.time.iso))).toBe(false)
  })
})

describe('readSave', () => {
  it('没有存档返回 null', () => {
    expect(readSave()).toBeNull()
  })

  it('有存档时返回解析结果', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify(createInitialState()))
    const raw = readSave() as { player?: unknown }
    expect(raw.player).toBeTruthy()
  })

  it('缺少 player 字段时抛错', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ meta: {} }))
    expect(() => readSave()).toThrow(/缺少 player 字段/)
  })

  it('旧版存档被识别为 legacy（交给迁移处理）', () => {
    localStorage.setItem(LEGACY_KEYS[0], JSON.stringify({ meta: { turn: 7 }, scene: { name: '旧场景' } }))
    const raw = readSave() as { __legacy?: unknown }
    expect(raw.__legacy).toBeTruthy()
  })
})

describe('migrateLegacy', () => {
  it('保留场景与回合数，时间从今天重新开始', () => {
    const old = { meta: { turn: 7 }, scene: { name: '旧场景', description: '旧描述' }, log: [{ kind: 'narration', text: '旧的叙事' }] }
    const migrated = migrateLegacy(old)
    expect(migrated.meta.turn).toBe(7)
    expect(migrated.scene.name).toBe('旧场景')
    expect(migrated.log).toHaveLength(1)
    // 旧版是「第 N 天」，无法换算 → 时间重置为现在
    expect(Number.isNaN(Date.parse(migrated.time.iso))).toBe(false)
    expect(migrated.meta.version).toBe(3)
  })

  it('完全空的旧存档也能迁移', () => {
    expect(() => migrateLegacy(null)).not.toThrow()
    expect(migrateLegacy(undefined).meta.turn).toBe(0)
  })
})

describe('writeSave', () => {
  it('成功返回 true 并真的写进去', () => {
    const data = createInitialState()
    data.player.name = '测试者'
    expect(writeSave(data)).toBe(true)
    expect(localStorage.getItem(SAVE_KEY)).toContain('测试者')
  })

  it('写不进去时返回 false（调用方必须让玩家看到）', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(writeSave(createInitialState())).toBe(false)
    spy.mockRestore()
  })
})

describe('parseSave（导入文件走这里）', () => {
  it('合法存档通过', () => {
    const json = JSON.stringify(createInitialState())
    expect(parseSave(json).player.name).toBe('无名者')
  })

  it('不是对象、缺 player、数组都会被拒', () => {
    for (const bad of ['[]', '"字符串"', '{"player": 1}', '{}']) {
      expect(() => parseSave(bad)).toThrow('这不是有效的存档文件')
    }
  })

  it('坏 JSON 会抛出解析错误', () => {
    expect(() => parseSave('{坏掉的')).toThrow()
  })
})

describe('loadState —— 启动路径', () => {
  it('有合法存档时返回数据、无错误', () => {
    const data = createInitialState()
    data.meta.turn = 5
    writeSave(data)
    const { data: loaded, error } = loadState()
    expect(error).toBeNull()
    expect(loaded?.meta.turn).toBe(5)
  })

  it('旧版存档会被迁移并视为正常（不报错）', () => {
    localStorage.setItem(LEGACY_KEYS[0], JSON.stringify({ meta: { turn: 3 } }))
    const { data, error } = loadState()
    expect(error).toBeNull()
    expect(data?.meta.turn).toBe(3)
  })

  it('损坏的存档：返回错误 + 备份坏数据（玩家还有机会导出抢救）', () => {
    localStorage.setItem(SAVE_KEY, '{这不是合法 JSON')
    const { data, error } = loadState()
    expect(data).toBeNull()
    expect(error).toContain('本地存档已损坏')
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

describe('normalize 的兜底', () => {
  it('缺字段时用初始值补上', () => {
    const d = normalize({})
    expect(d.player.name).toBe('无名者')
    expect(d.time.calendar).toBe('real')
  })

  it('字段类型不对时不崩（数字、null、嵌套数组）', () => {
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
