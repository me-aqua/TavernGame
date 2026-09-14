/**
 * src/core/calendar.ts —— 历法
 *
 * ## 当前只有一种：现实日历
 *
 * 游戏从**玩家开始玩的那一刻**的真实时间开始，之后按真实公历走。
 *
 * ## 为什么日期运算交给 Date
 *
 * 全部用 JavaScript 的 Date 做加减，不手写除法。
 * 手写估算会在这两个地方翻车：
 *   - 「1 月 31 日 + 1 个月」—— 2 月没有 31 日
 *   - 「闰年 2 月 28 日 + 1 天」—— 到底是不是 2 月 29 日
 *
 * ## 内部统一用 ISO 时刻
 *
 * 状态里存的是一个绝对时刻（ISO 字符串），显示成什么样由这里决定。
 * 这样以后真要换历法，同一时刻能直接换个显示方式，不用迁移存档。
 */

/** 一天的时段 */
import { t } from '../i18n'

/** 时段键（协议/内部用）；显示名走 locale 的 calendar.segment.* */
export const SEGMENTS = ['morning', 'afternoon', 'evening'] as const

/** 时段名 */
export type SegmentName = (typeof SEGMENTS)[number]

/** 时间单位（历法只认这些） */
export type TimeUnit = 'segment' | 'hour' | 'day' | 'week' | 'month' | 'year'

/** 一次时间推进的结果 */
export interface AdvanceResult {
  iso: string
  elapsedMs: number
}

/** 历法接口 —— 以后要加别的历法，实现这几个方法即可 */
export interface Calendar {
  id: string
  label: string
  description: string
  /** 「2026 年 9 月 10 日 · 星期四 · 晚上」 */
  format(iso: string): string
  /** 「9 月 10 日 · 晚上」 */
  formatShort(iso: string): string
  /** 推进时间 */
  advance(iso: string, step: number, unit: TimeUnit): AdvanceResult
  /** 把毫秒差说成人话 */
  describeElapsed(ms: number): string
  // ⚠️ 这里**没有**「给模型看的历法说明」—— 提示词内容一律在
  //    prompts/calendar.md（提示词与代码分离，由 prompts.ts 装配）
}

/** 把小时数映射到时段索引 */
export function hourToSegment(hour: number): number {
  if (hour < 12) return 0 // morning
  if (hour < 18) return 1 // afternoon
  return 2 // evening
}

/** Localized segment label for an hour */
export function segmentName(hour: number): string {
  const key = SEGMENTS[hourToSegment(hour)]
  return t(`calendar.segment.${key}`)
}

/** 日历预设：现实公历 */
export const realCalendar: Calendar = {
  id: 'real',
  label: 'real',
  description: 'real',

  format(iso: string): string {
    const d = new Date(iso)
    const date = t('calendar.yearMonthDay', {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    })
    const sep = t('calendar.dateSeparator')
    return `${date}${sep}${t(`calendar.weekday.${d.getDay()}`)}${sep}${segmentName(d.getHours())}`
  },

  formatShort(iso: string): string {
    const d = new Date(iso)
    const date = t('calendar.monthDay', { month: d.getMonth() + 1, day: d.getDate() })
    return `${date}${t('calendar.dateSeparator')}${segmentName(d.getHours())}`
  },

  advance(iso: string, step: number, unit: TimeUnit = 'segment'): AdvanceResult {
    const d = new Date(iso)
    const before = d.getTime()

    switch (unit) {
      case 'segment':
        // 一个时段 ≈ 4 小时。不是精确的「上午→下午」，但足够表达叙事节奏。
        d.setHours(d.getHours() + step * 4)
        break
      case 'hour':
        d.setHours(d.getHours() + step)
        break
      case 'day':
        d.setDate(d.getDate() + step)
        break
      case 'week':
        d.setDate(d.getDate() + step * 7)
        break
      case 'month':
        // ⚠️ 已知语义：月末会**向上溢出**。1 月 31 日 + 1 个月 = 3 月 3 日
        //    （整个 2 月被跳过），因为 Date 按天数溢出而非 clamp 到月末。
        //    这是 JavaScript Date 的既定行为，见 AGENTS.md 待办 #4。
        d.setMonth(d.getMonth() + step)
        break
      case 'year':
        d.setFullYear(d.getFullYear() + step)
        break
      default: {
        // Exhaustiveness check: if the TimeUnit union ever grows without a case here,
        // `unit` stops being assignable to never and this line fails the build.
        const impossible: never = unit
        throw new Error(`Unknown time unit: ${String(impossible)}`)
      }
    }

    return { iso: d.toISOString(), elapsedMs: d.getTime() - before }
  },

  /**
   * 把毫秒差说成人话。
   *
   * ⚠️ 这是**时长换算**，不是日历跨度：1 年按 365 天、1 个月按 30 天折算，
   *   所以「1 个月」不等于日历上的任何一个月。要精确表达日期差，
   *   得同时知道起止两个时刻（本函数只拿到差值，做不到）。
   *
   * 逐级剥离：先年、再月、最后天。不能用 `days % 365 / 30` 配 `days % 30` ——
   * 365 = 12×30 + 5，那样两个取模都从"年"里吃天数，每满一年就凭空多出 5 天。
   */
  describeElapsed(ms: number): string {
    if (ms <= 0) return ''
    const totalMinutes = Math.round(ms / 60000)
    const days = Math.floor(totalMinutes / 1440)
    const hours = Math.floor((totalMinutes % 1440) / 60)

    if (days === 0) {
      if (hours > 0) return t('calendar.elapsedHours', { hours })
      return totalMinutes > 0 ? t('calendar.elapsedMinutes', { minutes: totalMinutes }) : ''
    }

    // 不足一年：按月 + 天
    if (days < 365) {
      const months = Math.floor(days / 30)
      const remDays = days % 30
      const parts: string[] = []
      if (months) parts.push(t('calendar.months', { months }))
      if (remDays) parts.push(t('calendar.days', { days: remDays }))
      return t('calendar.elapsed', { parts: parts.join(' ') })
    }

    // 一年以上：年 + 月 + 天，逐级从余数里剥，谁都不重复吃
    const years = Math.floor(days / 365)
    const afterYears = days % 365
    const months = Math.floor(afterYears / 30)
    const remDays = afterYears % 30
    const parts: string[] = [t('calendar.years', { years })]
    if (months) parts.push(t('calendar.months', { months }))
    if (remDays) parts.push(t('calendar.days', { days: remDays }))
    return t('calendar.elapsed', { parts: parts.join(' ') })
  },
}

/** 全部可用历法。目前只有现实历 —— 加新历法时往这里加一项，引擎其余部分不用动。 */
export const CALENDARS: Record<string, Calendar> = {
  [realCalendar.id]: realCalendar,
}

/** 默认历法 */
export const DEFAULT_CALENDAR_ID = realCalendar.id

/** 按 id 取历法。找不到就回退到默认。 */
export function getCalendar(id?: string): Calendar {
  if (!id) return CALENDARS[DEFAULT_CALENDAR_ID]
  const found = CALENDARS[id]
  if (!found) {
    console.warn(t('calendar.unknownCalendar', { id, fallback: DEFAULT_CALENDAR_ID }))
    return CALENDARS[DEFAULT_CALENDAR_ID]
  }
  return found
}

/**
 * 当前时刻的 ISO 字符串。
 * 新游戏的起点就是**调用它的那一刻** —— 也就是玩家点「开始」的时候。
 */
export function nowIso(): string {
  return new Date().toISOString()
}
