/**
 * 阶段 2.2 · B：公历三模式（契约 §B1–§B2、§B5–§B7）。
 *
 * 三个模式：`year-minute`（年月日时分）· `year-date`（年月日）· `days-minute`（天时分）。
 * 钉死四件事：
 *   1. **形状与单位**：每个模式的格子 / 可推进单位 / 默认值 / 年份范围（-551..9999，无 0 年）；
 *   2. **推算**：月末夹取、跨「没有 0 年」、天数模式进位、越界拒绝；
 *   3. **显示**：按模式格式化，公元前写「公元前 N」；
 *   4. **模式切换与校验**：`setTimeMode` 重置初值 / 天数模式删节日；坏卡被拦。
 *
 * 这一份守三种模式的形状、推进、显示与切换；单位判决的字段来源见 `time-units-by-mode.test.js`。
 */
import { describe, expect, it } from 'vitest'
import { loadModule } from './support/load.js'
import { elementOf, holidaysV6, stateV6, v6Card, v6Save } from './support/v6-fixtures.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

const CJK = /[\u4e00-\u9fff]/
const clone = (value) => JSON.parse(JSON.stringify(value))

/** 推进一次；错误以值返回（不吞错：没抛就是值） */
async function advance(value, amount, unit, mode, extra = {}) {
  const { advanceTime } = await loadState()
  try {
    return advanceTime(value, amount, unit, { mode, ...extra })
  } catch (cause) {
    return cause
  }
}

/** 期望推进成功 */
async function expectNext(value, amount, unit, mode, expected, extra) {
  const result = await advance(value, amount, unit, mode, extra)
  expect(result).toEqual(expected)
}

/** 期望被拒：E_VALIDATION + 中文 */
async function expectReject(value, amount, unit, mode, note, extra) {
  const result = await advance(value, amount, unit, mode, extra)
  expect(result, `${note}：应当被拒`).toBeInstanceOf(Error)
  expect(result.code, `${note}：错误码`).toBe('E_VALIDATION')
  expect(result.message).toMatch(CJK)
}

