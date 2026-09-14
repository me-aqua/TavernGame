/**
 * advanceTime 测试 —— 模型参数进引擎前的那道关。
 *
 * 这里**直接**测它，不经过 GameState —— 只被间接覆盖时，几条分支是碰巧走到的。
 *
 * 契约（读源码确认）：
 *   - unit 不传（undefined / null）按 segment；传了就必须是 6 个规范值之一
 *   - step 先 Number() 再 Math.round()；**非有限值当成 1**
 *   - n <= 0 拒绝，文案区分「倒退」与「原地不动」
 *   - 单次跨度 > 1000 年拒绝（判据是 >，恰好 1000 年放行）
 *   - 失败返回 { ok: false, message }，**不带 iso** —— 调用方自己保留原时刻
 */
import { describe, expect, it } from 'vitest'
import { advanceTime } from '../src/utils/calendar'
import { toolSchemas } from '../src/agent/tools'

/** 基准时刻（Asia/Shanghai 本地 10:00；该时区无夏令时，定长单位的毫秒数才可断言） */
const BASE_ISO = '2026-09-10T02:00:00.000Z'
/** 只出现在错误文案里的「当前时间」标签，用来验证它被原样回显 */
const LABEL = '2026-09-10 10:00'
const HOUR_MS = 3600000
const DAY_MS = 86400000

describe('advanceTime - the six canonical units', () => {
  it('segment: one segment is four hours', () => {
    expect(advanceTime(BASE_ISO, 1, 'segment', LABEL)).toMatchObject({
      ok: true,
      elapsedMs: 4 * HOUR_MS,
    })
  })

  it('hour: advances by whole hours', () => {
    expect(advanceTime(BASE_ISO, 3, 'hour', LABEL)).toMatchObject({
      ok: true,
      elapsedMs: 3 * HOUR_MS,
    })
  })

  it('day: advances by whole days', () => {
    expect(advanceTime(BASE_ISO, 2, 'day', LABEL)).toMatchObject({
      ok: true,
      elapsedMs: 2 * DAY_MS,
    })
  })

  it('week: one week is seven days', () => {
    expect(advanceTime(BASE_ISO, 1, 'week', LABEL)).toMatchObject({
      ok: true,
      elapsedMs: 7 * DAY_MS,
    })
  })

  it('month: moves one month on and reports the real elapsed time (not 30 days)', () => {
    const out = advanceTime(BASE_ISO, 1, 'month', LABEL)
    if (!out.ok) throw new Error('month must be accepted: ' + out.message)
    expect(new Date(out.iso).getMonth()).toBe(new Date(BASE_ISO).getMonth() + 1)
    // 月份长度不定，所以断言的是不变式：elapsedMs 必须等于两个时刻的真实差
    expect(out.elapsedMs).toBe(Date.parse(out.iso) - Date.parse(BASE_ISO))
  })

  it('year: moves one year on and reports the real elapsed time', () => {
    const out = advanceTime(BASE_ISO, 1, 'year', LABEL)
    if (!out.ok) throw new Error('year must be accepted: ' + out.message)
    expect(new Date(out.iso).getFullYear()).toBe(new Date(BASE_ISO).getFullYear() + 1)
    expect(out.elapsedMs).toBe(Date.parse(out.iso) - Date.parse(BASE_ISO))
  })
})

describe('advanceTime - unit validation', () => {
  it('defaults to segment when the unit is missing (undefined or null)', () => {
    expect(advanceTime(BASE_ISO, 1, undefined, LABEL)).toMatchObject({
      ok: true,
      elapsedMs: 4 * HOUR_MS,
    })
    expect(advanceTime(BASE_ISO, 1, null, LABEL)).toMatchObject({
      ok: true,
      elapsedMs: 4 * HOUR_MS,
    })
  })

  it('rejects an unknown unit, lists the accepted ones, and echoes the current time', () => {
    const out = advanceTime(BASE_ISO, 1, 'lightyear', LABEL)
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining('Unknown time unit') })
    if (out.ok) throw new Error('a bogus unit must be rejected')
    expect(out.message, 'the message must list the accepted units').toContain('segment')
    expect(out.message, 'the message must echo the current time').toContain(LABEL)
  })

  it('rejects an empty string instead of treating it as the default unit', () => {
    // '' 是 falsy 但不是 null，所以不该走默认值那条路 —— 否则模型发空串会被静默当成 segment
    expect(advanceTime(BASE_ISO, 1, '', LABEL)).toMatchObject({
      ok: false,
      message: expect.stringContaining('Unknown time unit'),
    })
  })

  it('rejects a non-string unit', () => {
    expect(advanceTime(BASE_ISO, 1, 42, LABEL)).toMatchObject({
      ok: false,
      message: expect.stringContaining('Unknown time unit'),
    })
  })
})

