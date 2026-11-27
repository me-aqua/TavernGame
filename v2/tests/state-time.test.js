/**
 * 阶段 2.2 / 2.3 · 时间（契约 §B1–§B2 / §F）。
 *
 * 时间在 2.2 里按**模式**走：`year-minute` = 年月日时分（5 格）、`year-date` = 年月日（3 格）、
 * `days-minute` = 天时分（3 格）。这一份钉三件事（与 2.1 那份同一批断言，按新语义迁移）：
 *   1. **日历推进**：分 / 时 / 日 / 周 / 月 / 年都按公历走；月末没有那一天就取月末；
 *   2. **单位只由模式决定**：`unitsOfMode(mode)` 是唯一来源；旧的 `upper` / `lower` 不参与判决；
 *   3. **合法性**：源时间必须是该模式的合法公历；`amount` 是正整数；年份 -551..9999、没有 0 年。
 *
 * 判据只钉这三件事；契约没写的语义不断言。
 */
import { describe, expect, it } from 'vitest'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))

const CJK = /[\u4e00-\u9fff]/

/** 一个 year-minute 时间值（分钟 / 小时缺省 0） */
function at(year, month, day, hour = 0, minute = 0) {
  return { year, month, day, hour, minute }
}

/** 一个 year-date 时间值 */
function date(year, month, day) {
  return { year, month, day }
}

/** 推进一次；错误以值返回（不吞错：没抛就是 null） */
async function advance(value, amount, unit, options = { mode: 'year-minute' }) {
  const { advanceTime } = await loadState()
  try {
    return advanceTime(value, amount, unit, options)
  } catch (cause) {
    return cause
  }
}

/** 期望推进成功并得到这个值 */
async function expectNext(value, amount, unit, expected, options) {
  const result = await advance(value, amount, unit, options)
  expect(result).toEqual(expected)
}

/** 期望被拒（E_VALIDATION + 中文） */
async function expectReject(value, amount, unit, options, note) {
  const result = await advance(value, amount, unit, options)
  expect(result).toBeInstanceOf(Error)
  expect(result.code, `${note}：应当报 E_VALIDATION`).toBe('E_VALIDATION')
  expect(result.message).toMatch(CJK)
}

describe('时间 · 单位顺序与模式', () => {
  it('六个单位按「粗 → 细」排：year / month / week / day / hour / minute（秒没有了）', async () => {
    const { TIME_UNITS } = await loadState()
    expect(TIME_UNITS).toEqual(['year', 'month', 'week', 'day', 'hour', 'minute'])
  })

  it('year-minute 没有额外的上界：week / month / year 都是合法单位', async () => {
    const value = at(2024, 1, 1, 8, 5)
    await expectNext(value, 1, 'week', at(2024, 1, 8, 8, 5))
    await expectNext(value, 1, 'month', at(2024, 2, 1, 8, 5))
    await expectNext(value, 1, 'year', at(2025, 1, 1, 8, 5))
  })

  it('旧的 upper / lower 传进来当没传：判决只看 mode', async () => {
    const options = { mode: 'year-minute', upper: 'hour', lower: 'hour' }
    await expectNext(at(2024, 1, 1, 8, 5), 1, 'week', at(2024, 1, 8, 8, 5), options)
    await expectNext(at(2024, 1, 1, 8, 5), 30, 'minute', at(2024, 1, 1, 8, 35), options)
  })

  it('year-date 只到 day：hour 被拒（按模式判，不看旧 upper）', async () => {
    const value = date(2024, 1, 15)
    const options = { mode: 'year-date' }
    await expectNext(value, 1, 'month', date(2024, 2, 15), options)
    await expectNext(value, 2, 'day', date(2024, 1, 17), options)
    await expectReject(value, 1, 'hour', options, 'year-date 没有钟点')
  })
})

