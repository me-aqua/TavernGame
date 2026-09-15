/**
 * src/game/card-calendar.ts —— 历法：引擎出算法与预设，卡决定用哪个、或者自己写一个。
 *
 * 两件事：
 *   · 预设 `real` = 现实公历 —— **算法复用 utils/calendar.ts**，这里只做「卡的单位
 *     （year/month/day/hour/minute）↔ 时刻」的换算，闰年 / 月长 / 星期不重写一份；
 *   · 自定义 = **均匀模型** —— 一天等分成 segments.length 段、一月 month.days 天、
 *     一年 year.months 月，全部按分钟算。规则简单到不会有边界 bug（闰年那类不规则
 *     规则属于预设的实现细节）。
 *
 * 时间的推进量只有一个数：**分钟**（这张卡的历法里的一分钟）。进位、跨段、跨日、跨月
 * 全在这里发生，调用方只给一个整数。
 *
 * ⚠️ 卡是外部数据，所以 checkCalendar / checkTime 抛错并带 ASCII 路径；advance / format
 *    只处理**已经校验过**的历法与时刻（信任内部调用方，不写第二遍检查）。
 */

import { realCalendar } from '../utils/calendar'
import { at, checkKeys, checkOptionalKeys, fail, isRecord, requireRecord, requireText } from './card-read'

/** 时间值的形状：历法自己的单位（year / month / day / hour / minute），不是字符串 */
export interface TimeValue {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** 自定义历法：均匀模型 + 两个念法模板 */
export interface CustomCalendar {
  /** 一天的时段，按顺序等分 */
  segments: string[]
  /** 一周几天、叫什么 */
  weekdays: string[]
  /** 一天多少小时、一小时多少分钟；start 是日界（分段与显示的偏移，不改变日期进位） */
  day: { hours: number; minutesPerHour: number; start?: string }
  /** 一月多少天 */
  month: { days: number }
  /** 一年多少月 */
  year: { months: number }
  /** 时刻怎么念，占位符：{year} {month} {day} {weekday} {segment} */
  display: string
  /** 「过去了多久」怎么念；占位符 {days} {hours} {minutes}。可省 —— 格式化器由引擎在需要时补 */
  elapsed?: string
}

/** 历法：引擎预设的名字，或卡自己写的 spec */
export type Calendar = string | CustomCalendar

/** 引擎自带的历法预设 —— 加一个预设就是在这里加一个名字 + 在 advance/format 里加一条分支 */
export const CALENDAR_PRESETS = ['real'] as const

/** 自定义历法认识的键 */
const CALENDAR_KEYS = ['segments', 'weekdays', 'day', 'month', 'year', 'display', 'elapsed']
/** 其中必写的 —— elapsed 可省 */
const CALENDAR_REQUIRED = ['segments', 'weekdays', 'day', 'month', 'year', 'display']

/** display 模板认识的占位符 */
const DISPLAY_FIELDS = ['year', 'month', 'day', 'weekday', 'segment']
/** elapsed 模板认识的占位符 */
const ELAPSED_FIELDS = ['days', 'hours', 'minutes']

/** 时钟写法 HH:MM（日界） */
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

/** 自定义历法里一天的分钟数 */
function dayMinutes(calendar: CustomCalendar): number {
  return calendar.day.hours * calendar.day.minutesPerHour
}

/** 日界偏移（分钟）；没写 start 就是 00:00 */
function dayStart(calendar: CustomCalendar): number {
  const written = calendar.day.start
  if (written === undefined) return 0
  const [hours, minutes] = written.split(':')
  return Number(hours) * calendar.day.minutesPerHour + Number(minutes)
}

/** 一年有多少天（均匀模型） */
function yearDays(calendar: CustomCalendar): number {
  return calendar.year.months * calendar.month.days
}

/** 从历法元年元月元日起算的天数 —— 星期几按它取模 */
function absoluteDay(calendar: CustomCalendar, day: { year: number; month: number; day: number }): number {
  return (day.year - 1) * yearDays(calendar) + (day.month - 1) * calendar.month.days + day.day
}

/** 把模板里的 {field} 换成值（校验期已经确认占位符都在 values 里） */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole)
}

/** 时刻 → ISO 本地写法（YYYY-MM-DDTHH:mm）—— real 预设与 utils/calendar.ts 之间的桥 */
function isoOf(time: TimeValue): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = String(time.year).padStart(4, '0')
  return year + '-' + pad(time.month) + '-' + pad(time.day) + 'T' + pad(time.hour) + ':' + pad(time.minute)
}