describe('advanceTime - step validation', () => {
  it('rejects step 0 as standing still', () => {
    expect(advanceTime(BASE_ISO, 0, 'day', LABEL)).toMatchObject({
      ok: false,
      message: expect.stringContaining('time cannot stand still'),
    })
  })

  it('rejects a negative step as moving backwards (a different reason)', () => {
    expect(advanceTime(BASE_ISO, -1, 'day', LABEL)).toMatchObject({
      ok: false,
      message: expect.stringContaining('time cannot move backwards'),
    })
  })

  it('rounds a fractional step to the nearest integer', () => {
    expect(advanceTime(BASE_ISO, 2.6, 'hour', LABEL)).toMatchObject({
      ok: true,
      elapsedMs: 3 * HOUR_MS,
    })
  })

  it('accepts a numeric string (the model sometimes quotes numbers)', () => {
    expect(advanceTime(BASE_ISO, '2', 'hour', LABEL)).toMatchObject({
      ok: true,
      elapsedMs: 2 * HOUR_MS,
    })
  })

  it('rejects a non-numeric step instead of silently advancing by 1', () => {
    // 模型发 "many" / NaN / Infinity 时回传结构化错误，让它自己改 ——
    // 「静默当成 1」是替模型做决定，也违反「绝不吞掉错误」。
    // （不填的 undefined 仍按默认 1 处理，见下一条。）
    const out = advanceTime(BASE_ISO, 'many', 'hour', LABEL)
    expect(out).toMatchObject({ ok: false })
    expect(out.ok === false && out.message).toMatch(/Invalid step/)
    expect(advanceTime(BASE_ISO, Number.NaN, 'hour', LABEL).ok).toBe(false)
    expect(advanceTime(BASE_ISO, Number.POSITIVE_INFINITY, 'hour', LABEL).ok).toBe(false)
  })

  it('treats an omitted step as 1 (the documented default)', () => {
    expect(advanceTime(BASE_ISO, undefined, 'hour', LABEL)).toMatchObject({
      ok: true,
      elapsedMs: 1 * HOUR_MS,
    })
  })

  it('coerces null to 0 and rejects it (unlike undefined, which means not provided)', () => {
    // JSON 里没有 undefined，模型「不填」到我们手上更像 null —— 这里选择拒绝而不是
    // 当成默认值，理由：null 是明确写了「没有数量」，静默当 1 会掩盖模型的参数错误
    expect(advanceTime(BASE_ISO, null, 'hour', LABEL)).toMatchObject({
      ok: false,
      message: expect.stringContaining('time cannot stand still'),
    })
  })

  it('rejects a span beyond the 1000-year guard, whichever unit expresses it', () => {
    expect(advanceTime(BASE_ISO, 1001, 'year', LABEL)).toMatchObject({
      ok: false,
      message: expect.stringContaining('Step too large'),
    })
    // 400000 天 ≈ 1095 年：同一个上限换算到别的单位也要拦住
    expect(advanceTime(BASE_ISO, 400000, 'day', LABEL)).toMatchObject({
      ok: false,
      message: expect.stringContaining('Step too large'),
    })
  })

  it('accepts exactly 1000 years (the guard is exclusive)', () => {
    expect(advanceTime(BASE_ISO, 1000, 'year', LABEL)).toMatchObject({ ok: true })
  })
})

describe('advanceTime - a rejected advance carries no new instant', () => {
  it('the failure branch has no iso field, so the caller keeps its own time', () => {
    const out = advanceTime(BASE_ISO, 1, 'lightyear', LABEL)
    expect(out.ok).toBe(false)
    expect(Object.hasOwn(out, 'iso'), 'the failure branch must not carry an iso').toBe(false)
    // 正向对照：成功分支**有** iso —— 否则上面那条断言在「两边都没有 iso」时也会绿
    const ok = advanceTime(BASE_ISO, 1, 'day', LABEL)
    expect(ok.ok).toBe(true)
    expect(Object.hasOwn(ok, 'iso'), 'the success branch must carry the new instant').toBe(true)
  })
})

describe('advanceTime - the unit list stays in sync with the tool schema', () => {
  it('the units advanceTime enforces are exactly the units the schema advertises', () => {
    const [schema] = toolSchemas()
    const params = schema.function.parameters as { properties: { unit: { enum: string[] } } }
    const advertised = params.properties.unit.enum

    // 这两份单位表在代码里是**手写的两处**（calendar.ts 的 TIME_UNITS 与 tools.ts 的
    // schema enum）。TIME_UNITS 没有导出，所以从拒绝文案里把它读出来 —— 那是运行中的
    // 代码自己列出的、它真正接受的集合。任一处的单位表变了，这条就红。
    const rejected = advanceTime(BASE_ISO, 1, 'not-a-unit', LABEL)
    if (rejected.ok) throw new Error('a bogus unit must be rejected')
    const listed = rejected.message.split('Expected one of: ')[1]?.split('. Current time')[0]?.split(', ')

    expect(listed, 'the units advanceTime enforces must equal the schema enum').toEqual(advertised)

    // 反方向：schema 广告出去的每个单位都必须真的能用（否则模型照着 schema 调用会失败）
    for (const unit of advertised) {
      const out = advanceTime(BASE_ISO, 1, unit, LABEL)
      expect(out.ok, 'schema advertises "' + unit + '" but advanceTime rejects it').toBe(true)
    }
  })
})
