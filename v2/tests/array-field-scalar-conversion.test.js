/**
 * 本票判据（数据层 `setElementType`）：**数组子树里的数组字段** → `text` / `integer` / `enum`。
 *
 * 口径见 `.team/test/2026-11-28/契约-数组字段转标量-类型下拉-撤销重做.md` §2：
 *   · 对**每个外层 item** 各取它这一格数组的**第一个内层 item**；
 *   · 内层 item 的字段值直接成为该字段的孩子值（字段定义 / code / 顺序一个不动）；
 *   · 目标类型的自己的默认值写 `<字段>.0`；第 2 个内层 item 起丢弃；
 *   · 没有内层 item ⇒ 孩子默认值 + 自己的默认值；外层数组为空 ⇒ 没有实例可改；
 *   · 值仍住在每个外层 item 里，不写回根元素的初始值表；
 *   · 对象字段 / `array → object` / 任何 `time` 方向仍拒（守卫）。
 *
 * DOM（四档下拉 / 确认层）在 `v2/e2e/array-field-conversion.spec.js`。
 */
import { describe, expect, it } from 'vitest'
import { elementOf, holdCard, withInitialValue } from './support/array-fixtures.js'
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
  return elementOf(card, '2').initial
}

/** `2.4`（背包）当下的 item 列表 */
function itemsOf(card) {
  return tableOf(card)['2.4']
}

/** 某个数组字段在每一外层 item 里的值 */
function fieldValuesOf(card, code = '2.4.3') {
  return itemsOf(card).map((item) => item[code])
}

/** 把某个元素的某一格换成给定值（其余原样） */
function withElement(card, code, change) {
  return { ...card, state: card.state.map((item) => (item.code === code ? { ...item, ...change } : item)) }
}

/** 换掉根 `2` 的整张初始值表 */
function withTable(card, table) {
  return {
    ...card,
    state: card.state.map((item) => (item.code === '2' ? { ...item, initial: table } : item)),
  }
}

/** 把 `check` 节点的两面眼睛换成给定清单（别的节点原样） */
function cardWithRefs(card, { reads = [], writable = [] } = {}) {
  return {
    ...card,
    chain: card.chain.map((node) => (node.id === 'check' ? { ...node, reads, writable } : node)),
  }
}

/**
 * 在 `holdCard` 上给 `2.4` 加一个有字段的数组字段：
 *
 * ```text
 * 2.4 背包（array）
 *   2.4.1 物品（text）
 *   2.4.2 数量（integer）
 *   2.4.3 附魔（array）
 *     2.4.3.1 词条（text）
 *     2.4.3.2 强度（integer 0..10）
 * ```
 *
 * 三个外层实例的内层数组长度分别是 2 / 1 / 0（丢弃数 = 1）。
 */
function fieldArrayCard() {
  const base = holdCard()
  const at = base.state.findIndex((item) => item.code === '2.4.2') + 1
  const card = {
    ...base,
    state: [
      ...base.state.slice(0, at),
      { code: '2.4.3', name: '附魔', note: '', type: 'array' },
      { code: '2.4.3.1', name: '词条', note: '', type: 'text' },
      { code: '2.4.3.2', name: '强度', note: '', type: 'integer', min: 0, max: 10 },
      ...base.state.slice(at),
    ],
  }
  return withInitialValue(card, '2.4', [
    {
      id: 'id_1',
      '2.4.1': '短剑',
      '2.4.2': 1,
      '2.4.3': [
        { id: 'id_1', '2.4.3.1': '锋利', '2.4.3.2': 3 },
        { id: 'id_2', '2.4.3.1': '旧词条', '2.4.3.2': 9 },
      ],
    },
    { id: 'id_2', '2.4.1': '斗篷', '2.4.2': 1, '2.4.3': [{ id: 'id_1', '2.4.3.1': '轻柔', '2.4.3.2': 4 }] },
    { id: 'id_3', '2.4.1': '银币', '2.4.2': 3, '2.4.3': [] },
  ])
}

