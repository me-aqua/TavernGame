/**
 * 状态测试（game/state.ts）—— 一轮之外的一切：初始帧、事件流、时间推进、落盘。
 *
 * 存档的形状与卡的身份在 tests/save.test.ts；这里管「校验通过之后」的行为。
 */
import { describe, expect, it, vi } from 'vitest'
import * as game from '../src/game/state'
import { createInitialState, identityOf } from '../src/game/save'
import { instantiate } from '../src/game/card-state'
import { clockIn } from '../src/game/card-time'
import { advance, format } from '../src/game/card-calendar'
import { localStorageStore, SAVE_KEY } from '../src/utils/storage'
import { currentCard } from '../src/game/current-card'
import { t } from '../src/i18n'
import { loadCard, NIGHT_WATCH_CARD } from './support/card-fixtures'
import { createGame, countBackupKeys } from './support/game-fixtures'

/* ---- 测试自己编的 fixture（非产品文案） ---- */
const STORY_LINE = 'a bit of story'
const DEBUG_LINE = 'a trace line'
const WAITED = 'waited a while'
const CORRUPT_SAVE_RAW = '{not valid JSON'
const CUSTOM_STEP = 8 * 60

const logText = (i: number) => 'entry ' + i

describe('initialState - the first frame comes from the card', () => {
  it('has exactly the four top-level pieces', () => {
    const s = game.initialState()
    // ⚠️ 顶层没有 `time` —— 时刻住在状态树里（R39），引擎手里不留第二份
    expect(Object.keys(s.data).sort()).toEqual(['events', 'meta', 'state', 'timeline'])
    expect(s.loadError).toBeNull()
    expect(s.data.meta.turn).toBe(0)
    expect(s.data.events).toEqual([])
    expect(s.data.timeline).toEqual([])
  })

  it('writes the card identity into meta.card (a save knows which card it belongs to)', () => {
    expect(game.initialState().data.meta.card).toEqual(identityOf(currentCard))
  })

  it('instantiates the state tree and the clock from the card (nothing hardcoded)', () => {
    const s = game.initialState()
    expect(s.data.state).toEqual(instantiate(currentCard))
    expect(clockIn(s.data.state)).toEqual(clockIn(instantiate(currentCard)))
  })
})

describe('timeText', () => {
  it('renders a moment with the given card calendar', () => {
    expect(game.timeText(currentCard.time.calendar, clockIn(instantiate(currentCard)))).toBe(
      format(currentCard.time.calendar, clockIn(instantiate(currentCard))),
    )
  })
})

describe('addEvent - one stream, only the debug side is capped', () => {
  it('appends one event with a timestamp', () => {
    const s = createGame()
    game.addEvent(s.data, { kind: 'narration', text: STORY_LINE })
    expect(s.data.events).toHaveLength(1)
    expect(s.data.events[0].text).toBe(STORY_LINE)
    expect(Number.isNaN(Date.parse(s.data.events[0].at))).toBe(false)
  })

  it('keeps the whole story stream (the model memory is never trimmed)', () => {
    const s = createGame()
    for (let i = 0; i < 100; i += 1) game.addEvent(s.data, { kind: 'narration', text: logText(i) })
    expect(s.data.events, 'no story event may be dropped').toHaveLength(100)
    expect(s.data.events[0].text, 'the earliest story event is still there').toBe(logText(0))
  })

  it('still caps the debug stream at the last 120 (only the story window was widened)', () => {
    const debug = createGame()
    for (let i = 0; i < 200; i += 1) game.addEvent(debug.data, { kind: 'tool', text: logText(i) })
    // ⚠️ 120 是**故意写死**的：调试预算是老板没碰的那一路，从源头现取会让「顺手改上限」悄悄通过
    expect(debug.data.events).toHaveLength(120)
    expect(debug.data.events[0].text).toBe(logText(80))
    expect(debug.data.events.at(-1)?.text).toBe(logText(199))
  })

  it('debug noise cannot push the story out (that is the model memory)', () => {
    const s = createGame()
    for (let i = 0; i < 30; i += 1) game.addEvent(s.data, { kind: 'narration', text: logText(i) })
    for (let i = 0; i < 300; i += 1) game.addEvent(s.data, { kind: 'tool', text: DEBUG_LINE })
    expect(s.data.events.filter((event) => event.kind === 'narration')).toHaveLength(30)
  })
})

