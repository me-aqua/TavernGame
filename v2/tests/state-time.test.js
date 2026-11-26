/**
 * 阶段 2.1 · 时间（v5 契约 §3）。
 *
 * 时间在 v5 里是**真实公历**：`{ year, month, day, hour, minute, second }`，`week` 不存、按日期算。
 * 这一份钉三件事：
 *   1. **日历推进**：秒 / 分 / 时 / 日 / 周 / 月 / 年都按公历走；月末没有那一天就取月末；
 *   2. **颗粒度上下界**：`granularityUpper` 是最粗的单次推进单位、`granularityLower` 是最细的；
 *      界外的单位（比下界更细 / 比上界更粗）一律拒绝；
 *   3. **合法性**：源时间必须是合法公历；`amount` 是正整数；推进结果不许越过 1..9999 年。
 *
 * 判据只钉这三件事；契约没写的语义不断言。
 */
import { describe, expect, it } from 'vitest'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))

const CJK = /[\u4e00-\u9fff]/

/** 一个时间值（只写关心的几格，其余取 0） */
function at(year, month, day, hour = 0, minute = 0, second = 0) {
  return { year, month, day, hour, minute, second }
}

/** 推进一次；错误以值返回（不吞错：没抛就是 null） */
async function advance(value, amount, unit, bounds) {
  const { advanceTime } = await loadState()
  try {
    return advanceTime(value, amount, unit, bounds)
  } catch (cause) {
    return cause
  }
}

/** 期望推进成功并得到这个值 */
async function expectNext(value, amount, unit, expected, bounds) {
  const result = await advance(value, amount, unit, bounds)
  expect(result).toEqual(expected)
}

/** 期望被拒（E_VALIDATION + 中文） */
async function expectReject(value, amount, unit, bounds, note) {
  const result = await advance(value, amount, unit, bounds)
  expect(result).toBeInstanceOf(Error)
  expect(result.code, `${note}：应当报 E_VALIDATION`).toBe('E_VALIDATION')
  expect(result.message).toMatch(CJK)
}

describe('时间 v5 · 单位顺序与颗粒度', () => {
  it('七个单位按「粗 → 细」排：year / month / week / day / hour / minute / second', async () => {
    const { TIME_UNITS } = await loadState()
    expect(TIME_UNITS).toEqual(['year', 'month', 'week', 'day', 'hour', 'minute', 'second'])
  })

  it('颗粒度界内可以推进，界外一律拒绝（upper=day, lower=minute）', async () => {
    const bounds = { upper: 'day', lower: 'minute' }
    const value = at(2024, 1, 1, 8, 5, 0)
    await expectNext(value, 30, 'minute', at(2024, 1, 1, 8, 35, 0), bounds)
    await expectNext(value, 3, 'hour', at(2024, 1, 1, 11, 5, 0), bounds)
    await expectNext(value, 2, 'day', at(2024, 1, 3, 8, 5, 0), bounds)
    await expectReject(value, 1, 'second', bounds, '比下界更细')
    await expectReject(value, 1, 'week', bounds, '比上界更粗')
    await expectReject(value, 1, 'month', bounds, '比上界更粗')
  })

  it('上下界可以相等（upper=lower=hour）：只有小时能推', async () => {
    const bounds = { upper: 'hour', lower: 'hour' }
    await expectNext(at(2024, 1, 1, 8, 5, 0), 2, 'hour', at(2024, 1, 1, 10, 5, 0), bounds)
    await expectReject(at(2024, 1, 1, 8, 5, 0), 1, 'minute', bounds, '比下界细')
    await expectReject(at(2024, 1, 1, 8, 5, 0), 1, 'day', bounds, '比上界粗')
  })
})

