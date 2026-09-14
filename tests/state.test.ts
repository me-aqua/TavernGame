/**
 * 状态与存档测试。
 *
 * 重点：**坏存档不能让游戏卡死**。
 * 这些断言全部对应 v0.5.4 那次独立审查修掉的缺陷，是防回归用的。
 */
import { describe, expect, it, vi } from 'vitest'
import * as game from '../src/game/state'
import { createInitialState, normalize } from '../src/game/save'
import { localStorageStore, SAVE_KEY } from '../src/utils/storage'
import { createGame, countBackupKeys } from './support/game-fixtures'
import { i18n, t } from '../src/i18n'

/** 坏存档内容：JSON.parse 必然失败（测试自己编的 fixture） */
const CORRUPT_SAVE_RAW = '{not valid JSON'

/** Date.parse 不接受的时刻（测试 fixture） */
const INVALID_TIME = 'not-a-valid-time'

/** 一条正常日志的文本（测试 fixture） */
const NORMAL_LOG_TEXT = 'a normal log entry'

/** 灌满日志用的填充文本（只验证条数，不关心内容） */
const FILLER_LOG_TEXT = 'filler'

/** 非规范时间单位：未收录 / 复数 / 全大写 / 另一个未收录 / 首字母大写 / 空串 */
const NON_CANONICAL_UNITS = ['lightyear', 'days', 'DAY', 'fortnight', 'Segment', '']

/** 推进时间时给出的原因（测试 fixture） */
const WAITED_A_WEEK = 'waited a week'

/** 玩家行动与模型回复（测试 fixture） */
const PLAYER_ACTION = 'I take a look'
const GM_REPLY = 'You push the door open.'

/** 日志与时间线里用的叙事文本（测试 fixture） */
const STORY_LOG_TEXT = 'a bit of story'
const SLEPT_THROUGH_THE_NIGHT = 'slept through the night'

describe('initial state', () => {
  it('contains every required field', () => {
    const s = createInitialState()
    expect(Object.keys(s).sort()).toEqual(['log', 'meta', 'player', 'scene', 'time', 'timeline'])
    expect(Number.isNaN(Date.parse(s.time.iso))).toBe(false)
    expect(s.meta.turn).toBe(0)
  })
})

describe('load - reading and writing the save', () => {
  it('starts a fresh game when there is no save', () => {
    const g = createGame()
    game.hydrateFromSave(g, localStorage)
    expect(g.loadError).toBeNull()
    expect(game.turn(g)).toBe(0)
  })

  it('a corrupted save does not silently start a new game: it returns an error and backs up the bad data', () => {
    localStorage.setItem(SAVE_KEY, CORRUPT_SAVE_RAW)
    const g = createGame()
    game.hydrateFromSave(g, localStorage)
    expect(g.loadError).toContain(t('save.corrupted', { message: '' }).replace('{message}', '').trim())
    // 坏数据必须留一份，否则玩家连导出抢救的机会都没有
    expect(countBackupKeys()).toBe(1)
  })

  it('a failed save returns false instead of pretending to succeed', () => {
    const gs = createGame()
    const store = localStorageStore(localStorage)
    // 垫片是普通对象（不是 Storage 实例），所以要打它自己的方法
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(game.save(gs, store)).toBe(false)
    spy.mockRestore()
  })
})

describe('normalize - sanitizing a dirty save', () => {
  it('null / arrays / strings never make it throw', () => {
    for (const bad of [null, undefined, [], 'x', 42, true]) {
      expect(() => normalize(bad)).not.toThrow()
    }
  })

  it('a completely empty input is filled in as a full initial state', () => {
    const d = normalize({})
    expect(Object.keys(d).sort()).toEqual(['log', 'meta', 'player', 'scene', 'time', 'timeline'])
  })

  it('an invalid instant falls back to now (otherwise the sidebar shows NaN years forever and every time tool fails)', () => {
    const d = normalize({ time: { iso: INVALID_TIME } })
    expect(Number.isNaN(Date.parse(d.time.iso))).toBe(false)
  })

  it('null / string entries in log are filtered out, leaving nothing that makes snapshot throw', () => {
    const d = normalize({
      log: [null, 'abc', 42, { kind: 'narration', text: NORMAL_LOG_TEXT }],
    })
    expect(d.log).toHaveLength(1)
    expect(d.log[0].text).toBe(NORMAL_LOG_TEXT)
  })

  it('dirty entries in timeline are filtered out and their fields are filled in', () => {
    const d = normalize({ timeline: [null, { from: 'a' }] })
    expect(d.timeline).toHaveLength(1)
    expect(d.timeline[0].reason).toBe('')
    expect(d.timeline[0].elapsedMs).toBe(0)
  })

  it('the turn count is coerced to a number (a string would make endTurn concatenate "51")', () => {
    expect(normalize({ meta: { turn: '7' } }).meta.turn).toBe(7)
    expect(normalize({ meta: { turn: 'abc' } }).meta.turn).toBe(0)
    expect(normalize({ meta: { turn: -5 } }).meta.turn).toBe(0)
  })

  it('log has a cap and does not grow without bound', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      kind: 'narration',
      text: `${FILLER_LOG_TEXT}-${i}`,
    }))
    expect(normalize({ log: many }).log.length).toBeLessThanOrEqual(80)
  })
})