/** ISO 时刻 → 历法单位（本地读数，与 decision #42 的「本地时刻」一致） */
function timeOf(iso: string): TimeValue {
  const date = new Date(iso)
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  }
}

/** real 预设：整小时走 utils/calendar.ts 的历法，余下的分钟数用 Date 补进位 */
function advanceReal(time: TimeValue, minutes: number): TimeValue {
  const hours = Math.trunc(minutes / 60)
  const rest = minutes - hours * 60
  const shifted = new Date(realCalendar.advance(isoOf(time), hours, 'hour').iso)
  shifted.setMinutes(shifted.getMinutes() + rest)
  return timeOf(shifted.toISOString())
}

/** 自定义历法：全按分钟算，再逐级进位 */
function advanceCustom(calendar: CustomCalendar, time: TimeValue, minutes: number): TimeValue {
  const perHour = calendar.day.minutesPerHour
  const perDay = dayMinutes(calendar)
  const total = time.hour * perHour + time.minute + minutes
  const days = Math.floor(total / perDay)
  const rest = total - days * perDay
  const hour = Math.floor(rest / perHour)
  const minute = rest - hour * perHour

  let day = time.day + days
  let month = time.month
  let year = time.year
  while (day > calendar.month.days) {
    day -= calendar.month.days
    month += 1
    if (month > calendar.year.months) {
      month = 1
      year += 1
    }
  }
  return { year, month, day, hour, minute }
}

/** 自定义历法的时段下标：以日界为起点等分一天 */
function segmentIndex(calendar: CustomCalendar, time: TimeValue): number {
  const perDay = dayMinutes(calendar)
  const offset =
    (time.hour * calendar.day.minutesPerHour + time.minute - dayStart(calendar) + perDay) % perDay
  return Math.floor((offset * calendar.segments.length) / perDay)
}

/**
 * 推进时刻。minutes = 0 合法（这一轮时间没动）；负数与小数由调用方（动作层）挡在门外。
 */
export function advance(calendar: Calendar, time: TimeValue, minutes: number): TimeValue {
  if (typeof calendar === 'string') return advanceReal(time, minutes)
  return advanceCustom(calendar, time, minutes)
}

/** 把时刻念成人话：real 预设走引擎的 locale，自定义走卡里的 display 模板 */
export function format(calendar: Calendar, time: TimeValue): string {
  if (typeof calendar === 'string') return realCalendar.format(isoOf(time))
  const weekday = calendar.weekdays[(absoluteDay(calendar, time) - 1) % calendar.weekdays.length]
  return fill(calendar.display, {
    year: String(time.year),
    month: String(time.month),
    day: String(time.day),
    weekday,
    segment: calendar.segments[segmentIndex(calendar, time)],
  })
}

/** 模板里的占位符必须都是认识的 —— 写错一个（{weakday}）就整条时间显示坏掉 */
function checkTemplate(text: string, fields: string[], where: string): void {
  const matches = text.matchAll(/\{([^{}]*)\}/g)
  for (const match of matches) {
    if (!fields.includes(match[1])) {
      fail(where, 'unknown placeholder "' + match[0] + '" (known: ' + fields.join(', ') + ')')
    }
  }
}

/** 正整数（一天多少小时这类） */
function checkCount(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key]
  if (!Number.isInteger(value) || (value as number) < 1) fail(at(where, key), 'must be a positive integer')
  return value as number
}

