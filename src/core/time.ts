/**
 * src/core/time.ts —— 时间推进的参数把关
 *
 * 模型输出的是**外部输入**，所以单位识别与防呆在这里做。
 * 检查只有两类，别再加：
 *   1. 拦模型的错误输入（认不出的单位、倒退、原地不动）
 *   2. 拦手滑（一次推十万年）
 * **跨度本身没有上限** —— 那是玩法，不是错误。
 */

import { realCalendar, type TimeUnit } from './calendar'

/** 单位别名：模型很爱写复数、中文、大小写混用 */
const UNIT_ALIASES: Record<string, TimeUnit> = {
  segment: 'segment',
  segments: 'segment',
  时段: 'segment',
  hour: 'hour',
  hours: 'hour',
  hr: 'hour',
  hrs: 'hour',
  小时: 'hour',
  day: 'day',
  days: 'day',
  天: 'day',
  week: 'week',
  weeks: 'week',
  周: 'week',
  星期: 'week',
  month: 'month',
  months: 'month',
  月: 'month',
  个月: 'month',
  year: 'year',
  years: 'year',
  yr: 'year',
  yrs: 'year',
  年: 'year',
}

const MAX_YEARS = 1000
const YEARS_PER_UNIT: Record<TimeUnit, number> = {
  segment: 4 / 8760,
  hour: 1 / 8760,
  day: 1 / 365,
  week: 7 / 365,
  month: 1 / 12,
  year: 1,
}

export type AdvanceOutcome = { ok: true; iso: string; elapsedMs: number } | { ok: false; message: string }

/**
 * 推进时间。
 * @param step 数量（外部输入）
 * @param unit 单位（外部输入）
 * @param currentLabel 当前时间标签，只用于错误文案
 */
export function advanceTime(iso: string, step: unknown, unit: unknown, currentLabel: string): AdvanceOutcome {
  const key = unit == null ? 'segment' : String(unit).trim().toLowerCase()
  const u = UNIT_ALIASES[key]
  if (!u) {
    return {
      ok: false,
      message: `⚠ 不认识的时间单位「${String(unit)}」。可用：segment（时段，约 4 小时）/ hour / day / week / month / year。（当前：${currentLabel}）`,
    }
  }

  const raw = Number(step)
  const n = Number.isFinite(raw) ? Math.round(raw) : 1

  if (n <= 0) {
    const why = n < 0 ? '不能倒退' : '不能原地不动'
    return { ok: false, message: `⚠ 时间是单向的，${why}。（当前：${currentLabel}）` }
  }

  if (n * YEARS_PER_UNIT[u] > MAX_YEARS) {
    return { ok: false, message: `⚠ 一次推进跨度太大（${n} ${u}），已忽略。当前：${currentLabel}` }
  }

  const { iso: next, elapsedMs } = realCalendar.advance(iso, n, u)
  return { ok: true, iso: next, elapsedMs }
}
