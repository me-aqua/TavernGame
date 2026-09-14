/**
 * src/utils/calendar.ts —— 历法
 *
 * ## 参数把关（原来单独一个文件，现已折进来）
 *
 * 模型给的是**外部输入**，检查只有三类，别再加：
 *   1. 单位必须是协议枚举里的 6 个规范值之一（见 agent/tools.ts 的 toolSchemas()）
 *   2. step 必须 >= 1（时间是单向的）
 *   3. 防呆：一次推 1000 年以上视为手滑
 * **跨度本身没有上限** —— 那是玩法，不是错误。
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

/** 时间单位（历法只认这些） */
export type TimeUnit = 'segment' | 'hour' | 'day' | 'week' | 'month' | 'year'

/** 一次时间推进的结果 */
export interface AdvanceResult {
  iso: string
  elapsedMs: number
}

/** 现实公历的形状（只有一种历法，接口留着是为了给 realCalendar 定型） */
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

  /** 完整时间标签：「2026 年 9 月 10 日 · 星期四 · 晚上」 */
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

  /** 简短时间标签，侧栏时间线用 */
  formatShort(iso: string): string {
    const d = new Date(iso)
    const date = t('calendar.monthDay', { month: d.getMonth() + 1, day: d.getDate() })
    return `${date}${t('calendar.dateSeparator')}${segmentName(d.getHours())}`
  },

  /** 按单位推进时刻；日期运算全部交给 Date，不手写除法 */
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

/**
 * 当前时刻的 ISO 字符串。
 * 新游戏的起点就是**调用它的那一刻** —— 也就是玩家点「开始」的时候。
 */
export function nowIso(): string {
  return new Date().toISOString()
}

const TIME_UNITS = ['segment', 'hour', 'day', 'week', 'month', 'year'] as const

/** 一次推进的防呆上限：超过这个量级视为手滑，不是玩法 */
const MAX_YEARS = 1000
const YEARS_PER_UNIT: Record<TimeUnit, number> = {
  segment: 4 / 8760,
  hour: 1 / 8760,
  day: 1 / 365,
  week: 7 / 365,
  month: 1 / 12,
  year: 1,
}

type AdvanceOutcome = { ok: true; iso: string; elapsedMs: number } | { ok: false; message: string }

/** 单位是否是协议枚举里的规范值 */
function isTimeUnit(value: unknown): value is TimeUnit {
  return typeof value === 'string' && (TIME_UNITS as readonly string[]).includes(value)
}

/** 校验并推进一个 ISO 时刻；失败返回结构化错误（交给模型改参数重试） */
export function advanceTime(iso: string, step: unknown, unit: unknown, currentLabel: string): AdvanceOutcome {
  // 未提供按默认单位处理；提供了就必须是规范值，不做任何容错猜测
  const resolved: unknown = unit == null ? 'segment' : unit
  if (!isTimeUnit(resolved)) {
    return {
      ok: false,
      message:
        'Unknown time unit: ' +
        `${JSON.stringify(unit)}` +
        '. Expected one of: ' +
        TIME_UNITS.join(', ') +
        '. Current time: ' +
        currentLabel,
    }
  }

  const raw = Number(step)
  const n = Number.isFinite(raw) ? Math.round(raw) : 1

  if (n <= 0) {
    const why = n < 0 ? 'time cannot move backwards' : 'time cannot stand still'
    return { ok: false, message: `Invalid step: ${why}. Current time: ${currentLabel}` }
  }

  if (n * YEARS_PER_UNIT[resolved] > MAX_YEARS) {
    return {
      ok: false,
      message: `Step too large: ${n} ${resolved} exceeds the ${MAX_YEARS}-year guard. Ignored. Current time: ${currentLabel}`,
    }
  }

  const { iso: next, elapsedMs } = realCalendar.advance(iso, n, resolved)
  return { ok: true, iso: next, elapsedMs }
}
