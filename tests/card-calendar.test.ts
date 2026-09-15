/**
 * card-calendar 测试 —— 历法：预设 real 复用引擎的日期算法，自定义是均匀模型。
 *
 * 判据是**可算的**：推进量只有一个数（分钟），所以每一条都拿具体时刻对答案 ——
 * 跨小时 / 跨日 / 跨月 / 跨年 / 闰年 / 日界（day.start）/ 时段边界。
 * 星期几的约定：历法元年元月元日是 weekdays[0]（均匀模型里没有别的锚点）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { realCalendar } from '../src/utils/calendar'
import { NIGHT_WATCH_CARD } from './support/card-fixtures'
import {
  advance,
  checkCalendar,
  checkTime,
  format,
  type CustomCalendar,
  type TimeValue,
} from '../src/game/card-calendar'

/** 三个 8 小时段、日界在 18:00 的自定义历法（与设计第 12 节那份同形） */
const custom = (): CustomCalendar => ({
  segments: ['dark', 'mid', 'dawn'],
  weekdays: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  day: { hours: 24, minutesPerHour: 60, start: '18:00' },
  month: { days: 30 },
  year: { months: 12 },
  display: '{year}-{month}-{day} {weekday} {segment}',
})

/** 造一个时刻（year / month / day / hour / minute 五个数） */
const at = (year: number, month: number, day: number, hour: number, minute: number): TimeValue => ({
  year,
  month,
  day,
  hour,
  minute,
})

