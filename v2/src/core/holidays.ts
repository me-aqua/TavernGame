/**
 * 节日（阶段 2.2 / CONTRACT §2.2 · B3）：三组定义 + 派生只读的「这一天有哪些节日」。
 *
 * 一句话：**节日不是状态** —— 它由「时间值 + 三个勾选」当场算出来，不写进 `state[]` / `tree` /
 * 事件里；提示词只在读了时间元素时多出一行 `节日：…`。
 *
 * 三组：
 *   · `international` 现代国际：七条公历固定日；
 *   · `china` 现代中国：只剩三条公历固定日（元旦 / 劳动节 / 国庆节）—— **一个农历派生节日都没有**；
 *   · `traditional` 中国传统：十一条，靠一张 1900–2100 的有界农历表换算（`lunar-table.ts`，
 *     **不接第三方历法库**）。年份不在 1900–2100 ⇒ 这一组一条都不产出（不报错、不影响另外两组）。
 *
 * 换算方向是**公历 → 农历 → 查节日表**，所以腊八 / 小年 / 除夕落在次年 1 月时照样算对；
 * **闰月不算节日**（闰五月初五不是端午）。
 */
import { t } from '../i18n'
import { LUNAR_INFO } from './lunar-table'
import { daysFromCivil } from './timevalue'
import type { Holidays, TimeMode, TimeValue, YearDateValue } from './types'

/** 传统节日只认这两年之间（农历表的两端） */
export const TRADITIONAL_YEAR_MIN = 1900
export const TRADITIONAL_YEAR_MAX = 2100

/** 一条公历固定日的节日：`name` 是 locale key（中文名住 locales） */
export interface FixedHoliday {
  name: string
  month: number
  day: number
}

/** 一条传统节日：`day === 'last'` 表示「这个月的最后一天」（除夕） */
export interface LunarFestival {
  name: string
  month: number
  day: number | 'last'
}

/** 现代国际节日（公历固定日） */
export const INTERNATIONAL_HOLIDAYS: FixedHoliday[] = [
  { name: 'holiday.newYear', month: 1, day: 1 },
  { name: 'holiday.valentine', month: 2, day: 14 },
  { name: 'holiday.women', month: 3, day: 8 },
  { name: 'holiday.labour', month: 5, day: 1 },
  { name: 'holiday.children', month: 6, day: 1 },
  { name: 'holiday.halloween', month: 10, day: 31 },
  { name: 'holiday.christmas', month: 12, day: 25 },
]

/** 现代中国节日（只保留公历固定日；农历节日全在传统那一组） */
export const CHINA_HOLIDAYS: FixedHoliday[] = [
  { name: 'holiday.newYear', month: 1, day: 1 },
  { name: 'holiday.labour', month: 5, day: 1 },
  { name: 'holiday.national', month: 10, day: 1 },
]

/** 中国传统节日（农历月 / 日；除夕是腊月最后一天） */
export const TRADITIONAL_FESTIVALS: LunarFestival[] = [
  { name: 'holiday.springFestival', month: 1, day: 1 },
  { name: 'holiday.lantern', month: 1, day: 15 },
  { name: 'holiday.dragonHead', month: 2, day: 2 },
  { name: 'holiday.dragonBoat', month: 5, day: 5 },
  { name: 'holiday.qixi', month: 7, day: 7 },
  { name: 'holiday.ghost', month: 7, day: 15 },
  { name: 'holiday.midAutumn', month: 8, day: 15 },
  { name: 'holiday.doubleNinth', month: 9, day: 9 },
  { name: 'holiday.laba', month: 12, day: 8 },
  { name: 'holiday.littleNewYear', month: 12, day: 23 },
  { name: 'holiday.newYearEve', month: 12, day: 'last' },
]

/** 表里这一年的闰月月份（0 = 没有闰月） */
function leapMonthOf(lunarYear: number): number {
  return LUNAR_INFO[lunarYear - TRADITIONAL_YEAR_MIN] & 0xf
}