describe('B1 模式、单位、默认值、年份范围', () => {
  it('三个模式按固定顺序：year-minute / year-date / days-minute', async () => {
    const { TIME_MODES } = await loadState()
    expect(TIME_MODES).toEqual(['year-minute', 'year-date', 'days-minute'])
  })

  it('六个单位、秒没有了：year / month / week / day / hour / minute', async () => {
    const { TIME_UNITS } = await loadState()
    expect(TIME_UNITS).toEqual(['year', 'month', 'week', 'day', 'hour', 'minute'])
  })

  it('每个模式的可推进单位', async () => {
    const { unitsOfMode } = await loadState()
    expect(unitsOfMode('year-minute')).toEqual(['year', 'month', 'week', 'day', 'hour', 'minute'])
    expect(unitsOfMode('year-date')).toEqual(['year', 'month', 'week', 'day'])
    expect(unitsOfMode('days-minute')).toEqual(['day', 'hour', 'minute'])
  })

  it('每个模式的默认时间值', async () => {
    const { defaultTimeOf } = await loadState()
    expect(defaultTimeOf('year-minute')).toEqual({ year: 1024, month: 1, day: 1, hour: 8, minute: 0 })
    expect(defaultTimeOf('year-date')).toEqual({ year: 1024, month: 1, day: 1 })
    expect(defaultTimeOf('days-minute')).toEqual({ day: 1, hour: 8, minute: 0 })
  })

  it('年份范围：公元前 551 到 9999，没有 0 年', async () => {
    const { YEAR_MIN, YEAR_MAX, isTimeValue } = await loadState()
    expect(YEAR_MIN).toBe(-551)
    expect(YEAR_MAX).toBe(9999)
    expect(isTimeValue({ year: -551, month: 1, day: 1, hour: 0, minute: 0 }, 'year-minute')).toBe(true)
    expect(isTimeValue({ year: 9999, month: 12, day: 31, hour: 23, minute: 59 }, 'year-minute')).toBe(true)
    expect(isTimeValue({ year: 0, month: 1, day: 1, hour: 0, minute: 0 }, 'year-minute'), '没有0年').toBe(
      false,
    )
    expect(isTimeValue({ year: -552, month: 1, day: 1, hour: 0, minute: 0 }, 'year-minute')).toBe(false)
    expect(isTimeValue({ year: 10000, month: 1, day: 1, hour: 0, minute: 0 }, 'year-minute')).toBe(false)
  })

  it('公元前 1 年按天文年 0 算 ⇒ 闰年（-1-02-29 合法）', async () => {
    const { isTimeValue } = await loadState()
    expect(isTimeValue({ year: -1, month: 2, day: 29, hour: 0, minute: 0 }, 'year-minute')).toBe(true)
    expect(isTimeValue({ year: 2023, month: 2, day: 29, hour: 0, minute: 0 }, 'year-minute')).toBe(false)
  })

  it('时间值的键集合必须恰好是模式的格子（旧的六格 / 多一格都拒）', async () => {
    const { isTimeValue } = await loadState()
    expect(
      isTimeValue({ year: 2024, month: 1, day: 1, hour: 8, minute: 0, second: 0 }, 'year-minute'),
      '六格旧形状',
    ).toBe(false)
    expect(isTimeValue({ year: 2024, month: 1, day: 1 }, 'year-minute'), '少两格').toBe(false)
    expect(isTimeValue({ year: 2024, month: 1, day: 1, hour: 8 }, 'year-date'), '多一格').toBe(false)
    expect(isTimeValue({ year: 2024, month: 1, day: 1 }, 'year-date')).toBe(true)
  })

  it('天数模式：day 是正整数计数，没有年月', async () => {
    const { isTimeValue } = await loadState()
    expect(isTimeValue({ day: 1, hour: 0, minute: 0 }, 'days-minute')).toBe(true)
    expect(isTimeValue({ day: 0, hour: 0, minute: 0 }, 'days-minute')).toBe(false)
    expect(isTimeValue({ day: 1.5, hour: 0, minute: 0 }, 'days-minute')).toBe(false)
    expect(isTimeValue({ year: 2024, day: 1, hour: 0, minute: 0 }, 'days-minute')).toBe(false)
  })

  it('省略 mode 时三种形状任一都收（存档没有卡可比时的入口）', async () => {
    const { isTimeValue } = await loadState()
    expect(isTimeValue({ year: 2024, month: 1, day: 1, hour: 8, minute: 0 })).toBe(true)
    expect(isTimeValue({ year: 2024, month: 1, day: 1 })).toBe(true)
    expect(isTimeValue({ day: 3, hour: 8, minute: 0 })).toBe(true)
    expect(isTimeValue({ day: 3 })).toBe(false)
  })
})

describe('B2 显示', () => {
  it('year-minute：`YYYY-MM-DD HH:mm（周X）`', async () => {
    const { formatTime } = await loadState()
    expect(formatTime({ year: 2024, month: 2, day: 10, hour: 8, minute: 30 }, 'year-minute')).toBe(
      '2024-02-10 08:30（周六）',
    )
    expect(formatTime({ year: 1, month: 1, day: 1, hour: 0, minute: 0 }, 'year-minute')).toBe(
      '0001-01-01 00:00（周一）',
    )
  })

  it('公元前：年份写「公元前 N」（不补零），星期几按公历', async () => {
    const { formatTime } = await loadState()
    expect(formatTime({ year: -551, month: 1, day: 1, hour: 8, minute: 0 }, 'year-minute')).toBe(
      '公元前551-01-01 08:00（周二）',
    )
    expect(formatTime({ year: -1, month: 12, day: 31, hour: 23, minute: 59 }, 'year-minute')).toBe(
      '公元前1-12-31 23:59（周日）',
    )
  })

  it('year-date：没有钟点', async () => {
    const { formatTime } = await loadState()
    expect(formatTime({ year: 2024, month: 2, day: 10 }, 'year-date')).toBe('2024-02-10（周六）')
    expect(formatTime({ year: -551, month: 1, day: 1 }, 'year-date')).toBe('公元前551-01-01（周二）')
  })

  it('days-minute：`第 N 天 HH:mm`，没有星期', async () => {
    const { formatTime } = await loadState()
    expect(formatTime({ day: 5, hour: 8, minute: 30 }, 'days-minute')).toBe('第 5 天 08:30')
    expect(formatTime({ day: 1, hour: 0, minute: 5 }, 'days-minute')).toBe('第 1 天 00:05')
  })
})

