/**
 * 阶段 3 · 扩充：数组 ⇄ 结构体的类型转换（契约增补 §十）。
 *
 * 这一份钉的是**数据层**（`setElementType`），不碰编辑器：
 *   · 只做 array ⇄ object，且只对**数组子树之外**的元素；
 *   · array → object：字段上、只保留**第 1 项**并摊平；0 项 ⇒ 每个字段的默认值；第 2 项起丢弃；
 *   · object → array：字段下、当前对象值拼成**一个 item**；没有自己的值 ⇒ `[]`；
 *   · 字段 code / 字段顺序 / `reads` / `writable` 引用逐字保留，转换后卡合法；
 *   · array → text / integer / enum / time ⇒ `E_VALIDATION`，卡一个字不动。
 *
 * 确认层 / 类型锁 / 存档编辑器锁死是 DOM 的事，在 `v2/e2e/array-conversion.spec.js`。
 */
import { describe, expect, it } from 'vitest'
import { holdCard, nestedCard } from './support/array-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

const CJK = /[\u4e00-\u9fff]/

/** 抓一个同步调用抛出的错误（没抛就是 null） */
function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 深拷贝（卡是纯 JSON；判据要能证明「转换没动输入」） */
function copy(value) {
  return JSON.parse(JSON.stringify(value))
}

/** 根元素 `2` 的初始值表 */
function tableOf(card) {
  return card.state.find((item) => item.code === '2').initial
}

/** 换掉根 `2` 的整张初始值表 */
function withTable(card, table) {
  return {
    ...card,
    state: card.state.map((item) => (item.code === '2' ? { ...item, initial: table } : item)),
  }
}

/** 把卡里的 `2.4` 换成**结构体**，并给出它后代的值（扁平表键 = 完整 code） */
function objectCard(values, base = holdCard()) {
  const table = { ...tableOf(base) }
  delete table['2.4']
  Object.assign(table, values)
  return withTable(
    {
      ...base,
      state: base.state.map((item) => (item.code === '2.4' ? { ...item, type: 'object' } : item)),
    },
    table,
  )
}