/** 闰月有几天（没有闰月 ⇒ 0） */
function leapDaysOf(lunarYear: number): number {
  if (leapMonthOf(lunarYear) === 0) return 0
  return LUNAR_INFO[lunarYear - TRADITIONAL_YEAR_MIN] & 0x10000 ? 30 : 29
}

/** 农历某个月有几天（不含闰月） */
function monthDaysOf(lunarYear: number, month: number): number {
  return LUNAR_INFO[lunarYear - TRADITIONAL_YEAR_MIN] & (0x10000 >> month) ? 30 : 29
}

/** 农历一年有几天（12 个月 + 可能的闰月） */
function yearDaysOf(lunarYear: number): number {
  let days = 348
  for (let bit = 0x8000; bit > 0x8; bit >>= 1) {
    if (LUNAR_INFO[lunarYear - TRADITIONAL_YEAR_MIN] & bit) days += 1
  }
  return days + leapDaysOf(lunarYear)
}

/** 农历日期（`leap` = 落在闰月里） */
interface LunarDate {
  year: number
  month: number
  day: number
  leap: boolean
}

/** 公历 → 农历；落在表外（1900-01-31 之前 / 2100 年之后）⇒ `null` */
function lunarOf(gregorian: YearDateValue): LunarDate | null {
  let offset = daysFromCivil(gregorian.year, gregorian.month, gregorian.day) - daysFromCivil(1900, 1, 31)
  if (offset < 0) return null
  let year = TRADITIONAL_YEAR_MIN
  while (year <= TRADITIONAL_YEAR_MAX && offset >= yearDaysOf(year)) {
    offset -= yearDaysOf(year)
    year += 1
  }
  if (year > TRADITIONAL_YEAR_MAX) return null
  const leapMonth = leapMonthOf(year)
  for (let month = 1; month <= 12; month += 1) {
    const days = monthDaysOf(year, month)
    if (offset < days) return { year, month, day: offset + 1, leap: false }
    offset -= days
    if (leapMonth === month) {
      const leapDays = leapDaysOf(year)
      if (offset < leapDays) return { year, month, day: offset + 1, leap: true }
      offset -= leapDays
    }
  }
  return null
}

/** 这一天的传统节日（名字按定义顺序；闰月不认） */
function traditionalNames(gregorian: YearDateValue): string[] {
  if (gregorian.year < TRADITIONAL_YEAR_MIN || gregorian.year > TRADITIONAL_YEAR_MAX) return []
  const lunar = lunarOf(gregorian)
  if (lunar === null || lunar.leap) return []
  return TRADITIONAL_FESTIVALS.filter((festival) => {
    if (festival.month !== lunar.month) return false
    const last = monthDaysOf(lunar.year, festival.month)
    return festival.day === 'last' ? lunar.day === last : lunar.day === festival.day
  }).map((festival) => festival.name)
}

/** 公历固定日那一组的命中项 */
function fixedNames(list: FixedHoliday[], gregorian: YearDateValue): string[] {
  return list
    .filter((item) => item.month === gregorian.month && item.day === gregorian.day)
    .map((item) => item.name)
}

/**
 * 这一天有哪些节日（**显示名**，中文）。
 *
 * 顺序 = 组顺序（international → china → traditional）× 组内定义顺序；
 * **按名字去重、保留第一次出现**（元旦 / 劳动节同时住在两组里，两组都开也只写一遍）。
 * `days-minute` 模式没有节日格子，`holidays` 缺失也返回 `[]`。
 */
export function holidaysOf(value: TimeValue, mode: TimeMode, holidays: Holidays | undefined): string[] {
  if (holidays === undefined || mode === 'days-minute') return []
  const gregorian = value as YearDateValue
  const names: string[] = []
  /** 收一个节日：翻成中文名，**按名字去重**（保留第一次出现的位置） */
  const push = (key: string) => {
    const name = t(key)
    if (!names.includes(name)) names.push(name)
  }
  if (holidays.international) fixedNames(INTERNATIONAL_HOLIDAYS, gregorian).forEach(push)
  if (holidays.china) fixedNames(CHINA_HOLIDAYS, gregorian).forEach(push)
  if (holidays.traditional) traditionalNames(gregorian).forEach(push)
  return names
}
