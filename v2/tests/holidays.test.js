/**
 * 阶段 2.2 · B3/B4：现代国际节日 + 现代中国节日（契约 §B3–§B4）。
 *
 * 钉死：两组各自的公历固定日、`holidaysOf` 的取用与去重、天数模式没有节日、
 * 以及提示词里那一行 `节日：…`（前缀 / 分隔符 / 出现次数 / 与时间行的先后）。
 *
 * 现代中国组**一个农历派生节日都没有**（春节 / 元宵 / 端午 / 七夕 / 中秋 / 重阳 / 除夕都不在），
 * **也没有清明**（节气不是节日）。节日显示名是契约字面量（`holidaysOf` 返回中文名）。
 */
import { describe, expect, it } from 'vitest'
import { loadModule } from './support/load.js'
import { elementOf, holidaysV6, v6Card, v6Save } from './support/v6-fixtures.js'

const loadHolidays = () => loadModule('core/holidays.ts', () => import('../src/core/holidays.ts'))
const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))

/** 年月日时分（year-minute） */
const at = (year, month, day, hour = 0, minute = 0) => ({ year, month, day, hour, minute })
/** 年月日（year-date） */
const date = (year, month, day) => ({ year, month, day })

/** `holidaysOf` 的常用形态：年份模式 + 选中的组 */
async function namesOf(value, mode, holidays) {
  const { holidaysOf } = await loadHolidays()
  return holidaysOf(value, mode, holidays)
}

/** 提示词：`check` 节点读时间（`reads` 含 '0'） */
async function promptOf(card, nodeId = 'check') {
  const { buildPrompt } = await loadPrompt()
  const node = card.chain.find((item) => item.id === nodeId)
  return buildPrompt({ card, save: v6Save(card), node, action: 'ACT', outputs: {} })
}

const HOLIDAY_LINE = /节日：/g

describe('B3 两组现代节日的定义', () => {
  it('现代国际：七条，公历固定日', async () => {
    const { INTERNATIONAL_HOLIDAYS } = await loadHolidays()
    expect(INTERNATIONAL_HOLIDAYS.length).toBe(7)
    expect(INTERNATIONAL_HOLIDAYS.map((item) => `${item.month}/${item.day}`)).toEqual([
      '1/1',
      '2/14',
      '3/8',
      '5/1',
      '6/1',
      '10/31',
      '12/25',
    ])
  })

  it('现代中国：三条（元旦 / 劳动节 / 国庆节），没有农历派生节日', async () => {
    const { CHINA_HOLIDAYS } = await loadHolidays()
    expect(CHINA_HOLIDAYS.length).toBe(3)
    expect(CHINA_HOLIDAYS.map((item) => `${item.month}/${item.day}`).sort()).toEqual(['1/1', '10/1', '5/1'])
  })

  it('现代中国组在春节当天什么都不产出（春节只属于传统节日组）', async () => {
    expect(await namesOf(at(2024, 2, 10), 'year-minute', holidaysV6({ china: true }))).toEqual([])
  })

  it('清明不是节日（节气不加）：4 月 4 日三组现代节日都关着时为空', async () => {
    expect(await namesOf(at(2024, 4, 4), 'year-minute', holidaysV6())).toEqual([])
  })
})

describe('B3 holidaysOf：取用、去重、模式', () => {
  it('元旦（1/1）：两组都开也只有一个', async () => {
    const both = await namesOf(
      at(2024, 1, 1),
      'year-minute',
      holidaysV6({ international: true, china: true }),
    )
    expect(both).toEqual(['元旦'])
  })

  it('劳动节（5/1）：两组都开也只有一个', async () => {
    const both = await namesOf(
      at(2024, 5, 1),
      'year-minute',
      holidaysV6({ international: true, china: true }),
    )
    expect(both).toEqual(['劳动节'])
  })

  it('国庆节只在现代中国组出现', async () => {
    expect(await namesOf(at(2024, 10, 1), 'year-minute', holidaysV6({ china: true }))).toEqual(['国庆节'])
    expect(await namesOf(at(2024, 10, 1), 'year-minute', holidaysV6({ international: true }))).toEqual([])
  })

  it('国际组的五个专属日子各自命中', async () => {
    const intl = holidaysV6({ international: true })
    for (const [month, day, name] of [
      [2, 14, '情人节'],
      [3, 8, '妇女节'],
      [6, 1, '儿童节'],
      [10, 31, '万圣节'],
      [12, 25, '圣诞节'],
    ]) {
      expect(await namesOf(at(2024, month, day), 'year-minute', intl), `${month}/${day}`).toEqual([name])
    }
  })

  it('没勾 / 不是那几天 ⇒ 空', async () => {
    expect(await namesOf(at(2024, 1, 1), 'year-minute', holidaysV6())).toEqual([])
    expect(
      await namesOf(at(2024, 1, 2), 'year-minute', holidaysV6({ international: true, china: true })),
    ).toEqual([])
  })

  it('year-date 模式照样能算', async () => {
    expect(
      await namesOf(date(2024, 1, 1), 'year-date', holidaysV6({ international: true, china: true })),
    ).toEqual(['元旦'])
  })

  it('days-minute 模式没有节日：返回空数组', async () => {
    const { holidaysOf } = await loadHolidays()
    expect(
      holidaysOf({ day: 1, hour: 0, minute: 0 }, 'days-minute', holidaysV6({ international: true })),
    ).toEqual([])
  })

  it('holidays 缺省（undefined）⇒ 空数组', async () => {
    const { holidaysOf } = await loadHolidays()
    expect(holidaysOf(at(2024, 1, 1), 'year-minute', undefined)).toEqual([])
  })
})

