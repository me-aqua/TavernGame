/**
 * 阶段 2.3 · 时间元素的字段与推进单位（契约 §E–§F）。
 *
 * 一句话：**颗粒度上下界不存在了**。时间能推进哪些单位，只由它的模式决定：
 *   · `year-minute` ⇒ year / month / week / day / hour / minute
 *   · `year-date`   ⇒ year / month / week / day
 *   · `days-minute` ⇒ day / hour / minute
 *
 * 钉五件事：
 *   1. 新建卡的时间元素**不写** `granularityUpper` / `granularityLower`；
 *   2. 没有这两格的卡**合法**（校验不再要它们），残留这两格（哪怕是坏值）**也不报错**（多余字段宽容）；
 *   3. `setTimeMode` 不再回落 / 补写这两格；
 *   4. `advanceTime` 的判决只由模式决定 —— 第四参传旧的 `upper` / `lower` 当没传；
 *   5. mock 的推进单位落在模式单位表里（删字段之后不会掉进 `hour` 这种 year-date 不认的单位）。
 *
 * 实现已落地：这一份全绿；它守的是「两格删干净之后，单位仍只由模式决定」。
 */
import { describe, expect, it } from 'vitest'
import { loadModule } from './support/load.js'
import { elementOf, stateV6, v6Card } from './support/v6-fixtures.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadCards = () => loadModule('cards.ts', () => import('../src/cards.ts'))
const loadMock = () => loadModule('core/mock.ts', () => import('../src/core/mock.ts'))
const loadTools = () =>
  loadModule('core/tool-definitions.ts', () => import('../src/core/tool-definitions.ts'))

const CJK = /[\u4e00-\u9fff]/
const BOUND_KEYS = ['granularityUpper', 'granularityLower']

/** 卡的深拷贝（比较「入参没被改」用） */
const clone = (value) => JSON.parse(JSON.stringify(value))

/** 一张没有颗粒度两格的时间卡（本票之后的正常形状） */
function bareCard({ mode = 'year-minute' } = {}) {
  const card = v6Card({ state: stateV6({ mode }) })
  for (const key of BOUND_KEYS) delete elementOf(card, '0')[key]
  return card
}

/** 调一次 advanceTime；错误按值返回（没抛就是值） */
async function advance(value, amount, unit, options) {
  const { advanceTime } = await loadState()
  try {
    return advanceTime(value, amount, unit, options)
  } catch (cause) {
    return cause
  }
}

/** 2024-01-01 08:05（year-minute） */
const AT = { year: 2024, month: 1, day: 1, hour: 8, minute: 5 }
/** 2024-01-01（year-date） */
const DATE = { year: 2024, month: 1, day: 1 }
/** 第 1 天 08:05（days-minute） */
const DAYS = { day: 1, hour: 8, minute: 5 }

async function issuesOf(card) {
  const { cardIssues } = await loadState()
  return cardIssues(card)
}

describe('E1 新建卡：时间元素不再带颗粒度两格', () => {
  it('freshCard 的时间元素没有 granularityUpper / granularityLower', async () => {
    const { freshCard } = await loadCards()
    const card = freshCard('c-2-3', 'new')
    const time = elementOf(card, '0')
    expect(time.type).toBe('time')
    for (const key of BOUND_KEYS) expect(key in time, `${key} 不该再写进新卡`).toBe(false)
  })
})

describe('E2 校验：缺这两格合法；残留这两格也不报', () => {
  it('没有颗粒度两格的时间卡 ⇒ cardIssues 一条问题都没有', async () => {
    expect(await issuesOf(bareCard())).toEqual([])
    expect(await issuesOf(bareCard({ mode: 'year-date' }))).toEqual([])
    expect(await issuesOf(bareCard({ mode: 'days-minute' }))).toEqual([])
  })

  it('残留坏颗粒度（year-date 写 hour、写 second、顺序反了）⇒ 也不再报问题', async () => {
    const mode = 'year-date'
    const cases = [
      (time) => (time.granularityUpper = 'hour'),
      (time) => (time.granularityLower = 'second'),
      (time) => {
        time.granularityUpper = 'minute'
        time.granularityLower = 'year'
      },
    ]
    for (const spoil of cases) {
      const card = v6Card({ state: stateV6({ mode }) })
      spoil(elementOf(card, '0'))
      expect(await issuesOf(card), '残留字段是宽容的（与 presetId 同一条规矩）').toEqual([])
    }
  })

  it('坏颗粒度不遮住别的检查：节日缺项照旧报（合法卡为对照）', async () => {
    const card = bareCard()
    expect(await issuesOf(card), '合法卡是这组判据的对照').toEqual([])
    const broken = clone(card)
    delete elementOf(broken, '0').holidays
    expect((await issuesOf(broken)).length).toBeGreaterThan(0)
    expect((await issuesOf(broken)).every((issue) => CJK.test(issue.message))).toBe(true)
  })
})

