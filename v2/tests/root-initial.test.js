/**
 * 阶段 2.2 · A：初始值一律挂在根元素（契约 §A1–§A3）。
 *
 * 一句话：**只有根元素（code 不含 `.`）有 `initial`**；根 initial = 它整棵子树的扁平值表
 * （时间根例外：就是时间值本身）。子元素存 `initial` 就是坏卡。
 * 增 / 删 / 换类型都要把所属根的 initial 同步好 —— 这三件事是这一份判据的主干。
 *
 * 功能还没做 ⇒ 这一份全红（缺函数 / 语义还是 2.1 的）。
 */
import { describe, expect, it } from 'vitest'
import { loadModule } from './support/load.js'
import { elementOf, stateV6, TIME_V6, treeOf, v6Card, v6Save } from './support/v6-fixtures.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

const CJK = /[\u4e00-\u9fff]/

/** 卡的深拷贝（比较「入参没被改」用） */
const clone = (value) => JSON.parse(JSON.stringify(value))

/** 拿一次 `cardIssues`；不吞错之外的任何东西 */
async function issuesOf(card, options) {
  const { cardIssues } = await loadState()
  return cardIssues(card, options)
}

/** 期望同步成功：返回新卡（旧卡不动） */
async function apply(name, card, ...args) {
  const state = await loadState()
  const before = clone(card)
  const next = state[name](card, ...args)
  expect(clone(card), `${name} 不许改入参`).toEqual(before)
  return next
}

describe('A1 根 initial 的形状与派生', () => {
  it('initialTreeOf：根 initial 合起来就是新建存档的 tree（时间值深拷贝）', async () => {
    const { initialTreeOf } = await loadState()
    const card = v6Card()
    const tree = initialTreeOf(card)
    expect(tree).toEqual(treeOf(card))
    expect(tree['0']).toEqual(TIME_V6)
    expect(tree['1.1.0']).toBe('A1')
    expect(tree['1.1.1']).toBe('SITE_X')
    expect(tree['1.2']).toBe('MOOD_Y')
    expect(tree['2.1']).toBe('HERO')
    expect(tree['2.2']).toBe(80)
    // object 自己不是值路径
    expect('1' in tree).toBe(false)
    expect('2' in tree).toBe(false)
  })

  it('initialTreeOf：时间值不与卡共享引用（改树不回头改卡）', async () => {
    const { initialTreeOf } = await loadState()
    const card = v6Card()
    const tree = initialTreeOf(card)
    tree['0'].year = 1999
    expect(elementOf(card, '0').initial.year).toBe(TIME_V6.year)
  })

  it('initialTreeOf：根元素缺 initial ⇒ E_VALIDATION + 中文，点名那个 code', async () => {
    const { initialTreeOf } = await loadState()
    const card = v6Card()
    delete elementOf(card, '2').initial
    let caught = null
    try {
      initialTreeOf(card)
    } catch (cause) {
      caught = cause
    }
    expect(caught, '缺根 initial 必须抛').toBeInstanceOf(Error)
    expect(caught.code).toBe('E_VALIDATION')
    expect(caught.message).toMatch(CJK)
    expect(caught.message).toContain('2')
  })
})

