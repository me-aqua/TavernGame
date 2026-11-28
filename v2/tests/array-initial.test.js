/**
 * 阶段 3 · 数组节点：默认值 / 初始值 / 加删字段与 item 的同步（数组契约 §1.3 / §四）。
 *
 * 这一份钉的是**编辑器背后的纯函数**（DOM 那半边在 `v2/e2e/array-editor.spec.js`）：
 *   · `arrayItemOf`：新 item 的默认值（text '' / integer 夹进上下限 / enum 第一项 / 嵌套递归 / array []）；
 *   · `setInitial(card, '2.4', 数组)`：整份数组写进根元素初始值，原卡不变；
 *   · `addChild`：加字段时把默认值补进**所有现存对应 item**（外层 / 内层都要）；
 *   · `removeNode`：删字段时从所有 item 里摘掉这个键，同层字段重排时 item 的键一起改名；
 *   · `setElementType`：换成数组 ⇒ 旧值清掉、写 `[]`；从数组换成别的类型 ⇒ `E_VALIDATION`。
 */
import { describe, expect, it } from 'vitest'
import {
  elementOf,
  holdCard,
  holdItems,
  nestedCard,
  nestedItems,
  patchElement,
} from './support/array-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const CJK = /[\u4e00-\u9fff]/

function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 取一个导出；缺了就指名道姓地红（每个用例只在自己要用的那一格上红） */
async function fn(name) {
  const mod = await loadState()
  if (typeof mod[name] !== 'function') {
    throw new Error(`missing export: core/statetree.ts ${name}（数组契约 §1.3 / §四）`)
  }
  return mod[name]
}

/** 卡里 `2.4` 的初始值（直接引用；调用方自己别改） */
function itemsOf(card) {
  return elementOf(card, '2').initial['2.4']
}

describe('数组 · 新 item 的默认值（§1.3）', () => {
  it('text ⇒ ""；integer ⇒ 0；嵌套 object / array 递归', async () => {
    const arrayItemOf = await fn('arrayItemOf')
    expect(arrayItemOf(holdCard().state, '2.4')).toEqual({ '2.4.1': '', '2.4.2': 0 })
    expect(arrayItemOf(nestedCard().state, '2.4')).toEqual({
      '2.4.1': '',
      '2.4.2': { '2.4.2.1': '普通', '2.4.2.2': [] },
    })
    expect(arrayItemOf(nestedCard().state, '2.4.2.2')).toEqual({ '2.4.2.2.1': '', '2.4.2.2.2': 0 })
  })

  it('integer 默认值夹进生效上下限：min=5 ⇒ 5；max=-1 ⇒ -1', async () => {
    const arrayItemOf = await fn('arrayItemOf')
    const high = patchElement(holdCard(), '2.4.2', { min: 5, max: 9 })
    expect(arrayItemOf(high.state, '2.4')['2.4.2']).toBe(5)
    const low = patchElement(holdCard(), '2.4.2', { min: -9, max: -1 })
    expect(arrayItemOf(low.state, '2.4')['2.4.2']).toBe(-1)
  })

  it('enum 默认取白名单第一项', async () => {
    const arrayItemOf = await fn('arrayItemOf')
    const card = patchElement(holdCard(), '2.4.2', {
      type: 'enum',
      values: ['普通', '稀有'],
      min: undefined,
      max: undefined,
    })
    expect(arrayItemOf(card.state, '2.4')['2.4.2']).toBe('普通')
  })
})

