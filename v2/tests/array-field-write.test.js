/**
 * 阶段 3 · 扩充：数组字段的**整列写**（契约增补 §五）。
 *
 * 这一份钉的是引擎那条路（`applyWrite`）：
 *   · 字段引用 `2.4.1` ⇒ 整列替换：长度 = 当前 item 数、只改这一格、不增删 item；
 *   · 长度 / 类型不对 ⇒ `E_VALIDATION`，tree 一个字不动；没授权 ⇒ `E_CHAIN`（先权限后值）；
 *   · **容器写 ⊇ 字段写**：`writable: ['2.4']` 也授权 `2.4.x` 的整列写（反向不成立）；
 *   · 容器 `2.4` 整表写不变（可增删 item），只由容器引用授权（字段引用不授权整表）；
 *   · 嵌套：object 字段里的 `2.4.2.1` 一层列表；穿 array 字段的 `2.4.2.2.1` 按数组层嵌套
 *     （每层长度 = 那一层的当前 item 数）；array 字段本身（`2.4.2.2`）每外层写一份完整嵌套数组。
 *
 * 读字段 / 提示词投影在 `array-field-reads.test.js`；共用夹具在 `support/field-ref-fixtures.js`。
 */
import { describe, expect, it } from 'vitest'
import { holdCard, holdItems, holdSave } from './support/array-fixtures.js'
import { cardWithRefs, twoOuterNestedCard, twoOuterNestedItems } from './support/field-ref-fixtures.js'
import { loadModule } from './support/load.js'

const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

const CJK = /[\u4e00-\u9fff]/

