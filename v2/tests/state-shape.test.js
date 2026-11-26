/**
 * 阶段 2.1 · 状态树形状与整卡校验（v5 契约 §1 / §2 / §6.1）。
 *
 * 这一份量三件事：
 *   1. **五种类型**（`time` / `text` / `integer` / `enum` / `object`）各按自己的字段被接受；
 *   2. **编号铁律**：`0` 只给时间、自身值是隐式 `.0`（不进 `state[]`）、孩子从 `.1` 起连续、
 *      父 code 必须存在、深度 ≤ 5、标量节点可以有孩子且**不自动转 object**；
 *   3. **保存按钮要用的错误清单**：`cardIssues(card)` 给出「哪一格、什么毛病」的中文清单，
 *      `validateCard(card)` 对同一份卡抛 `E_VALIDATION`（第一个毛病）。
 *
 * 读法：每条判据都连着 v5 契约的一节；本文没写的东西不断言。
 */
import { describe, expect, it } from 'vitest'
import { elementOf, deepCard, tooDeepCard, v5Card, withState } from './support/state-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

const CJK = /[\u4e00-\u9fff]/

/** 抓一个同步调用抛出的错误（不吞错：没抛就是 `null`） */
function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 改一格（其余元素原样） */
function patch(state, code, change) {
  return state.map((item) => (item.code === code ? { ...item, ...change } : item))
}

/** 从 v5 的合法状态表出发，派一份变体 */
function variant(change) {
  return withState(v5Card(), change(v5Card().state))
}

/** 只换 state、把链的引用摘空：编号 / 坏 code 类用例的红只该来自结构，不该来自悬空引用 */
function bareCard(state) {
  const card = v5Card()
  return {
    ...card,
    state,
    chain: card.chain.map((node) => ({
      ...node,
      reads: [],
      writable: node.type === 'time' ? ['0'] : [],
    })),
  }
}

/** 期望「至少一条 issue 落在这些 code / path 上」（归因两种写法都收，见契约 §6.1） */
async function expectIssue(card, codes, note) {
  const { cardIssues } = await loadState()
  const wanted = Array.isArray(codes) ? codes : [codes]
  const issues = cardIssues(card)
  expect(issues.length, `${note}：应当报错`).toBeGreaterThan(0)
  for (const issue of issues) expect(issue.message, `${note}：message 必须是中文`).toMatch(CJK)
  const hit = issues.some((issue) =>
    wanted.some((code) => issue.code === code || issue.path === code || issue.path?.startsWith(`${code}.`)),
  )
  expect(hit, `${note}：没有一条 issue 指到 ${wanted.join(' / ')}（实际：${JSON.stringify(issues)}）`).toBe(
    true,
  )
  return issues
}

/** 只要求「有中文错误清单」（归因由实现定：卡级问题没有单一 code） */
async function expectIssues(card, note) {
  const { cardIssues } = await loadState()
  const issues = cardIssues(card)
  expect(issues.length, `${note}：应当报错`).toBeGreaterThan(0)
  for (const issue of issues) expect(issue.message, `${note}：message 必须是中文`).toMatch(CJK)
  return issues
}

/** 期望 validateCard 也拒同一份卡（保存按钮与引擎走的是同一个校验器） */
async function expectReject(card, note) {
  const { validateCard } = await loadSchema()
  const error = errorOf(() => validateCard(card))
  expect(error, `${note}：validateCard 应当抛错`).not.toBeNull()
  expect(error.code, `${note}：结构错是 E_VALIDATION`).toBe('E_VALIDATION')
  expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
}

describe('状态树 v5 · 合法形状', () => {
  it('v5 的卡过得了 validateCard，而且 cardIssues 是空的（正控）', async () => {
    const { validateCard } = await loadSchema()
    const { cardIssues } = await loadState()
    expect(() => validateCard(v5Card())).not.toThrow()
    expect(cardIssues(v5Card())).toEqual([])
  })

  it('深度 5（1.1.1.1.1）合法、深度 6 被拦', async () => {
    const { validateCard } = await loadSchema()
    expect(() => validateCard(deepCard())).not.toThrow()
    await expectIssue(tooDeepCard(), '1.1.1.1.1.1', '深度 6')
    await expectReject(tooDeepCard(), '深度 6')
  })

  it('标量节点可以有孩子：type 描述自身值，不自动转成 object', async () => {
    const { validateCard } = await loadSchema()
    const card = v5Card()
    expect(elementOf(card, '1.1').type, '1.1 是 enum（自身值）').toBe('enum')
    expect(elementOf(card, '1.1.1').type, '1.1.1 是它下面的 text').toBe('text')
    expect(() => validateCard(card)).not.toThrow()
  })
})

