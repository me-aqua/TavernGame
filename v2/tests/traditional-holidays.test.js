/**
 * 阶段 2.2 · B3/B4：中国传统节日（契约 §B3）。
 *
 * 有界表：只认 1900–2100（`LUNAR_INFO` 201 项，农历月长 + 闰月）。这一份钉：
 *   1. **范围**：1900 / 2100 边界、表外年份静默不产出（不抛错）、勾选照旧可点；
 *   2. **已知日期**：2024 春节 2/10、端午 6/10、中秋 9/17；2025 除夕 1/28；1900-01-31、2100-02-09 春节；
 *   3. **闰月不算节日**：2028-06-27 是闰五月初五，不是端午；
 *   4. **腊八 / 小年 / 除夕跨公历年**（2025-01-07 / 01-22 / 01-28）；
 *   5. **与另两组一起去重**、提示词里那一行。
 *
 * 功能还没做 ⇒ 这一份全红。
 */
import { describe, expect, it } from 'vitest'
import { loadModule } from './support/load.js'
import { holidaysV6, v6Card, v6Save } from './support/v6-fixtures.js'

const loadHolidays = () => loadModule('core/holidays.ts', () => import('../src/core/holidays.ts'))
const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))

const at = (year, month, day, hour = 0, minute = 0) => ({ year, month, day, hour, minute })
const date = (year, month, day) => ({ year, month, day })

/** 只开传统节日组 */
const traditional = () => holidaysV6({ traditional: true })

/** 传统节日名（只那两组现代节日不会产出的那些） */
async function namesOf(value, mode = 'year-minute', holidays = traditional()) {
  const { holidaysOf } = await loadHolidays()
  return holidaysOf(value, mode, holidays)
}

async function promptOf(card) {
  const { buildPrompt } = await loadPrompt()
  const node = card.chain.find((item) => item.id === 'check')
  return buildPrompt({ card, save: v6Save(card), node, action: 'ACT', outputs: {} })
}

describe('B3 传统节日的范围与定义', () => {
  it('只支持 1900–2100', async () => {
    const { TRADITIONAL_YEAR_MIN, TRADITIONAL_YEAR_MAX } = await loadHolidays()
    expect(TRADITIONAL_YEAR_MIN).toBe(1900)
    expect(TRADITIONAL_YEAR_MAX).toBe(2100)
  })

  it('十一条：春节 / 元宵 / 龙抬头 / 端午 / 七夕 / 中元 / 中秋 / 重阳 / 腊八 / 小年 / 除夕', async () => {
    const { TRADITIONAL_FESTIVALS } = await loadHolidays()
    expect(TRADITIONAL_FESTIVALS.length).toBe(11)
  })
})

describe('B3 已知日期（逐条对账）', () => {
  it('2024 年：春节 2/10、元宵 2/24、龙抬头 3/11、端午 6/10、七夕 8/10、中元 8/18、中秋 9/17、重阳 10/11', async () => {
    const map = [
      [2, 10, '春节'],
      [2, 24, '元宵'],
      [3, 11, '龙抬头'],
      [6, 10, '端午'],
      [8, 10, '七夕'],
      [8, 18, '中元'],
      [9, 17, '中秋'],
      [10, 11, '重阳'],
    ]
    for (const [month, day, name] of map) {
      expect(await namesOf(at(2024, month, day)), `2024-${month}-${day}`).toEqual([name])
    }
  })

  it('2025 年 1 月：腊八 1/7、小年 1/22、除夕 1/28、春节 1/29（按公历→农历换算）', async () => {
    expect(await namesOf(at(2025, 1, 7))).toEqual(['腊八'])
    expect(await namesOf(at(2025, 1, 22))).toEqual(['小年'])
    expect(await namesOf(at(2025, 1, 28))).toEqual(['除夕'])
    expect(await namesOf(at(2025, 1, 29))).toEqual(['春节'])
  })

  it('2024 除夕是 2/9（春节前一天）', async () => {
    expect(await namesOf(at(2024, 2, 9))).toEqual(['除夕'])
  })

  it('春节的锚点：1900-01-31 / 2000-02-05 / 2024-02-10 / 2025-01-29 / 2026-02-17 / 2100-02-09', async () => {
    for (const [year, month, day] of [
      [1900, 1, 31],
      [2000, 2, 5],
      [2024, 2, 10],
      [2025, 1, 29],
      [2026, 2, 17],
      [2100, 2, 9],
    ]) {
      expect(await namesOf(at(year, month, day)), `${year}-${month}-${day}`).toEqual(['春节'])
    }
  })

  it('非节日（春节第二天）⇒ 空', async () => {
    expect(await namesOf(at(2024, 2, 11))).toEqual([])
  })

  it('闰月不算节日：2028-05-28 是端午，2028-06-27（闰五月初五）不是', async () => {
    expect(await namesOf(at(2028, 5, 28))).toEqual(['端午'])
    expect(await namesOf(at(2028, 6, 27))).toEqual([])
  })

  it('闰六月的月份也不冒充：2025-07-30（闰六月初六）不是任何传统节日', async () => {
    expect(await namesOf(at(2025, 7, 30))).toEqual([])
  })
})

