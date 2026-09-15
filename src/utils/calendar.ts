/**
 * src/utils/calendar.ts —— 现实公历的**算术**（card/3 的 real 预设用它）。
 *
 * 时间推进的入口在 game/card-calendar.ts：卡声明用哪个历法、推进多少**分钟**，
 * 这里只负责「现实公历」这一种的显示与加减。日期加减全部交给 JavaScript 的 Date，
 * 不手写除法：手写估算会在「1 月 31 日 + 1 个月」与「闰年 2 月 28 日 + 1 天」
 * 这类边界上翻车。自定义历法（均分时段 / 月 / 年）不走这里 —— 它有自己的一套。
 *
 * ⚠️ 这里**没有**「给模型看的历法说明」：提示词内容一律在 prompts/ 下，由 prompts.ts 装配；
 *    也**没有**任何面向模型的时间参数校验 —— 那张表由卡的 actions 推导（card-actions.ts）。
 */

import { t } from '../i18n'

/** 时段键（内部用）；显示名走 locale 的 calendar.segment.* */
const SEGMENTS = ['morning', 'afternoon', 'evening'] as const

/** 推进时间用的单位（`realCalendar.advance` 的 step 单位） */
type TimeUnit = 'segment' | 'hour' | 'day' | 'week' | 'month' | 'year'

interface AdvanceResult {
  iso: string
  elapsedMs: number
}

/** 现实公历的形状（只有一种历法，接口留着是为了给 realCalendar 定型） */
interface Calendar {
  /** 「2026 年 9 月 10 日 · 星期四 · 晚上」 */
  format(iso: string): string
  /** 推进时间 */
  advance(iso: string, step: number, unit: TimeUnit): AdvanceResult
}

/** 把小时数映射到时段索引 */
export function hourToSegment(hour: number): number {
  if (hour < 12) return 0 // morning
  if (hour < 18) return 1 // afternoon
  return 2 // evening
}

/** 取某个小时对应的时段显示名 */
export function segmentName(hour: number): string {
  const key = SEGMENTS[hourToSegment(hour)]
  return t(`calendar.segment.${key}`)
}

export const realCalendar: Calendar = {
  /** 完整时间标签 */
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

  /** 按单位推进时刻 */
  advance(iso: string, step: number, unit: TimeUnit): AdvanceResult {
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
        //    这是 JavaScript Date 的既定行为。
        d.setMonth(d.getMonth() + step)
        break
      case 'year':
        d.setFullYear(d.getFullYear() + step)
        break
      default: {
        // 穷尽性检查：TimeUnit 以后加了成员却漏了 case 时，这行会因 unit 不再是 never 而编译失败
        const impossible: never = unit
        throw new Error(`Unknown time unit: ${String(impossible)}`)
      }
    }

    return { iso: d.toISOString(), elapsedMs: d.getTime() - before }
  },
}

/**
 * 当前时刻的 ISO 字符串。
 * 新游戏的起点就是**调用它的那一刻** —— 也就是玩家点「开始」的时候。
 */
export function nowIso(): string {
  return new Date().toISOString()
}