describe('advanceTime - rejecting invalid input', () => {
  it('rejects a step that moves backwards', () => {
    const s = createGame()
    const before = game.iso(s)
    expect(game.advanceTime(s, -1)).toContain('backwards')
    expect(game.iso(s)).toBe(before)
  })

  it('rejects a step that stands still', () => {
    const s = createGame()
    const before = game.iso(s)
    expect(game.advanceTime(s, 0)).toContain('stand still')
    expect(game.iso(s)).toBe(before)
  })

  it('rejects non-canonical units and leaves the time untouched (no tolerance guessing left)', () => {
    // 旧版本靠一张别名表把「days / 天 / DAY」猜成 day；原生 tool calling 之后
    // 协议层用 enum 挡住了这些，引擎只认 6 个规范值。
    for (const bad of NON_CANONICAL_UNITS) {
      const s = createGame()
      const before = game.iso(s)
      const msg = game.advanceTime(s, 1, bad)
      expect(msg, `unit "${bad}" must not be accepted`).toContain('Unknown time unit')
      expect(game.iso(s), `unit "${bad}" must not change the time`).toBe(before)
    }
  })

  it('accepts only the 6 canonical units, each with the correct amount of elapsed time', () => {
    const expected: Record<string, number> = {
      segment: 4 * 3600000,
      hour: 3600000,
      day: 86400000,
      week: 7 * 86400000,
      month: 30 * 86400000, // 近似：日历月长度不一，这里只验证量级
      year: 365 * 86400000,
    }
    for (const [unit, ms] of Object.entries(expected)) {
      const s = createGame()
      const before = Date.parse(game.iso(s))
      game.advanceTime(s, 1, unit)
      const elapsed = Date.parse(game.iso(s)) - before
      if (unit === 'month') {
        // 日历月的长度取决于起点，只断言落在合理区间（28–31 天）
        expect(elapsed).toBeGreaterThanOrEqual(28 * 86400000)
        expect(elapsed).toBeLessThanOrEqual(31 * 86400000)
      } else {
        expect(elapsed, `elapsed ms for unit ${unit}`).toBe(ms)
      }
    }
  })

  it('blocks slip-of-the-hand input such as advancing a hundred thousand years', () => {
    const s = createGame()
    const before = game.iso(s)
    expect(game.advanceTime(s, 99999, 'year')).toContain('Step too large')
    expect(game.iso(s)).toBe(before)
  })

  it('a successful advance moves the clock, writes the timeline, and its start differs from its end', () => {
    const s = createGame()
    const before = game.timeLabel(s)
    const msg = game.advanceTime(s, 1, 'week', WAITED_A_WEEK)
    const after = game.timeLabel(s)
    expect(msg).toContain(t('tools.advanceResult', { before, after }))
    expect(msg).toContain(t('tools.advanceReason', { reason: WAITED_A_WEEK }))
    expect(s.data.timeline).toHaveLength(1)
    // 防回归：from 必须是**推进前**的时刻；若取推进后，from 会等于 to
    expect(s.data.timeline[0].from).not.toBe(s.data.timeline[0].to)
    expect(s.data.timeline[0].reason).toBe(WAITED_A_WEEK)
  })

  it('defaults to the segment unit (4 hours) and still reaches the timeline', () => {
    const s = createGame()
    const before = Date.parse(game.iso(s))
    game.advanceTime(s, 1)
    expect(Date.parse(game.iso(s)) - before).toBe(4 * 3600000)
    // 门槛必须小于等于 4 小时，否则默认推进永远进不了时间线（曾是这个 bug）
    expect(s.data.timeline).toHaveLength(1)
  })
})