describe('E3 setTimeMode：不再回落 / 补写颗粒度', () => {
  it('without 颗粒度换模式 ⇒ 结果里也没有这两格（初值 / 节日照 2.2）', async () => {
    const { setTimeMode } = await loadState()
    const card = bareCard()
    const before = clone(card)
    const next = setTimeMode(card, 'days-minute')
    expect(clone(card), '不许改入参').toEqual(before)
    for (const key of BOUND_KEYS) expect(key in next.state[0], `${key} 不该被补回来`).toBe(false)
    expect(next.state[0].timeMode).toBe('days-minute')
    expect(next.state[0].initial).toEqual({ day: 1, hour: 8, minute: 0 })
    expect('holidays' in next.state[0]).toBe(false)
    expect(await issuesOf(next)).toEqual([])
  })

  it('带旧颗粒度换模式 ⇒ 值原样留着（不读、不改、不回落）', async () => {
    const { setTimeMode } = await loadState()
    const card = v6Card()
    elementOf(card, '0').granularityUpper = 'day'
    elementOf(card, '0').granularityLower = 'minute'
    const next = setTimeMode(card, 'year-date')
    expect(next.state[0].granularityUpper).toBe('day')
    expect(next.state[0].granularityLower).toBe('minute')
  })
})

describe('F1 advanceTime：允许单位只由模式决定', () => {
  it('每个模式的单位表里，每一个单位都能推进（正控）', async () => {
    const { unitsOfMode } = await loadState()
    for (const [mode, value] of [
      ['year-minute', AT],
      ['year-date', DATE],
      ['days-minute', DAYS],
    ]) {
      for (const unit of unitsOfMode(mode)) {
        const result = await advance(value, 1, unit, { mode })
        expect(result, `${mode} + ${unit} 应当能推进`).not.toBeInstanceOf(Error)
      }
    }
  })

  it('模式外的单位一律拒绝：year-date 没有钟点、days-minute 没有年月（E_VALIDATION + 中文）', async () => {
    for (const [value, unit, mode] of [
      [DATE, 'hour', 'year-date'],
      [DATE, 'minute', 'year-date'],
      [DAYS, 'year', 'days-minute'],
      [DAYS, 'month', 'days-minute'],
      [DAYS, 'week', 'days-minute'],
    ]) {
      const result = await advance(value, 1, unit, { mode })
      expect(result, `${mode} + ${unit} 应当被拒`).toBeInstanceOf(Error)
      expect(result.code).toBe('E_VALIDATION')
      expect(result.message).toMatch(CJK)
    }
  })

  it('旧的 upper / lower 传进来当没传：upper=hour 时 day 照样推进', async () => {
    const result = await advance(AT, 1, 'day', {
      mode: 'year-minute',
      upper: 'hour',
      lower: 'hour',
    })
    expect(result, '上下界不再是判决的一部分').toEqual({ ...AT, day: 2 })
  })

  it('旧的反序上下界也不再有意见：upper=day / lower=day 时 week 照样推进', async () => {
    const result = await advance(DATE, 1, 'week', { mode: 'year-date', upper: 'day', lower: 'day' })
    expect(result).toEqual({ year: 2024, month: 1, day: 8 })
  })
})

describe('F2 引擎侧的两个接缝（回归）', () => {
  it('JSON schema 的 unit 枚举仍是六个单位（值域不按模式收窄）', async () => {
    const { TOOL_DEFINITIONS } = await loadTools()
    const { TIME_UNITS } = await loadState()
    const unit = TOOL_DEFINITIONS.advance_time.inputSchema.properties.unit
    expect(unit.enum).toEqual(TIME_UNITS)
  })

  it('mock 的推进单位落在模式单位表里（三种模式各一条）', async () => {
    const { mockReply } = await loadMock()
    const { unitsOfMode } = await loadState()
    for (const mode of ['year-minute', 'year-date', 'days-minute']) {
      const card = bareCard({ mode })
      const reply = await mockReply({ card, node: card.chain[0], turn: 1, action: 'wait' })
      const call = reply.toolCalls.find((item) => item.name === 'advance_time')
      expect(call, `${mode}：mock 要发 advance_time`).toBeTruthy()
      expect(call.args.amount).toBe(1)
      expect(unitsOfMode(mode), `${mode}：mock 的单位必须在模式单位表里`).toContain(call.args.unit)
    }
  })
})
