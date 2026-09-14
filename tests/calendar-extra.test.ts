/**
 * calendar.ts 补充测试 —— 覆盖未走到的单位分支与时长文案分支。
 */
import { describe, expect, it } from 'vitest'
import { realCalendar, hourToSegment } from '../src/core/calendar'

describe('advance —— 未覆盖的时间单位', () => {
  it('hour：按小时推进', () => {
    const { iso, elapsedMs } = realCalendar.advance('2026-09-10T02:00:00.000Z', 3, 'hour')
    expect(elapsedMs).toBe(3 * 3600000)
    expect(new Date(iso).getUTCHours()).toBe(5)
  })

  it('year：按年推进（跨闰年也由 Date 处理）', () => {
    const { iso } = realCalendar.advance('2024-02-29T10:00:00.000Z', 1, 'year')
    // 2024-02-29 + 1 年 → 2025-02-28（2025 不是闰年，Date 向上溢出到 3/1 或落到 2/28）
    const d = new Date(iso)
    expect(d.getFullYear()).toBe(2025)
    expect([1, 2]).toContain(d.getMonth()) // 2 月或 3 月，取决于运行环境实现
  })

  it('未知单位走 default 分支并抛错（穷尽性检查）', () => {
    expect(() => realCalendar.advance('2026-09-10T02:00:00.000Z', 1, '光年' as never)).toThrow(
      /Unknown time unit|不认识/,
    )
  })
})

describe('describeElapsed —— 未覆盖的文案分支', () => {
  it('不足一天但满 1 小时 → 小时', () => {
    expect(realCalendar.describeElapsed(3600000)).toBe('过去了 1 小时')
  })

  it('满 30 天但不足 365 → 至少出现「个月」', () => {
    expect(realCalendar.describeElapsed(45 * 86400000)).toContain('个月')
  })

  it('整 30 天 → 1 个月（remDays 为 0，不追加「天」分支）', () => {
    expect(realCalendar.describeElapsed(30 * 86400000)).toBe('过去了 1 个月')
  })

  it('不足 1 小时 → 分钟（elapsedMinutes 分支）', () => {
    expect(realCalendar.describeElapsed(30 * 60000)).toBe('过去了 30 分钟')
  })

  it('负数或 0 → 空串', () => {
    expect(realCalendar.describeElapsed(0)).toBe('')
    expect(realCalendar.describeElapsed(-1)).toBe('')
  })
})

describe('hourToSegment —— 边界', () => {
  it('11/12/17/18 几个分界点', () => {
    expect(hourToSegment(11)).toBe(0)
    expect(hourToSegment(12)).toBe(1)
    expect(hourToSegment(17)).toBe(1)
    expect(hourToSegment(18)).toBe(2)
  })
})
