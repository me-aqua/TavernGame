/**
 * 阶段 3 · 数组节点：数据形状、值路径、初始值展开（数组契约 §一 / §二 / §1.3）。
 *
 * 这一份钉的是**数据层**，不碰编辑器：
 *   · `type: 'array'` 是合法类型；值住在节点自己的 code（`2.4`），没有 `2.4.0`；
 *   · 子元素是 item 字段定义，不是值路径（`pathsOf('2.4.1') === []`、`elementOfPath` 认不出）；
 *   · 初始值只挂根元素：`root.initial['2.4']` 是整份数组，`initialTreeOf` 深拷贝进 `tree['2.4']`；
 *   · `reads` / `writable` 只接受容器 code；工具由类型派生（数组 ⇒ 只有 write_state）。
 *
 * 读法：每条判据都连着数组契约的一节；契约没写的东西不断言。
 */
import { describe, expect, it } from 'vitest'
import {
  deepCard,
  elementOf,
  holdCard,
  holdItems,
  nestedCard,
  tooDeepCard,
} from './support/array-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

const CJK = /[\u4e00-\u9fff]/

/** 抓一个同步调用抛出的错误（不吞错：没抛就是 null） */
function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 数组契约 §3.2 的两个新导出：缺了就是第 3 关没实现，给一条指名道姓的红 */
async function stateApi() {
  const mod = await loadState()
  for (const name of ['arrayValueFits', 'arrayItemOf']) {
    if (typeof mod[name] !== 'function') {
      throw new Error(`missing export: core/statetree.ts ${name}（数组契约 §3.2 / §1.3）`)
    }
  }
  return mod
}

/** 把节点 `check` 的 reads / writable 换成给定清单（另一侧清空，避免两条规则互相借力） */
function cardWithRefs(field, refs) {
  const card = holdCard()
  return {
    ...card,
    chain: card.chain.map((node) =>
      node.id === 'check'
        ? { ...node, reads: field === 'reads' ? refs : [], writable: field === 'writable' ? refs : [] }
        : node,
    ),
  }
}

describe('数组 · 合法形状（正控）', () => {
  it('最简背包卡与嵌套卡都过得了 validateCard，cardIssues 是空的', async () => {
    const { validateCard } = await loadSchema()
    const { cardIssues } = await loadState()
    for (const card of [holdCard(), nestedCard(), deepCard()]) {
      expect(() => validateCard(card), `${card.id} 应当合法`).not.toThrow()
      expect(cardIssues(card), `${card.id} 不该有问题`).toEqual([])
    }
  })

  it('空数组 [] 合法；没有字段的数组才是坏卡', async () => {
    const { validateCard } = await loadSchema()
    const { cardIssues } = await loadState()
    const empty = holdCard()
    empty.state.find((item) => item.code === '2').initial['2.4'] = []
    expect(() => validateCard(empty), '空数组合法').not.toThrow()
    expect(cardIssues(empty)).toEqual([])

    const noFields = holdCard({
      state: holdCard().state.filter((item) => !item.code.startsWith('2.4.')),
    })
    const issues = cardIssues(noFields)
    expect(issues.length, '没有字段的数组是坏卡').toBeGreaterThan(0)
    expect(issues.some((issue) => issue.code === '2.4' || issue.path === '2.4')).toBe(true)
    expect(errorOf(() => validateCard(noFields))?.code).toBe('E_VALIDATION')
  })

  it('字典 / 键字段不是数组：不认识的 type 照旧被拒，且报中文', async () => {
    const { cardIssues } = await loadState()
    const dictionary = holdCard({
      state: holdCard().state.map((item) => (item.code === '2.4' ? { ...item, type: 'dictionary' } : item)),
    })
    const issues = cardIssues(dictionary)
    expect(issues.length, 'dictionary 应当报错').toBeGreaterThan(0)
    expect(issues.some((issue) => issue.code === '2.4')).toBe(true)
    for (const issue of issues) expect(issue.message).toMatch(CJK)
  })
})