describe('advanceTime - the clock moves by minutes of the card calendar', () => {
  it('moves the clock and reports the new moment', () => {
    const s = createGame()
    const calendar = currentCard.time.calendar
    const before = clockIn(s.data.state)
    // 具体进位由历法负责（tests/card-calendar.test.ts 逐条走通）；
    // 这里证明 state 层真的把它接上了：时钟走到历法算出来的那一刻
    const expected = format(calendar, advance(calendar, before, 60))

    const out = game.advanceTime(s.data, calendar, 60, WAITED)

    expect(game.timeText(calendar, clockIn(s.data.state))).toBe(expected)
    expect(out).toContain(t('tools.advanceDone', { minutes: 60, time: expected }))
    expect(out).toContain(t('tools.advanceReason', { reason: WAITED }))
  })

  it('minutes = 0 is legal: the clock stands still and nothing reaches the timeline', () => {
    const s = createGame()
    const calendar = currentCard.time.calendar
    const before = { ...clockIn(s.data.state) }

    const out = game.advanceTime(s.data, calendar, 0, WAITED)

    expect(clockIn(s.data.state)).toEqual(before)
    expect(s.data.timeline).toEqual([])
    expect(out).toContain(t('tools.advanceStill', { time: game.timeText(calendar, before) }))
  })

  it('falls back to the card calendar when rendering (a custom calendar has custom segments)', () => {
    const card = loadCard(NIGHT_WATCH_CARD)
    const data = createInitialState(card)
    const out = game.advanceTime(data, card.time.calendar, CUSTOM_STEP, WAITED)

    // 这张卡的一天三段是它自己声明的：推进量按分钟算，进位由历法负责
    const expected = { year: 1, month: 4, day: 13, hour: 5, minute: 40 }
    expect(clockIn(data.state)).toEqual(expected)
    expect(out).toContain(
      t('tools.advanceDone', { minutes: CUSTOM_STEP, time: format(card.time.calendar, expected) }),
    )
  })

  it('records a notable jump with its start, its end and its reason', () => {
    const s = createGame()
    const calendar = currentCard.time.calendar
    const from = game.timeText(calendar, clockIn(s.data.state))

    game.advanceTime(s.data, calendar, 1440, WAITED)

    expect(s.data.timeline).toHaveLength(1)
    expect(s.data.timeline[0].from).toBe(from)
    expect(s.data.timeline[0].minutes).toBe(1440)
    expect(s.data.timeline[0].reason).toBe(WAITED)
    // 防回归：from 必须是**推进前**的时刻，若取推进后 from 会等于 to
    expect(s.data.timeline[0].from).not.toBe(s.data.timeline[0].to)
  })

  it('does not record a small jump once the timeline already has three entries', () => {
    const s = createGame()
    const calendar = currentCard.time.calendar
    for (let i = 0; i < 3; i += 1) game.advanceTime(s.data, calendar, 1440, WAITED)
    const before = s.data.timeline.length
    game.advanceTime(s.data, calendar, 60, WAITED)
    expect(s.data.timeline).toHaveLength(before)
  })

  it('caps the timeline', () => {
    const s = createGame()
    const calendar = currentCard.time.calendar
    for (let i = 0; i < 50; i += 1) game.advanceTime(s.data, calendar, 1440, WAITED)
    expect(s.data.timeline).toHaveLength(40)
  })
})

describe('save / reset / import / export', () => {
  it('a failed save returns false instead of pretending to succeed', () => {
    const s = createGame()
    const store = localStorageStore(localStorage)
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(game.save(s, store)).toBe(false)
    spy.mockRestore()
  })

  it('export -> import is idempotent, and importing replaces the story', () => {
    const s = createGame()
    game.addEvent(s.data, { kind: 'narration', text: STORY_LINE })
    game.advanceTime(s.data, currentCard.time.calendar, 1440, WAITED)
    const json = game.exportFile(s)

    const other = createGame()
    game.addEvent(other.data, { kind: 'narration', text: 'the old story' })
    game.importFile(other, json, localStorageStore(localStorage))

    expect(other.data.events.map((event) => event.text)).toEqual([STORY_LINE])
    expect(other.data.timeline).toHaveLength(1)
    expect(clockIn(other.data.state)).toEqual(clockIn(s.data.state))
  })

  it('rejects JSON that is not a save', () => {
    const s = createGame()
    for (const bad of ['[]', '"a string"', '{}', '{"player": 1}']) {
      expect(() => game.importFile(s, bad, localStorageStore(localStorage)), bad).toThrow()
    }
  })

  it('reset writes back a fresh initial state and clears the old story', () => {
    const s = createGame()
    game.addEvent(s.data, { kind: 'narration', text: STORY_LINE })
    game.advanceTime(s.data, currentCard.time.calendar, 1440, WAITED)

    game.reset(s, localStorageStore(localStorage))

    expect(s.data.events).toEqual([])
    expect(s.data.timeline).toEqual([])
    expect(game.turn(s)).toBe(0)
    expect(localStorage.getItem(SAVE_KEY)).toBeTruthy()
  })

  it('a no-op save store reports success without touching disk', () => {
    const s = createGame()
    expect(game.save(s, { save: () => true })).toBe(true)
    expect(localStorage.getItem(SAVE_KEY)).toBeNull()
  })
})

describe('hydrateFromSave - a bad save is backed up, explained, replaced by a blank game', () => {
  it('starts a fresh game when there is no save', () => {
    const g = createGame()
    game.hydrateFromSave(g, localStorage)
    expect(g.loadError).toBeNull()
    expect(game.turn(g)).toBe(0)
  })

  it('a corrupted save does not silently start a new game: it returns an error and backs the data up', () => {
    localStorage.setItem(SAVE_KEY, CORRUPT_SAVE_RAW)
    const g = createGame()
    game.hydrateFromSave(g, localStorage)
    expect(g.loadError).toContain(t('save.corrupted', { message: '' }).replace('{message}', '').trim())
    // 坏数据必须留一份，否则玩家连导出抢救的机会都没有
    expect(countBackupKeys()).toBe(1)
  })

  it('refuses a save that belongs to another card (and backs it up)', () => {
    const other = createInitialState(loadCard(NIGHT_WATCH_CARD))
    localStorage.setItem(SAVE_KEY, JSON.stringify(other))

    const g = createGame()
    game.hydrateFromSave(g, localStorage)

    // 报错说清两边是谁：存档里的卡与当前卡
    expect(g.loadError).toContain(other.meta.card.id)
    expect(g.loadError).toContain(currentCard.card.id)
    expect(countBackupKeys()).toBe(1)
    // 拒绝之后是**空白开局**：没有拿旧状态硬跑新卡
    expect(g.data.meta.card).toEqual(identityOf(currentCard))
    expect(g.data.meta.turn).toBe(0)
  })
})
