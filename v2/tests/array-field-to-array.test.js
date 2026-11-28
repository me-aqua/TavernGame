/**
 * 评审 F1 / F2 的判据（数据层 `setElementType`）：数组字段换数组、换数组前的 `.0` 引用闸。
 *
 * 对应契约 `.team/test/2026-11-28/契约-评审F1F2-数组字段换数组与消失引用.md`。
 *
 * F1（数组子树里的有孩子字段 → array）：
 *   · **允许**，不是拒绝；每个外层 item 的**这一实例**把「当前孩子值」收成**恰好一个 item**；
 *   · 自己的值 `<code>.0` 清掉（不进 item）；一个孩子值都没有 ⇒ `[]`；
 *   · 每一外层 item 各算各的；有孩子值的实例**不许静默变 `[]`**；
 *   · 换完是有字段的数组字段 ⇒ 换回标量**允许**（每个外层实例取第一个内层 item；本票放开）。
 *
 * F2（换数组会让 `<code>.0` 引用消失）：
 *   · `reads` / `writable` 里出现 `${code}.0` ⇒ 换 array 必须 `E_VALIDATION`、**点名那条引用**；
 *   · 钉死「拒绝」，不静默重定向；卡一个字不动。
 *
 * 这一份只钉纯函数；DOM 那半边（下拉四档 / 有字段只剩 array）在
 * `v2/e2e/array-conversion.spec.js` 与 `v2/e2e/array-item-field-parity.spec.js`。
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
 * 在 `holdCard` 上给 `2.4.1` 挂两个孩子（文字 + 整数），再把 `2.4` 的 item 值换成 `items`。
 * `2.4.1` 的值形状与普通「有孩子的标量」一致：`{ '2.4.1.0': 自己, 孩子 code: 孩子值 }`。
 */
function fieldWithChildren(items) {
  const base = holdCard()
  const at = base.state.findIndex((item) => item.code === '2.4.1') + 1
  const card = {
    ...base,
    state: [
      ...base.state.slice(0, at),
      { code: '2.4.1.1', name: '附魔', note: '', type: 'text' },
      { code: '2.4.1.2', name: '强度', note: '', type: 'integer', min: 0, max: 9 },
      ...base.state.slice(at),
    ],
  }
  return withInitialValue(card, '2.4', items)
}

/** 三项都带完整「自己 + 两个孩子」的合法值（每一外层 item 的孩子值都不同） */
function fullItems() {
  return [
    { '2.4.1': { '2.4.1.0': '短剑', '2.4.1.1': '锋利', '2.4.1.2': 3 }, '2.4.2': 1 },
    { '2.4.1': { '2.4.1.0': '斗篷', '2.4.1.1': '轻柔', '2.4.1.2': 1 }, '2.4.2': 1 },
    { '2.4.1': { '2.4.1.0': '银币', '2.4.1.1': '微光', '2.4.1.2': 5 }, '2.4.2': 3 },
  ]
}

/** 有孩子的标量（数组外）：`2.4 背包` 是 text，自己 `2.4.0` + 孩子 `2.4.1` / `2.4.2` */
function scalarWithChildrenCard() {
  const base = holdCard()
  const table = { 2.1: '旅人', 2.2: 80, 2.3: '正常', '2.4.0': '背包自身', '2.4.1': '短剑', '2.4.2': 1 }
  return withTable(withElement(base, '2.4', { type: 'text' }), table)
}