/** 每一项内层数组都 ≤ 1：丢弃数为 0（不该弹确认）；字段定义照 `fieldArrayCard` */
function oneInnerEachCard() {
  return withInitialValue(fieldArrayCard(), '2.4', [
    { id: 'id_1', '2.4.1': '短剑', '2.4.2': 1, '2.4.3': [{ id: 'id_1', '2.4.3.1': '锋利', '2.4.3.2': 3 }] },
    { id: 'id_2', '2.4.1': '斗篷', '2.4.2': 1, '2.4.3': [] },
    { id: 'id_3', '2.4.1': '银币', '2.4.2': 3, '2.4.3': [{ id: 'id_1', '2.4.3.1': '微光', '2.4.3.2': 2 }] },
  ])
}

describe('数组字段（有字段）→ text：每个外层实例取第一个内层 item', () => {
  it('三项 2 / 1 / 0：字段值成孩子值、空内层全默认、own `.0` = 空串、第 2 项丢弃', async () => {
    const { setElementType, cardIssues, initialTreeOf } = await loadState()
    const { validateCard } = await loadSchema()
    const card = fieldArrayCard()
    const before = copy(card)
    expect(cardIssues(card), '夹具本身要先合法').toEqual([])

    const next = setElementType(card, '2.4.3', 'text')
    const field = elementOf(next, '2.4.3')
    expect(field.type).toBe('text')
    expect(
      next.state.filter((item) => item.code.startsWith('2.4.3.')).map((item) => item.code),
      '孩子定义 / code / 顺序一个都不许动',
    ).toEqual(['2.4.3.1', '2.4.3.2'])
    expect(next.chain, '引用逐字保留').toEqual(before.chain)
    expect(card, '入参卡一个字都不许改').toEqual(before)

    expect(fieldValuesOf(next), '每个外层实例各取第一个内层 item').toEqual([
      { '2.4.3.0': '', '2.4.3.1': '锋利', '2.4.3.2': 3 },
      { '2.4.3.0': '', '2.4.3.1': '轻柔', '2.4.3.2': 4 },
      { '2.4.3.0': '', '2.4.3.1': '', '2.4.3.2': 0 },
    ])
    expect(JSON.stringify(itemsOf(next)), '第 2 个内层 item 必须丢弃').not.toContain('旧词条')
    expect(JSON.stringify(itemsOf(next))).not.toContain('9')
    expect(
      itemsOf(next).map((item) => item['2.4.1']),
      '兄弟字段不动',
    ).toEqual(['短剑', '斗篷', '银币'])

    const table = tableOf(next)
    expect(table, '字段值不写回根初始值表').not.toHaveProperty('2.4.3')
    expect(initialTreeOf(next)['2.4'], '摊平后的树就是换好的 item 列表').toEqual(itemsOf(next))
    expect(cardIssues(next), '换完卡仍合法').toEqual([])
    expect(() => validateCard(next)).not.toThrow()
  })

  it('integer：own `.0` = 0；孩子值同上；旧类型的格子清掉', async () => {
    const { setElementType, cardIssues } = await loadState()
    const next = setElementType(fieldArrayCard(), '2.4.3', 'integer')
    const field = elementOf(next, '2.4.3')
    expect(field.type).toBe('integer')
    expect(field.min).toBeUndefined()
    expect(fieldValuesOf(next)).toEqual([
      { '2.4.3.0': 0, '2.4.3.1': '锋利', '2.4.3.2': 3 },
      { '2.4.3.0': 0, '2.4.3.1': '轻柔', '2.4.3.2': 4 },
      { '2.4.3.0': 0, '2.4.3.1': '', '2.4.3.2': 0 },
    ])
    expect(cardIssues(next)).toEqual([])
  })

  it('enum：源元素的 values 保留、own `.0` = 白名单第一项', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = withElement(fieldArrayCard(), '2.4.3', { values: ['甲', '乙'] })
    const next = setElementType(card, '2.4.3', 'enum')
    const field = elementOf(next, '2.4.3')
    expect(field.type).toBe('enum')
    expect(field.values).toEqual(['甲', '乙'])
    expect(fieldValuesOf(next).map((value) => value['2.4.3.0'])).toEqual(['甲', '甲', '甲'])
    expect(cardIssues(next)).toEqual([])
  })

  it('没有任何内层 item：孩子默认值 + 自己的默认值（不凭空造 item）', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = withInitialValue(fieldArrayCard(), '2.4', [
      { id: 'id_1', '2.4.1': '短剑', '2.4.2': 1, '2.4.3': [] },
    ])
    const next = setElementType(card, '2.4.3', 'text')
    expect(fieldValuesOf(next)).toEqual([{ '2.4.3.0': '', '2.4.3.1': '', '2.4.3.2': 0 }])
    expect(cardIssues(next)).toEqual([])
  })
})

