/**
 * 阶段 3 · 数组 ↔ 标量：**带孩子的元素换数组**与**没有字段的数组字段换回标量**。
 *
 * 对应契约增补 `.team/test/2026-11-28/契约-阶段3-数组-标量往返与子值成项.md`（下称「往返契约」）。
 * 这一份只钉**数据层** `setElementType`；类型下拉那一格在 `v2/e2e/array-conversion.spec.js`。
 *
 * 三件事：
 *   · **数组字段（item schema 里）没有字段**时允许换回 `text` / `integer` / `enum`：
 *     每个外层 item 里的那一格回到标量默认值（`''` / `0` / 白名单第一项）；
 *     有字段的数组字段仍拒（`E_VALIDATION`，逐 item 转换是另一票）——这是本票**钉死的选择**。
 *   · **任何有孩子的元素换成数组**：自己的值清掉、孩子定义原样留成字段、**当前孩子值收成一个 item**
 *     （数组长度 1）；孩子一条值路径都没有 ⇒ `[]`（与 object → array 的既有口径一致，也是钉死的选择）。
 *   · 既有方向回归：object → array、array → 标量（自己 + 孩子）。
 *
 * ⚠️ 0 字段的数组仍是坏卡（`cardIssues` 的 `emptyArray`）：本票只保证**草稿能改回去**，
 *    不把「数组必须有 ≥1 个字段」这条校验放松。
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

/** 把某个元素的某一格换成给定值（其余原样） */
function withElement(card, code, change) {
  return { ...card, state: card.state.map((item) => (item.code === code ? { ...item, ...change } : item)) }
}

/** 把 `check` 节点的两面眼睛换成给定清单（别的节点原样） */
function cardWithRefs(card, { reads = [], writable = [] } = {}) {
  return {
    ...card,
    chain: card.chain.map((node) => (node.id === 'check' ? { ...node, reads, writable } : node)),
  }
}

/** `2.4`（背包）当下的 item 列表 */
function itemsOf(card) {
  return tableOf(card)['2.4']
}

/** 数组字段 `2.4.1` 在每一外层 item 里的值 */
function fieldValuesOf(card) {
  return itemsOf(card).map((item) => item['2.4.1'])
}

/** `2.4` 这棵子树在 `state[]` 里的全部 code（字段定义一个都不许少 / 不许改名） */
function subtreeCodesOf(card) {
  return card.state
    .filter((item) => item.code === '2.4' || item.code.startsWith('2.4.'))
    .map((item) => item.code)
}

/**
 * 有孩子的标量：`2.4 背包` 从 array 改成 text，自己那一格 `2.4.0` 有值，
 * 孩子（原字段）`2.4.1` / `2.4.2` 照旧是它的孩子 —— 是合法卡。
 */