describe('数组 · setInitial 整份数组（§1.3 / §四）', () => {
  it('写进根元素 initial["2.4"]，不改原卡，落盘形状没有 2.4.0', async () => {
    const setInitial = await fn('setInitial')
    const initialTreeOf = await fn('initialTreeOf')
    const card = holdCard()
    const next = [{ '2.4.1': '长弓', '2.4.2': 7 }]
    const changed = setInitial(card, '2.4', next)
    expect(itemsOf(changed)).toEqual(next)
    expect(itemsOf(card), '入参卡不许被改').toEqual(holdItems())
    expect(initialTreeOf(changed)['2.4']).toEqual(next)
    expect(Object.keys(initialTreeOf(changed))).not.toContain('2.4.0')
  })

  it('空数组可以写；加一项 = 追加 arrayItemOf 的默认值', async () => {
    const setInitial = await fn('setInitial')
    const arrayItemOf = await fn('arrayItemOf')
    const cardIssues = await fn('cardIssues')
    const arrayValueFits = await fn('arrayValueFits')
    const empty = setInitial(holdCard(), '2.4', [])
    expect(arrayValueFits(holdCard().state, '2.4', itemsOf(empty))).toBe(true)
    expect(cardIssues(empty)).toEqual([])

    const one = setInitial(empty, '2.4', [arrayItemOf(holdCard().state, '2.4')])
    expect(itemsOf(one)).toEqual([{ '2.4.1': '', '2.4.2': 0 }])
    expect(cardIssues(one)).toEqual([])
  })
})