describe('数组字段换标量 · 嵌套 / 空外层 / 丢弃数', () => {
  it('嵌套：object 字段里的数组字段（2.4.2.2）也按每个外层实例取第一个内层 item', async () => {
    const { setElementType, cardIssues } = await loadState()
    const { validateCard } = await loadSchema()
    const { nestedCard } = await import('./support/array-fixtures.js')
    const next = setElementType(nestedCard(), '2.4.2.2', 'text')
    const field = elementOf(next, '2.4.2.2')
    expect(field.type).toBe('text')
    expect(itemsOf(next)[0]['2.4.2']['2.4.2.2']).toEqual({
      '2.4.2.2.0': '',
      '2.4.2.2.1': '锋锐',
      '2.4.2.2.2': 2,
    })
    expect(cardIssues(next)).toEqual([])
    expect(() => validateCard(next)).not.toThrow()
  })

  it('外层数组是空的：没有实例可改，字段类型照改、卡合法', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = withTable(fieldArrayCard(), { ...tableOf(fieldArrayCard()), 2.4: [] })
    const next = setElementType(card, '2.4.3', 'text')
    expect(elementOf(next, '2.4.3').type).toBe('text')
    expect(itemsOf(next)).toEqual([])
    expect(cardIssues(next)).toEqual([])
  })

  it('丢弃数 = 各外层实例 `len − 1` 之和：2 / 1 / 0 ⇒ 1；全 ≤ 1 ⇒ 0', async () => {
    const { arrayDiscardedCount } = await loadState()
    expect(arrayDiscardedCount(fieldArrayCard(), '2.4.3')).toBe(1)
    expect(arrayDiscardedCount(oneInnerEachCard(), '2.4.3')).toBe(0)
  })
})

describe('守卫 · 不该放开的仍拒 / 引用逐字保留', () => {
  it('对象字段不变：2.4.2 → text / integer / enum 仍 E_VALIDATION', async () => {
    const { setElementType } = await loadState()
    const { nestedCard } = await import('./support/array-fixtures.js')
    const card = nestedCard()
    const before = copy(card)
    for (const type of ['text', 'integer', 'enum']) {
      const error = errorOf(() => setElementType(card, '2.4.2', type))
      expect(error, `对象字段 → ${type} 应当被拒`).not.toBeNull()
      expect(error.code).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
      expect(card).toEqual(before)
    }
  })

  it('array → object / array → time 仍拒，卡一个字不动', async () => {
    const { setElementType } = await loadState()
    for (const type of ['object', 'time']) {
      const card = fieldArrayCard()
      const before = copy(card)
      const error = errorOf(() => setElementType(card, '2.4.3', type))
      expect(error, `2.4.3 → ${type} 应当被拒`).not.toBeNull()
      expect(error.code).toBe('E_VALIDATION')
      expect(card).toEqual(before)
    }
  })

  it('引用逐字保留：reads / writable 里的 2.4.3 / 2.4.3.1 转换后仍合法', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = cardWithRefs(fieldArrayCard(), {
      reads: ['2.4.3', '2.4.3.1'],
      writable: ['2.4.3'],
    })
    const before = copy(card)
    expect(cardIssues(card)).toEqual([])
    const next = setElementType(card, '2.4.3', 'text')
    expect(next.chain).toEqual(before.chain)
    expect(cardIssues(next), '2.4.3 仍是字段引用，2.4.3.1 仍是字段引用').toEqual([])
  })
})