function scalarWithChildrenCard({ nested = false } = {}) {
  const base = nested ? nestedCard() : holdCard()
  const table = nested
    ? {
        2.1: '旅人',
        2.2: 80,
        2.3: '正常',
        '2.4.0': '背包自身',
        '2.4.1': '短剑',
        '2.4.2.1': '普通',
        '2.4.2.2': [{ '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }],
      }
    : {
        2.1: '旅人',
        2.2: 80,
        2.3: '正常',
        '2.4.0': '背包自身',
        '2.4.1': '短剑',
        '2.4.2': 1,
      }
  return withTable(withElement(base, '2.4', { type: 'text' }), table)
}

/** 结构体版的卡：`2.4` object，后代值摊在根表里（object → array 的既有回归用） */
function objectCard(values, base = holdCard()) {
  const table = { ...tableOf(base) }
  delete table['2.4']
  Object.assign(table, values)
  return withTable(withElement(base, '2.4', { type: 'object' }), table)
}

/** 嵌套结构体版：object 字段里再套 array 字段 */
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

/** 一条值路径都没有的结构体：只有别的字段值，`2.4` 的后代全是缺的 */
function objectWithoutChildValuesCard() {
  const base = holdCard()
  const table = { 2.1: '旅人', 2.2: 80, 2.3: '正常' }
  return withTable(withElement(base, '2.4', { type: 'object' }), table)
}

describe('数组字段没有字段：换回标量（往返契约 §2）', () => {
  it('text → array → text：允许；每个外层 item 里的那一格回到空串，卡重新合法', async () => {
    const { setElementType, cardIssues, initialTreeOf } = await loadState()
    const { validateCard } = await loadSchema()
    const card = cardWithRefs(holdCard(), { reads: ['2.4', '2.4.1'], writable: ['2.4', '2.4.2'] })
    const before = copy(card)

    const array = setElementType(card, '2.4.1', 'array')
    expect(array.state.find((item) => item.code === '2.4.1').type).toBe('array')
    expect(
      array.state.some((item) => item.code.startsWith('2.4.1.')),
      '没有字段',
    ).toBe(false)
    expect(fieldValuesOf(array), '中间态：每一格清成 []').toEqual([[], [], []])
    expect(cardIssues(array).length, '0 字段的数组仍是坏卡（本票不放松这条）').toBeGreaterThan(0)

    const back = setElementType(array, '2.4.1', 'text')
    expect(back.state.find((item) => item.code === '2.4.1').type).toBe('text')
    expect(
      back.state.some((item) => item.code.startsWith('2.4.1.')),
      '不凭空造孩子',
    ).toBe(false)
    expect(fieldValuesOf(back), '每一格回到 text 默认值').toEqual(['', '', ''])
    expect(tableOf(back), '字段的值住在 item 里，不写回根表').not.toHaveProperty('2.4.1')
    expect(cardIssues(back)).toEqual([])
    expect(() => validateCard(back)).not.toThrow()
    expect(initialTreeOf(back)['2.4']).toEqual([
      { '2.4.1': '', '2.4.2': 1 },
      { '2.4.1': '', '2.4.2': 1 },
      { '2.4.1': '', '2.4.2': 3 },
    ])
    expect(back.chain, '引用逐字保留').toEqual(before.chain)
    expect(card, '入参卡一个字都不许改').toEqual(before)
  })

  it('text → array → integer：每一格回到 0', async () => {
    const { setElementType, cardIssues } = await loadState()
    const back = setElementType(setElementType(holdCard(), '2.4.1', 'array'), '2.4.1', 'integer')
    expect(back.state.find((item) => item.code === '2.4.1').type).toBe('integer')
    expect(fieldValuesOf(back)).toEqual([0, 0, 0])
    expect(cardIssues(back)).toEqual([])
  })

  it('text → array → enum：白名单保留、每一格回到第一项', async () => {
    const { setElementType, cardIssues } = await loadState()
    const array = withElement(setElementType(holdCard(), '2.4.1', 'array'), '2.4.1', {
      values: ['甲', '乙'],
    })
    const back = setElementType(array, '2.4.1', 'enum')
    const field = back.state.find((item) => item.code === '2.4.1')
    expect(field.type).toBe('enum')
    expect(field.values).toEqual(['甲', '乙'])
    expect(fieldValuesOf(back)).toEqual(['甲', '甲', '甲'])
    expect(cardIssues(back)).toEqual([])
  })

  it('外层数组是空的时候：字段也能换回 text，值仍是 []', async () => {
    const { setElementType, cardIssues } = await loadState()
    const empty = withTable(holdCard(), { ...tableOf(holdCard()), 2.4: [] })
    const array = setElementType(empty, '2.4.1', 'array')
    expect(itemsOf(array)).toEqual([])
    const back = setElementType(array, '2.4.1', 'text')
    expect(back.state.find((item) => item.code === '2.4.1').type).toBe('text')
    expect(itemsOf(back)).toEqual([])
    expect(cardIssues(back)).toEqual([])
  })

  it('有字段的数组字段：换标量一律 E_VALIDATION（中文、点名字段、卡不动）——本票钉死的选择', async () => {
    const { setElementType } = await loadState()
    const card = nestedCard()
    const before = copy(card)
    for (const type of ['text', 'integer', 'enum']) {
      const error = errorOf(() => setElementType(card, '2.4.2.2', type))
      expect(error, `2.4.2.2 → ${type} 应当被拒`).not.toBeNull()
      expect(error.code).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
      expect(error.message).toContain('2.4.2.2')
      expect(card, `${type} 被拒后卡不许动`).toEqual(before)
    }
  })

  it('没有字段的数组字段：object / time 仍拒（时间不能做字段、结构体不可选）', async () => {
    const { setElementType } = await loadState()
    const array = setElementType(holdCard(), '2.4.1', 'array')
    const before = copy(array)
    for (const type of ['object', 'time']) {
      const error = errorOf(() => setElementType(array, '2.4.1', type))
      expect(error, `2.4.1 → ${type} 应当被拒`).not.toBeNull()
      expect(error.code).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
      expect(array).toEqual(before)
    }
  })
})

describe('有孩子的元素 → 数组：当前孩子值收成一个 item（往返契约 §3）', () => {
  it('有孩子的 text → array → text：数组长度 1、孩子值在 item 里；换回来值不丢、自己回到空串', async () => {
    const { setElementType, cardIssues } = await loadState()
    const { validateCard } = await loadSchema()
    const card = cardWithRefs(scalarWithChildrenCard(), {
      reads: ['2.4', '2.4.1'],
      writable: ['2.4', '2.4.2'],
    })
    const before = copy(card)

    const array = setElementType(card, '2.4', 'array')
    const element = array.state.find((item) => item.code === '2.4')
    expect(element.type).toBe('array')
    expect(element.values, '旧类型的格子清掉').toBeUndefined()
    expect(subtreeCodesOf(array), '孩子定义一个都不许少 / 不许改名').toEqual(subtreeCodesOf(card))
    expect(itemsOf(array), '当前孩子值收成一个 item').toEqual([{ '2.4.1': '短剑', '2.4.2': 1 }])
    expect(itemsOf(array)).toHaveLength(1)
    expect(tableOf(array), '自己的值清掉').not.toHaveProperty('2.4.0')
    expect(tableOf(array), '孩子值不再摊在根表里').not.toHaveProperty('2.4.1')
    expect(tableOf(array)).not.toHaveProperty('2.4.2')
    expect(array.chain).toEqual(before.chain)
    expect(cardIssues(array)).toEqual([])
    expect(() => validateCard(array)).not.toThrow()
    expect(card, '入参卡一个字都不许改').toEqual(before)

    const back = setElementType(array, '2.4', 'text')
    expect(tableOf(back)).toMatchObject({ '2.4.0': '', '2.4.1': '短剑', '2.4.2': 1 })
    expect(tableOf(back)).not.toHaveProperty('2.4')
    expect(cardIssues(back)).toEqual([])
    expect(() => validateCard(back)).not.toThrow()
  })

  it('有孩子的 text（孩子里有 object / array 字段）→ array：item 里同样是嵌套对象 / 嵌套数组', async () => {
    const { setElementType, cardIssues } = await loadState()
    const { validateCard } = await loadSchema()
    const array = setElementType(scalarWithChildrenCard({ nested: true }), '2.4', 'array')
    expect(itemsOf(array)).toEqual([
      {
        '2.4.1': '短剑',
        '2.4.2': { '2.4.2.1': '普通', '2.4.2.2': [{ '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }] },
      },
    ])
    expect(tableOf(array)).not.toHaveProperty('2.4.0')
    expect(cardIssues(array)).toEqual([])
    expect(() => validateCard(array)).not.toThrow()
  })

  it('孩子值都是默认值（空串 / 0）也算「有值」：照样收成一个 item', async () => {
    const { setElementType } = await loadState()
    const card = withTable(withElement(holdCard(), '2.4', { type: 'text' }), {
      2.1: '旅人',
      2.2: 80,
      2.3: '正常',
      '2.4.0': '',
      '2.4.1': '',
      '2.4.2': 0,
    })
    expect(itemsOf(setElementType(card, '2.4', 'array'))).toEqual([{ '2.4.1': '', '2.4.2': 0 }])
  })

  it('根元素（有孩子的标量）→ array：根自己的 initial 表整张换成一个 item、卡合法', async () => {
    const { setElementType, cardIssues } = await loadState()
    const { validateCard } = await loadSchema()
    const base = holdCard()
    const card = {
      ...base,
      state: base.state.map((item) =>
        item.code === '1' ? { ...item, type: 'text', initial: { '1.0': '世界自身', 1.1: 'A1' } } : item,
      ),
    }
    expect(cardIssues(card), '夹具本身要先合法').toEqual([])
    const array = setElementType(card, '1', 'array')
    const root = array.state.find((item) => item.code === '1')
    expect(root.type).toBe('array')
    expect(root.initial, '根元素自己的 initial 就是整份数组').toEqual({ 1: [{ 1.1: 'A1' }] })
    expect(Object.keys(root.initial)).not.toContain('1.0')
    expect(cardIssues(array)).toEqual([])
    expect(() => validateCard(array)).not.toThrow()
  })

  it('孩子一条值路径都没有：写 []（与 object → array 既有口径一致）——本票钉死的选择', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = withTable(withElement(holdCard(), '2.4', { type: 'text' }), {
      2.1: '旅人',
      2.2: 80,
      2.3: '正常',
      '2.4.0': '背包自身',
    })
    const array = setElementType(card, '2.4', 'array')
    expect(itemsOf(array)).toEqual([])
    expect(cardIssues(array), '字段定义还在，所以这是一张合法卡').toEqual([])
  })

  it('没孩子的 text → array：仍是 []（0 字段数组是坏卡，等作者加字段或换回去）', async () => {
    const { setElementType, cardIssues } = await loadState()
    const array = setElementType(holdCard(), '2.1', 'array')
    expect(tableOf(array)['2.1'], '自己的值清掉、数组值写在 code 上').toEqual([])
    expect(array.state.find((item) => item.code === '2.1').type).toBe('array')
    expect(cardIssues(array).length, '0 字段的数组是坏卡').toBeGreaterThan(0)
  })
})

describe('object → array：既有行为回归（往返契约 §4）', () => {
  it('对象当前值收成一个 item、字段 code / 引用原样、卡合法', async () => {
    const { setElementType, cardIssues } = await loadState()
    const { validateCard } = await loadSchema()
    const card = cardWithRefs(objectCard({ '2.4.1': '短剑', '2.4.2': 7 }), {
      reads: ['2.4', '2.4.1'],
      writable: ['2.4', '2.4.2'],
    })
    const before = copy(card)
    const array = setElementType(card, '2.4', 'array')

    expect(array.state.find((item) => item.code === '2.4').type).toBe('array')
    expect(subtreeCodesOf(array)).toEqual(subtreeCodesOf(card))
    expect(itemsOf(array)).toEqual([{ '2.4.1': '短剑', '2.4.2': 7 }])
    expect(tableOf(array)).not.toHaveProperty('2.4.1')
    expect(tableOf(array)).not.toHaveProperty('2.4.2')
    expect(array.chain).toEqual(before.chain)
    expect(cardIssues(array)).toEqual([])
    expect(() => validateCard(array)).not.toThrow()
    expect(card).toEqual(before)
  })

  it('嵌套对象 → array：object 后代收成嵌套对象、array 字段整份进 item', async () => {
    const { setElementType, cardIssues } = await loadState()
    const { validateCard } = await loadSchema()
    const array = setElementType(nestedObjectCard(), '2.4', 'array')
    expect(itemsOf(array)).toEqual([
      {
        '2.4.1': '短剑',
        '2.4.2': { '2.4.2.1': '普通', '2.4.2.2': [{ '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }] },
      },
    ])
    expect(cardIssues(array)).toEqual([])
    expect(() => validateCard(array)).not.toThrow()
  })

  it('对象一条后代值路径都没有：写 []（既有口径）', async () => {
    const { setElementType, cardIssues } = await loadState()
    const array = setElementType(objectWithoutChildValuesCard(), '2.4', 'array')
    expect(itemsOf(array)).toEqual([])
    expect(cardIssues(array)).toEqual([])
  })
})

describe('array → 标量：自己 + 孩子的搬运（往返契约 §5）', () => {
  it('没有孩子的数组 → text：自己的值写在自己的 code（不是 `.0`）', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = holdCard()
    const array = setElementType(card, '1.1', 'array')
    const back = setElementType(array, '1.1', 'text')
    expect(back.state.find((item) => item.code === '1.1').type).toBe('text')
    expect(back.state.find((item) => item.code === '1').initial['1.1']).toBe('')
    expect(back.state.find((item) => item.code === '1').initial).not.toHaveProperty('1.1.0')
    expect(cardIssues(back)).toEqual([])
  })

  it('有孩子的数组 → text：自己写 `<code>.0` 默认值、第 1 项铺进孩子、其余丢弃', async () => {
    const { setElementType, cardIssues } = await loadState()
    const back = setElementType(holdCard(), '2.4', 'text')
    const table = tableOf(back)
    expect(table).toMatchObject({ '2.4.0': '', '2.4.1': '短剑', '2.4.2': 1 })
    expect(table).not.toHaveProperty('2.4')
    expect(JSON.stringify(table), '第 2 / 3 项丢弃').not.toContain('斗篷')
    expect(JSON.stringify(table)).not.toContain('银币')
    expect(cardIssues(back)).toEqual([])
  })

  it('第 1 项里有「自己 + 孩子」的标量字段：铺成 `<field>.0` + 孩子路径，不留中间键', async () => {
    const { setElementType, cardIssues } = await loadState()
    const { validateCard } = await loadSchema()
    const base = holdCard()
    const card = withTable(
      {
        ...base,
        state: [
          ...base.state.map((item) => (item.code === '2.4.2' ? { ...item, type: 'text' } : item)),
          { code: '2.4.2.1', name: '备注', note: '', type: 'text' },
        ],
      },
      {
        ...tableOf(base),
        2.4: [
          { '2.4.1': '短剑', '2.4.2': { '2.4.2.0': '锋利', '2.4.2.1': '旧剑' } },
          { '2.4.1': '斗篷', '2.4.2': { '2.4.2.0': '普通', '2.4.2.1': '布' } },
        ],
      },
    )
    expect(cardIssues(card), '夹具本身要先合法').toEqual([])

    const back = setElementType(card, '2.4', 'text')
    expect(tableOf(back)).toMatchObject({
      '2.4.0': '',
      '2.4.1': '短剑',
      '2.4.2.0': '锋利',
      '2.4.2.1': '旧剑',
    })
    expect(tableOf(back)).not.toHaveProperty('2.4.2')
    expect(tableOf(back)).not.toHaveProperty('2.4')
    expect(cardIssues(back)).toEqual([])
    expect(() => validateCard(back)).not.toThrow()
  })
})