describe('状态树 v5 · 编号铁律', () => {
  it('state[0] 必须是时间元素 0；只有它能是 time', async () => {
    await expectIssues(
      variant((state) => state.slice(1).concat(state[0])),
      '时间不在第一格',
    )
    await expectIssue(
      variant((state) => patch(state, '0', { type: 'text' })),
      '0',
      '0 不是时间',
    )
    await expectIssue(
      variant((state) => patch(state, '1', { type: 'time', initial: state[0].initial })),
      ['1', '0'],
      '第二个 time',
    )
  })

  it('时间元素不能有孩子（0.1 被拦）', async () => {
    const card = variant((state) => [
      ...state,
      { code: '0.1', name: 'bad', note: '', type: 'text', initial: 'X' },
    ])
    await expectIssue(card, ['0.1', '0'], '时间的孩子')
  })

  it('.0 是保留槽：state[] 里不许出现 1.1.0 这样的元素', async () => {
    const card = variant((state) => [
      ...state,
      { code: '1.1.0', name: 'bad', note: '', type: 'text', initial: 'X' },
    ])
    await expectIssue(card, ['1.1.0', '1.1'], 'state 里出现 .0')
  })

  it('code 必须是点分数字（x / 1. / .1 / 1..2 都被拦）', async () => {
    for (const bad of ['x', '1.', '.1', '1..2']) {
      const card = bareCard(patch(v5Card().state, '1.2', { code: bad }))
      await expectIssue(card, bad, `坏 code ${bad}`)
    }
  })

  it('父 code 必须存在（3.1 没有 3 被拦）', async () => {
    const card = variant((state) => [
      ...state,
      { code: '3.1', name: 'bad', note: '', type: 'text', initial: 'X' },
    ])
    await expectIssue(card, ['3.1', '3'], '父不存在')
  })

  it('同级孩子从 1 起连续编号（只有 1.2 / 1.1+1.3 都被拦）', async () => {
    const base = v5Card().state
    const onlySecond = bareCard(base.filter((item) => !['1.1', '1.1.1'].includes(item.code)))
    await expectIssue(onlySecond, ['1.2', '1'], '孩子不从 1 起')
    const gap = bareCard(patch(base, '1.2', { code: '1.3' }))
    await expectIssue(gap, ['1.3', '1'], '孩子有断号')
  })

  it('顶层根号也必须从 1 起连续：0/1/3 被拦，0/1/2 合法', async () => {
    const time = v5Card().state[0]
    const roots = (codes) =>
      bareCard([
        time,
        ...codes.map((code) => ({
          code,
          name: `n${code}`,
          note: '',
          type: 'text',
          initial: `V${code}`,
        })),
      ])
    await expectReject(roots(['1', '3']), '顶层断号（缺 2）')
    const { validateCard } = await loadSchema()
    expect(() => validateCard(roots(['1', '2'])), '0/1/2 是合法的根编号').not.toThrow()
  })

  it('object 必须有孩子，且没有自身值（不带 initial）', async () => {
    const empty = variant((state) => [...state, { code: '3', name: 'empty', note: '', type: 'object' }])
    await expectIssue(empty, '3', '空 object')
    await expectReject(empty, '空 object')
    const withInitial = variant((state) => patch(state, '2.4', { initial: 'X' }))
    await expectIssue(withInitial, '2.4', 'object 带 initial')
  })

  it('非 object 节点必须有自身值：带孩子的标量也一样（1.1 缺 initial 被拦）', async () => {
    const card = variant((state) =>
      state.map((item) => {
        if (item.code !== '1.1') return item
        const rest = { ...item }
        delete rest.initial
        return rest
      }),
    )
    await expectIssue(card, '1.1', '带孩子的标量缺 initial')
  })

  it('旧形状（type: "string"）被拒：2.1 不做迁移', async () => {
    const old = variant((state) => patch(state, '1.2', { type: 'string' }))
    await expectIssue(old, '1.2', '旧类型 string')
    await expectReject(old, '旧类型 string')
  })
})

describe('状态树 v5 · 各类型的值与约束（§2.1 / §2.2）', () => {
  it('enum：values 非空、不重复、都是字符串，初始值必须是其中一项', async () => {
    await expectIssue(
      variant((state) => patch(state, '1.1', { values: [] })),
      '1.1',
      '空 values',
    )
    await expectIssue(
      variant((state) => patch(state, '1.1', { values: ['A1', 'A1'] })),
      '1.1',
      '重复 values',
    )
    await expectIssue(
      variant((state) => patch(state, '1.1', { values: ['A1', 7] })),
      '1.1',
      '非字符串 values',
    )
    await expectIssue(
      variant((state) => patch(state, '1.1', { initial: 'A9' })),
      '1.1',
      '初值不在白名单',
    )
  })

  it('integer：min ≤ max、stepMin ≤ stepMax、非负步幅、整数且 abs ≤ 1e9', async () => {
    const cases = [
      [{ min: 50, max: 10 }, 'min > max'],
      [{ stepMin: 10, stepMax: 1 }, 'stepMin > stepMax'],
      [{ stepMin: -1 }, '负步幅'],
      [{ min: 0.5 }, '非整数下限'],
      [{ max: 1e9 + 1 }, '上限越界'],
      [{ initial: 101 }, '初值超上限'],
      [{ initial: 1.5 }, '初值非整数'],
      [{ initial: '80' }, '初值是字符串'],
    ]
    for (const [change, note] of cases) {
      await expectIssue(
        variant((state) => patch(state, '2.2', change)),
        '2.2',
        note,
      )
    }
    await expectReject(
      variant((state) => patch(state, '2.2', { min: 50, max: 10 })),
      'min > max',
    )
  })

  it('text：初始值必须是字符串', async () => {
    await expectIssue(
      variant((state) => patch(state, '1.2', { initial: 7 })),
      '1.2',
      'text 初值不是字符串',
    )
  })
})

