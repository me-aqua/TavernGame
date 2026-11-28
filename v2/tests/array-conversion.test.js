/**
 * 阶段 3 · 数组转换到标量（契约增补 `契约-阶段3-数组转换-标量与UI.md` §三）。
 *
 * 这一份钉**数据层**（`setElementType`），不碰编辑器：
 *   · 数组行只能变 text / integer / enum / array；结构体与时间都拒；
 *   · array → 标量：字段留成孩子，第 1 项的值铺进孩子，容器自己的默认值写 `<code>.0`；
 *   · 0 项 ⇒ 字段默认值 + 自己的默认值；> 1 项只留第 1 项（确认层是 DOM 的事）；
 *   · array → array 是 no-op；不做 array ⇄ time；
 *   · 字段 code / 顺序 / `reads` / `writable` 引用逐字保留，转换后卡合法；
 *   · 整数格子（含数组 item 字段）留空 min / max / step 是合法卡。
 *
 * DOM（下拉四项、确认层、`[data-array-range]`、删除按钮同一行）在 `v2/e2e/array-conversion.spec.js`。
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

/** 结构体版的卡：`2.4` object，后代值摊在根表里（只用于「对象 → 数组」的既有回归） */
function objectCard(values, base = holdCard()) {
  const table = { ...tableOf(base) }
  delete table['2.4']
  Object.assign(table, values)
  return withTable(withElement(base, '2.4', { type: 'object' }), table)
}