describe('F1 · 数组字段（有孩子）→ array：每个外层实例收成恰好一个 item', () => {
  it('三项各有孩子值：每项收成 1 个 item、自己的值清掉、孩子值逐个搬（不许静默 []）', async () => {
    const { setElementType, cardIssues, initialTreeOf } = await loadState()
    const { validateCard } = await loadSchema()
    const card = fieldWithChildren(fullItems())
    const before = copy(card)
    expect(cardIssues(card), '夹具本身要先合法').toEqual([])

    const array = setElementType(card, '2.4.1', 'array')
    const field = array.state.find((item) => item.code === '2.4.1')
    expect(field.type).toBe('array')
    expect(subtreeCodesOf(array), '孩子定义 / code / 顺序一个都不许动').toEqual(subtreeCodesOf(card))
    expect(array.chain, '引用逐字保留').toEqual(before.chain)
    expect(card, '入参卡一个字都不许改').toEqual(before)

    const values = fieldValuesOf(array)
    expect(itemsOf(array), '外层 item 数 / 顺序不动').toHaveLength(3)
    expect(values, '每个外层实例各收成恰好一个 item').toEqual([
      [{ '2.4.1.1': '锋利', '2.4.1.2': 3 }],
      [{ '2.4.1.1': '轻柔', '2.4.1.2': 1 }],
      [{ '2.4.1.1': '微光', '2.4.1.2': 5 }],
    ])
    for (const [index, value] of values.entries()) {
      expect(value, `第 ${index + 1} 项：有孩子值就必须收成恰好一个 item，不许静默 []`).toHaveLength(1)
      expect(
        Object.keys(value[0]),
        `第 ${index + 1} 项：item 的键恰好是孩子 code（自己的值不进 item）`,
      ).toEqual(['2.4.1.1', '2.4.1.2'])
    }
    expect(JSON.stringify(values), '自己的值 `<code>.0` 不许搬进 item').not.toContain('2.4.1.0')
    expect(JSON.stringify(values), '自己的孩子值一个都不许丢').toContain('锋利')
    expect(JSON.stringify(values)).toContain('微光')
    expect(
      itemsOf(array).map((item) => item['2.4.2']),
      '兄弟字段 2.4.2 不动',
    ).toEqual([1, 1, 3])

    expect(cardIssues(array), '换完是有字段的数组，卡仍合法').toEqual([])
    expect(() => validateCard(array)).not.toThrow()
    expect(initialTreeOf(array)['2.4'], '初始值摊平后就是转换后的 item 列表').toEqual(itemsOf(array))
  })

  it('一个实例没有孩子值 ⇒ 只该实例 []；有孩子值的实例照旧收 item；缺的孩子键补默认值', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = fieldWithChildren([
      { '2.4.1': { '2.4.1.0': '短剑', '2.4.1.1': '锋利', '2.4.1.2': 3 }, '2.4.2': 1 },
      // 只有自己的值：一条孩子值都没有 ⇒ 这一实例 []
      { '2.4.1': { '2.4.1.0': '只有自己' }, '2.4.2': 1 },
      // 只有一条孩子值：仍收成 1 个 item，缺的孩子键按默认值补成 0
      { '2.4.1': { '2.4.1.0': '银币', '2.4.1.1': '微光' }, '2.4.2': 3 },
    ])

    const array = setElementType(card, '2.4.1', 'array')
    expect(fieldValuesOf(array)).toEqual([
      [{ '2.4.1.1': '锋利', '2.4.1.2': 3 }],
      [],
      [{ '2.4.1.1': '微光', '2.4.1.2': 0 }],
    ])
    expect(cardIssues(array), '空数组是合法数组值（字段定义还在），卡仍合法').toEqual([])
  })

  it('三项都没有孩子值：每项都 []（与既有「没有孩子值 ⇒ []」一致，不凭空造默认 item）', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = fieldWithChildren([
      { '2.4.1': { '2.4.1.0': '短剑' }, '2.4.2': 1 },
      { '2.4.1': { '2.4.1.0': '斗篷' }, '2.4.2': 1 },
      { '2.4.1': { '2.4.1.0': '银币' }, '2.4.2': 3 },
    ])

    const array = setElementType(card, '2.4.1', 'array')
    expect(fieldValuesOf(array)).toEqual([[], [], []])
    expect(JSON.stringify(itemsOf(array)), '自己的值清掉').not.toContain('2.4.1.0')
    expect(cardIssues(array)).toEqual([])
  })

  it('外层数组是空的：没有实例可搬，`2.4` 仍是 []、字段类型照改、卡合法', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = fieldWithChildren([])

    const array = setElementType(card, '2.4.1', 'array')
    expect(itemsOf(array)).toEqual([])
    expect(array.state.find((item) => item.code === '2.4.1').type).toBe('array')
    expect(cardIssues(array), '数组有字段、0 个 item 是合法值').toEqual([])
  })

  it('换完是有字段的数组字段：换回 text 允许（本票放开），每个外层实例取第一个 item', async () => {
    const { setElementType, cardIssues } = await loadState()
    const { validateCard } = await loadSchema()
    const array = setElementType(fieldWithChildren(fullItems()), '2.4.1', 'array')
    const before = copy(array)

    const back = setElementType(array, '2.4.1', 'text')
    expect(array, '入参卡一个字都不许动').toEqual(before)
    expect(back.state.find((item) => item.code === '2.4.1').type).toBe('text')
    expect(subtreeCodesOf(back), '孩子定义 / code / 顺序一个都不许动').toEqual(subtreeCodesOf(array))
    expect(back.chain).toEqual(array.chain)
    expect(fieldValuesOf(back), '每个外层实例取第一个内层 item，其余丢弃').toEqual([
      { '2.4.1.0': '', '2.4.1.1': '锋利', '2.4.1.2': 3 },
      { '2.4.1.0': '', '2.4.1.1': '轻柔', '2.4.1.2': 1 },
      { '2.4.1.0': '', '2.4.1.1': '微光', '2.4.1.2': 5 },
    ])
    expect(cardIssues(back), '换完卡仍合法').toEqual([])
    expect(() => validateCard(back)).not.toThrow()
  })
})

