/**
 * `advance_time` 的负向判据（契约 §F）。
 *
 * 钉死一件事：**坏实参一律拒绝** —— `amount` 缺失 / 0 / 负数 / 非整数 / 字符串；
 * `unit` 缺失 / 不认识 / 不在当前模式的单位表里 ⇒ `E_VALIDATION` + 中文
 * （缺的单位不会被默认成「天」，缺的数量不会被默认成 1）。
 *
 * 允许单位只由模式决定（`unitsOfMode`）；上下界那一族已经不存在了，相关判据在
 * `v2/tests/time-units-by-mode.test.js`。这些都是**执行器**这一层的判据；引擎那条链路另由
 * `v2/e2e/advance-time-negative.spec.js` 用真 provider 形状的 tool call 钉。
 */
import { describe, expect, it } from 'vitest'
import { loadModule } from './support/load.js'

const loadTime = () => loadModule('core/timevalue.ts', () => import('../src/core/timevalue.ts'))
const loadTools = () =>
  loadModule('core/tool-definitions.ts', () => import('../src/core/tool-definitions.ts'))

const CJK = /[\u4e00-\u9fff]/

/** 2024-01-01 08:05（year-minute） */
const AT = { year: 2024, month: 1, day: 1, hour: 8, minute: 5 }
/** 2024-01-01（year-date） */
const DATE = { year: 2024, month: 1, day: 1 }
/** 第 1 天 08:05（days-minute） */
const DAYS = { day: 1, hour: 8, minute: 5 }

/** 调一次 advanceTime，错误按值返回（没抛就是值） */
async function advance(value, amount, unit, bounds) {
  const { advanceTime } = await loadTime()
  try {
    return advanceTime(value, amount, unit, bounds)
  } catch (cause) {
    return cause
  }
}

/** 期望被拒：E_VALIDATION + 中文消息 */
async function expectReject(value, amount, unit, bounds, note) {
  const result = await advance(value, amount, unit, bounds)
  expect(result, `${note}：应当被拒`).toBeInstanceOf(Error)
  expect(result.code, `${note}：错误码`).toBe('E_VALIDATION')
  expect(result.message, `${note}：消息必须是中文`).toMatch(CJK)
}

describe('advance_time 负向：坏 amount', () => {
  it('缺失 / 0 / 负数 / 非整数 / 字符串 ⇒ E_VALIDATION（不会被默认成 1）', async () => {
    const bounds = { mode: 'year-minute' }
    for (const [amount, note] of [
      [undefined, '缺失'],
      [null, 'null'],
      [0, '0'],
      [-1, '负数'],
      [-3, '负整数'],
      [1.5, '小数'],
      ['2', '数字字符串'],
      ['', '空串'],
      [true, '布尔'],
    ]) {
      await expectReject(AT, amount, 'day', bounds, `amount ${note}`)
    }
  })

  it('amount 合法时能推进（同一条判据的正控）', async () => {
    expect(await advance(AT, 2, 'day', { mode: 'year-minute' })).toEqual({ ...AT, day: 3 })
  })
})

describe('advance_time 负向：坏 unit', () => {
  it('缺失 / 空串 / 不认识 ⇒ E_VALIDATION（不会被默认成 day）', async () => {
    const bounds = { mode: 'year-minute' }
    for (const [unit, note] of [
      [undefined, '缺失'],
      [null, 'null'],
      ['', '空串'],
      ['decade', '不认识的单位'],
      ['second', '秒已经不是单位了'],
      [7, '数字'],
    ]) {
      await expectReject(AT, 1, unit, bounds, `unit ${note}`)
    }
  })

  it('单位不在该模式里 ⇒ E_VALIDATION（year-date 没有钟点；days-minute 没有年月）', async () => {
    for (const [value, unit, mode, note] of [
      [DATE, 'hour', 'year-date', 'year-date 的 hour'],
      [DATE, 'minute', 'year-date', 'year-date 的 minute'],
      [DAYS, 'year', 'days-minute', 'days-minute 的 year'],
      [DAYS, 'month', 'days-minute', 'days-minute 的 month'],
      [DAYS, 'week', 'days-minute', 'days-minute 的 week'],
    ]) {
      await expectReject(value, 1, unit, { mode }, note)
    }
  })

  it('控制卡：每个模式的合法单位照常能推进', async () => {
    expect(await advance(DATE, 1, 'month', { mode: 'year-date' })).toEqual({ ...DATE, month: 2 })
    expect(await advance(DAYS, 1, 'hour', { mode: 'days-minute' })).toEqual({ ...DAYS, hour: 9 })
  })
})

describe('advance_time 负向：工具实参提取与执行器的接缝', () => {
  it('缺实参时 advanceTimeArgsOf 取到 undefined，交给执行器 ⇒ E_VALIDATION', async () => {
    const { advanceTimeArgsOf } = await loadTools()
    const { advanceTime } = await loadTime()
    for (const args of [{}, { amount: 1 }, { unit: 'day' }, { amount: 1, unit: 'decade' }, { hours: 1 }]) {
      const picked = advanceTimeArgsOf(args)
      let caught = null
      try {
        advanceTime(AT, picked.amount, picked.unit, { mode: 'year-minute' })
      } catch (cause) {
        caught = cause
      }
      expect(caught, `参数 ${JSON.stringify(args)} 应当拒绝`).toBeInstanceOf(Error)
      expect(caught.code).toBe('E_VALIDATION')
      expect(caught.message).toMatch(CJK)
    }
  })

  it('完整实参 ⇒ 执行器照常推进（同一接缝的正控）', async () => {
    const { advanceTimeArgsOf } = await loadTools()
    const { advanceTime } = await loadTime()
    const picked = advanceTimeArgsOf({ amount: 3, unit: 'hour' })
    expect(advanceTime(AT, picked.amount, picked.unit, { mode: 'year-minute' })).toEqual({ ...AT, hour: 11 })
  })
})