describe('时间 v5 · 公历推进', () => {
  it('秒 / 分 / 时按位进位（跨时、跨日）', async () => {
    await expectNext(at(2024, 1, 1, 0, 0, 0), 1, 'second', at(2024, 1, 1, 0, 0, 1))
    await expectNext(at(2024, 1, 1, 23, 59, 59), 1, 'second', at(2024, 1, 2, 0, 0, 0))
    await expectNext(at(2024, 1, 1, 0, 59, 59), 1, 'minute', at(2024, 1, 1, 1, 0, 59))
    await expectNext(at(2024, 1, 1, 23, 30, 0), 1, 'hour', at(2024, 1, 2, 0, 30, 0))
  })

  it('日 / 周按天数走：week = 7 × amount 天，且不存周字段', async () => {
    await expectNext(at(2024, 2, 28, 12, 0, 0), 1, 'day', at(2024, 2, 29, 12, 0, 0))
    await expectNext(at(2023, 2, 28, 12, 0, 0), 1, 'day', at(2023, 3, 1, 12, 0, 0))
    await expectNext(at(2024, 12, 30, 9, 0, 0), 1, 'week', at(2025, 1, 6, 9, 0, 0))
    await expectNext(at(2024, 12, 30, 9, 0, 0), 2, 'week', at(2025, 1, 13, 9, 0, 0))
  })

  it('月：目标月没有该日就取月末（闰年 2 月 29）', async () => {
    await expectNext(at(2024, 1, 31, 0, 0, 0), 1, 'month', at(2024, 2, 29, 0, 0, 0))
    await expectNext(at(2023, 1, 31, 0, 0, 0), 1, 'month', at(2023, 2, 28, 0, 0, 0))
    await expectNext(at(2024, 11, 30, 0, 0, 0), 2, 'month', at(2025, 1, 30, 0, 0, 0))
    await expectNext(at(2024, 12, 15, 0, 0, 0), 1, 'month', at(2025, 1, 15, 0, 0, 0))
  })

  it('年：闰日加一年落回 2 月 28', async () => {
    await expectNext(at(2024, 2, 29, 0, 0, 0), 1, 'year', at(2025, 2, 28, 0, 0, 0))
    await expectNext(at(2024, 3, 1, 0, 0, 0), 1, 'year', at(2025, 3, 1, 0, 0, 0))
    await expectNext(at(2024, 6, 15, 0, 0, 0), 3, 'year', at(2027, 6, 15, 0, 0, 0))
  })

  it('不支持的单位 / amount 不是正整数 ⇒ E_VALIDATION', async () => {
    const value = at(2024, 1, 1, 8, 5, 0)
    for (const [amount, unit, note] of [
      [0, 'day', 'amount 0'],
      [-1, 'day', 'amount 负数'],
      [1.5, 'day', 'amount 非整数'],
      ['1', 'day', 'amount 字符串'],
      [1, 'decade', '不认识单位'],
    ]) {
      await expectReject(value, amount, unit, undefined, note)
    }
  })

  it('源时间不合法 ⇒ E_VALIDATION；推进越过 1..9999 ⇒ E_VALIDATION', async () => {
    for (const [bad, note] of [
      [at(2024, 13, 1), '月份 13'],
      [at(2024, 2, 30), '2 月 30'],
      [at(2024, 1, 1, 24), '24 点'],
      [{ year: 2024, month: 1, day: 1 }, '缺字段'],
    ]) {
      await expectReject(bad, 1, 'day', undefined, note)
    }
    await expectReject(at(9999, 12, 31, 23, 59, 59), 1, 'second', undefined, '越过 9999 年')
    // 下界不是「拒绝」：amount 只能是正整数，往前推不会掉到 1 年以下；从 1 年出发是合法的
    expect(await advance(at(1, 1, 1, 0, 0, 0), 1, 'year')).toEqual(at(2, 1, 1, 0, 0, 0))
  })
})

describe('时间 v5 · 输出格式', () => {
  it('`YYYY-MM-DD HH:mm:ss（周X）`，星期几按真实日历', async () => {
    const { formatTime } = await loadState()
    expect(formatTime(at(2024, 1, 1, 8, 5, 0))).toBe('2024-01-01 08:05:00（周一）')
    expect(formatTime(at(2024, 2, 29, 23, 59, 59))).toBe('2024-02-29 23:59:59（周四）')
    expect(formatTime(at(2024, 12, 31, 0, 0, 0))).toBe('2024-12-31 00:00:00（周二）')
  })

  it('月和日、时分秒补零，年份补到四位', async () => {
    const { formatTime } = await loadState()
    expect(formatTime(at(1024, 9, 7, 6, 3, 2))).toMatch(/^1024-09-07 06:03:02（周[一二三四五六日]）$/)
    expect(formatTime(at(1, 1, 1, 0, 0, 0))).toMatch(/^0001-01-01 00:00:00（周[一二三四五六日]）$/)
  })
})
