/**
 * 状态与存档测试。
 *
 * 重点：**坏存档不能让游戏卡死**。
 * 这些断言全部对应 v0.5.4 那次独立审查修掉的缺陷，是防回归用的。
 */
import { describe, expect, it, vi } from 'vitest'
import { GameState } from '../src/core/state'
import { createInitialState, normalize, loadState, SAVE_KEY } from '../src/core/persistence'

/** 数一数有几个 .broken- 备份键（垫片是普通对象，只能用它的 key()） */
function 备份键数量(): number {
  let n = 0
  for (let i = 0; ; i += 1) {
    const k = localStorage.key(i)
    if (k === null) break
    if (k.startsWith(`${SAVE_KEY}.broken-`)) n += 1
  }
  return n
}

describe('初始状态', () => {
  it('包含全部必需字段', () => {
    const s = createInitialState()
    expect(Object.keys(s).sort()).toEqual(['log', 'meta', 'player', 'scene', 'time', 'timeline'])
    expect(Number.isNaN(Date.parse(s.time.iso))).toBe(false)
    expect(s.time.calendar).toBe('real')
    expect(s.meta.turn).toBe(0)
  })
})

describe('load —— 存档读写', () => {
  it('没有存档时返回 null（由调用方决定开新局）', () => {
    const { data, error } = loadState()
    expect(data).toBeNull()
    expect(error).toBeNull()
  })

  it('存档损坏时不静默开新局：返回 error 并备份坏数据', () => {
    localStorage.setItem('tavernGame.save.v3', '{这不是合法 JSON')
    const { data, error } = loadState()
    expect(data).toBeNull()
    expect(error).toContain('本地存档已损坏')
    // 坏数据必须留一份，否则玩家连导出抢救的机会都没有
    expect(备份键数量()).toBe(1)
  })

  it('save 失败返回 false 而不是假装成功', () => {
    const gs = new GameState(createInitialState())
    // 垫片是普通对象（不是 Storage 实例），所以要打它自己的方法
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(gs.save()).toBe(false)
    spy.mockRestore()
  })
})

describe('normalize —— 脏存档净化', () => {
  it('null / 数组 / 字符串都不会让它抛错', () => {
    for (const bad of [null, undefined, [], 'x', 42, true]) {
      expect(() => normalize(bad)).not.toThrow()
    }
  })

  it('完全空的输入也会补成完整的初始状态', () => {
    const d = normalize({})
    expect(Object.keys(d).sort()).toEqual(['log', 'meta', 'player', 'scene', 'time', 'timeline'])
  })

  it('非法时刻回退到当前时间（否则侧栏会永久显示 NaN 年，时间工具每次都失败）', () => {
    const d = normalize({ time: { iso: '这不是时间' } })
    expect(Number.isNaN(Date.parse(d.time.iso))).toBe(false)
  })

  it('log 里的 null / 字符串元素被过滤，不留下会让 snapshot 抛错的东西', () => {
    const d = normalize({
      log: [null, 'abc', 42, { kind: 'narration', text: '正常的一条' }],
    })
    expect(d.log).toHaveLength(1)
    expect(d.log[0].text).toBe('正常的一条')
  })

  it('timeline 里的脏元素被过滤并补齐字段', () => {
    const d = normalize({ timeline: [null, { from: 'a' }] })
    expect(d.timeline).toHaveLength(1)
    expect(d.timeline[0].reason).toBe('')
    expect(d.timeline[0].elapsedMs).toBe(0)
  })

  it('回合数被强制成数字（字符串会被 endTurn 拼成 "51"）', () => {
    expect(normalize({ meta: { turn: '7' } }).meta.turn).toBe(7)
    expect(normalize({ meta: { turn: 'abc' } }).meta.turn).toBe(0)
    expect(normalize({ meta: { turn: -5 } }).meta.turn).toBe(0)
  })

  it('log 有上限，不会无限增长', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ kind: 'narration', text: '第' + i }))
    expect(normalize({ log: many }).log.length).toBeLessThanOrEqual(80)
  })
})