/** 校验一份历法声明（预设名或自定义 spec），返回它 */
export function checkCalendar(value: unknown, base: string): Calendar {
  if (typeof value === 'string') {
    if (!(CALENDAR_PRESETS as readonly string[]).includes(value)) {
      const known = CALENDAR_PRESETS.join(', ')
      fail(base, 'unknown calendar preset ' + JSON.stringify(value) + ' (known: ' + known + ')')
    }
    return value
  }
  if (!isRecord(value)) fail(base, 'must be a preset name or a custom calendar object')
  checkOptionalKeys(value, CALENDAR_KEYS, CALENDAR_REQUIRED, base)

  const segments = value.segments
  if (!Array.isArray(segments) || segments.length === 0) fail(at(base, 'segments'), 'must not be empty')
  if (!segments.every((name) => typeof name === 'string' && name.length > 0)) {
    fail(at(base, 'segments'), 'must be an array of non-empty strings')
  }
  const weekdays = value.weekdays
  if (!Array.isArray(weekdays) || weekdays.length === 0) fail(at(base, 'weekdays'), 'must not be empty')
  if (!weekdays.every((name) => typeof name === 'string' && name.length > 0)) {
    fail(at(base, 'weekdays'), 'must be an array of non-empty strings')
  }

  const day = requireRecord(value, 'day', base)
  checkOptionalKeys(day, ['hours', 'minutesPerHour', 'start'], ['hours', 'minutesPerHour'], at(base, 'day'))
  const hours = checkCount(day, 'hours', at(base, 'day'))
  const minutesPerHour = checkCount(day, 'minutesPerHour', at(base, 'day'))
  if (Object.hasOwn(day, 'start')) {
    const start = requireText(day, 'start', at(base, 'day'))
    if (!CLOCK.test(start)) fail(at(at(base, 'day'), 'start'), 'must look like 18:00')
    const [startHours, startMinutes] = start.split(':').map(Number)
    if (startHours * minutesPerHour + startMinutes >= hours * minutesPerHour) {
      fail(at(at(base, 'day'), 'start'), 'must be inside one day of ' + hours + ' hours')
    }
  }

  const month = requireRecord(value, 'month', base)
  checkKeys(month, ['days'], at(base, 'month'))
  checkCount(month, 'days', at(base, 'month'))

  const year = requireRecord(value, 'year', base)
  checkKeys(year, ['months'], at(base, 'year'))
  checkCount(year, 'months', at(base, 'year'))

  const display = requireText(value, 'display', base)
  checkTemplate(display, DISPLAY_FIELDS, at(base, 'display'))
  if (Object.hasOwn(value, 'elapsed')) {
    const elapsed = requireText(value, 'elapsed', base)
    checkTemplate(elapsed, ELAPSED_FIELDS, at(base, 'elapsed'))
  }
  return value as unknown as CustomCalendar
}

/** 一份时刻必须落在这张历法的单位里 —— 月 13、时 24、2 月 30 日都在这里被拦下 */
export function checkTime(calendar: Calendar, value: unknown, base: string): TimeValue {
  if (!isRecord(value)) fail(base, 'must be an object')
  checkKeys(value, ['year', 'month', 'day', 'hour', 'minute'], base)
  const time = {} as TimeValue
  for (const key of ['year', 'month', 'day', 'hour', 'minute'] as const) {
    const part = value[key]
    if (!Number.isInteger(part)) fail(at(base, key), 'must be an integer')
    time[key] = part as number
  }
  if (typeof calendar === 'string') {
    if (time.year < 1 || time.year > 9999) fail(at(base, 'year'), 'must be a year JavaScript Date can hold')
    if (time.month < 1 || time.month > 12) fail(at(base, 'month'), 'must be 1-12')
    if (time.hour < 0 || time.hour > 23) fail(at(base, 'hour'), 'must be 0-23')
    if (time.minute < 0 || time.minute > 59) fail(at(base, 'minute'), 'must be 0-59')
    // 日期交给 Date 往返一次：闰年 2 月 29 日合法，2 月 30 日会溢到 3 月
    const probe = new Date(0)
    probe.setFullYear(time.year, time.month - 1, time.day)
    probe.setHours(time.hour, time.minute, 0, 0)
    const same =
      probe.getFullYear() === time.year && probe.getMonth() === time.month - 1 && probe.getDate() === time.day
    if (!same) fail(at(base, 'day'), 'is not a real date in the Gregorian calendar')
    return time
  }
  if (time.year < 1) fail(at(base, 'year'), 'must be at least 1')
  if (time.month < 1 || time.month > calendar.year.months) {
    fail(at(base, 'month'), 'must be 1-' + calendar.year.months)
  }
  if (time.day < 1 || time.day > calendar.month.days) {
    fail(at(base, 'day'), 'must be 1-' + calendar.month.days)
  }
  if (time.hour < 0 || time.hour >= calendar.day.hours) {
    fail(at(base, 'hour'), 'must be 0-' + (calendar.day.hours - 1))
  }
  if (time.minute < 0 || time.minute >= calendar.day.minutesPerHour) {
    fail(at(base, 'minute'), 'must be 0-' + (calendar.day.minutesPerHour - 1))
  }
  return time
}
