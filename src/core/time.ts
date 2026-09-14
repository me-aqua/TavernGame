/**
 * src/core/time.ts —— 时间推进的参数把关
 *
 * 模型输出的是**外部输入**，所以检查在这里做。只有三类，别再加：
 *   1. 单位必须是协议枚举里的 6 个规范值之一（见 tools.ts 的 TOOL_SCHEMAS）
 *   2. step 必须 >= 1（时间是单向的）
 *   3. 防呆：一次推 1000 年以上视为手滑
 * **跨度本身没有上限** —— 那是玩法，不是错误。
 *
 * ⚠️ 这里**没有**「复数 / 中文 / 大小写」的容错别名表。
 *    那是文本协议时代的残留：当时模型在正文里写 JSON，格式飘了就得兜。
 *    现在工具参数由 OpenAI 原生 tool calling 的 schema 约束
 *    （unit 是 enum），协议层已经挡住非法值；
 *    真出现非法值时返回结构化错误，让模型自己改参数重试。
 */

import { realCalendar, type TimeUnit } from './calendar'

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

export type AdvanceOutcome = { ok: true; iso: string; elapsedMs: number } | { ok: false; message: string }

/** 单位是否是协议枚举里的规范值 */
function isTimeUnit(value: unknown): value is TimeUnit {
  return typeof value === 'string' && (TIME_UNITS as readonly string[]).includes(value)
}

/**
 * 推进时间。
 * @param step 数量（外部输入）
 * @param unit 单位（外部输入）；不传按 segment 处理
 * @param currentLabel 当前时间标签，只用于错误文案
 */
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
