/**
 * 公历时间值（阶段 2.2 / CONTRACT §2.2）：三种模式的形状、校验、显示与推进。
 *
 * 一句话：**时间是带模式的公历值** —— `year-minute`（年月日时分）/ `year-date`（年月日）/
 * `days-minute`（天数 + 时分）。没有秒；年份是 `-551 … -1` 与 `1 … 9999`（**没有 0 年**）。
 *
 * 公历换算用 Howard Hinnant 的「civil from days」那一对公式（纯算术，不接第三方历法库）。
 * ⚠️ 它的输入是**天文年**（`1 BC` 记作 `0`，因为数学上要「有 0 年」才连得上），而卡里存的
 * 是历史年号（没有 0 年）：两者之间靠 `astroOf` / `yearOfAstro` 换一次。闰年、当月天数、
 * 星期几**全部按天文年算** —— 所以 `-1-02-29` 是合法的（公元前 1 年是闰年）。
 */
import { t } from '../i18n'
import { AppError } from './errors'
import type { DaysMinuteValue, TimeMode, TimeUnit, TimeValue, YearDateValue, YearMinuteValue } from './types'

/** 年份下界：公元前 551 年 */
export const YEAR_MIN = -551
/** 年份上界：公元 9999 年 */
export const YEAR_MAX = 9999

/** 三种模式，固定顺序（界面下拉、校验清单都按它） */
export const TIME_MODES: TimeMode[] = ['year-minute', 'year-date', 'days-minute']

/** 时间单位，粗 → 细；`week` 不存，按日期算（周一 = 1） */
export const TIME_UNITS: TimeUnit[] = ['year', 'month', 'week', 'day', 'hour', 'minute']

/** 每种模式存哪几格（校验「键集合恰好等于它」与界面渲染共用） */
const MODE_CELLS: Record<TimeMode, (keyof YearMinuteValue)[]> = {
  'year-minute': ['year', 'month', 'day', 'hour', 'minute'],
  'year-date': ['year', 'month', 'day'],
  'days-minute': ['day', 'hour', 'minute'],
}

/** 每种模式能推进的单位（比存的格子少了 `week`：它不存，只用来走 7 天） */
const MODE_UNITS: Record<TimeMode, TimeUnit[]> = {
  'year-minute': ['year', 'month', 'week', 'day', 'hour', 'minute'],
  'year-date': ['year', 'month', 'week', 'day'],
  'days-minute': ['day', 'hour', 'minute'],
}

/** 这个模式存哪几格（界面按它渲染 5 / 3 / 3 个输入框） */
export function cellsOfMode(mode: TimeMode): (keyof YearMinuteValue)[] {
  return [...MODE_CELLS[mode]]
}

/** 这个模式能不能推进这个单位 */
export function unitsOfMode(mode: TimeMode): TimeUnit[] {
  return [...MODE_UNITS[mode]]
}

/** 新模式的时间值长什么样：都是**合法**值，换模式时直接当新种子用 */
export function defaultTimeOf(mode: TimeMode): TimeValue {
  if (mode === 'days-minute') return { day: 1, hour: 8, minute: 0 }
  if (mode === 'year-date') return { year: 1024, month: 1, day: 1 }
  return { year: 1024, month: 1, day: 1, hour: 8, minute: 0 }
}

/** 历史年号 → 天文年（公元前 1 年 = 0） */
function astroOf(year: number): number {
  return year < 0 ? year + 1 : year
}

/** 天文年 → 历史年号（0 = 公元前 1 年；往回没有「公元 0 年」这一格） */
function yearOfAstro(astro: number): number {
  return astro <= 0 ? astro - 1 : astro
}

function isLeapYear(astro: number): boolean {
  return (astro % 4 === 0 && astro % 100 !== 0) || astro % 400 === 0
}

/** 天文年的某个月有几天（月长只取决于年份与月份，与年号换算无关） */
function daysInMonth(astro: number, month: number): number {
  const days = [31, isLeapYear(astro) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month - 1]
}

/** 公历日期（天文年）→ 距 1970-01-01 的天数；负年份靠 `Math.floor` 的负数除法成立 */
export function daysFromCivil(astro: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? astro - 1 : astro
  const era = Math.floor(shiftedYear / 400)
  const yearOfEra = shiftedYear - era * 400
  const shiftedMonth = (month + 9) % 12
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

/** 距 1970-01-01 的天数 → 公历日期（天文年） */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const shifted = days + 719468
  const era = Math.floor(shifted / 146097)
  const dayOfEra = shifted - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) /
      365,
  )
  const astro = yearOfEra + era * 400
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9
  return { year: month <= 2 ? astro + 1 : astro, month, day }
}