/** 结构体版的嵌套卡：`2.4` object，后代值摊在根表里 */
function nestedObjectCard() {
  return objectCard(
    {
      '2.4.1': '短剑',
      '2.4.2.1': '普通',
      '2.4.2.2': [{ '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }],
    },
    nestedCard(),
  )
}

/** 把 `check` 节点的两面眼睛换成给定清单（别的节点原样） */
function cardWithRefs(card, { reads = [], writable = [] } = {}) {
  return {
    ...card,
    chain: card.chain.map((node) => (node.id === 'check' ? { ...node, reads, writable } : node)),
  }
}

describe('数组 ⇄ 结构体 · 数组 → 结构体（增补 §10.2）', () => {
  it('字段上、只取第 1 项摊平、第 2 项起丢弃；引用与字段 code 原样', async () => {
    const { setElementType } = await loadState()
    const card = cardWithRefs(holdCard(), { reads: ['2.4', '2.4.1'], writable: ['2.4', '2.4.2'] })
    const before = copy(card)
    const next = setElementType(card, '2.4', 'object')

    expect(next.state.find((item) => item.code === '2.4').type).toBe('object')
    expect(
      next.state.filter((item) => item.code.startsWith('2.4.')).map((item) => item.code),
      '字段一个都不许少 / 不许改名',
    ).toEqual(['2.4.1', '2.4.2'])
    expect(next.chain).toEqual(before.chain)

    const table = tableOf(next)
    expect(table['2.4.1']).toBe('短剑')
    expect(table['2.4.2']).toBe(1)
    expect(table).not.toHaveProperty('2.4')
    expect(table).not.toHaveProperty('2.4.0')
    expect(JSON.stringify(table), '第 2 / 3 项必须丢弃').not.toContain('斗篷')
    expect(JSON.stringify(table)).not.toContain('银币')
    expect(card, '入参卡一个字都不许改').toEqual(before)
  })

  it('0 项 ⇒ 结构体每个字段的默认值（text 空串 / integer 夹进范围）', async () => {
    const { setElementType } = await loadState()
    const card = withTable(holdCard(), { ...tableOf(holdCard()), 2.4: [] })
    const next = setElementType(card, '2.4', 'object')
    expect(tableOf(next)['2.4.1']).toBe('')
    expect(tableOf(next)['2.4.2']).toBe(0)
    expect(tableOf(next)).not.toHaveProperty('2.4')
  })

  it('0 项 + 嵌套字段 ⇒ 默认值逐层写（enum 第一项 / 嵌套数组 []）', async () => {
    const { setElementType } = await loadState()
    const card = withTable(nestedCard(), { ...tableOf(nestedCard()), 2.4: [] })
    const next = setElementType(card, '2.4', 'object')
    expect(tableOf(next)['2.4.1']).toBe('')
    expect(tableOf(next)['2.4.2.1']).toBe('普通')
    expect(tableOf(next)['2.4.2.2']).toEqual([])
    expect(tableOf(next)).not.toHaveProperty('2.4.2')
  })

  it('嵌套：object 字段摊到后代 code、array 字段整份搬；不出现中间对象的键', async () => {
    const { setElementType } = await loadState()
    const next = setElementType(nestedCard(), '2.4', 'object')
    const table = tableOf(next)
    expect(table['2.4.1']).toBe('短剑')
    expect(table['2.4.2.1']).toBe('普通')
    expect(table['2.4.2.2']).toEqual([{ '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }])
    expect(table).not.toHaveProperty('2.4.2')
    expect(table).not.toHaveProperty('2.4')
  })

  it('转换后卡合法；新形态的 pathsOf / initialTreeOf 是结构体口径', async () => {
    const { setElementType, pathsOf, initialTreeOf } = await loadState()
    const { validateCard } = await loadSchema()
    const next = setElementType(holdCard(), '2.4', 'object')
    expect(() => validateCard(next)).not.toThrow()
    expect(pathsOf(next.state, '2.4')).toEqual(['2.4.1', '2.4.2'])
    expect(pathsOf(next.state, '2.4.1')).toEqual(['2.4.1'])
    expect(initialTreeOf(next)).toMatchObject({ '2.4.1': '短剑', '2.4.2': 1 })
    expect(initialTreeOf(next)).not.toHaveProperty('2.4')
  })

  it('array → text / integer / enum / time ⇒ E_VALIDATION + 中文，卡一个字不动', async () => {
    const { setElementType } = await loadState()
    for (const type of ['text', 'integer', 'enum', 'time']) {
      const card = holdCard()
      const before = copy(card)
      const error = errorOf(() => setElementType(card, '2.4', type))
      expect(error, `array → ${type} 应当被拒`).not.toBeNull()
      expect(error.code).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
      expect(card).toEqual(before)
    }
  })
})

describe('数组 ⇄ 结构体 · 结构体 → 数组（增补 §10.3）', () => {
  it('字段下、当前对象值拼成一个 item；字段 code / 引用原样', async () => {
    const { setElementType } = await loadState()
    const { validateCard } = await loadSchema()
    const card = cardWithRefs(objectCard({ '2.4.1': '短剑', '2.4.2': 7 }), {
      reads: ['2.4', '2.4.1'],
      writable: ['2.4', '2.4.2'],
    })
    const before = copy(card)
    const next = setElementType(card, '2.4', 'array')

    expect(next.state.find((item) => item.code === '2.4').type).toBe('array')
    expect(next.state.filter((item) => item.code.startsWith('2.4.')).map((item) => item.code)).toEqual([
      '2.4.1',
      '2.4.2',
    ])
    expect(next.chain).toEqual(before.chain)
    expect(tableOf(next)['2.4']).toEqual([{ '2.4.1': '短剑', '2.4.2': 7 }])
    expect(tableOf(next)).not.toHaveProperty('2.4.1')
    expect(tableOf(next)).not.toHaveProperty('2.4.2')
    expect(() => validateCard(next)).not.toThrow()
    expect(card).toEqual(before)
  })

  it('嵌套：object 后代收成嵌套对象、array 字段整份进 item', async () => {
    const { setElementType } = await loadState()
    const { validateCard } = await loadSchema()
    const next = setElementType(nestedObjectCard(), '2.4', 'array')
    expect(tableOf(next)['2.4']).toEqual([
      {
        '2.4.1': '短剑',
        '2.4.2': {
          '2.4.2.1': '普通',
          '2.4.2.2': [{ '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }],
        },
      },
    ])
    expect(() => validateCard(next)).not.toThrow()
  })

  it('没有自己的值（后代一条值路径都没有）⇒ 空数组 []，不造默认 item', async () => {
    const { setElementType } = await loadState()
    const card = objectCard({})
    const next = setElementType(card, '2.4', 'array')
    expect(tableOf(next)['2.4']).toEqual([])
    expect(tableOf(next)).not.toHaveProperty('2.4.1')
  })

  it('转换后卡合法；新形态的 pathsOf / initialTreeOf 是数组口径', async () => {
    const { setElementType, pathsOf, initialTreeOf } = await loadState()
    const { validateCard } = await loadSchema()
    const next = setElementType(objectCard({ '2.4.1': '短剑', '2.4.2': 7 }), '2.4', 'array')
    expect(() => validateCard(next)).not.toThrow()
    expect(pathsOf(next.state, '2.4')).toEqual(['2.4'])
    expect(pathsOf(next.state, '2.4.1')).toEqual([])
    expect(initialTreeOf(next)['2.4']).toEqual([{ '2.4.1': '短剑', '2.4.2': 7 }])
    expect(initialTreeOf(next)).not.toHaveProperty('2.4.1')
  })
})

describe('数组 ⇄ 结构体 · 往返（增补 §10.1）', () => {
  it('array → object → array：回到第 1 项那一个 item，字段定义不变', async () => {
    const { setElementType } = await loadState()
    const card = cardWithRefs(holdCard(), { reads: ['2.4.1'], writable: ['2.4.2'] })
    const fields = card.state.filter((item) => item.code.startsWith('2.4.'))
    const round = setElementType(setElementType(card, '2.4', 'object'), '2.4', 'array')
    expect(tableOf(round)['2.4']).toEqual([{ '2.4.1': '短剑', '2.4.2': 1 }])
    expect(round.state.filter((item) => item.code.startsWith('2.4.'))).toEqual(fields)
    expect(round.chain).toEqual(card.chain)
  })

  it('object → array → object：回到原对象值（一个 item）', async () => {
    const { setElementType } = await loadState()
    const card = objectCard({ '2.4.1': '短剑', '2.4.2.1': '普通', '2.4.2.2': [] }, nestedCard())
    const original = copy(tableOf(card))
    const round = setElementType(setElementType(card, '2.4', 'array'), '2.4', 'object')
    const table = tableOf(round)
    expect(table['2.4.1']).toBe(original['2.4.1'])
    expect(table['2.4.2.1']).toBe(original['2.4.2.1'])
    expect(table['2.4.2.2']).toEqual(original['2.4.2.2'])
    expect(table).not.toHaveProperty('2.4')
  })
})
