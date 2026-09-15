/**
 * 历法测试 —— 重点盯「手写日期运算一定会算错」的那些边界。
 *
 * 这里只测 realCalendar 的显示与加减（card/3 的 real 预设用它）；推进量按**分钟**算的
 * 那一层在 tests/card-calendar.test.ts。
 */
import { describe, expect, it } from 'vitest'
import { realCalendar, hourToSegment, nowIso, segmentName } from '../src/utils/calendar'
import { t } from '../src/i18n'

describe('Hour to segment mapping', () => {
  it('splits the day into morning, afternoon and evening by hour', () => {
    expect(hourToSegment(0)).toBe(0)
    expect(hourToSegment(11)).toBe(0)
    expect(hourToSegment(12)).toBe(1)
    expect(hourToSegment(17)).toBe(1)
    expect(hourToSegment(18)).toBe(2)
    expect(hourToSegment(23)).toBe(2)
  })
})

describe('advance - date boundaries', () => {
  it('overflows upward when the target month has no such day (Date behaviour, not a bug)', () => {
    // 1 月 31 日 + 1 个月：2 月没有 31 日 → 溢出到 3 月 3 日（平年）
    const { iso } = realCalendar.advance('2026-01-31T10:00:00.000Z', 1, 'month')
    const d = new Date(iso)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2) // 3 月
    expect(d.getDate()).toBe(3)
  })

  it('in a leap year, Feb 28 plus one day is Feb 29', () => {
    const { iso } = realCalendar.advance('2024-02-28T10:00:00.000Z', 1, 'day')
    const d = new Date(iso)
    expect(d.getMonth()).toBe(1)
    expect(d.getDate()).toBe(29)
  })

  it('in a common year, Feb 28 plus one day is Mar 1', () => {
    const { iso } = realCalendar.advance('2026-02-28T10:00:00.000Z', 1, 'day')
    const d = new Date(iso)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(1)
  })

  it('crosses the year boundary', () => {
    const { iso } = realCalendar.advance('2026-12-31T10:00:00.000Z', 1, 'day')
    expect(new Date(iso).getFullYear()).toBe(2027)
  })

  it('treats one segment as four hours', () => {
    const { elapsedMs } = realCalendar.advance('2026-09-10T02:00:00.000Z', 1, 'segment')
    expect(elapsedMs).toBe(4 * 3600000)
  })

  it('treats one week as seven days', () => {
    const { elapsedMs } = realCalendar.advance('2026-09-10T02:00:00.000Z', 2, 'week')
    expect(elapsedMs).toBe(14 * 86400000)
  })

  it('reports an elapsedMs equal to the difference between the two ISO instants', () => {
    const from = '2026-09-10T02:00:00.000Z'
    const { iso, elapsedMs } = realCalendar.advance(from, 3, 'day')
    expect(elapsedMs).toBe(Date.parse(iso) - Date.parse(from))
  })
})

describe('format', () => {
  it('renders year / weekday / segment through the locale table', () => {
    const iso = '2026-09-10T02:00:00.000Z'
    const d = new Date(iso)
    const expected =
      t('calendar.yearMonthDay', { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }) +
      t('calendar.dateSeparator') +
      t(`calendar.weekday.${d.getDay()}`) +
      t('calendar.dateSeparator') +
      segmentName(d.getHours())
    expect(realCalendar.format(iso)).toBe(expected)
  })

  it('throws on an unknown time unit (input outside the union type)', () => {
    expect(() => realCalendar.advance('2026-09-10T02:00:00.000Z', 1, 'light-year' as never)).toThrow(
      /Unknown time unit/,
    )
  })
})

describe('Calendar registry', () => {
  it('nowIso returns a parseable ISO string', () => {
    expect(Number.isNaN(Date.parse(nowIso()))).toBe(false)
  })
})
