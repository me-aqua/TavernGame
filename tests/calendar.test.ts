/**
 * 历法测试 —— 重点盯「手写日期运算一定会算错」的那些边界。
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

describe('describeElapsed - duration conversion', () => {
  it('reports minutes below one hour', () => {
    expect(realCalendar.describeElapsed(30 * 60000)).toBe(t('calendar.elapsedMinutes', { minutes: 30 }))
  })

  it('reports hours below one day', () => {
    expect(realCalendar.describeElapsed(5 * 3600000)).toBe(t('calendar.elapsedHours', { hours: 5 }))
  })

  it('reports days only at exactly 47 hours (known trade-off: hours are dropped)', () => {
    // 这是 AGENTS.md 记录的未修问题 #3，断言当前行为以便将来改的时候有提示
    expect(realCalendar.describeElapsed(47 * 3600000)).toBe(
      t('calendar.elapsed', { parts: t('calendar.days', { days: 1 }) }),
    )
  })

  it('turns 365 days into one year (no phantom extra days)', () => {
    expect(realCalendar.describeElapsed(365 * 86400000)).toBe(
      t('calendar.elapsed', { parts: t('calendar.years', { years: 1 }) }),
    )
  })

  it('turns 400 days into 1 year 1 month 5 days', () => {
    // 防回归：以前写成 days % 365 / 30 配 days % 30，
    // 两个取模都从「年」里吃天数，每满一年就凭空多 5 天
    expect(realCalendar.describeElapsed(400 * 86400000)).toBe(
      t('calendar.elapsed', {
        parts: [
          t('calendar.years', { years: 1 }),
          t('calendar.months', { months: 1 }),
          t('calendar.days', { days: 5 }),
        ].join(' '),
      }),
    )
  })

  it('turns 730 days into 2 years (not 2 years and 10 days)', () => {
    expect(realCalendar.describeElapsed(730 * 86400000)).toBe(
      t('calendar.elapsed', { parts: t('calendar.years', { years: 2 }) }),
    )
  })

  it('returns an empty string for zero or a negative value', () => {
    expect(realCalendar.describeElapsed(0)).toBe('')
    expect(realCalendar.describeElapsed(-1000)).toBe('')
  })
})

describe('Extra branches', () => {
  it('throws on an unknown time unit (input outside the union type)', () => {
    expect(() => realCalendar.advance('2026-09-10T02:00:00.000Z', 1, 'light-year' as never)).toThrow(
      /Unknown time unit/,
    )
  })

  it('still reports days once there is at least one month', () => {
    // 45 天 = 1 个月 15 天
    expect(realCalendar.describeElapsed(45 * 86400000)).toBe(
      t('calendar.elapsed', {
        parts: [t('calendar.months', { months: 1 }), t('calendar.days', { days: 15 })].join(' '),
      }),
    )
  })

  it('formatShort is the short format (no year)', () => {
    const iso = '2026-09-10T02:00:00.000Z'
    const d = new Date(iso)
    const expected =
      t('calendar.monthDay', { month: d.getMonth() + 1, day: d.getDate() }) +
      t('calendar.dateSeparator') +
      segmentName(d.getHours())
    expect(realCalendar.formatShort(iso)).toBe(expected)
  })

  // 历法说明是提示词，在 prompts/calendar.md 里（断言在 tests/prompts.test.ts）
})

describe('Calendar registry', () => {
  it('nowIso returns a parseable ISO string', () => {
    expect(Number.isNaN(Date.parse(nowIso()))).toBe(false)
  })
})