describe('F2 · 换 array 会让 `<code>.0` 引用消失：E_VALIDATION、点名那条引用', () => {
  it('reads 里有 `2.4.0`：换 array 被拒，错误点名 2.4.0，卡不动', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = cardWithRefs(scalarWithChildrenCard(), { reads: ['2.4.0'], writable: ['2.4'] })
    const before = copy(card)
    expect(cardIssues(card), '`2.4.0` 在旧卡里是合法引用').toEqual([])

    const error = errorOf(() => setElementType(card, '2.4', 'array'))
    expect(error, '会让 2.4.0 消失的转换必须被拒').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(error.message, '错误必须点名那条会消失的引用').toContain('2.4.0')
    expect(error.message, '错误也要点名被转换的元素 2.4（不是只出现 2.4.0）').toMatch(/2\.4(?!\.0)/)
    expect(card, '被拒后卡一个字不许动').toEqual(before)
  })

  it('writable 里有 `2.4.0`：同样拒绝（读 / 写两套引用同一把尺）', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = cardWithRefs(scalarWithChildrenCard(), { reads: ['2.4'], writable: ['2.4.0'] })
    const before = copy(card)
    expect(cardIssues(card)).toEqual([])

    const error = errorOf(() => setElementType(card, '2.4', 'array'))
    expect(error).not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(error.message).toContain('2.4.0')
    expect(card).toEqual(before)
  })

  it('只引用 code / 可见孩子：换 array 放行，引用逐字保留、转换结果仍合法', async () => {
    const { setElementType, cardIssues } = await loadState()
    const { validateCard } = await loadSchema()
    const card = cardWithRefs(scalarWithChildrenCard(), {
      reads: ['2.4', '2.4.1'],
      writable: ['2.4', '2.4.2'],
    })
    const before = copy(card)
    expect(cardIssues(card)).toEqual([])

    const array = setElementType(card, '2.4', 'array')
    expect(array.state.find((item) => item.code === '2.4').type).toBe('array')
    expect(itemsOf(array), '有孩子的标量 → array 的既有行为不变').toEqual([{ '2.4.1': '短剑', '2.4.2': 1 }])
    expect(array.chain).toEqual(before.chain)
    expect(cardIssues(array), '2.4 / 2.4.1 / 2.4.2 在转换后都还是合法引用').toEqual([])
    expect(() => validateCard(array)).not.toThrow()
    expect(card).toEqual(before)
  })

  it('换成非 array 不动 `<code>.0` 引用：仍然放行（闸只钉「换 array」这一支）', async () => {
    const { setElementType, cardIssues } = await loadState()
    const card = cardWithRefs(scalarWithChildrenCard(), { reads: ['2.4.0'], writable: ['2.4'] })
    expect(cardIssues(card)).toEqual([])

    const next = setElementType(card, '2.4', 'integer')
    expect(next.state.find((item) => item.code === '2.4').type).toBe('integer')
    expect(tableOf(next)['2.4.0'], '换成 integer 后自己的值路径仍在').toBe(0)
    expect(next.chain).toEqual(card.chain)
    expect(cardIssues(next), '2.4.0 在 integer 下仍是合法引用').toEqual([])
  })
})