describe('时间 · 公历推进', () => {
  it('分 / 时按位进位（跨时、跨日）', async () => {
    await expectNext(at(2024, 1, 1, 0, 59), 1, 'minute', at(2024, 1, 1, 1, 0))
    await expectNext(at(2024, 1, 1, 23, 59), 1, 'minute', at(2024, 1, 2, 0, 0))
    await expectNext(at(2024, 1, 1, 23, 30), 1, 'hour', at(2024, 1, 2, 0, 30))
  })

  it('日 / 周按天数走：week = 7 × amount 天，且不存周字段', async () => {
    await expectNext(at(2024, 2, 28, 12, 0), 1, 'day', at(2024, 2, 29, 12, 0))
    await expectNext(at(2023, 2, 28, 12, 0), 1, 'day', at(2023, 3, 1, 12, 0))
    await expectNext(at(2024, 12, 30, 9, 0), 1, 'week', at(2025, 1, 6, 9, 0))
    await expectNext(at(2024, 12, 30, 9, 0), 2, 'week', at(2025, 1, 13, 9, 0))
  })

  it('月：目标月没有该日就取月末（闰年 2 月 29）', async () => {
    await expectNext(at(2024, 1, 31, 0, 0), 1, 'month', at(2024, 2, 29, 0, 0))
    await expectNext(at(2023, 1, 31, 0, 0), 1, 'month', at(2023, 2, 28, 0, 0))
    await expectNext(at(2024, 11, 30, 0, 0), 2, 'month', at(2025, 1, 30, 0, 0))
    await expectNext(at(2024, 12, 15, 0, 0), 1, 'month', at(2025, 1, 15, 0, 0))
  })

  it('年：闰日加一年落回 2 月 28；跨「没有 0 年」按天文年走', async () => {
    await expectNext(at(2024, 2, 29, 0, 0), 1, 'year', at(2025, 2, 28, 0, 0))
    await expectNext(at(2024, 3, 1, 0, 0), 1, 'year', at(2025, 3, 1, 0, 0))
    await expectNext(at(2024, 6, 15, 0, 0), 3, 'year', at(2027, 6, 15, 0, 0))
    // 公元前 1 年 + 1 年 = 公元 1 年（没有 0 年）
    await expectNext(at(-1, 1, 1, 0, 0), 1, 'year', at(1, 1, 1, 0, 0))
    // year-date 模式同样按天数走
    await expectNext(date(2024, 12, 30), 1, 'week', date(2025, 1, 6), { mode: 'year-date' })
  })

  it('天数模式：时 / 分进位到天，天是最粗单位', async () => {
    const days = { day: 1, hour: 23, minute: 30 }
    await expectNext(days, 1, 'hour', { day: 2, hour: 0, minute: 30 }, { mode: 'days-minute' })
    await expectNext(days, 1, 'day', { day: 2, hour: 23, minute: 30 }, { mode: 'days-minute' })
    await expectReject(days, 1, 'month', { mode: 'days-minute' }, '天数模式没有月')
  })

  it('不支持的单位 / amount 不是正整数 ⇒ E_VALIDATION', async () => {
    const value = at(2024, 1, 1, 8, 5)
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

  it('源时间不合法 ⇒ E_VALIDATION；推进越过 9999 / 公元前 551 ⇒ E_VALIDATION', async () => {
    for (const [bad, note] of [
      [at(2024, 13, 1), '月份 13'],
      [at(2024, 2, 30), '2 月 30'],
      [at(2024, 1, 1, 24), '24 点'],
      [at(0, 1, 1), '0 年不存在'],
      [{ year: 2024, month: 1, day: 1 }, '缺钟点'],
    ]) {
      await expectReject(bad, 1, 'day', undefined, note)
    }
    await expectReject(at(9999, 12, 31, 23, 59), 1, 'minute', undefined, '越过 9999 年')
    // 下界不是「拒绝」：amount 只能是正整数，从 -551 年出发是合法的
    expect(await advance(at(-551, 1, 1, 0, 0), 1, 'year')).toEqual(at(-550, 1, 1, 0, 0))
  })
})

describe('时间 · 输出格式', () => {
  it('year-minute：`YYYY-MM-DD HH:mm（周X）`，星期几按真实日历', async () => {
    const { formatTime } = await loadState()
    expect(formatTime(at(2024, 1, 1, 8, 5), 'year-minute')).toBe('2024-01-01 08:05（周一）')
    expect(formatTime(at(2024, 2, 29, 23, 59), 'year-minute')).toBe('2024-02-29 23:59（周四）')
    expect(formatTime(at(2024, 12, 31, 0, 0), 'year-minute')).toBe('2024-12-31 00:00（周二）')
    // year-date 没有钟点；days-minute 是「第 N 天」
    expect(formatTime(date(2024, 2, 10), 'year-date')).toBe('2024-02-10（周六）')
    expect(formatTime({ day: 3, hour: 8, minute: 5 }, 'days-minute')).toBe('第 3 天 08:05')
  })

  it('月和日补零、年份补到四位；公元前写「公元前 N」', async () => {
    const { formatTime } = await loadState()
    expect(formatTime(at(1024, 9, 7, 6, 3), 'year-minute')).toMatch(
      /^1024-09-07 06:03（周[一二三四五六日]）$/,
    )
    expect(formatTime(at(1, 1, 1, 0, 0), 'year-minute')).toMatch(/^0001-01-01 00:00（周[一二三四五六日]）$/)
    expect(formatTime(at(-551, 1, 1, 8, 0), 'year-minute')).toBe('公元前551-01-01 08:00（周二）')
  })
})
