/**
 * 历法测试 —— 重点盯「手写日期运算一定会算错」的那些边界。
 */
import { describe, expect, it } from 'vitest'
import { realCalendar, hourToSegment, getCalendar, nowIso } from '../src/core/calendar'

describe('时段映射', () => {
  it('按小时分上午 / 下午 / 晚上', () => {
    expect(hourToSegment(0)).toBe(0)
    expect(hourToSegment(11)).toBe(0)
    expect(hourToSegment(12)).toBe(1)
    expect(hourToSegment(17)).toBe(1)
    expect(hourToSegment(18)).toBe(2)
    expect(hourToSegment(23)).toBe(2)
  })
})

describe('advance —— 日期边界', () => {
  it('加一个月遇到月末：向上溢出（Date 的既定行为，不是 bug）', () => {
    // 1 月 31 日 + 1 个月：2 月没有 31 日 → 溢出到 3 月 3 日（平年）
    const { iso } = realCalendar.advance('2026-01-31T10:00:00.000Z', 1, 'month')
    const d = new Date(iso)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2) // 3 月
    expect(d.getDate()).toBe(3)
  })

  it('闰年 2 月 28 日 + 1 天 = 2 月 29 日', () => {
    const { iso } = realCalendar.advance('2024-02-28T10:00:00.000Z', 1, 'day')
    const d = new Date(iso)
    expect(d.getMonth()).toBe(1)
    expect(d.getDate()).toBe(29)
  })

  it('平年 2 月 28 日 + 1 天 = 3 月 1 日', () => {
    const { iso } = realCalendar.advance('2026-02-28T10:00:00.000Z', 1, 'day')
    const d = new Date(iso)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(1)
  })

  it('跨年', () => {
    const { iso } = realCalendar.advance('2026-12-31T10:00:00.000Z', 1, 'day')
    expect(new Date(iso).getFullYear()).toBe(2027)
  })

  it('一个 segment = 4 小时', () => {
    const { elapsedMs } = realCalendar.advance('2026-09-10T02:00:00.000Z', 1, 'segment')
    expect(elapsedMs).toBe(4 * 3600000)
  })

  it('周 = 7 天', () => {
    const { elapsedMs } = realCalendar.advance('2026-09-10T02:00:00.000Z', 2, 'week')
    expect(elapsedMs).toBe(14 * 86400000)
  })

  it('elapsedMs 是正数且等于 iso 之差', () => {
    const from = '2026-09-10T02:00:00.000Z'
    const { iso, elapsedMs } = realCalendar.advance(from, 3, 'day')
    expect(elapsedMs).toBe(Date.parse(iso) - Date.parse(from))
  })
})

describe('describeElapsed —— 时长换算', () => {
  it('不足一小时按分钟', () => {
    expect(realCalendar.describeElapsed(30 * 60000)).toBe('过去了 30 分钟')
  })

  it('不足一天按小时', () => {
    expect(realCalendar.describeElapsed(5 * 3600000)).toBe('过去了 5 小时')
  })

  it('整 47 小时 → 只报天数（已知取舍：丢掉小时）', () => {
    // 这是 AGENTS.md 记录的未修问题 #3，断言当前行为以便将来改的时候有提示
    expect(realCalendar.describeElapsed(47 * 3600000)).toBe('过去了 1 天')
  })

  it('365 天 = 1 年（不会凭空多出 5 天）', () => {
    expect(realCalendar.describeElapsed(365 * 86400000)).toBe('过去了 1 年')
  })

  it('400 天 = 1 年 1 个月 5 天', () => {
    // 防回归：以前写成 days % 365 / 30 配 days % 30，
    // 两个取模都从「年」里吃天数，每满一年就凭空多 5 天
    expect(realCalendar.describeElapsed(400 * 86400000)).toBe('过去了 1 年 1 个月 5 天')
  })

  it('730 天 = 2 年（不是 2 年 10 天）', () => {
    expect(realCalendar.describeElapsed(730 * 86400000)).toBe('过去了 2 年')
  })

  it('0 或负数返回空串', () => {
    expect(realCalendar.describeElapsed(0)).toBe('')
    expect(realCalendar.describeElapsed(-1000)).toBe('')
  })
})

describe('历法注册表', () => {
  it('未知历法回退到默认而不是抛错', () => {
    expect(getCalendar('不存在的历法').id).toBe('real')
    expect(getCalendar(undefined).id).toBe('real')
  })

  it('nowIso 返回可解析的 ISO 字符串', () => {
    expect(Number.isNaN(Date.parse(nowIso()))).toBe(false)
  })
})