describe('数组 · 加字段：默认值补进所有现存 item（§四）', () => {
  it('给 2.4 加字段：新字段 2.4.3（text），每个 item 都补空串；原卡不变', async () => {
    const addChild = await fn('addChild')
    const cardIssues = await fn('cardIssues')
    const card = holdCard()
    const changed = addChild(card, '2.4')
    expect(changed.state.map((item) => item.code)).toEqual([
      '0',
      '1',
      '1.1',
      '2',
      '2.1',
      '2.2',
      '2.3',
      '2.4',
      '2.4.1',
      '2.4.2',
      '2.4.3',
    ])
    expect(changed.state.find((item) => item.code === '2.4.3')).toMatchObject({ type: 'text' })
    expect(itemsOf(changed)).toEqual([
      { '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '' },
      { '2.4.1': '斗篷', '2.4.2': 1, '2.4.3': '' },
      { '2.4.1': '银币', '2.4.2': 3, '2.4.3': '' },
    ])
    expect(itemsOf(card), '原卡的 item 不许被改').toEqual(holdItems())
    expect(cardIssues(changed), '加完字段应当仍然合法').toEqual([])
  })

  it('给嵌套 object 字段（2.4.2）加孩子：每个 item 的嵌套对象都补默认值', async () => {
    const addChild = await fn('addChild')
    const cardIssues = await fn('cardIssues')
    const changed = addChild(nestedCard(), '2.4.2')
    const items = itemsOf(changed)
    expect(items[0]['2.4.2']['2.4.2.3']).toBe('')
    expect(items[0]['2.4.2']['2.4.2.1']).toBe('普通')
    expect(itemsOf(nestedCard()), '原卡不变').toEqual(nestedItems())
    expect(cardIssues(changed)).toEqual([])
  })

  it('给嵌套 array 字段（2.4.2.2）加字段：每个内层 item 都补默认值', async () => {
    const addChild = await fn('addChild')
    const cardIssues = await fn('cardIssues')
    const changed = addChild(nestedCard(), '2.4.2.2')
    const nested = itemsOf(changed)[0]['2.4.2']['2.4.2.2']
    expect(nested[0]).toEqual({ '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2, '2.4.2.2.3': '' })
    expect(cardIssues(changed)).toEqual([])
  })

  it('给标量字段 2.4.1 加孩子：提升成 `<code>.0` + 孩子（2026-11-28 翻面）', async () => {
    const addChild = await fn('addChild')
    const cardIssues = await fn('cardIssues')
    const changed = addChild(holdCard(), '2.4.1')
    expect(changed.state.find((item) => item.code === '2.4.1.1')).toMatchObject({ type: 'text' })
    expect(itemsOf(changed)).toEqual([
      { '2.4.1': { '2.4.1.0': '短剑', '2.4.1.1': '' }, '2.4.2': 1 },
      { '2.4.1': { '2.4.1.0': '斗篷', '2.4.1.1': '' }, '2.4.2': 1 },
      { '2.4.1': { '2.4.1.0': '银币', '2.4.1.1': '' }, '2.4.2': 3 },
    ])
    expect(itemsOf(holdCard()), '原卡不变').toEqual(holdItems())
    expect(cardIssues(changed), '有自身值 + 孩子的字段是合法卡').toEqual([])
  })
})

describe('数组 · 删字段：所有 item 的键一起摘掉 / 改名（§四）', () => {
  it('删 2.4.1（第一个字段）：剩下字段重排为 2.4.1，item 的键也跟着改名', async () => {
    const removeNode = await fn('removeNode')
    const cardIssues = await fn('cardIssues')
    const changed = removeNode(holdCard(), '2.4.1')
    expect(changed.state.map((item) => item.code)).toEqual([
      '0',
      '1',
      '1.1',
      '2',
      '2.1',
      '2.2',
      '2.3',
      '2.4',
      '2.4.1',
    ])
    expect(changed.state.find((item) => item.code === '2.4.1')).toMatchObject({
      name: '数量',
      type: 'integer',
    })
    expect(itemsOf(changed)).toEqual([{ '2.4.1': 1 }, { '2.4.1': 1 }, { '2.4.1': 3 }])
    expect(cardIssues(changed)).toEqual([])
  })

  it('删 2.4.2（最后一个字段）：item 只剩 2.4.1，数量整列消失', async () => {
    const removeNode = await fn('removeNode')
    const cardIssues = await fn('cardIssues')
    const changed = removeNode(holdCard(), '2.4.2')
    expect(itemsOf(changed)).toEqual([{ '2.4.1': '短剑' }, { '2.4.1': '斗篷' }, { '2.4.1': '银币' }])
    expect(cardIssues(changed)).toEqual([])
  })

  it('删嵌套 object 字段里的第一个孩子：内层键重排、值跟着搬', async () => {
    const removeNode = await fn('removeNode')
    const cardIssues = await fn('cardIssues')
    const changed = removeNode(nestedCard(), '2.4.2.1')
    const nested = itemsOf(changed)[0]['2.4.2']
    expect(Object.keys(nested)).toEqual(['2.4.2.1'])
    expect(nested['2.4.2.1']).toEqual([{ '2.4.2.1.1': '锋锐', '2.4.2.1.2': 2 }])
    expect(cardIssues(changed)).toEqual([])
  })
})

describe('数组 · 换类型', () => {
  it('text 字段换成 array：item 里那格清成 []；补一个字段后卡重新合法', async () => {
    const setElementType = await fn('setElementType')
    const addChild = await fn('addChild')
    const cardIssues = await fn('cardIssues')
    const converted = setElementType(holdCard(), '2.4.1', 'array')
    expect(itemsOf(converted)[0]['2.4.1']).toEqual([])
    expect(cardIssues(converted).length, '没有字段的数组是坏卡').toBeGreaterThan(0)

    const withField = addChild(converted, '2.4.1')
    expect(withField.state.find((item) => item.code === '2.4.1.1')).toMatchObject({ type: 'text' })
    expect(itemsOf(withField)).toEqual([
      { '2.4.1': [], '2.4.2': 1 },
      { '2.4.1': [], '2.4.2': 1 },
      { '2.4.1': [], '2.4.2': 3 },
    ])
    expect(cardIssues(withField)).toEqual([])
  })

  it('从数组换成 object / time：E_VALIDATION，草稿（原卡）一个字不动', async () => {
    const setElementType = await fn('setElementType')
    for (const type of ['object', 'time']) {
      const card = holdCard()
      const error = errorOf(() => setElementType(card, '2.4', type))
      expect(error, `array → ${type} 应当被拒`).not.toBeNull()
      expect(error.code).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
      expect(itemsOf(card)).toEqual(holdItems())
    }
  })
})