describe('B2 推进：year-minute', () => {
  const base = { year: 2024, month: 2, day: 10, hour: 8, minute: 30 }

  it('分 / 时 / 日 / 周按位进位', async () => {
    await expectNext(base, 30, 'minute', 'year-minute', { ...base, hour: 9, minute: 0 })
    await expectNext(base, 2, 'hour', 'year-minute', { ...base, hour: 10 })
    await expectNext(base, 1, 'day', 'year-minute', { ...base, day: 11 })
    await expectNext(base, 1, 'week', 'year-minute', { ...base, day: 17 })
    await expectNext({ ...base, hour: 23, minute: 30 }, 1, 'hour', 'year-minute', {
      ...base,
      day: 11,
      hour: 0,
    })
  })

  it('月：目标月没有该日就取月末', async () => {
    const jan31 = { year: 2024, month: 1, day: 31, hour: 0, minute: 0 }
    await expectNext(jan31, 1, 'month', 'year-minute', { ...jan31, month: 2, day: 29 })
    await expectNext({ ...jan31, year: 2023 }, 1, 'month', 'year-minute', {
      year: 2023,
      month: 2,
      day: 28,
      hour: 0,
      minute: 0,
    })
    await expectNext({ ...jan31, month: 12 }, 2, 'month', 'year-minute', {
      ...jan31,
      year: 2025,
      month: 2,
      day: 28,
    })
  })

  it('年：闰日加一年落回 2 月 28', async () => {
    await expectNext({ ...base, month: 2, day: 29 }, 1, 'year', 'year-minute', {
      ...base,
      year: 2025,
      month: 2,
      day: 28,
    })
  })

  it('跨「没有 0 年」：公元前 1 年 +1 年 ⇒ 公元 1 年；公元前 1 年 12 月 +1 月 ⇒ 1 月', async () => {
    const bc = { year: -1, month: 1, day: 1, hour: 0, minute: 0 }
    await expectNext(bc, 1, 'year', 'year-minute', { year: 1, month: 1, day: 1, hour: 0, minute: 0 })
    await expectNext({ ...bc, month: 12, day: 15 }, 1, 'month', 'year-minute', {
      year: 1,
      month: 1,
      day: 15,
      hour: 0,
      minute: 0,
    })
    await expectNext({ year: -551, month: 1, day: 1, hour: 0, minute: 0 }, 1, 'year', 'year-minute', {
      year: -550,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
    })
  })

  it('范围边界：9998 → 9999 能走；再往前一步 ⇒ E_VALIDATION', async () => {
    await expectNext({ year: 9998, month: 12, day: 31, hour: 0, minute: 0 }, 1, 'year', 'year-minute', {
      year: 9999,
      month: 12,
      day: 31,
      hour: 0,
      minute: 0,
    })
    await expectReject(
      { year: 9999, month: 12, day: 31, hour: 0, minute: 0 },
      1,
      'year',
      'year-minute',
      '越 9999',
    )
    await expectReject(
      { year: 9999, month: 12, day: 31, hour: 23, minute: 59 },
      1,
      'minute',
      'year-minute',
      '分钟进位越 9999',
    )
  })
})