describe('A3 校验：只看根 initial', () => {
  it('合法卡 ⇒ 没有问题', async () => {
    expect(await issuesOf(v6Card())).toEqual([])
  })

  it('子元素带 initial ⇒ 一条问题，点名那个子元素', async () => {
    const card = v6Card()
    elementOf(card, '1.1').initial = 'A1'
    const issues = await issuesOf(card)
    expect(issues.length, '至少要报一条').toBeGreaterThan(0)
    expect(issues.some((issue) => issue.code === '1.1')).toBe(true)
    expect(issues.every((issue) => CJK.test(issue.message))).toBe(true)
  })

  it('子元素带 initial ⇒ validateCard 抛 E_VALIDATION + 中文（先证合法卡不抛）', async () => {
    const { validateCard } = await loadSchema()
    const card = v6Card()
    expect(() => validateCard(card), '同形状的合法卡必须能过').not.toThrow()
    elementOf(card, '1.2').initial = 'X'
    let caught = null
    try {
      validateCard(card)
    } catch (cause) {
      caught = cause
    }
    expect(caught, '坏卡必须抛').toBeInstanceOf(Error)
    expect(caught.code).toBe('E_VALIDATION')
    expect(caught.message).toMatch(CJK)
    expect(caught.message).toContain('1.2')
  })

  it('根 initial 少一条值路径 ⇒ 一条问题，path 是缺的那条', async () => {
    const card = v6Card()
    delete elementOf(card, '1').initial['1.1.1']
    const issues = await issuesOf(card)
    expect(issues.some((issue) => issue.path === '1.1.1')).toBe(true)
  })

  it('根 initial 多一条不属于这棵子树的键 ⇒ 一条问题，path 是多的那条', async () => {
    const card = v6Card()
    elementOf(card, '1').initial['9.9'] = 'ghost'
    const issues = await issuesOf(card)
    expect(issues.some((issue) => issue.path === '9.9')).toBe(true)
  })

  it('根 initial 的值类型不符 ⇒ 一条问题，path 是那一条', async () => {
    const card = v6Card()
    elementOf(card, '1').initial['1.2'] = 42
    const issues = await issuesOf(card)
    expect(issues.some((issue) => issue.path === '1.2')).toBe(true)
  })

  it('数字根的初始值越过上下限 ⇒ 一条问题', async () => {
    const card = v6Card()
    elementOf(card, '2').initial['2.2'] = 101
    const issues = await issuesOf(card)
    expect(issues.some((issue) => issue.path === '2.2')).toBe(true)
  })

  it('存档模式（initial: false）不判初始值：缺根 / 多键 / 值不符 / 子元素带 initial 都不报', async () => {
    const card = v6Card()
    delete elementOf(card, '2').initial
    elementOf(card, '1').initial['9.9'] = 'ghost'
    elementOf(card, '1.1').initial = 'A1'
    elementOf(card, '1').initial['1.2'] = 7
    expect(await issuesOf(card, { initial: false })).toEqual([])
  })

  it('object 根没有自己的值路径（它的键全是孩子的） ⇒ 合法', async () => {
    const card = v6Card()
    expect(Object.keys(elementOf(card, '1').initial).sort()).toEqual(['1.1.0', '1.1.1', '1.2'])
    expect(await issuesOf(card)).toEqual([])
  })

  it('时间根的 initial 就是时间值本身（不是 { 0: 值 }）', async () => {
    const card = v6Card()
    expect(elementOf(card, '0').initial).toEqual(TIME_V6)
    expect(await issuesOf(card)).toEqual([])
  })
})

describe('A2 同步：加子元素', () => {
  it('给 object 根加孩子：新孩子的值路径补进根 initial，孩子自己没有 initial', async () => {
    const next = await apply('addChild', v6Card(), '1')
    expect(next.state.length).toBe(9)
    const added = next.state.find((element) => !v6Card().state.some((old) => old.code === element.code))
    expect(added, '应当多出一个元素').toBeTruthy()
    expect(added.code).toBe('1.3')
    expect('initial' in added, '孩子不许有 initial').toBe(false)
    expect(elementOf(next, '1').initial['1.3']).toBe('')
    expect('1.1.0' in elementOf(next, '1').initial).toBe(true)
  })

  it('给「有自身值 + 有孩子」的标量加孩子：不动 .0，多一条孩子的键', async () => {
    const next = await apply('addChild', v6Card(), '1.1')
    expect(elementOf(next, '1').initial['1.1.0']).toBe('A1')
    expect(elementOf(next, '1').initial['1.1.2']).toBe('')
    expect(elementOf(next, '1.1.1')).toBeTruthy()
  })

  it('给叶子加孩子：自己的值从 <code> 搬到 <code>.0，新孩子用 .1', async () => {
    const next = await apply('addChild', v6Card(), '2.1')
    expect(elementOf(next, '2').initial['2.1']).toBeUndefined()
    expect(elementOf(next, '2').initial['2.1.0']).toBe('HERO')
    expect(elementOf(next, '2').initial['2.1.1']).toBe('')
    expect(await issuesOf(next), '加完孩子卡应当还是合法的').toEqual([])
  })

  // 常绿（2.1 已有的规则，这里只是回归哨兵）：时间元素不能有孩子 —— 新签名下也得拒。
  it('时间元素不能加孩子 ⇒ E_VALIDATION', async () => {
    const { addChild } = await loadState()
    let caught = null
    try {
      addChild(v6Card(), '0')
    } catch (cause) {
      caught = cause
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught.code).toBe('E_VALIDATION')
    expect(caught.message).toMatch(CJK)
  })
})

describe('A2 同步：删子元素', () => {
  it('删掉唯一的孩子的孩子：<code>.0 搬回 <code>', async () => {
    const next = await apply('removeNode', v6Card(), '1.1.1')
    expect(elementOf(next, '1.1.1')).toBeUndefined()
    expect(elementOf(next, '1').initial['1.1.0']).toBeUndefined()
    expect(elementOf(next, '1').initial['1.1']).toBe('A1')
    expect(elementOf(next, '1').initial['1.2']).toBe('MOOD_Y')
  })

  it('删一个中间孩子：兄弟重排，根 initial 的键跟着改名', async () => {
    const next = await apply('removeNode', v6Card(), '1.1')
    expect(elementOf(next, '1.1.1')).toBeUndefined()
    expect(elementOf(next, '1.1').name).toBe('1.2')
    expect(elementOf(next, '1').initial).toEqual({ 1.1: 'MOOD_Y' })
  })

  it('删顶层元素：后面的根重排，根 initial 的键一起搬', async () => {
    const next = await apply('removeNode', v6Card(), '1')
    expect(elementOf(next, '1').name).toBe('2')
    expect(elementOf(next, '1').initial).toEqual({ 1.1: 'HERO', 1.2: 80 })
    expect(elementOf(next, '2')).toBeUndefined()
  })

  it('删元素不动别的根的 initial', async () => {
    const next = await apply('removeNode', v6Card(), '1.1.1')
    expect(elementOf(next, '2').initial).toEqual({ 2.1: 'HERO', 2.2: 80 })
    expect(elementOf(next, '0').initial).toEqual(TIME_V6)
  })
})