describe('B4 提示词里的节日行', () => {
  it('读时间 + 节日非空 ⇒ 时间行后面一行 `节日：元旦`，只出现一次', async () => {
    const card = v6Card()
    card.state[0].holidays = holidaysV6({ international: true, china: true })
    card.state[0].initial = at(2024, 1, 1)
    const prompt = await promptOf(card)
    expect(prompt).toContain('节日：元旦')
    expect((prompt.match(HOLIDAY_LINE) ?? []).length).toBe(1)
    expect(prompt.indexOf('2024-01-01'), '时间行在节日行前面').toBeLessThan(prompt.indexOf('节日：'))
  })

  it('节日为空 ⇒ 连 `节日：` 都不出现（有节日时为对照）', async () => {
    const festive = v6Card()
    festive.state[0].holidays = holidaysV6({ international: true, china: true })
    festive.state[0].initial = at(2024, 1, 1)
    expect(await promptOf(festive), '有节日时先要出现这一行').toContain('节日：元旦')

    const card = v6Card()
    card.state[0].initial = at(2024, 1, 2)
    const prompt = await promptOf(card)
    expect(prompt).not.toContain('节日：')
  })

  it('没读时间元素 ⇒ 节日行不出现（读时间的节点为对照）', async () => {
    const card = v6Card()
    card.state[0].holidays = holidaysV6({ international: true, china: true })
    card.state[0].initial = at(2024, 1, 1)
    expect(await promptOf(card, 'check'), '读时间的节点先要出现这一行').toContain('节日：')
    // output 节点不读时间：它的提示词里不许有节日行
    const prompt = await promptOf(card, 'output')
    expect(prompt).not.toContain('节日：')
  })

  it('同日两条现代节日去重后只写一遍名字', async () => {
    const card = v6Card()
    card.state[0].holidays = holidaysV6({ international: true, china: true })
    card.state[0].initial = at(2024, 5, 1)
    const prompt = await promptOf(card)
    expect((prompt.match(/劳动节/g) ?? []).length).toBe(1)
  })

  it('节日行**不写进** state：卡与存档的 tree 一个字都不动，但提示词确实变长', async () => {
    const card = v6Card()
    card.state[0].holidays = holidaysV6({ international: true, china: true })
    card.state[0].initial = at(2024, 1, 1)
    const save = v6Save(card)
    const before = JSON.stringify({ card, save })
    const withHoliday = await promptOf(card)
    expect(withHoliday, '节日这一行必须真的进了提示词（否则下面那条是在空断言）').toContain('节日：元旦')
    expect(JSON.stringify({ card, save }), '生成提示词不许改卡 / 存档').toBe(before)
    expect('节日' in save.tree, '节日不是状态值').toBe(false)
    expect(Object.keys(save.tree).sort()).toEqual(['0', '1.1.0', '1.1.1', '1.2', '2.1', '2.2'])
  })

  it('状态树里的时间元素自己的值是时间值，不被节日污染（同一张卡节日开关下都成立）', async () => {
    const card = v6Card()
    card.state[0].holidays = holidaysV6({ international: true })
    card.state[0].initial = at(2024, 2, 14)
    const save = v6Save(card)
    const prompt = await promptOf(card)
    expect(prompt, '情人节这一行先要出现').toContain('节日：情人节')
    expect(save.tree[elementOf(card, '0').code]).toEqual(at(2024, 2, 14))
  })
})