describe('extra coverage for uncovered branches', () => {
  it('advancing returns the failure text instead of throwing when the saved instant was hand-edited to an invalid value', () => {
    const s = createGame()
    s.data.time.iso = INVALID_TIME
    const out = game.advanceTime(s, 1, 'day')
    // 文案来自 locale 表，不能手写；RangeError 的文本由 JS 引擎给，也不能硬编码
    const messages = i18n.global.getLocaleMessage(String(i18n.global.locale.value)) as {
      tools: Record<string, string>
    }
    expect(out).toContain(messages.tools.advanceFailed.split('{message}')[0])
    expect(out).toContain(game.timeLabel(s))
  })

  it('save() returns false when the write fails (a failed write does not crash)', () => {
    const s = createGame()
    const store = localStorageStore(localStorage)
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(game.save(s, store)).toBe(false)
    spy.mockRestore()
  })

  it('with neither log nor history the snapshot only carries time and place', () => {
    const s = createGame()
    const snap = game.snapshot(s)
    expect(snap).not.toContain(t('snapshot.recent'))
    expect(snap).not.toContain(t('snapshot.timeline'))
  })

  it('timeline entries with an empty to are skipped (no blank line in the prompt)', () => {
    const s = createGame()
    s.data.timeline = [{ from: 'a', to: '', reason: '', elapsedMs: 0, at: '' }]
    expect(game.snapshot(s)).not.toContain(t('snapshot.timeline'))
  })
})

describe('snapshot - built for the prompt, must never throw', () => {
  it('a normal state carries time / place / turn', () => {
    const s = createGame()
    const snap = game.snapshot(s)
    expect(snap).toContain(t('snapshot.turn', { turn: 0 }))
    expect(snap).toContain(t('snapshot.time', { time: game.timeLabel(s) }))
    expect(snap).toContain(t('snapshot.place', { name: game.sceneOf(s).name }))
  })

  it('history wins over the log when it is provided', () => {
    const s = createGame()
    const snap = game.snapshot(s, [
      { role: 'user', content: PLAYER_ACTION },
      { role: 'assistant', content: GM_REPLY },
    ])
    expect(snap).toContain(t('snapshot.recent'))
    expect(snap).toContain(t('snapshot.recentLine', { who: t('snapshot.player'), text: PLAYER_ACTION }))
  })
})

describe('import / export', () => {
  it('exporting and importing again is idempotent', () => {
    const s = createGame()
    game.addLog(s, 'narration', STORY_LOG_TEXT)
    game.advanceTime(s, 1, 'day', SLEPT_THROUGH_THE_NIGHT)
    const json = game.exportFile(s)

    const s2 = createGame()
    game.importFile(s2, json, localStorageStore(localStorage))
    expect(s2.data.log.at(-1)?.text).toBe(STORY_LOG_TEXT)
    expect(s2.data.timeline).toHaveLength(1)
    expect(game.iso(s2)).toBe(game.iso(s))
  })

  it('rejects JSON that is not a save', () => {
    const s = createGame()
    expect(() => game.importFile(s, '{"player": 1}', localStorageStore(localStorage))).toThrow(
      t('save.notValid'),
    )
    expect(() => game.importFile(s, '[]', localStorageStore(localStorage))).toThrow(t('save.notValid'))
  })
})

describe('a no-op save store', () => {
  it('reports success without touching disk (used by pure logic tests)', () => {
    const s = createGame()
    const noop = { save: () => true }
    expect(game.save(s, noop)).toBe(true) // 空实现不报错，也不落盘
    expect(localStorage.getItem(SAVE_KEY)).toBeNull()
    // 没有存档时读档 = 保持新开局
    const opened = createGame()
    game.hydrateFromSave(opened, localStorage)
    expect(game.turn(opened)).toBe(0)
  })
})

describe('narration stream (messages)', () => {
  it('appends lines with increasing ids and can be cleared', () => {
    const s = createGame()
    game.appendMessage(s, 'narration', STORY_LOG_TEXT)
    game.appendMessage(s, 'action', PLAYER_ACTION)

    expect(s.messages.map((m) => m.text)).toEqual([STORY_LOG_TEXT, PLAYER_ACTION])
    expect(s.messages[1].id).toBeGreaterThan(s.messages[0].id)

    game.clearMessages(s)
    expect(s.messages).toHaveLength(0)
  })

  it('restores only narration and actions from the log (system lines are not replayed)', () => {
    const s = createGame()
    game.addLog(s, 'narration', STORY_LOG_TEXT)
    game.addLog(s, 'system', PLAYER_ACTION)
    game.addLog(s, 'action', PLAYER_ACTION)

    game.restoreMessages(s)

    expect(s.messages.map((m) => m.kind)).toEqual(['narration', 'action'])
  })
})