describe('B2 推进：year-date 与 days-minute', () => {
  it('year-date：日 / 周 / 月 / 年都能推，小时被拒', async () => {
    const base = { year: 2024, month: 2, day: 10 }
    await expectNext(base, 1, 'day', 'year-date', { ...base, day: 11 })
    await expectNext(base, 1, 'week', 'year-date', { ...base, day: 17 })
    await expectNext(base, 1, 'month', 'year-date', { ...base, month: 3 })
    await expectNext({ ...base, day: 29 }, 1, 'year', 'year-date', { year: 2025, month: 2, day: 28 })
    await expectReject(base, 1, 'hour', 'year-date', 'year-date 没有钟点')
  })

  it('days-minute：时 / 分进位到天，天是最粗单位', async () => {
    await expectNext({ day: 1, hour: 23, minute: 30 }, 1, 'hour', 'days-minute', {
      day: 2,
      hour: 0,
      minute: 30,
    })
    await expectNext({ day: 1, hour: 23, minute: 45 }, 30, 'minute', 'days-minute', {
      day: 2,
      hour: 0,
      minute: 15,
    })
    await expectNext({ day: 1, hour: 8, minute: 0 }, 2, 'day', 'days-minute', { day: 3, hour: 8, minute: 0 })
    await expectReject({ day: 1, hour: 8, minute: 0 }, 1, 'year', 'days-minute', '天数模式没有年')
    await expectReject({ day: 1, hour: 8, minute: 0 }, 1, 'month', 'days-minute', '天数模式没有月')
  })

  it('模式外的单位照拒：旧的 upper / lower 不参与判决', async () => {
    const value = { year: 2024, month: 2, day: 10 }
    await expectNext(value, 1, 'week', 'year-date', { ...value, day: 17 }, { upper: 'year', lower: 'week' })
    await expectReject(value, 1, 'hour', 'year-date', 'year-date 没有钟点', {
      upper: 'year',
      lower: 'hour',
    })
    await expectReject({ day: 1, hour: 8, minute: 0 }, 1, 'month', 'days-minute', '天数模式没有月', {
      upper: 'year',
      lower: 'day',
    })
  })

  it('amount 必须是正整数；源值不合法 ⇒ E_VALIDATION', async () => {
    const value = { year: 2024, month: 2, day: 10, hour: 8, minute: 30 }
    for (const [amount, note] of [
      [0, '0'],
      [-1, '负数'],
      [1.5, '非整数'],
      ['1', '字符串'],
    ]) {
      await expectReject(value, amount, 'day', 'year-minute', `amount ${note}`)
    }
    for (const [bad, note] of [
      [{ year: 2024, month: 13, day: 1, hour: 0, minute: 0 }, '13 月'],
      [{ year: 2024, month: 2, day: 30, hour: 0, minute: 0 }, '2 月 30'],
      [{ year: 2024, month: 1, day: 1, hour: 24, minute: 0 }, '24 点'],
      [{ year: 2024, month: 1, day: 1, hour: 8, minute: 0, second: 0 }, '六格旧形状'],
    ]) {
      await expectReject(bad, 1, 'day', 'year-minute', note)
    }
  })
})

