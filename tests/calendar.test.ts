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

describe('advanceHours - date boundaries', () => {
  it('adds whole hours', () => {
    const from = '2026-09-10T02:00'
    expect(Date.parse(realCalendar.advanceHours(from, 3)) - Date.parse(from)).toBe(3 * 3600000)
  })

  it('crosses midnight into the next day', () => {
    const d = new Date(realCalendar.advanceHours('2026-09-10T23:00', 2))
    expect([d.getDate(), d.getHours()]).toEqual([11, 1])
  })

  it('in a leap year, Feb 28 plus 24 hours is Feb 29', () => {
    const d = new Date(realCalendar.advanceHours('2024-02-28T10:00', 24))
    expect([d.getMonth(), d.getDate()]).toEqual([1, 29])
  })

  it('in a common year, Feb 28 plus 24 hours is Mar 1', () => {
    const d = new Date(realCalendar.advanceHours('2026-02-28T10:00', 24))
    expect([d.getMonth(), d.getDate()]).toEqual([2, 1])
  })

  it('crosses the end of a month and the end of a year', () => {
    // 1 月 31 日 + 24 小时 = 2 月 1 日（不跳月，Date 按天数走）
    const d = new Date(realCalendar.advanceHours('2026-01-31T10:00', 24))
    expect([d.getMonth(), d.getDate()]).toEqual([1, 1])
    expect(new Date(realCalendar.advanceHours('2026-12-31T10:00', 24)).getFullYear()).toBe(2027)
  })

  it('accepts zero hours (a turn that does not move the clock)', () => {
    const from = '2026-09-10T02:00'
    expect(realCalendar.advanceHours(from, 0)).toBe(new Date(from).toISOString())
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
})

describe('Calendar registry', () => {
  it('nowIso returns a parseable ISO string', () => {
    expect(Number.isNaN(Date.parse(nowIso()))).toBe(false)
  })
})