/** 这一天是周几（0 = 周日，1 = 周一 … 6 = 周六）；1970-01-01 是周四 */
function weekdayOf(astro: number, month: number, day: number): number {
  return (((daysFromCivil(astro, month, day) + 4) % 7) + 7) % 7
}

function inRange(value: unknown, from: number, to: number): boolean {
  return Number.isInteger(value) && (value as number) >= from && (value as number) <= to
}

/** 历史年号在 `[YEAR_MIN, YEAR_MAX]` 且不是 0（没有公元 0 年） */
function yearFits(year: unknown): boolean {
  return (
    Number.isInteger(year) &&
    (year as number) !== 0 &&
    (year as number) >= YEAR_MIN &&
    (year as number) <= YEAR_MAX
  )
}

/** 年月日三格：年份范围 + 月 1..12 + 日不超当月（按天文年） */
function dateFits(year: unknown, month: unknown, day: unknown): boolean {
  if (!yearFits(year) || !inRange(month, 1, 12)) return false
  return inRange(day, 1, daysInMonth(astroOf(year as number), month as number))
}

/** 一个值是不是这个模式的**合法**时间（键集合必须恰好等于该模式的格子） */
function exactShape(value: Record<string, unknown>, mode: TimeMode): boolean {
  const cells = MODE_CELLS[mode]
  if (cells === undefined) return false
  const keys = Object.keys(value).sort().join(',')
  if (keys !== [...cells].sort().join(',')) return false
  if (mode === 'days-minute') {
    return (
      Number.isSafeInteger(value.day) &&
      (value.day as number) >= 1 &&
      inRange(value.hour, 0, 23) &&
      inRange(value.minute, 0, 59)
    )
  }
  if (!dateFits(value.year, value.month, value.day)) return false
  if (mode === 'year-date') return true
  return inRange(value.hour, 0, 23) && inRange(value.minute, 0, 59)
}

/**
 * 是不是合法时间值。给了 `mode` ⇒ 键集合必须**恰好**是那个模式的 5 / 3 / 3 格；
 * 省略 ⇒ 三种形状任一（存档没有卡可比时的入口）。
 */
export function isTimeValue(value: unknown, mode?: TimeMode): value is TimeValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (mode === undefined ? TIME_MODES : [mode]).some((one) => exactShape(record, one))
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/** 年份的显示：公元年补到 4 位，公元前写「公元前{N}」（不补零） */
function yearText(year: number): string {
  return year < 0 ? t('time.bcYear', { year: -year }) : pad(year, 4)
}

/**
 * 时间渲染成一行中文（提示词、工具结果、编辑器共用这一份）：
 *   · `year-minute` ⇒ `2024-02-10 08:30（周六）`；
 *   · `year-date`   ⇒ `2024-02-10（周六）`（没有钟点）；
 *   · `days-minute` ⇒ `第 5 天 08:30`（天数模式没有星期）。
 */
export function formatTime(value: TimeValue, mode: TimeMode): string {
  if (mode === 'days-minute') {
    const days = value as DaysMinuteValue
    return t('time.formattedDays', { day: days.day, clock: `${pad(days.hour, 2)}:${pad(days.minute, 2)}` })
  }
  const date = value as YearDateValue
  const dateText = `${yearText(date.year)}-${pad(date.month, 2)}-${pad(date.day, 2)}`
  const weekday = t(`time.weekday.${weekdayOf(astroOf(date.year), date.month, date.day)}`)
  if (mode === 'year-date') return t('time.formattedDate', { date: dateText, weekday })
  const clock = value as YearMinuteValue
  return t('time.formatted', {
    date: dateText,
    clock: `${pad(clock.hour, 2)}:${pad(clock.minute, 2)}`,
    weekday,
  })
}

function invalid(message: string, detail: unknown): AppError {
  return new AppError('E_VALIDATION', { message, nextStep: t('next.editor'), detail })
}

const MINUTES_PER_DAY = 1440