describe('B5 切换模式：setTimeMode', () => {
  it('year-minute → year-date：初值重置成新模式默认', async () => {
    const { setTimeMode } = await loadState()
    const card = v6Card()
    const before = clone(card)
    const next = setTimeMode(card, 'year-date')
    expect(clone(card), '不许改入参').toEqual(before)
    expect(next.state[0].timeMode).toBe('year-date')
    expect(next.state[0].initial).toEqual({ year: 1024, month: 1, day: 1 })
    expect(next.state[0].holidays).toEqual(holidaysV6())
  })

  it('→ days-minute：初值 3 格、节日整格删掉', async () => {
    const { setTimeMode } = await loadState()
    const next = setTimeMode(v6Card(), 'days-minute')
    expect(next.state[0].timeMode).toBe('days-minute')
    expect(next.state[0].initial).toEqual({ day: 1, hour: 8, minute: 0 })
    expect('holidays' in next.state[0]).toBe(false)
    expect(await issuesOf(next)).toEqual([])
  })

  it('days-minute → year-minute：补一份三个都 false 的 holidays', async () => {
    const { setTimeMode } = await loadState()
    const days = v6Card({ state: stateV6({ mode: 'days-minute' }) })
    const next = setTimeMode(days, 'year-minute')
    expect(next.state[0].holidays).toEqual(holidaysV6())
    expect(next.state[0].initial).toEqual({ year: 1024, month: 1, day: 1, hour: 8, minute: 0 })
  })

  it('模式切换后卡仍合法（三种模式各跑一遍）', async () => {
    const { setTimeMode } = await loadState()
    let card = v6Card()
    for (const mode of ['year-date', 'days-minute', 'year-minute']) {
      card = setTimeMode(card, mode)
      expect(card.state[0].timeMode).toBe(mode)
      expect(await issuesOf(card)).toEqual([])
    }
  })
})

/** 卡片问题清单（测试里高频） */
async function issuesOf(card) {
  const { cardIssues } = await loadState()
  return cardIssues(card)
}

describe('B6 校验：时间模式与节日格子', () => {
  // 每一条都先证「同形状的合法卡一条问题都没有」，再只改一处 ⇒ 这一条判据才钉得住那一处。
  it('缺 timeMode / 不认识的模式 ⇒ 一条问题（合法卡为对照）', async () => {
    expect(await issuesOf(v6Card()), '合法卡是这组判据的对照').toEqual([])

    const noMode = v6Card()
    delete noMode.state[0].timeMode
    expect((await issuesOf(noMode)).length).toBeGreaterThan(0)

    const badMode = v6Card()
    badMode.state[0].timeMode = 'lunar'
    expect((await issuesOf(badMode)).length).toBeGreaterThan(0)
  })

  it('days-minute 带 holidays ⇒ 一条问题（合法卡为对照）', async () => {
    const days = v6Card({ state: stateV6({ mode: 'days-minute' }) })
    expect(await issuesOf(days), '合法的天数模式卡是这组判据的对照').toEqual([])

    const bad = v6Card({ state: stateV6({ mode: 'days-minute' }) })
    bad.state[0].holidays = holidaysV6()
    const issues = await issuesOf(bad)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((issue) => CJK.test(issue.message))).toBe(true)
  })

  it('年份模式缺 holidays / 布尔缺一个 / 不是布尔 ⇒ 问题（合法卡为对照）', async () => {
    expect(await issuesOf(v6Card())).toEqual([])

    const missing = v6Card()
    delete missing.state[0].holidays
    expect((await issuesOf(missing)).length).toBeGreaterThan(0)

    const partial = v6Card()
    delete partial.state[0].holidays.china
    expect((await issuesOf(partial)).length).toBeGreaterThan(0)

    const notBoolean = v6Card()
    notBoolean.state[0].holidays.international = 'yes'
    expect((await issuesOf(notBoolean)).length).toBeGreaterThan(0)
  })

  it('严格形状：比模式更细的格子也不许混进初始值（year-date 带钟点 ⇒ 问题；严格卡为对照）', async () => {
    const strict = v6Card({ state: stateV6({ mode: 'year-date' }) })
    expect(await issuesOf(strict), '严格形状的卡先要能过').toEqual([])
    strict.state[0].initial = { ...strict.state[0].initial, hour: 8, minute: 30 }
    expect((await issuesOf(strict)).length).toBeGreaterThan(0)
  })

  it('时间初值 year 0 / 旧六格 ⇒ 问题（合法卡为对照）', async () => {
    expect(await issuesOf(v6Card())).toEqual([])

    const zero = v6Card()
    zero.state[0].initial.year = 0
    expect((await issuesOf(zero)).length).toBeGreaterThan(0)

    const six = v6Card()
    six.state[0].initial = { year: 2024, month: 1, day: 1, hour: 8, minute: 0, second: 0 }
    expect((await issuesOf(six)).length).toBeGreaterThan(0)
  })

  it('三种模式的合法卡各一条问题都没有', async () => {
    for (const mode of ['year-minute', 'year-date', 'days-minute']) {
      const card = v6Card({ state: stateV6({ mode }) })
      expect(await issuesOf(card), mode).toEqual([])
    }
  })

  it('存档里的时间值必须合模式：year-minute 卡 + year-date 形状的 tree ⇒ E_VALIDATION', async () => {
    const { validateSave } = await loadSchema()
    const card = v6Card()
    expect(() => validateSave(v6Save(card), card), '合模式的存档先要能过').not.toThrow()
    const save = v6Save(card)
    save.tree['0'] = { year: 2024, month: 2, day: 10 }
    let caught = null
    try {
      validateSave(save, card)
    } catch (cause) {
      caught = cause
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught.code).toBe('E_VALIDATION')
    expect(caught.message).toMatch(CJK)
  })

  it('days-minute 存档：tree 里是 3 格天数时间，合法', async () => {
    const { validateSave } = await loadSchema()
    const card = v6Card({ state: stateV6({ mode: 'days-minute' }) })
    expect(() => validateSave(v6Save(card), card)).not.toThrow()
  })
})