describe('B3 表外年份：静默不产出（不抛错、勾选照旧可点）', () => {
  it('1899 / 2101 ⇒ 空，且不抛错', async () => {
    expect(await namesOf(at(1899, 12, 31))).toEqual([])
    expect(await namesOf(at(2101, 1, 1))).toEqual([])
    expect(await namesOf(at(-551, 1, 1))).toEqual([])
    expect(await namesOf(at(9999, 12, 31))).toEqual([])
  })

  it('1900-01-30 在表外（农历还是 1899 年）⇒ 空；1900-01-31 就是春节', async () => {
    expect(await namesOf(at(1900, 1, 30))).toEqual([])
    expect(await namesOf(at(1900, 1, 31))).toEqual(['春节'])
  })

  it('2100-12-31 是农历腊月初一（不是节日）⇒ 空', async () => {
    expect(await namesOf(at(2100, 12, 31))).toEqual([])
  })
})

describe('B3 与另两组一起去重', () => {
  it('2024-01-01 三组全开 ⇒ 只有元旦，没有重复', async () => {
    const names = await namesOf(
      at(2024, 1, 1),
      'year-minute',
      holidaysV6({
        international: true,
        china: true,
        traditional: true,
      }),
    )
    expect(names).toEqual(['元旦'])
  })

  it('2024-02-10 三组全开 ⇒ 只有春节（同一天不出现两次）', async () => {
    const names = await namesOf(
      at(2024, 2, 10),
      'year-minute',
      holidaysV6({
        international: true,
        china: true,
        traditional: true,
      }),
    )
    expect(names).toEqual(['春节'])
  })

  it('传统节日关着 ⇒ 春节当天为空（它不沾现代两组的光）', async () => {
    expect(
      await namesOf(at(2024, 2, 10), 'year-minute', holidaysV6({ international: true, china: true })),
    ).toEqual([])
  })

  it('year-date 模式照样能算传统节日', async () => {
    expect(await namesOf(date(2024, 9, 17), 'year-date')).toEqual(['中秋'])
  })

  it('days-minute 模式没有传统节日（这个模式根本没有节日格子）', async () => {
    const { holidaysOf } = await loadHolidays()
    expect(
      holidaysOf({ day: 1, hour: 0, minute: 0 }, 'days-minute', holidaysV6({ traditional: true })),
    ).toEqual([])
  })
})

describe('B4 传统节日进提示词', () => {
  it('2024-02-10 + 传统节日勾着 ⇒ `节日：春节`，只出现一次', async () => {
    const card = v6Card()
    card.state[0].holidays = holidaysV6({ traditional: true })
    card.state[0].initial = at(2024, 2, 10)
    const prompt = await promptOf(card)
    expect(prompt).toContain('节日：春节')
    expect((prompt.match(/节日：/g) ?? []).length).toBe(1)
  })

  it('传统节日没勾 ⇒ 春节当天提示词里没有 `节日：`（勾着时为对照）', async () => {
    const on = v6Card()
    on.state[0].holidays = holidaysV6({ traditional: true })
    on.state[0].initial = at(2024, 2, 10)
    expect(await promptOf(on), '勾着时先要出现这一行').toContain('节日：春节')

    const card = v6Card()
    card.state[0].initial = at(2024, 2, 10)
    expect(await promptOf(card)).not.toContain('节日：')
  })

  it('表外年份（1899）即使勾着传统节日，提示词里也不出现 `节日：`，且不报错（表内为对照）', async () => {
    const inRange = v6Card()
    inRange.state[0].holidays = holidaysV6({ traditional: true })
    inRange.state[0].initial = at(2024, 2, 10)
    expect(await promptOf(inRange), '表内年份先要出现这一行').toContain('节日：春节')

    const card = v6Card()
    card.state[0].holidays = holidaysV6({ traditional: true })
    card.state[0].initial = at(1899, 2, 10)
    const prompt = await promptOf(card)
    expect(prompt).not.toContain('节日：')
    expect(prompt).toContain('1899-02-10')
  })

  it('同一张卡里现代 + 传统同时命中（2024-01-01 元旦 + 无传统）⇒ 一行只写元旦', async () => {
    const card = v6Card()
    card.state[0].holidays = holidaysV6({ international: true, traditional: true })
    card.state[0].initial = at(2024, 1, 1)
    const prompt = await promptOf(card)
    expect((prompt.match(/节日：/g) ?? []).length).toBe(1)
    expect(prompt).toContain('节日：元旦')
  })
})
