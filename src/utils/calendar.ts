/**
 * src/utils/calendar.ts —— 现实公历的**算术**（card/5 的 real 预设用它）。
 *
 * 时间推进的入口在 game/card-calendar.ts：卡声明用哪个历法、推进多少**分钟**。
 * 这里只有一件加减：**按整小时推**（分钟的零头由调用方用 Date 补）—— 日期运算全部
 * 交给 JavaScript 的 Date，不手写除法：手写估算会在闰年、月末这类边界上翻车。
 * 自定义历法（均分时段 / 月 / 年）不走这里 —— 它有自己的一套（game/card-calendar.ts）。
 *
 * ⚠️ 这里**没有**「给模型看的历法说明」：提示词内容一律在 prompts/ 下，由 prompts.ts 装配；
 *    也**没有**任何面向模型的时间参数校验 —— 那张表由卡的 actions 推导（card-actions.ts）。
 */

import { t } from '../i18n'

/** 时段键（内部用）；显示名走 locale 的 calendar.segment.* */
const SEGMENTS = ['morning', 'afternoon', 'evening'] as const

/** 现实公历的形状（只有一种历法，接口留着是为了给 realCalendar 定型） */
interface Calendar {
  /** 「2026 年 9 月 10 日 · 星期四 · 晚上」 */
  format(iso: string): string
  /** 往后推几小时（按本地读数算），返回新的时刻 */
  advanceHours(iso: string, hours: number): string
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

  /** 按整小时推进（跨日 / 跨月 / 跨年与闰年都交给 Date） */
  advanceHours(iso: string, hours: number): string {
    const d = new Date(iso)
    d.setHours(d.getHours() + hours)
    return d.toISOString()
  },
}

/**
 * 当前时刻的 ISO 字符串。
 * 新游戏的起点就是**调用它的那一刻** —— 也就是玩家点「开始」的时候。
 */
export function nowIso(): string {
  return new Date().toISOString()
}