/** 跑一次校验，把抛出的错误读成文本（通过了就返回空串） */
function errorOf(run: () => unknown): string {
  try {
    run()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('checkCalendar', () => {
  it('accepts the preset name and a full custom spec', () => {
    expect(checkCalendar('real', 'time.calendar')).toBe('real')
    expect(checkCalendar(custom(), 'time.calendar')).toEqual(custom())
  })

  it('accepts an elapsed template as an optional field', () => {
    const withElapsed = { ...custom(), elapsed: '{days} {hours} {minutes}' }
    expect(checkCalendar(withElapsed, 'time.calendar')).toBeDefined()
  })

  it('rejects an unknown preset, a non-object, and unknown or missing keys', () => {
    expect(errorOf(() => checkCalendar('lunar', 'time.calendar'))).toContain('unknown calendar preset')
    expect(errorOf(() => checkCalendar(7, 'time.calendar'))).toContain('must be a preset name')
    const extra = { ...custom(), extra: 1 }
    expect(errorOf(() => checkCalendar(extra, 'time.calendar'))).toContain('time.calendar.extra: unknown key')
    const missing = { ...custom() } as Record<string, unknown>
    delete missing.display
    expect(errorOf(() => checkCalendar(missing, 'time.calendar'))).toContain('missing key "display"')
  })

  it('rejects bad counts, a bad day start, and an unknown placeholder', () => {
    expect(errorOf(() => checkCalendar({ ...custom(), month: { days: 0 } }, 'time.calendar'))).toContain(
      'time.calendar.month.days',
    )
    expect(errorOf(() => checkCalendar({ ...custom(), segments: [] }, 'time.calendar'))).toContain(
      'time.calendar.segments',
    )
    const badStart = { ...custom(), day: { hours: 12, minutesPerHour: 60, start: '18:00' } }
    expect(errorOf(() => checkCalendar(badStart, 'time.calendar'))).toContain('time.calendar.day.start')
    const badClock = { ...custom(), day: { hours: 24, minutesPerHour: 60, start: '25:00' } }
    expect(errorOf(() => checkCalendar(badClock, 'time.calendar'))).toContain('must look like 18:00')
    const badDisplay = { ...custom(), display: '{year} {weakday}' }
    expect(errorOf(() => checkCalendar(badDisplay, 'time.calendar'))).toContain('unknown placeholder')
    const badElapsed = { ...custom(), elapsed: '{days} {weeks}' }
    expect(errorOf(() => checkCalendar(badElapsed, 'time.calendar'))).toContain('unknown placeholder')
  })
})

describe('checkTime', () => {
  it('accepts a real instant and rejects one outside the Gregorian calendar', () => {
    expect(checkTime('real', at(2026, 9, 14, 19, 30), 'time.initial')).toEqual(at(2026, 9, 14, 19, 30))
    expect(checkTime('real', at(2028, 2, 29, 0, 0), 'time.initial')).toBeDefined()
    expect(errorOf(() => checkTime('real', at(2026, 2, 29, 0, 0), 'time.initial'))).toContain(
      'time.initial.day',
    )
    expect(errorOf(() => checkTime('real', at(2026, 13, 1, 0, 0), 'time.initial'))).toContain(
      'time.initial.month',
    )
    expect(errorOf(() => checkTime('real', at(2026, 1, 1, 24, 0), 'time.initial'))).toContain(
      'time.initial.hour',
    )
  })

  it('rejects a custom instant outside the calendar units', () => {
    expect(checkTime(custom(), at(1, 12, 30, 23, 59), 'time.initial')).toBeDefined()
    expect(errorOf(() => checkTime(custom(), at(1, 13, 1, 0, 0), 'time.initial'))).toContain('must be 1-12')
    expect(errorOf(() => checkTime(custom(), at(1, 1, 31, 0, 0), 'time.initial'))).toContain('must be 1-30')
    expect(errorOf(() => checkTime(custom(), at(1, 1, 1, 24, 0), 'time.initial'))).toContain('must be 0-23')
  })

  it('rejects a missing part, a non-integer, and a wrong key set', () => {
    expect(errorOf(() => checkTime('real', { year: 2026 }, 'time.initial'))).toContain('missing key "month"')
    expect(
      errorOf(() => checkTime('real', { ...at(2026, 9, 14, 19, 30), minute: 1.5 }, 'time.initial')),
    ).toContain('must be an integer')
    expect(
      errorOf(() => checkTime('real', { ...at(2026, 9, 14, 19, 30), zone: 'UTC' }, 'time.initial')),
    ).toContain('unknown key')
  })
})

describe('advance: the real calendar', () => {
  it('moves minute by minute inside the same hour', () => {
    expect(advance('real', at(2026, 9, 14, 19, 30), 0)).toEqual(at(2026, 9, 14, 19, 30))
    expect(advance('real', at(2026, 9, 14, 19, 30), 5)).toEqual(at(2026, 9, 14, 19, 35))
    expect(advance('real', at(2026, 9, 14, 19, 30), 15)).toEqual(at(2026, 9, 14, 19, 45))
  })

  it('carries across hours and days', () => {
    expect(advance('real', at(2026, 9, 14, 23, 50), 30)).toEqual(at(2026, 9, 15, 0, 20))
    expect(advance('real', at(2026, 9, 14, 19, 30), 1440)).toEqual(at(2026, 9, 15, 19, 30))
    expect(advance('real', at(2026, 9, 30, 23, 0), 120)).toEqual(at(2026, 10, 1, 1, 0))
  })

  it('carries across a leap day', () => {
    expect(advance('real', at(2028, 2, 28, 23, 59), 2)).toEqual(at(2028, 2, 29, 0, 1))
    expect(advance('real', at(2026, 2, 28, 23, 59), 2)).toEqual(at(2026, 3, 1, 0, 1))
  })

  it('crosses a year boundary', () => {
    expect(advance('real', at(2026, 12, 31, 23, 30), 60)).toEqual(at(2027, 1, 1, 0, 30))
  })
})

describe('advance: a custom calendar', () => {
  it('carries within the day and across days', () => {
    expect(advance(custom(), at(1, 4, 12, 21, 40), 480)).toEqual(at(1, 4, 13, 5, 40))
    expect(advance(custom(), at(1, 4, 12, 23, 59), 1)).toEqual(at(1, 4, 13, 0, 0))
  })

  it('carries across months and years', () => {
    expect(advance(custom(), at(1, 4, 30, 23, 0), 60)).toEqual(at(1, 5, 1, 0, 0))
    expect(advance(custom(), at(1, 12, 30, 23, 0), 60)).toEqual(at(2, 1, 1, 0, 0))
    expect(advance(custom(), at(1, 1, 1, 0, 0), 30 * 24 * 60 * 12)).toEqual(at(2, 1, 1, 0, 0))
  })

  it('treats day.start as an offset for segments only, not for the date', () => {
    expect(advance(custom(), at(1, 4, 12, 21, 40), 480)).toEqual(at(1, 4, 13, 5, 40))
    const noStart = { ...custom(), day: { hours: 24, minutesPerHour: 60 } }
    expect(advance(noStart, at(1, 4, 12, 21, 40), 480)).toEqual(at(1, 4, 13, 5, 40))
  })
})

describe('format', () => {
  it('delegates the real calendar to the engine formatter', () => {
    const time = at(2026, 9, 14, 19, 30)
    const iso = new Date(2026, 8, 14, 19, 30).toISOString()
    expect(format('real', time)).toBe(realCalendar.format(iso))
  })

  it('fills the custom display template, weekdays and segments', () => {
    const calendar = custom()
    expect(format(calendar, at(1, 1, 1, 0, 0))).toBe('1-1-1 a dark')
    expect(format(calendar, at(1, 1, 2, 0, 0))).toBe('1-1-2 b dark')
    expect(format(calendar, at(1, 1, 8, 0, 0))).toBe('1-1-8 a dark')
  })

  it('anchors the segment at day.start', () => {
    const calendar = custom()
    expect(format(calendar, at(1, 4, 12, 17, 59))).toContain('dawn')
    expect(format(calendar, at(1, 4, 12, 18, 0))).toContain('dark')
    expect(format(calendar, at(1, 4, 13, 5, 40))).toContain('mid')
  })

  it('reads the minimal card: its night is three segments starting at 18:00', () => {
    const card = JSON.parse(readFileSync(NIGHT_WATCH_CARD, 'utf8'))
    const calendar = card.time.calendar as CustomCalendar
    const initial = card.time.initial as TimeValue
    // 段名是卡里的内容（测试代码必须 ASCII），所以只断言「落在第几段」
    expect(format(calendar, initial)).toContain(calendar.segments[0])
    const later = advance(calendar, initial, 480)
    expect(format(calendar, later)).toContain(calendar.segments[1])
    expect(later).toEqual({ ...initial, day: initial.day + 1, hour: 5, minute: 40 })
  })

  it('counts the weekday from the first day of the calendar', () => {
    const calendar = custom()
    // 30 天一个月：第 31 天是第 2 个月的 1 号（下标 30 → 30 mod 7 = 2，也就是第 3 个名字）
    expect(format(calendar, at(1, 2, 1, 0, 0))).toBe('1-2-1 c dark')
    expect(format(calendar, at(1, 1, 7, 0, 0))).toBe('1-1-7 g dark')
    expect(format(calendar, at(1, 1, 8, 0, 0))).toBe('1-1-8 a dark')
  })
})