describe('B7 工具派生（常绿：2.1 已有规则，这一组是回归哨兵）', () => {
  it('写时间元素 ⇒ advance_time；不因模式变化', async () => {
    const { toolsForNode } = await loadSchema()
    const card = v6Card()
    const time = card.chain.find((node) => node.id === 'time')
    expect(toolsForNode(card, time)).toEqual(['advance_time'])
    const check = card.chain.find((node) => node.id === 'check')
    expect(toolsForNode(card, check)).toEqual(['write_state'])
  })

  it('时间元素不再给 write_state（时间只能推进）', async () => {
    const { toolsForNode } = await loadSchema()
    const card = v6Card({ state: stateV6({ mode: 'days-minute' }) })
    const node = { ...card.chain[1], writable: ['0'] }
    expect(toolsForNode(card, node)).toEqual(['advance_time'])
  })
})

describe('C 迁移探针：旧形状必须被拒（不迁移）', () => {
  // 先证「新形状能过」再变坏 —— 否则今天它只是被 2.1 的六格校验顺手拦下，等于空断言。
  it('2.1 的六格时间卡 ⇒ validateCard 抛 E_VALIDATION（新形状为对照）', async () => {
    const { validateCard } = await loadSchema()
    expect(() => validateCard(v6Card()), '新形状的卡先要能过').not.toThrow()
    const legacy = v6Card()
    legacy.state[0].initial = { year: 1024, month: 9, day: 17, hour: 18, minute: 30, second: 0 }
    delete legacy.state[0].timeMode
    let caught = null
    try {
      validateCard(legacy)
    } catch (cause) {
      caught = cause
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught.code).toBe('E_VALIDATION')
    expect(caught.message).toMatch(CJK)
  })

  it('每元素都有 initial 的 2.1 卡 ⇒ validateCard 抛 E_VALIDATION（新形状为对照）', async () => {
    const { validateCard } = await loadSchema()
    expect(() => validateCard(v6Card())).not.toThrow()
    const legacy = v6Card()
    elementOf(legacy, '1.1').initial = 'A1'
    let caught = null
    try {
      validateCard(legacy)
    } catch (cause) {
      caught = cause
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught.code).toBe('E_VALIDATION')
  })
})