describe('A2 同步：换类型', () => {
  it('文字 → 数字：根 initial 那一格换成数字默认值，元素上没有 initial', async () => {
    const next = await apply('setElementType', v6Card(), '1.2', 'integer')
    expect(elementOf(next, '1.2').type).toBe('integer')
    expect(elementOf(next, '1').initial['1.2']).toBe(0)
    expect('initial' in elementOf(next, '1.2')).toBe(false)
  })

  it('标量（有孩子）→ object：自己的值路径从根 initial 删掉，孩子的键保留', async () => {
    const next = await apply('setElementType', v6Card(), '1.1', 'object')
    expect(elementOf(next, '1.1').type).toBe('object')
    expect('1.1.0' in elementOf(next, '1').initial).toBe(false)
    expect(elementOf(next, '1').initial['1.1.1']).toBe('SITE_X')
  })

  it('object → 文字：补一条自己的值路径', async () => {
    const next = await apply('setElementType', v6Card(), '1', 'text')
    expect(elementOf(next, '1').type).toBe('text')
    expect(elementOf(next, '1').initial['1.0']).toBe('')
    expect(elementOf(next, '1').initial['1.1.1']).toBe('SITE_X')
  })

  it('换类型清掉旧类型的专属格子（enum 的 values 没了）', async () => {
    const next = await apply('setElementType', v6Card(), '1.1', 'text')
    expect('values' in elementOf(next, '1.1')).toBe(false)
  })

  it('非 time 元素换成 time ⇒ E_VALIDATION', async () => {
    const { setElementType } = await loadState()
    let caught = null
    try {
      setElementType(v6Card(), '1.2', 'time')
    } catch (cause) {
      caught = cause
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught.code).toBe('E_VALIDATION')
    expect(caught.message).toMatch(CJK)
  })
})

describe('A2 setInitial：按值路径写回所属根', () => {
  it('写子元素的值 ⇒ 所属根 initial 变，子元素对象不变', async () => {
    const { setInitial } = await loadState()
    const card = v6Card()
    const next = setInitial(card, '1.1.1', 'NEW_SITE')
    expect(elementOf(next, '1').initial['1.1.1']).toBe('NEW_SITE')
    expect('initial' in elementOf(next, '1.1.1')).toBe(false)
    expect(elementOf(card, '1').initial['1.1.1']).toBe('SITE_X')
  })

  it('写时间根的值 ⇒ 时间值本身被换掉', async () => {
    const { setInitial } = await loadState()
    const next = setInitial(v6Card(), '0', { year: 2001, month: 9, day: 9, hour: 1, minute: 2 })
    expect(elementOf(next, '0').initial).toEqual({ year: 2001, month: 9, day: 9, hour: 1, minute: 2 })
    expect(next.state[0].timeMode).toBe('year-minute')
  })

  it('路径不属于任何根 initial ⇒ E_VALIDATION', async () => {
    const { setInitial } = await loadState()
    let caught = null
    try {
      setInitial(v6Card(), '8.8.8', 'x')
    } catch (cause) {
      caught = cause
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught.code).toBe('E_VALIDATION')
    expect(caught.message).toMatch(CJK)
  })
})

describe('A 与存档的接缝', () => {
  it('新建存档的 tree 必须覆盖根 initial 的全部值路径（原样通过）', async () => {
    const { validateSave } = await loadSchema()
    const card = v6Card()
    const save = v6Save(card)
    expect(() => validateSave(save, card)).not.toThrow()
  })

  it('saveTreeIssues 不受 initial 影响：同一棵树 / 卡，initial 坏了也判「容得下」', async () => {
    const { saveTreeIssues } = await loadState()
    const card = v6Card()
    const save = v6Save(card)
    elementOf(card, '2').initial = { 2.1: 'OTHER', 2.2: 3 }
    expect(saveTreeIssues(card, save.tree)).toEqual([])
  })

  it('天数模式的时间根同样只有根一个 initial（时间值 3 格，没有 holidays）', async () => {
    const card = v6Card({ state: stateV6({ mode: 'days-minute' }) })
    const { initialTreeOf } = await loadState()
    expect(elementOf(card, '0').holidays).toBeUndefined()
    expect(initialTreeOf(card)['0']).toEqual({ day: 5, hour: 8, minute: 30 })
    expect(await issuesOf(card)).toEqual([])
  })
})