/** 结构体版的嵌套卡：`2.4` object，后代值摊在根表里 */
function nestedObjectCard() {
  return objectCard(
    {
      '2.4.1': '短剑',
      '2.4.2.1': '普通',
      '2.4.2.2': [{ id: 'id_1', '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }],
    },
    nestedCard(),
  )
}

/** 给数组容器带一份白名单（导入的卡可能有；enum 目标的「第一项」从这里来） */
function withValues(card, values) {
  return withElement(card, '2.4', { values })
}

/** 去掉整数字段的 min / max / stepMin / stepMax（空范围） */
function withoutIntegerRange(card, code) {
  return {
    ...card,
    state: card.state.map((item) => {
      if (item.code !== code) return item
      const next = { ...item }
      delete next.min
      delete next.max
      delete next.stepMin
      delete next.stepMax
      return next
    }),
  }
}

/** 一个数组元素 / 它的字段定义 / 初始值表（断言常用三件套） */
function pieces(card) {
  return {
    element: card.state.find((item) => item.code === '2.4'),
    fields: card.state.filter((item) => item.code.startsWith('2.4.')).map((item) => item.code),
    table: tableOf(card),
  }
}

describe('数组 → 标量 · 第 1 项铺进字段孩子（增补 §3.2）', () => {
  it('array → text：字段原样、第 1 项铺进孩子、own `2.4.0` = 空串；第 2/3 项丢弃', async () => {
    const { setElementType } = await loadState()
    const { validateCard } = await loadSchema()
    const card = cardWithRefs(holdCard(), { reads: ['2.4', '2.4.1'], writable: ['2.4', '2.4.2'] })
    const before = copy(card)
    const next = setElementType(card, '2.4', 'text')

    expect(next.state.find((item) => item.code === '2.4').type).toBe('text')
    expect(pieces(next).fields, '字段一个都不许少 / 不许改名').toEqual(['2.4.1', '2.4.2'])
    expect(next.chain, '引用逐字保留').toEqual(before.chain)

    const table = pieces(next).table
    expect(table['2.4.0'], 'own 值住在 `.0`，默认空串').toBe('')
    expect(table['2.4.1']).toBe('短剑')
    expect(table['2.4.2']).toBe(1)
    expect(table, '数组值不再存在').not.toHaveProperty('2.4')
    expect(JSON.stringify(table), '第 2 / 3 项必须丢弃').not.toContain('斗篷')
    expect(JSON.stringify(table)).not.toContain('银币')
    expect(card, '入参卡一个字都不许改').toEqual(before)
    expect(() => validateCard(next)).not.toThrow()

    const { pathsOf, initialTreeOf } = await loadState()
    expect(pathsOf(next.state, '2.4')[0], 'own 值排第一').toBe('2.4.0')
    expect(pathsOf(next.state, '2.4')).toEqual(['2.4.0', '2.4.1', '2.4.2'])
    expect(initialTreeOf(next)).toMatchObject({ '2.4.0': '', '2.4.1': '短剑', '2.4.2': 1 })
    expect(initialTreeOf(next)).not.toHaveProperty('2.4')
  })

  it('array → integer：own `2.4.0` = 0；第 1 项铺进孩子', async () => {
    const { setElementType } = await loadState()
    const { validateCard } = await loadSchema()
    const card = cardWithRefs(holdCard(), { reads: ['2.4.1'], writable: ['2.4.2'] })
    const before = copy(card)
    const next = setElementType(card, '2.4', 'integer')

    expect(next.state.find((item) => item.code === '2.4').type).toBe('integer')
    expect(next.state.find((item) => item.code === '2.4').min, '旧类型的格子清掉').toBeUndefined()
    expect(next.chain).toEqual(before.chain)
    expect(pieces(next).table).toMatchObject({ '2.4.0': 0, '2.4.1': '短剑', '2.4.2': 1 })
    expect(pieces(next).table).not.toHaveProperty('2.4')
    expect(card).toEqual(before)
    expect(() => validateCard(next)).not.toThrow()
  })

  it('array → enum：白名单从源元素保留、own `2.4.0` = 第一项', async () => {
    const { setElementType } = await loadState()
    const { validateCard } = await loadSchema()
    const card = withValues(cardWithRefs(holdCard()), ['甲', '乙'])
    const next = setElementType(card, '2.4', 'enum')

    expect(next.state.find((item) => item.code === '2.4').type).toBe('enum')
    expect(next.state.find((item) => item.code === '2.4').values).toEqual(['甲', '乙'])
    expect(pieces(next).table).toMatchObject({ '2.4.0': '甲', '2.4.1': '短剑', '2.4.2': 1 })
    expect(pieces(next).table).not.toHaveProperty('2.4')
    expect(() => validateCard(next)).not.toThrow()
  })

  it('嵌套：object 字段摊到后代 code、array 字段整份搬；own 默认照写、没有中间键', async () => {
    const { setElementType } = await loadState()
    const { validateCard } = await loadSchema()
    const next = setElementType(nestedCard(), '2.4', 'text')
    const table = tableOf(next)

    expect(table['2.4.0']).toBe('')
    expect(table['2.4.1']).toBe('短剑')
    expect(table['2.4.2.1']).toBe('普通')
    expect(table['2.4.2.2']).toEqual([{ id: 'id_1', '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }])
    expect(table).not.toHaveProperty('2.4.2')
    expect(table).not.toHaveProperty('2.4')
    expect(() => validateCard(next)).not.toThrow()
  })

  it('0 项 ⇒ 每个字段默认值 + own 默认值（text 空串）', async () => {
    const { setElementType } = await loadState()
    const card = withTable(holdCard(), { ...tableOf(holdCard()), 2.4: [] })
    const next = setElementType(card, '2.4', 'text')
    expect(tableOf(next)).toMatchObject({ '2.4.0': '', '2.4.1': '', '2.4.2': 0 })
    expect(tableOf(next)).not.toHaveProperty('2.4')
  })

  it('0 项 + 嵌套 ⇒ 默认值逐层写（enum 第一项 / 嵌套数组 []）+ own 默认值', async () => {
    const { setElementType } = await loadState()
    const card = withTable(nestedCard(), { ...tableOf(nestedCard()), 2.4: [] })
    const next = setElementType(card, '2.4', 'text')
    expect(tableOf(next)).toMatchObject({ '2.4.0': '', '2.4.1': '', '2.4.2.1': '普通', '2.4.2.2': [] })
    expect(tableOf(next)).not.toHaveProperty('2.4.2')
  })

  it('0 项 + enum 目标 ⇒ own 默认 = 白名单第一项', async () => {
    const { setElementType } = await loadState()
    const card = withValues(withTable(nestedCard(), { ...tableOf(nestedCard()), 2.4: [] }), ['甲', '乙'])
    const next = setElementType(card, '2.4', 'enum')
    expect(tableOf(next)).toMatchObject({ '2.4.0': '甲', '2.4.1': '', '2.4.2.1': '普通', '2.4.2.2': [] })
    expect(tableOf(next)).not.toHaveProperty('2.4')
  })

  it('> 1 项：数据层只留第 1 项，own 默认照写（确认层在 e2e）', async () => {
    const { setElementType } = await loadState()
    const next = setElementType(holdCard(), '2.4', 'integer')
    expect(tableOf(next)['2.4.1']).toBe('短剑')
    expect(JSON.stringify(tableOf(next)), '第 2 / 3 项必须丢弃').not.toContain('斗篷')
    expect(JSON.stringify(tableOf(next))).not.toContain('银币')
    expect(tableOf(next)['2.4.0']).toBe(0)
  })
})

describe('数组 → 数组 / 不做的方向（增补 §3.3–§3.4）', () => {
  it('array → array 是 no-op：卡深比较完全不变', async () => {
    const { setElementType } = await loadState()
    const card = cardWithRefs(holdCard(), { reads: ['2.4', '2.4.1'], writable: ['2.4'] })
    const before = copy(card)
    const next = setElementType(card, '2.4', 'array')
    expect(next).toEqual(before)
    expect(card).toEqual(before)
  })

  it('array → object 也拒（E_VALIDATION + 中文，卡一个字不动）', async () => {
    const { setElementType } = await loadState()
    const card = holdCard()
    const before = copy(card)
    const error = errorOf(() => setElementType(card, '2.4', 'object'))
    expect(error).not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(card).toEqual(before)
  })

  it('array → time 拒、time → array 也拒（不做 array ⇄ time）', async () => {
    const { setElementType } = await loadState()
    for (const [code, type] of [
      ['2.4', 'time'],
      ['0', 'array'],
    ]) {
      const card = holdCard()
      const before = copy(card)
      const error = errorOf(() => setElementType(card, code, type))
      expect(error, `${code} → ${type} 应当被拒`).not.toBeNull()
      expect(error.code).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
      expect(card).toEqual(before)
    }
  })

  it('数组字段（item schema 里）仍不做逐 item 转换：2.4.2.2 array → object 拒', async () => {
    const { setElementType } = await loadState()
    const card = nestedCard()
    const before = copy(card)
    const error = errorOf(() => setElementType(card, '2.4.2.2', 'object'))
    expect(error).not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(card).toEqual(before)
  })
})

describe('既有形状 / 空范围（增补 §3.5）', () => {
  it('对象 → 数组保留：当前对象值拼成一个 item、字段 code / 引用原样', async () => {
    const { setElementType } = await loadState()
    const { validateCard } = await loadSchema()
    const card = cardWithRefs(objectCard({ '2.4.1': '短剑', '2.4.2': 7 }), {
      reads: ['2.4', '2.4.1'],
      writable: ['2.4', '2.4.2'],
    })
    const before = copy(card)
    const next = setElementType(card, '2.4', 'array')

    expect(next.state.find((item) => item.code === '2.4').type).toBe('array')
    expect(pieces(next).fields).toEqual(['2.4.1', '2.4.2'])
    expect(next.chain).toEqual(before.chain)
    // 转换新建的 item 也要带 id（数组 item 一律带 id；空数组 ⇒ 第一条是 id_1）
    expect(tableOf(next)['2.4']).toEqual([{ id: 'id_1', '2.4.1': '短剑', '2.4.2': 7 }])
    expect(tableOf(next)).not.toHaveProperty('2.4.1')
    expect(() => validateCard(next)).not.toThrow()
    expect(card).toEqual(before)
  })

  it('嵌套对象 → 数组：object 后代收成嵌套对象、array 字段整份进 item', async () => {
    const { setElementType } = await loadState()
    const { validateCard } = await loadSchema()
    const next = setElementType(nestedObjectCard(), '2.4', 'array')
    expect(tableOf(next)['2.4']).toEqual([
      {
        id: 'id_1',
        '2.4.1': '短剑',
        '2.4.2': {
          '2.4.2.1': '普通',
          '2.4.2.2': [{ id: 'id_1', '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }],
        },
      },
    ])
    expect(() => validateCard(next)).not.toThrow()
  })

  it('整数字段没有 min / max / step 是合法卡：validateCard 通过、integerRangeOf 给缺省', async () => {
    const { validateCard } = await loadSchema()
    const { integerRangeOf } = await loadState()
    const card = withoutIntegerRange(holdCard(), '2.4.2')
    expect(() => validateCard(card)).not.toThrow()
    const field = card.state.find((item) => item.code === '2.4.2')
    expect(integerRangeOf(field)).toEqual({
      min: -1_000_000_000,
      max: 1_000_000_000,
      stepMin: 0,
      stepMax: 1_000_000_000,
    })
  })
})
