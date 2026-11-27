/**
 * 阶段 2.2 · P2：`advance_time` 的负向判据（契约 §B2 / §B7）。
 *
 * 钉死两件事：
 *   1. **坏实参一律拒绝**：`amount` 缺失 / 0 / 负数 / 非整数 / 字符串；`unit` 缺失 / 不认识 / 不在模式里
 *      ⇒ `E_VALIDATION` + 中文（缺的单位不会被默认成“天”，缺的数量不会被默认成 1）；
 *   2. **颗粒度上下界真的在挡**：同一个 `unit`，界内 ⇒ 推进成功，界外 ⇒ 拒绝。
 *      「实现把 upper / lower 那道检查删掉」时，界外那几条会变成成功 ⇒ 这一组当场变红。
 *
 * 这些都是**执行器**这一层（`advanceTime` + `advanceTimeArgsOf`）的判据；引擎那条链路另由
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

describe('advance_time 负向：颗粒度上下界（删掉这道检查 ⇒ 这一组红）', () => {
  it('界内能推、界外拒绝：upper=lower=hour 时只有 hour', async () => {
    const bounds = { mode: 'year-minute', upper: 'hour', lower: 'hour' }
    expect(await advance(AT, 1, 'hour', bounds)).toEqual({ ...AT, hour: 9 })
    await expectReject(AT, 1, 'minute', bounds, '比下界细')
    await expectReject(AT, 1, 'day', bounds, '比上界粗')
    await expectReject(AT, 1, 'week', bounds, '比上界粗')
    await expectReject(AT, 1, 'month', bounds, '比上界粗')
  })

  it('同一单位的对照：上界收紧 ⇒ 拒绝；上界放宽 ⇒ 成功（界外成功就是漏了检查）', async () => {
    const strict = { mode: 'year-minute', upper: 'hour', lower: 'minute' }
    const loose = { mode: 'year-minute', upper: 'day', lower: 'minute' }
    await expectReject(AT, 1, 'day', strict, 'upper=hour 时 day 越界')
    expect(await advance(AT, 1, 'day', loose), 'upper=day 时同一次调用必须成功').toEqual({ ...AT, day: 2 })

    const strictLow = { mode: 'year-minute', upper: 'day', lower: 'hour' }
    const looseLow = { mode: 'year-minute', upper: 'day', lower: 'minute' }
    await expectReject(AT, 1, 'minute', strictLow, 'lower=hour 时 minute 越界')
    expect(await advance(AT, 1, 'minute', looseLow), 'lower=minute 时同一次调用必须成功').toEqual({
      ...AT,
      hour: 8,
      minute: 6,
    })
  })

  it('days-minute / year-date 的上界同样生效（不是只有 year-minute 一道）', async () => {
    await expectReject(
      DAYS,
      1,
      'day',
      { mode: 'days-minute', upper: 'hour', lower: 'minute' },
      'days 上界 hour',
    )
    await expectReject(
      DATE,
      1,
      'week',
      { mode: 'year-date', upper: 'day', lower: 'day' },
      'year-date 上界 day',
    )
    expect(await advance(DATE, 1, 'day', { mode: 'year-date', upper: 'day', lower: 'day' })).toEqual({
      ...DATE,
      day: 2,
    })
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
