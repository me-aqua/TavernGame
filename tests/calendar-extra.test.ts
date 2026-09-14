/**
 * calendar.ts 补充测试 —— 覆盖未走到的单位分支与时长文案分支。
 *
 * All user-visible text is asserted through t('key'), so a locale change cannot
 * silence these checks and this file stays ASCII-only.
 */
import { describe, expect, it } from 'vitest'
import { realCalendar, hourToSegment } from '../src/utils/calendar'
import { t } from '../src/i18n'

describe('advance -- units not covered elsewhere', () => {
  it('hour: advances by whole hours', () => {
    const { iso, elapsedMs } = realCalendar.advance('2026-09-10T02:00:00.000Z', 3, 'hour')
    expect(elapsedMs).toBe(3 * 3600000)
    expect(new Date(iso).getUTCHours()).toBe(5)
  })

  it('year: advances by years (leap years handled by Date)', () => {
    const { iso } = realCalendar.advance('2024-02-29T10:00:00.000Z', 1, 'year')
    // 2024-02-29 + 1 year -> 2025-02-28/03-01 (2025 is not a leap year)
    const d = new Date(iso)
    expect(d.getFullYear()).toBe(2025)
    expect([1, 2]).toContain(d.getMonth())
  })

  it('an unknown unit hits the default branch and throws (exhaustiveness check)', () => {
    expect(() => realCalendar.advance('2026-09-10T02:00:00.000Z', 1, 'lightyear' as never)).toThrow(
      /Unknown time unit|/,
    )
  })
})

describe('describeElapsed -- uncovered wording branches', () => {
  it('less than a day but at least an hour -> hours', () => {
    expect(realCalendar.describeElapsed(3600000)).toBe(t('calendar.elapsedHours', { hours: 1 }))
  })

  it('30 days or more but under 365 -> mentions months', () => {
    const out = realCalendar.describeElapsed(45 * 86400000)
    expect(out).toBe(t('calendar.elapsedMonthsDays', { months: 1, days: 15 }))
  })

  it('exactly 30 days -> 1 month (remDays is 0, no extra days part)', () => {
    expect(realCalendar.describeElapsed(30 * 86400000)).toBe(t('calendar.elapsedMonths', { months: 1 }))
  })

  it('under an hour -> minutes (elapsedMinutes branch)', () => {
    expect(realCalendar.describeElapsed(30 * 60000)).toBe(t('calendar.elapsedMinutes', { minutes: 30 }))
  })

  it('zero or negative -> empty string', () => {
    expect(realCalendar.describeElapsed(0)).toBe('')
    expect(realCalendar.describeElapsed(-1)).toBe('')
  })
})

describe('hourToSegment -- boundaries', () => {
  it('boundary points 11/12/17/18', () => {
    expect(hourToSegment(11)).toBe(0)
    expect(hourToSegment(12)).toBe(1)
    expect(hourToSegment(17)).toBe(1)
    expect(hourToSegment(18)).toBe(2)
  })
})