describe('advanceTime —— 拦住非法输入', () => {
  function fresh() {
    return new GameState(createInitialState())
  }

  it('拒绝倒退', () => {
    const s = fresh()
    const before = s.iso
    expect(s.advanceTime(-1)).toContain('不能倒退')
    expect(s.iso).toBe(before)
  })

  it('拒绝原地不动', () => {
    const s = fresh()
    const before = s.iso
    expect(s.advanceTime(0)).toContain('不能原地不动')
    expect(s.iso).toBe(before)
  })

  it('拒绝不认识的时间单位（以前会静默退回 segment，推进量错算成 4 小时）', () => {
    const s = fresh()
    const before = s.iso
    const msg = s.advanceTime(1, '光年')
    expect(msg).toContain('不认识的时间单位')
    expect(s.iso).toBe(before)
  })

  it('认复数 / 中文 / 大小写别名', () => {
    for (const u of ['days', 'DAY', '天', 'Days']) {
      const s = fresh()
      const before = Date.parse(s.iso)
      s.advanceTime(1, u)
      expect(Date.parse(s.iso) - before).toBe(86400000)
    }
  })

  it('拦住「推十万年」这类手滑输入', () => {
    const s = fresh()
    const before = s.iso
    expect(s.advanceTime(99999, 'year')).toContain('跨度太大')
    expect(s.iso).toBe(before)
  })

  it('成功推进：时间前进、写入时间线，且时间线的起点不等于终点', () => {
    const s = fresh()
    const msg = s.advanceTime(1, 'week', '等了七天')
    expect(msg).toContain('时间推进')
    expect(msg).toContain('等了七天')
    expect(s.data.timeline).toHaveLength(1)
    // 防回归：曾经 from 用的是推进后的时刻，导致 from === to
    expect(s.data.timeline[0].from).not.toBe(s.data.timeline[0].to)
    expect(s.data.timeline[0].reason).toBe('等了七天')
  })

  it('默认单位是 segment（4 小时），并且能进时间线', () => {
    const s = fresh()
    const before = Date.parse(s.iso)
    s.advanceTime(1)
    expect(Date.parse(s.iso) - before).toBe(4 * 3600000)
    // 门槛必须小于等于 4 小时，否则默认推进永远进不了时间线（曾是这个 bug）
    expect(s.data.timeline).toHaveLength(1)
  })
})

describe('未覆盖分支补测', () => {
  it('存档里的时刻被手改成非法值时，推进返回失败文案而不是抛异常', () => {
    const s = new GameState(createInitialState())
    s.data.time.iso = '不是时间'
    const out = s.advanceTime(1, 'day')
    expect(out).toContain('推进失败')
  })

  it('GameState.save 失败返回 false（写不进去也不崩）', () => {
    const s = new GameState(createInitialState())
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(s.save()).toBe(false)
    spy.mockRestore()
  })

  it('没有日志也没有历史时，快照只给时间与地点', () => {
    const s = new GameState(createInitialState())
    const snap = s.snapshot()
    expect(snap).not.toContain('最近发生的事')
    expect(snap).not.toContain('时间线')
  })

  it('时间线里的空 to 会被跳过（不让提示词出现空行）', () => {
    const s = new GameState(createInitialState())
    s.data.timeline = [{ from: 'a', to: '', reason: '', elapsedMs: 0, at: '' }]
    expect(s.snapshot()).not.toContain('### 时间线')
  })
})

describe('snapshot —— 拼提示词用，绝不能抛错', () => {
  it('正常状态包含时间 / 地点 / 回合', () => {
    const s = new GameState(createInitialState())
    const snap = s.snapshot()
    expect(snap).toContain('【第 0 回合】')
    expect(snap).toContain('时间：')
    expect(snap).toContain('地点：')
  })

  it('脏数据不会抛错（它一抛，之后每一回合都在同一处崩）', () => {
    const s = new GameState(createInitialState())
    s.data.log = [null, 'x', { text: 'ok' }] as never
    s.data.timeline = [null, { to: '' }] as never
    expect(() => s.snapshot()).not.toThrow()
  })

  it('传入历史时优先用历史', () => {
    const s = new GameState(createInitialState())
    const snap = s.snapshot([
      { role: 'user', content: '我去看看' },
      { role: 'assistant', content: '你推开门。' },
    ])
    expect(snap).toContain('最近发生的事')
    expect(snap).toContain('玩家：我去看看')
  })
})

describe('import / export', () => {
  it('导出再导入是幂等的', () => {
    const s = new GameState(createInitialState())
    s.addLog('narration', '一段故事')
    s.advanceTime(1, 'day', '睡了一觉')
    const json = s.export()

    const s2 = new GameState(createInitialState())
    s2.import(json)
    expect(s2.data.log.at(-1)?.text).toBe('一段故事')
    expect(s2.data.timeline).toHaveLength(1)
    expect(s2.iso).toBe(s.iso)
  })

  it('拒绝不是存档的 JSON', () => {
    const s = new GameState(createInitialState())
    expect(() => s.import('{"player": 1}')).toThrow('不是有效的存档文件')
    expect(() => s.import('[]')).toThrow('不是有效的存档文件')
  })
})