/** 天数模式：`day` 是计数，时分满 24 / 60 进一天；越出安全整数 ⇒ `E_VALIDATION` */
function advanceDays(value: DaysMinuteValue, amount: number, unit: TimeUnit): DaysMinuteValue {
  const minutes = (value.day - 1) * MINUTES_PER_DAY + value.hour * 60 + value.minute
  const step = unit === 'day' ? amount * MINUTES_PER_DAY : unit === 'hour' ? amount * 60 : amount
  const next = minutes + step
  if (!Number.isSafeInteger(minutes) || !Number.isSafeInteger(next)) {
    throw invalid(t('error.timeOverflow'), { value, amount, unit })
  }
  return {
    day: Math.floor(next / MINUTES_PER_DAY) + 1,
    hour: Math.floor((next % MINUTES_PER_DAY) / 60),
    minute: next % 60,
  }
}

/**
 * 推进时间。`amount` 是正整数；`unit` 必须在该模式的单位表里、也在颗粒度上下界之内
 * （`upper` 是单次能推的最粗单位、`lower` 是最细的，按 `TIME_UNITS` 的粗 → 细序比）。
 *
 * 年 / 月按公历走，**目标月没有那一天就取当月最后一天**（`2024-01-31 +1 月 = 2024-02-29`）；
 * `week` = 7 × amount 天，不存周字段；跨「没有 0 年」按天文年进位（公元前 1 年 +1 年 = 公元 1 年）。
 * 结果越过 `[-551, 9999]` 年（或天数模式越过安全整数）⇒ `E_VALIDATION`。
 */
export function advanceTime(
  value: TimeValue,
  amount: number,
  unit: TimeUnit,
  bounds: { mode: TimeMode; upper?: TimeUnit; lower?: TimeUnit },
): TimeValue {
  const mode = bounds.mode
  if (!isTimeValue(value, mode)) throw invalid(t('error.timeSourceInvalid'), { value, mode })
  if (!Number.isInteger(amount) || amount <= 0) throw invalid(t('error.amountInvalid'), { amount })
  if (!unitsOfMode(mode).includes(unit))
    throw invalid(t('error.unitUnknown', { unit: String(unit) }), { unit })
  const at = TIME_UNITS.indexOf(unit)
  if (bounds.upper !== undefined && TIME_UNITS.indexOf(bounds.upper) > at) {
    throw invalid(t('error.unitOutOfBounds', { unit, upper: bounds.upper }), { unit, bounds })
  }
  if (bounds.lower !== undefined && at > TIME_UNITS.indexOf(bounds.lower)) {
    throw invalid(t('error.unitOutOfBounds', { unit, lower: bounds.lower }), { unit, bounds })
  }

  if (mode === 'days-minute') return advanceDays(value as DaysMinuteValue, amount, unit)

  const date = value as YearDateValue
  const clock = mode === 'year-minute' ? (value as YearMinuteValue) : undefined
  const withClock = (year: number, month: number, day: number): TimeValue =>
    clock === undefined ? { year, month, day } : { year, month, day, hour: clock.hour, minute: clock.minute }

  if (unit === 'year' || unit === 'month') {
    // 月 / 年不按天数换算：月长会变，只做「年月进位 + 日夹到月末」
    let astro = astroOf(date.year)
    let month = date.month
    if (unit === 'year') astro += amount
    else {
      const months = astro * 12 + (month - 1) + amount
      astro = Math.floor(months / 12)
      month = (((months % 12) + 12) % 12) + 1
    }
    const year = yearOfAstro(astro)
    if (year < YEAR_MIN || year > YEAR_MAX) throw invalid(t('error.timeOverflow'), { value, amount, unit })
    return withClock(year, month, Math.min(date.day, daysInMonth(astro, month)))
  }

  const step =
    unit === 'week' ? 7 * MINUTES_PER_DAY : unit === 'day' ? MINUTES_PER_DAY : unit === 'hour' ? 60 : 1
  const total =
    daysFromCivil(astroOf(date.year), date.month, date.day) * MINUTES_PER_DAY +
    (clock?.hour ?? 0) * 60 +
    (clock?.minute ?? 0) +
    step * amount
  if (!Number.isSafeInteger(total)) throw invalid(t('error.timeOverflow'), { value, amount, unit })
  const nextDays = Math.floor(total / MINUTES_PER_DAY)
  const rested = total - nextDays * MINUTES_PER_DAY
  const civil = civilFromDays(nextDays)
  const year = yearOfAstro(civil.year)
  if (year < YEAR_MIN || year > YEAR_MAX) throw invalid(t('error.timeOverflow'), { value, amount, unit })
  if (clock === undefined) return { year, month: civil.month, day: civil.day }
  const hour = Math.floor(rested / 60)
  return { year, month: civil.month, day: civil.day, hour, minute: rested - hour * 60 }
}