describe('数组 · 值路径（§二）', () => {
  it('pathsOf(容器) 只返回节点码；字段 / .0 都不是值路径', async () => {
    const { pathsOf } = await loadState()
    const state = holdCard().state
    expect(pathsOf(state, '2.4')).toEqual(['2.4'])
    expect(pathsOf(state, '2')).toEqual(['2.1', '2.2', '2.3', '2.4'])
    expect(pathsOf(state, '2.4.1'), '字段不是值路径').toEqual([])
    expect(pathsOf(state, '2.4.2'), '字段不是值路径').toEqual([])
    expect(pathsOf(state, '2.4.0'), '数组没有自身值槽').toEqual([])
    expect(pathsOf(state, '1'), '普通 object 的口径不变').toEqual(['1.1'])
  })

  it('elementOfPath：数组 code 认得出，字段 code / .0 认不出', async () => {
    const { elementOfPath } = await loadState()
    const state = holdCard().state
    expect(elementOfPath(state, '2.4')).toMatchObject({ code: '2.4', type: 'array' })
    expect(elementOfPath(state, '2.4.1')).toBeUndefined()
    expect(elementOfPath(state, '2.4.0')).toBeUndefined()
    expect(elementOfPath(state, '2.1')).toMatchObject({ code: '2.1' })
  })

  it('嵌套数组 / 对象字段的 code 也都不进值路径', async () => {
    const { pathsOf } = await loadState()
    const state = nestedCard().state
    expect(pathsOf(state, '2.4')).toEqual(['2.4'])
    for (const code of ['2.4.1', '2.4.2', '2.4.2.1', '2.4.2.2', '2.4.2.2.1']) {
      expect(pathsOf(state, code), `${code} 是字段，不是值路径`).toEqual([])
    }
  })

  it('reads / writable 收容器 code 与字段 code；2.4.0 与不存在的字段仍是 E_VALIDATION', async () => {
    const { validateCard } = await loadSchema()
    for (const field of ['reads', 'writable']) {
      expect(() => validateCard(cardWithRefs(field, ['2.4'])), `${field} 里的容器 code 合法`).not.toThrow()
      expect(
        () => validateCard(cardWithRefs(field, ['2.4.1'])),
        `${field} 里的字段 code 是权限引用（增补 §一）`,
      ).not.toThrow()
      for (const ref of ['2.4.0', '2.4.2.2.1', '2.4.9']) {
        const error = errorOf(() => validateCard(cardWithRefs(field, [ref])))
        expect(error, `${field} 里的 ${ref} 应当被拒（holdCard 里没有这个字段 / 不是引用）`).not.toBeNull()
        expect(error.code).toBe('E_VALIDATION')
        expect(error.message).toMatch(CJK)
      }
    }
  })

  it('工具由类型派生：覆盖数组 ⇒ 只有 write_state，不派生 advance_time', async () => {
    const { toolsForNode } = await loadSchema()
    const card = holdCard()
    const check = card.chain.find((node) => node.id === 'check')
    expect(toolsForNode(card, check)).toEqual(['write_state'])
    const time = card.chain.find((node) => node.id === 'time')
    expect(toolsForNode(card, time)).toEqual(['advance_time'])
  })
})

describe('数组 · 初始值展开（§1.3）', () => {
  it('initialTreeOf：2.4 是数组本身，没有 2.4.0 / 2.4.1 键', async () => {
    const { initialTreeOf } = await loadState()
    const card = holdCard()
    const tree = initialTreeOf(card)
    expect(tree['2.4']).toEqual(holdItems())
    expect(Object.keys(tree), 'tree 的键只有值路径').not.toContain('2.4.0')
    expect(Object.keys(tree)).not.toContain('2.4.1')
    expect(tree['2.3']).toBe('正常')
  })

  it('initialTreeOf 是深拷贝：改 tree 里的数组 / item 改不到卡', async () => {
    const { initialTreeOf } = await loadState()
    const card = holdCard()
    const tree = initialTreeOf(card)
    tree['2.4'][0]['2.4.1'] = 'MUTATED'
    tree['2.4'].push({ '2.4.1': 'ADDED', '2.4.2': 1 })
    expect(elementOf(card, '2').initial['2.4'][0]['2.4.1']).toBe('短剑')
    expect(elementOf(card, '2').initial['2.4']).toHaveLength(3)
  })

  it('嵌套卡：2.4 的整份值逐字是 nestedItems（对象 / 数组都深拷贝）', async () => {
    const { initialTreeOf } = await loadState()
    const card = nestedCard()
    const tree = initialTreeOf(card)
    expect(tree['2.4']).toEqual([
      {
        '2.4.1': '短剑',
        '2.4.2': {
          '2.4.2.1': '普通',
          '2.4.2.2': [{ '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }],
        },
      },
    ])
    tree['2.4'][0]['2.4.2']['2.4.2.2'][0]['2.4.2.2.2'] = 99
    expect(elementOf(card, '2').initial['2.4'][0]['2.4.2']['2.4.2.2'][0]['2.4.2.2.2']).toBe(2)
  })

  it('深度 5 合法、深度 6 被拦（定义层深度与普通元素同一把尺）', async () => {
    const { validateCard } = await loadSchema()
    const { cardIssues } = await loadState()
    expect(() => validateCard(deepCard()), '2.4.1.1.1 是深度 5，合法').not.toThrow()
    const issues = cardIssues(tooDeepCard())
    expect(issues.length).toBeGreaterThan(0)
    expect(
      issues.some(
        (issue) =>
          issue.code === '2.4.1.1.1.1' || issue.path === '2.4.1.1.1.1' || issue.path?.startsWith('2.4'),
      ),
      `深度 6 应当报一条（实际：${JSON.stringify(issues)}）`,
    ).toBe(true)
    expect(errorOf(() => validateCard(tooDeepCard()))?.code).toBe('E_VALIDATION')
  })

  it('arrayValueFits：最简 / 嵌套 / 空数组都为真；不是数组为假', async () => {
    const { arrayValueFits } = await stateApi()
    const state = holdCard().state
    expect(arrayValueFits(state, '2.4', holdItems())).toBe(true)
    expect(arrayValueFits(state, '2.4', [])).toBe(true)
    expect(arrayValueFits(state, '2.4', null)).toBe(false)
    expect(arrayValueFits(state, '2.4', {})).toBe(false)
    expect(
      arrayValueFits(
        nestedCard().state,
        '2.4',
        nestedCard().state.find((item) => item.code === '2').initial['2.4'],
      ),
    ).toBe(true)
  })
})