describe('状态树 v5 · 时间（§3）', () => {
  it('颗粒度上界 / 下界必须存在，且 upper 不细于 lower', async () => {
    await expectIssue(
      variant((state) => patch(state, '0', { granularityUpper: undefined })),
      '0',
      '缺上界',
    )
    await expectIssue(
      variant((state) => patch(state, '0', { granularityLower: undefined })),
      '0',
      '缺下界',
    )
    await expectIssue(
      variant((state) => patch(state, '0', { granularityUpper: 'minute', granularityLower: 'day' })),
      '0',
      '顺序反',
    )
    await expectReject(
      variant((state) => patch(state, '0', { granularityUpper: 'minute', granularityLower: 'day' })),
      '顺序反',
    )
  })

  it('时间值必须是合法公历六格（月份 13 / 2 月 30 / 2 月 31 / 24 点 / 缺字段 / 多字段都被拦）', async () => {
    const cases = [
      [{ month: 13 }, '月份 13'],
      [{ day: 32 }, '日 32'],
      [{ month: 2, day: 30 }, '2 月 30'],
      [{ month: 2, day: 31 }, '2 月 31'],
      [{ hour: 24 }, '24 点'],
      [{ minute: 60 }, '60 分'],
      [{ second: 60 }, '60 秒'],
      [{ year: 0 }, '年份 0'],
      [{ year: 10000 }, '年份 10000'],
    ]
    for (const [change, note] of cases) {
      await expectIssue(
        variant((state) => patch(state, '0', { initial: { ...state[0].initial, ...change } })),
        '0',
        note,
      )
    }
    const missing = variant((state) => {
      const rest = { ...state[0].initial }
      delete rest.second
      return patch(state, '0', { initial: rest })
    })
    await expectIssue(missing, '0', '缺 second 字段')
    const extra = variant((state) => patch(state, '0', { initial: { ...state[0].initial, week: 3 } }))
    await expectIssue(extra, '0', '多 week 字段')
  })
})

describe('状态树 v5 · 错误清单（保存按钮靠它）', () => {
  it('一份卡里多处坏 ⇒ 清单逐条给出，每条都带中文与可点回的 code', async () => {
    const { cardIssues } = await loadState()
    const card = variant((state) => patch(patch(state, '1.1', { values: [] }), '2.2', { min: 500, max: 10 }))
    const issues = cardIssues(card)
    expect(issues.length, '两处坏应当至少两条').toBeGreaterThanOrEqual(2)
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['1.1', '2.2']))
    for (const issue of issues) expect(issue.message).toMatch(CJK)
  })
})

/**
 * `.0` 引用 = 节点自己的值（v5 §4 修订：reads / writable 里可以有 `<code>.0`）。
 *
 * 合法性只有一条：**那个 code 存在、而且它真的有自身值**（有孩子的标量 / 时间 / 叶子都不是 `.0`；
 * 叶子自己的值就是它的 code，object 没有自身值）。`state[]` 里永远没有 `.0` 元素 —— 那是 §1 的事。
 */
describe('状态树 v5 · <code>.0 引用（自身值）', () => {
  /** 把 `check` 节点的引用换成给定清单（另一侧清空，避免两条规则互相借力） */
  function cardWithRefs(refs, field) {
    const card = v5Card()
    card.chain[1] = {
      ...card.chain[1],
      reads: field === 'reads' ? refs : [],
      writable: field === 'writable' ? refs : [],
    }
    return card
  }

  async function refError(ref, field) {
    const { validateCard } = await loadSchema()
    return errorOf(() => validateCard(cardWithRefs([ref], field)))
  }

  it('reads / writable 可以含 1.1.0：1.1 有孩子、自己的值就住在 1.1.0', async () => {
    const { validateCard } = await loadSchema()
    const card = v5Card()
    card.chain[1] = { ...card.chain[1], reads: ['1.1.0'], writable: ['1.1.0'] }
    expect(() => validateCard(card), 'reads / writable 里的 .0 应当被接受').not.toThrow()
  })

  it('`.0` 只给有自身值的节点：object / 叶子 / 不存在的 code / 时间 0 的 .0 都拒', async () => {
    for (const field of ['reads', 'writable']) {
      for (const ref of ['2.4.0', '2.1.0', '9.0', '0.0']) {
        const error = await refError(ref, field)
        expect(error, `${field} 里的 ${ref} 应当被拒`).not.toBeNull()
        expect(error.code, `${ref} 是结构 / 引用错`).toBe('E_VALIDATION')
        expect(error.message, `${ref} 的报错必须是中文`).toMatch(CJK)
      }
    }
  })
})