describe('数组字段 · write_state 整列写（增补 §五）', () => {
  /** 一次字段写：卡 / 节点 / 树 / path / value */
  async function write({ card, node, tree, path, value }) {
    const { applyWrite } = await loadEngine()
    return applyWrite({ card, node, tree, path, value })
  }

  it('正控：写 2.4.1 整列落盘、只改这一格、item 数不变、入参 tree 不改', async () => {
    const card = cardWithRefs(holdCard(), { writable: ['2.4.1'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    const next = await write({ card, node, tree, path: '2.4.1', value: ['长弓', '火把', '盾'] })

    expect(next['2.4']).toEqual([
      { id: 'id_1', '2.4.1': '长弓', '2.4.2': 1 },
      { id: 'id_2', '2.4.1': '火把', '2.4.2': 1 },
      { id: 'id_3', '2.4.1': '盾', '2.4.2': 3 },
    ])
    expect(next['2.4']).toHaveLength(3)
    expect(tree['2.4'], '入参 tree 一个字都不许改').toEqual(holdItems())
    expect(Object.keys(next), '不许冒出字段 / .0 键').not.toContain('2.4.1')
    expect(Object.keys(next)).not.toContain('2.4.0')
  })

  it('容器写授权字段写：只有 2.4 也能整列写 2.4.1，item 数 / 兄弟字段不动', async () => {
    const card = cardWithRefs(holdCard(), { writable: ['2.4'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    const next = await write({ card, node, tree, path: '2.4.1', value: ['长弓', '火把', '盾'] })

    expect(next['2.4']).toEqual([
      { id: 'id_1', '2.4.1': '长弓', '2.4.2': 1 },
      { id: 'id_2', '2.4.1': '火把', '2.4.2': 1 },
      { id: 'id_3', '2.4.1': '盾', '2.4.2': 3 },
    ])
    expect(next['2.4']).toHaveLength(3)
    expect(tree['2.4'], '入参 tree 一个字都不许改').toEqual(holdItems())
  })

  it('容器授权字段写仍不能增删 item：长度不对 ⇒ E_VALIDATION，tree 不动', async () => {
    const card = cardWithRefs(holdCard(), { writable: ['2.4'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    for (const value of [['长弓', '火把'], ['长弓', '火把', '盾', '弓'], []]) {
      const failed = await write({ card, node, tree, path: '2.4.1', value }).catch((cause) => cause)
      expect(failed.code, `${JSON.stringify(value)} 应当 E_VALIDATION`).toBe('E_VALIDATION')
      expect(failed.message).toMatch(CJK)
      expect(tree['2.4']).toEqual(holdItems())
    }
  })

  it('长度不对（多 / 少）⇒ E_VALIDATION + 中文，tree 不动', async () => {
    const card = cardWithRefs(holdCard(), { writable: ['2.4.1'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    for (const value of [['长弓', '火把'], ['长弓', '火把', '盾', '弓'], []]) {
      const failed = await write({ card, node, tree, path: '2.4.1', value }).catch((cause) => cause)
      expect(failed.code, `${JSON.stringify(value)} 应当 E_VALIDATION`).toBe('E_VALIDATION')
      expect(failed.message).toMatch(CJK)
      expect(tree['2.4']).toEqual(holdItems())
    }
  })

  it('值 / 元素类型不对 ⇒ E_VALIDATION（不是数组、元素不是文本）', async () => {
    const card = cardWithRefs(holdCard(), { writable: ['2.4.1'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    for (const value of ['短剑', null, { 0: '短剑' }, ['短剑', 7, '银币']]) {
      const failed = await write({ card, node, tree, path: '2.4.1', value }).catch((cause) => cause)
      expect(failed.code, `${JSON.stringify(value)} 应当 E_VALIDATION`).toBe('E_VALIDATION')
      expect(failed.message).toMatch(CJK)
      expect(tree['2.4']).toEqual(holdItems())
    }
  })

  it('没授权 ⇒ E_CHAIN：兄弟字段不授权、output 不行；字段引用不授权整表', async () => {
    const base = holdCard()
    const sibling = cardWithRefs(base, { writable: ['2.4.2'] })
    const tree = holdSave(base).tree
    const cases = [
      ['只有 2.4.2', sibling, sibling.chain.find((n) => n.id === 'check')],
      ['output', base, base.chain.find((n) => n.id === 'output')],
    ]
    for (const [note, card, node] of cases) {
      const failed = await write({ card, node, tree, path: '2.4.1', value: ['A', 'B', 'C'] }).catch(
        (cause) => cause,
      )
      expect(failed.code, `${note}：应当 E_CHAIN`).toBe('E_CHAIN')
      expect(failed.message).toMatch(CJK)
      expect(tree['2.4']).toEqual(holdItems())
    }
  })

  it('错误次序：没授权 + 坏值 ⇒ E_CHAIN；有容器授权 + 坏值 ⇒ E_VALIDATION', async () => {
    const bad = '不是数组'
    const noAuth = cardWithRefs(holdCard(), { writable: ['2.4.2'] })
    const denied = await write({
      card: noAuth,
      node: noAuth.chain.find((item) => item.id === 'check'),
      tree: holdSave(noAuth).tree,
      path: '2.4.1',
      value: bad,
    }).catch((cause) => cause)
    expect(denied.code, '先判权限').toBe('E_CHAIN')

    const authorized = cardWithRefs(holdCard(), { writable: ['2.4'] })
    const failed = await write({
      card: authorized,
      node: authorized.chain.find((item) => item.id === 'check'),
      tree: holdSave(authorized).tree,
      path: '2.4.1',
      value: bad,
    }).catch((cause) => cause)
    expect(failed.code, '权限过了再判值').toBe('E_VALIDATION')
  })

  it('2.4.0 / 2.4.1.0 不是引用 ⇒ E_CHAIN', async () => {
    const card = cardWithRefs(holdCard(), { writable: ['2.4.1'] })
    const node = card.chain.find((item) => item.id === 'check')
    for (const path of ['2.4.0', '2.4.1.0']) {
      const failed = await write({
        card,
        node,
        tree: holdSave(card).tree,
        path,
        value: [],
      }).catch((cause) => cause)
      expect(failed.code, `${path} 应当 E_CHAIN`).toBe('E_CHAIN')
    }
  })

  it('整表写 2.4 不变：可增删 item，但只有字段权限时 path 2.4 ⇒ E_CHAIN', async () => {
    const card = cardWithRefs(holdCard(), { writable: ['2.4'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    const two = [
      { '2.4.1': '长弓', '2.4.2': 7 },
      { '2.4.1': '火把', '2.4.2': 2 },
    ]
    // 新 item 省略 id ⇒ 按旧数组最大 + 1 生成（旧数组是 id_1…id_3）
    const expected = two.map((item, index) => ({ id: 'id_' + (4 + index), ...item }))
    const next = await write({ card, node, tree, path: '2.4', value: two })
    expect(next['2.4']).toEqual(expected)
    const empty = await write({ card, node, tree, path: '2.4', value: [] })
    expect(empty['2.4']).toEqual([])

    const fieldsOnly = cardWithRefs(holdCard(), { writable: ['2.4.1'] })
    const failed = await write({
      card: fieldsOnly,
      node: fieldsOnly.chain.find((item) => item.id === 'check'),
      tree,
      path: '2.4',
      value: two,
    }).catch((cause) => cause)
    expect(failed.code, '字段权限不授权整表替换').toBe('E_CHAIN')
  })

  it('容器写也授权嵌套字段：2.4.2.1 / 穿 array 的 2.4.2.2.1 / array 字段本身', async () => {
    const card = cardWithRefs(twoOuterNestedCard(), { writable: ['2.4'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree

    const nested = await write({ card, node, tree, path: '2.4.2.1', value: ['稀有', '普通'] })
    expect(nested['2.4'][0]['2.4.2']['2.4.2.1']).toBe('稀有')
    expect(nested['2.4'][1]['2.4.2']['2.4.2.1']).toBe('普通')

    const through = await write({
      card,
      node,
      tree,
      path: '2.4.2.2.1',
      value: [['锋利'], ['微光', '余响']],
    })
    expect(through['2.4'][0]['2.4.2']['2.4.2.2'][0]['2.4.2.2.1']).toBe('锋利')
    expect(through['2.4'][1]['2.4.2']['2.4.2.2'][1]['2.4.2.2.1']).toBe('余响')

    const arrayField = await write({
      card,
      node,
      tree,
      path: '2.4.2.2',
      value: [[{ id: 'id_2', '2.4.2.2.1': '初火', '2.4.2.2.2': 3 }], []],
    })
    expect(arrayField['2.4'][0]['2.4.2']['2.4.2.2']).toHaveLength(1)
    expect(arrayField['2.4'][1]['2.4.2']['2.4.2.2']).toEqual([])
  })

  it('object 字段里的 2.4.2.1：整列替换、兄弟字段不动', async () => {
    const card = cardWithRefs(twoOuterNestedCard(), { writable: ['2.4.2.1'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    const next = await write({ card, node, tree, path: '2.4.2.1', value: ['稀有', '普通'] })
    expect(next['2.4'][0]['2.4.2']['2.4.2.1']).toBe('稀有')
    expect(next['2.4'][1]['2.4.2']['2.4.2.1']).toBe('普通')
    expect(
      next['2.4'][1]['2.4.2']['2.4.2.2'].map((item) => item.id),
      '整列写不动嵌套 item 的 id',
    ).toEqual(['id_1', 'id_2'])
    expect(tree['2.4']).toEqual(twoOuterNestedItems())
  })

  it('穿嵌套数组的 2.4.2.2.1：值按数组层嵌套，内层长度各等于当前项数', async () => {
    const card = cardWithRefs(twoOuterNestedCard(), { writable: ['2.4.2.2.1'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    const next = await write({
      card,
      node,
      tree,
      path: '2.4.2.2.1',
      value: [['锋利'], ['微光', '余响']],
    })
    expect(
      next['2.4'][0]['2.4.2']['2.4.2.2'].map((item) => item.id),
      '替换后的嵌套 item 各自带 id',
    ).toEqual(['id_1'])
    expect(new Set(next['2.4'][1]['2.4.2']['2.4.2.2'].map((item) => item.id)).size, '同一层内 id 唯一').toBe(
      2,
    )
    for (const item of next['2.4'][1]['2.4.2']['2.4.2.2'])
      expect(item.id, '每项都要有 id').toMatch(/^id_\d+$/)
    expect(next['2.4']).toHaveLength(2)
  })

  it('穿嵌套数组的字段：层数 / 内层长度不对 ⇒ E_VALIDATION，tree 不动', async () => {
    const card = cardWithRefs(twoOuterNestedCard(), { writable: ['2.4.2.2.1'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    for (const value of [
      ['锋利', '微光', '余响'],
      [['锋利'], ['微光']],
      [
        ['锋利', '多余'],
        ['微光', '余响'],
      ],
      [['锋利']],
    ]) {
      const failed = await write({ card, node, tree, path: '2.4.2.2.1', value }).catch((cause) => cause)
      expect(failed.code, `${JSON.stringify(value)} 应当 E_VALIDATION`).toBe('E_VALIDATION')
      expect(failed.message).toMatch(CJK)
      expect(tree['2.4']).toEqual(twoOuterNestedItems())
    }
  })

  it('array 字段本身（2.4.2.2）：每个外层 item 写一份完整嵌套数组，内层可增删', async () => {
    const card = cardWithRefs(twoOuterNestedCard(), { writable: ['2.4.2.2'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    const next = await write({
      card,
      node,
      tree,
      path: '2.4.2.2',
      value: [
        [
          { id: 'id_2', '2.4.2.2.1': '初火', '2.4.2.2.2': 3 },
          { id: 'id_3', '2.4.2.2.1': '余烬', '2.4.2.2.2': 4 },
        ],
        [],
      ],
    })
    expect(next['2.4'][0]['2.4.2']['2.4.2.2']).toHaveLength(2)
    expect(next['2.4'][1]['2.4.2']['2.4.2.2']).toEqual([])
    expect(next['2.4']).toHaveLength(2)
  })

  it('写字段不增删外层 item：长度固定后 item 的其余字段整体原样', async () => {
    const card = cardWithRefs(holdCard(), { writable: ['2.4.1'] })
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    const next = await write({ card, node, tree, path: '2.4.1', value: ['一', '二', '三'] })
    expect(next['2.4'].map((item) => item['2.4.2'])).toEqual([1, 1, 3])
    expect(next['2.4'].map((item) => item['2.4.1'])).toEqual(['一', '二', '三'])
  })
})
