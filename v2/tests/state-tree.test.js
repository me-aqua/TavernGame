/**
 * 阶段 2.1 · 树值、路径与权限（v5 契约 §2.3 / §4 / §5 / §6.1）。
 *
 * 这一份钉四件事：
 *   1. **扁平树值**：有孩子的节点自身值住 `<code>.0`、孩子用自己的 code、`object` 没有键；
 *      `initialTreeOf(card)` 就是「初始值 → 存档 tree」的那一步；
 *   2. **路径 = 完整 code**：`pathsOf` 给出一个 code 覆盖的所有**值路径**（自身值 + 整棵子树）；
 *      **权限覆盖**走 `refPathsOf`：object / array 元素覆盖后代，**标量元素（哪怕有孩子）只覆盖自己的值**
 *      （`1.1` ⇒ 只有 `1.1.0`，写 `1.1.1` 要 `1` 这种容器 ref 或它自己的 ref）；
 *   3. **`applyWrite` 按类型收值**：文字 / 数字（上下限 + 单次步幅）/ 下拉白名单 / 结构体无自身值；
 *      时间只能走 `advance_time`；
 *   4. **增删孩子**：加孩子不转类型、自身值搬到 `.0`；删节点删整棵子树、同层重排为 `1..n`、
 *      自身值搬回、`reads` / `writable` / 树值跟着映射。
 *
 * 判据只钉这四件事；契约没写的语义不断言。
 */
import { describe, expect, it } from 'vitest'
import { v5Card, v5Save, treeV5 } from './support/state-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

const CJK = /[\u4e00-\u9fff]/

/** 抓一个同步调用抛出的错误（没抛就是 `null`） */
function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 一个时间元素（year-minute 五格 + 模式 + 节日勾选） */
function timeElement() {
  return {
    code: '0',
    name: 'time',
    note: '',
    type: 'time',
    timeMode: 'year-minute',
    initial: { ...treeV5()['0'] },
    holidays: { international: false, china: false, traditional: false },
  }
}

/**
 * 顶层有 0 / 1 / 2 / 3 的卡：用来量「删掉中间那个根」之后的重排。
 * 中间那个根是 `2`，后面的 `3` 应当前移成 `2`，`0` 不动。
 */
function rootsCard() {
  const base = v5Card()
  return v5Card({
    id: 'c-roots',
    state: [
      timeElement(),
      { code: '1', name: 'one', note: '', type: 'text', initial: { 1: 'ONE' } },
      { code: '2', name: 'two', note: '', type: 'text', initial: { 2: 'TWO' } },
      { code: '3', name: 'three', note: '', type: 'text', initial: { 3: 'THREE' } },
    ],
    chain: base.chain.map((node) =>
      node.id === 'check'
        ? { ...node, reads: ['1', '2', '3'], writable: ['1', '2', '3'] }
        : node.id === 'output'
          ? { ...node, reads: ['1'], readsUpstream: ['check'] }
          : node,
    ),
  })
}

/**
 * 两个「有自身值 + 孩子」的兄弟：删 1.1 之后 1.2 变成 1.1，
 * 它的 `.0` 自身值键与 `.0` 读/写引用也要跟着改名。
 */
function nestedSiblingsCard() {
  const base = v5Card()
  return v5Card({
    id: 'c-nested-siblings',
    state: [
      timeElement(),
      {
        code: '1',
        name: 'root',
        note: '',
        type: 'object',
        initial: { '1.1.0': 'A1', '1.1.1': 'A_CHILD', '1.2.0': 'B1', '1.2.1': 'B_CHILD' },
      },
      { code: '1.1', name: 'a', note: '', type: 'enum', values: ['A1', 'A2'] },
      { code: '1.1.1', name: 'a-child', note: '', type: 'text' },
      { code: '1.2', name: 'b', note: '', type: 'enum', values: ['B1', 'B2'] },
      { code: '1.2.1', name: 'b-child', note: '', type: 'text' },
    ],
    chain: base.chain.map((node) =>
      node.id === 'check'
        ? {
            ...node,
            reads: ['1.1.0', '1.1.1', '1.2.0', '1.2.1'],
            writable: ['1.2.0', '1.2.1'],
          }
        : node.id === 'output'
          ? { ...node, reads: [], readsUpstream: ['check'] }
          : node,
    ),
  })
}

/** 一份「兄弟三个、用来量重排」的卡：object 1 下 1.1 / 1.2 / 1.3 三个文字 */
function siblingsCard() {
  return v5Card({
    id: 'c-siblings',
    state: [
      {
        code: '0',
        name: 'time',
        note: '',
        type: 'time',
        timeMode: 'year-minute',
        initial: { ...treeV5()['0'] },
        holidays: { international: false, china: false, traditional: false },
      },
      { code: '1', name: 'root', note: '', type: 'object', initial: { 1.1: 'A', 1.2: 'B', 1.3: 'C' } },
      { code: '1.1', name: 'a', note: '', type: 'text' },
      { code: '1.2', name: 'b', note: '', type: 'text' },
      { code: '1.3', name: 'c', note: '', type: 'text' },
    ],
    chain: [
      {
        id: 'time',
        type: 'time',
        name: 'time',
        reads: [],
        writable: ['0'],
        readsUpstream: [],
        historyTurns: 0,
        prompt: '',
      },
      {
        id: 'check',
        type: 'normal',
        name: 'check',
        reads: ['1.1', '1.3'],
        writable: ['1.1', '1.3'],
        readsUpstream: [],
        historyTurns: 0,
        prompt: '',
      },
      {
        id: 'output',
        type: 'output',
        name: 'output',
        reads: [],
        writable: [],
        readsUpstream: ['check'],
        historyTurns: 3,
        prompt: '',
      },
    ],
  })
}

describe('树值：扁平完整 code（§2.3 / §5）', () => {
  it('initialTreeOf：有孩子的节点用 .0、object 没有键、叶子用自身 code', async () => {
    const { initialTreeOf } = await loadState()
    expect(initialTreeOf(v5Card())).toEqual(treeV5())
    const tree = initialTreeOf(v5Card())
    expect(Object.keys(tree), 'object 1 / 2 / 2.4 不该有键').not.toEqual(
      expect.arrayContaining(['1', '2', '2.4']),
    )
  })

  it('initialTreeOf 不与卡共享引用（时间格是深拷贝）', async () => {
    const { initialTreeOf } = await loadState()
    const card = v5Card()
    const tree = initialTreeOf(card)
    tree['0'].hour = 23
    expect(card.state.find((item) => item.code === '0').initial.hour).toBe(8)
  })

  it('validateSave 要求 tree 覆盖每个值路径（缺 1.1.0 / 把 1.1 当键 / object 自己当键都被拦）', async () => {
    const { validateSave } = await loadSchema()
    const card = v5Card()
    expect(() => validateSave(v5Save(card), card)).not.toThrow()

    const missingOwn = treeV5()
    delete missingOwn['1.1.0']
    expect(errorOf(() => validateSave(v5Save(card, { tree: missingOwn }), card))?.code).toBe('E_VALIDATION')

    const flatCode = treeV5()
    delete flatCode['1.1.0']
    flatCode['1.1'] = 'A1'
    expect(
      errorOf(() => validateSave(v5Save(card, { tree: { ...flatCode, '1.1.1': 'SITE_X' } }), card))?.code,
    ).toBe('E_VALIDATION')

    const objectKey = treeV5()
    objectKey['2'] = {}
    expect(errorOf(() => validateSave(v5Save(card, { tree: objectKey }), card))?.code).toBe('E_VALIDATION')
  })

  it('validateSave 拒旧的时间形状（{day,hour}）', async () => {
    const { validateSave } = await loadSchema()
    // 不传 card：只量存档自身那一半（时间值必须是公历六格）—— 与 tree 覆盖无关，判据能单独翻面
    const tree = { ...treeV5(), 0: { day: 1, hour: 8 } }
    const error = errorOf(() => validateSave({ ...v5Save(v5Card(), { tree }) }))
    expect(error?.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })

  it('validateSave 拒日历非法的时间（2024-02-31）', async () => {
    const { validateSave } = await loadSchema()
    const tree = {
      ...treeV5(),
      0: { year: 2024, month: 2, day: 31, hour: 8, minute: 0 },
    }
    const error = errorOf(() => validateSave({ ...v5Save(v5Card(), { tree }) }))
    expect(error, '2024-02-31 不存在，必须被拒').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })
})

describe('路径与权限：code 覆盖自身值 + 整棵子树（§4）', () => {
  it('pathsOf：父亲 = 自身值 + 所有孩子；object 只有孩子；叶子只有自己', async () => {
    const { pathsOf } = await loadState()
    const state = v5Card().state
    expect(pathsOf(state, '1.1')).toEqual(['1.1.0', '1.1.1'])
    expect(pathsOf(state, '1')).toEqual(['1.1.0', '1.1.1', '1.2'])
    expect(pathsOf(state, '2')).toEqual(['2.1', '2.2', '2.3', '2.4.1'])
    expect(pathsOf(state, '2.4')).toEqual(['2.4.1'])
    expect(pathsOf(state, '2.1')).toEqual(['2.1'])
    expect(pathsOf(state, '0')).toEqual(['0'])
  })

  it('codeDepth：`.0` 不计入可见深度（§1）', async () => {
    const { codeDepth } = await loadState()
    expect(codeDepth('0')).toBe(1)
    expect(codeDepth('1.1.1')).toBe(3)
    expect(codeDepth('1.1.0')).toBe(2)
    expect(codeDepth('1.1.1.1.1')).toBe(5)
  })
})

describe('applyWrite：按元素类型收值（§2 / §4）', () => {
  /** 用 v5 卡与 `check` 节点写一次（同步 API，错误同步抛） */
  async function write(path, value, tree = treeV5()) {
    const { applyWrite } = await loadEngine()
    const card = v5Card()
    return applyWrite({ card, node: card.chain[1], tree, path, value })
  }

  /** 同上，但要拿到错误（没抛就是 null） */
  async function writeError(path, value, tree = treeV5()) {
    const { applyWrite } = await loadEngine()
    const card = v5Card()
    return errorOf(() => applyWrite({ card, node: card.chain[1], tree, path, value }))
  }

  it('文字 / 子孙路径都能写，返回新 tree，入参一个字不改', async () => {
    const tree = treeV5()
    const before = JSON.parse(JSON.stringify(tree))
    const next = await write('2.1', 'MAGE', tree)
    expect(next['2.1']).toBe('MAGE')
    expect((await write('1.1.0', 'A2'))['1.1.0']).toBe('A2')

    // 子孙路径要由 **object 容器** ref 授权：`1` 覆盖整棵子树，所以 `1.1.1` 可写
    const { applyWrite } = await loadEngine()
    const card = cardWithWritable(['1'])
    const descendant = applyWrite({ card, node: card.chain[1], tree, path: '1.1.1', value: 'SITE_Z' })
    expect(descendant['1.1.1']).toBe('SITE_Z')
    expect(descendant['1.1.0'], '写孩子不动父亲的自身值').toBe('A1')

    expect(tree, '入参 tree 一个字都不许改').toEqual(before)
    expect(next).not.toBe(tree)
  })

  /** 把 `check` 的 writable 换成给定清单（`.0` 引用；卡本身合法性由 state-shape 那份判据钉） */
  function cardWithWritable(writable) {
    const card = v5Card()
    card.chain[1] = { ...card.chain[1], writable }
    return card
  }

  /** 用指定的 writable 清单写一次（同步 API） */
  async function writeWith(writable, path, value) {
    const { applyWrite } = await loadEngine()
    const card = cardWithWritable(writable)
    return errorOf(() => applyWrite({ card, node: card.chain[1], tree: treeV5(), path, value }))
  }

  it('writable 里是 1.1.0 ⇒ 能写自己的值，但不能写孩子 1.1.1', async () => {
    const { applyWrite } = await loadEngine()
    const card = cardWithWritable(['1.1.0'])
    const next = applyWrite({ card, node: card.chain[1], tree: treeV5(), path: '1.1.0', value: 'A2' })
    expect(next['1.1.0'], '自身值要能写').toBe('A2')
    expect(next['1.1.1'], '写自身值不动孩子').toBe('SITE_X')

    const error = await writeWith(['1.1.0'], '1.1.1', 'CHILD_WRITE')
    expect(error, '只有 .0 权限时不许写孩子').not.toBeNull()
    expect(error.code).toBe('E_CHAIN')
    expect(error.message).toMatch(CJK)
  })

  it('writable 里是标量 code 1.1 ⇒ 只能写自己的值 1.1.0；写孩子 1.1.1 是 E_CHAIN', async () => {
    const { applyWrite } = await loadEngine()
    const card = cardWithWritable(['1.1'])
    const own = applyWrite({ card, node: card.chain[1], tree: treeV5(), path: '1.1.0', value: 'A2' })
    expect(own['1.1.0']).toBe('A2')
    expect(own['1.1.1'], '写自己的值不动孩子').toBe('SITE_X')

    const error = await writeWith(['1.1'], '1.1.1', 'SITE_Z')
    expect(error, '标量父 code 不授权孩子').not.toBeNull()
    expect(error.code).toBe('E_CHAIN')
    expect(error.message).toMatch(CJK)

    // 对照：同一格由 **object 容器** `1` 授权时可写（规则是「容器覆盖」，不是「孩子永远不能写」）
    const containerCard = cardWithWritable(['1'])
    const child = applyWrite({
      card: containerCard,
      node: containerCard.chain[1],
      tree: treeV5(),
      path: '1.1.1',
      value: 'SITE_Z',
    })
    expect(child['1.1.1']).toBe('SITE_Z')
  })

  it('下拉：值必须在 values 里（父亲自身值走 .0）', async () => {
    expect((await write('1.1.0', 'A2'))['1.1.0']).toBe('A2')
    expect((await write('2.3', 'HURT'))['2.3']).toBe('HURT')
    for (const bad of ['A9', 3]) {
      const error = await writeError('1.1.0', bad)
      expect(error?.code, `写 ${bad} 应当被拒`).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
    }
  })

  it('整数：上下限 + 单次步幅；只收安全整数', async () => {
    expect((await write('2.2', 85))['2.2']).toBe(85) // 步幅 5（1..10）
    expect((await write('2.2', 90))['2.2']).toBe(90) // 步幅 10（上界）
    for (const [bad, note] of [
      [91, '步幅 11 > stepMax'],
      [95, '步幅 15 > stepMax'],
      [101, '超上限'],
      [85.5, '不是整数'],
      ['abc', '不是数字字符串'],
      [80, '步幅 0 < stepMin'],
    ]) {
      const error = await writeError('2.2', bad)
      expect(error?.code, `${note} 应当被拒`).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
    }
  })

  it('数字字符串 "85" 也收：落成数字 85（模型可能把 JSON 数字写成字符串）', async () => {
    const next = await write('2.2', '85')
    expect(next['2.2']).toBe(85)
    expect(typeof next['2.2']).toBe('number')
  })

  it('整数缺省上下限 -1e9 / 1e9、缺省步幅 0 / 1e9', async () => {
    const loose = v5Card({
      state: v5Card().state.map((item) =>
        item.code === '2.2' ? { code: '2.2', name: 'n', note: '', type: 'integer', initial: 0 } : item,
      ),
    })
    const { applyWrite } = await loadEngine()
    const tree = { ...treeV5(), 2.2: 0 }
    const next = applyWrite({ card: loose, node: loose.chain[1], tree, path: '2.2', value: 1e9 })
    expect(next['2.2']).toBe(1e9)
    const error = errorOf(() =>
      applyWrite({ card: loose, node: loose.chain[1], tree, path: '2.2', value: 1e9 + 1 }),
    )
    expect(error?.code).toBe('E_VALIDATION')
  })

  it('结构体没有自身值：写 2.4 或 2.4.0 被拒', async () => {
    for (const path of ['2.4', '2.4.0']) {
      const error = await writeError(path, 'X')
      expect(error, `${path} 应当被拒`).not.toBeNull()
      expect(['E_VALIDATION', 'E_CHAIN']).toContain(error.code)
      expect(error.message).toMatch(CJK)
    }
  })

  it('没有权限 / 路径不存在 / 时间 / 父 code 本身 ⇒ E_CHAIN（时间只能走 advance_time）', async () => {
    for (const [path, value, note] of [
      ['1.2', 'X', '1.2 不在 writable'],
      ['9', 'X', '路径不存在'],
      ['0', 'X', '时间元素'],
      ['1.1', 'X', '有孩子的父 code 不是值路径（自身值走 1.1.0）'],
    ]) {
      const error = await writeError(path, value)
      expect(error?.code, `${note} 应当是 E_CHAIN`).toBe('E_CHAIN')
      expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
    }
  })
})
describe('增删孩子与删除节点（§2.3 · 2.2：值住在根 initial）', () => {
  /** 某个根元素 initial 里的一条值 */
  function valueAt(card, path) {
    const rootCode = path.includes('.') ? path.slice(0, path.indexOf('.')) : path
    return card.state.find((item) => item.code === rootCode).initial[path]
  }

  it('给标量叶子加孩子：类型不变，自身值搬到根 initial 的 .0，新孩子 .1 是文字', async () => {
    const { addChild } = await loadState()
    const card = v5Card()
    const next = addChild(card, '1.2')
    expect(valueAt(next, '1.2.0'), '自身值搬到 .0').toBe('MOOD_Y')
    expect(valueAt(next, '1.2.1'), '新孩子').toBe('')
    expect(valueAt(next, '1.2'), '旧键不在了').toBeUndefined()
    const parent = next.state.find((item) => item.code === '1.2')
    expect(parent.type, '不自动转 object').toBe('text')
    expect(parent, '子元素身上不许有 initial').not.toHaveProperty('initial')
    const child = next.state.find((item) => item.code === '1.2.1')
    expect(child).toMatchObject({ type: 'text' })
    expect(child).not.toHaveProperty('initial')
    expect(child.name, '新孩子要有名字').toBeTruthy()
    expect(
      card.state.some((item) => item.code === '1.2.1'),
      '入参卡不改',
    ).toBe(false)
  })

  it('已有孩子再加一个：用下一个空位，不重复搬 .0', async () => {
    const { addChild } = await loadState()
    const next = addChild(v5Card(), '1.1')
    expect(valueAt(next, '1.1.0'), '自身值还在 .0').toBe('A1')
    expect(valueAt(next, '1.1.2'), '下一个空位是 .2').toBe('')
    expect(next.state.filter((item) => item.code.startsWith('1.1.')).map((item) => item.code)).toEqual(
      expect.arrayContaining(['1.1.1', '1.1.2']),
    )
  })

  it('给 object 加孩子：不产生 .0（object 没有自身值）', async () => {
    const { addChild } = await loadState()
    const next = addChild(v5Card(), '2')
    expect(valueAt(next, '2.0')).toBeUndefined()
    expect(valueAt(next, '2.5')).toBe('')
  })

  it('时间不能加孩子；不存在的 code 也被拒', async () => {
    const { addChild } = await loadState()
    for (const code of ['0', '9']) {
      const error = errorOf(() => addChild(v5Card(), code))
      expect(error?.code, `${code} 加孩子应当被拒`).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
    }
  })

  it('删叶子：根 initial 的键与链引用一起摘掉', async () => {
    const { removeNode } = await loadState()
    const card = v5Card()
    const next = removeNode(card, '1.2')
    expect(next.state.some((item) => item.code === '1.2')).toBe(false)
    expect(valueAt(next, '1.2')).toBeUndefined()
    expect(next.chain[1].reads, '1.2 的读引用要摘掉').not.toContain('1.2')
  })

  it('删掉唯一孩子：自身值从 .0 搬回父 code', async () => {
    const { removeNode } = await loadState()
    const next = removeNode(v5Card(), '1.1.1')
    expect(next.state.some((item) => item.code === '1.1.1')).toBe(false)
    expect(valueAt(next, '1.1'), '自身值搬回 1.1').toBe('A1')
    expect(valueAt(next, '1.1.0')).toBeUndefined()
  })

  it('节点失去最后一个孩子：.0 读写引用收成父 code（根 initial 里已经没有 .0 路径）', async () => {
    const { removeNode } = await loadState()
    const card = v5Card()
    card.chain[1] = {
      ...card.chain[1],
      reads: ['1.1.0', '1.1.1'],
      writable: ['1.1.0', '1.1.1'],
    }

    const next = removeNode(card, '1.1.1')
    expect(valueAt(next, '1.1'), '自身值搬到父 code').toBe('A1')
    expect(valueAt(next, '1.1.0'), '.0 路径已经不存在').toBeUndefined()
    expect(next.chain[1].reads, '.0 引用要收成父 code').toEqual(['1.1'])
    expect(next.chain[1].writable, '.0 引用要收成父 code').toEqual(['1.1'])
  })

  it('删掉 object 的最后一个孩子：草稿允许；保存时被拦（object 必须有孩子）', async () => {
    const { removeNode, cardIssues } = await loadState()
    const { validateCard } = await loadSchema()
    const next = removeNode(v5Card(), '2.4.1')
    expect(next.state.some((item) => item.code === '2.4.1')).toBe(false)
    expect(
      next.state.some((item) => item.code === '2.4'),
      'object 本身要留着',
    ).toBe(true)
    expect(valueAt(next, '2.4.1')).toBeUndefined()
    const issues = cardIssues(next)
    expect(
      issues.some((issue) => issue.code === '2.4' || issue.path === '2.4'),
      '空 object 要出现在问题清单里',
    ).toBe(true)
    expect(errorOf(() => validateCard(next))?.code).toBe('E_VALIDATION')
  })

  it('删顶层中间元素：0 不动、后面的根重排为 1..n，根 initial 与 reads/writable 跟着映射', async () => {
    const { removeNode } = await loadState()
    const { validateCard } = await loadSchema()
    const next = removeNode(rootsCard(), '2')
    expect(next.state.map((item) => item.code)).toEqual(['0', '1', '2'])
    expect(valueAt(next, '1'), 'ONE 不动').toBe('ONE')
    expect(valueAt(next, '2'), '原来的 3 前移成 2').toBe('THREE')
    expect(next.chain[1].reads, 'reads 跟着映射').toEqual(['1', '2'])
    expect(next.chain[1].writable, 'writable 跟着映射').toEqual(['1', '2'])
    for (const code of next.state.map((item) => item.code)) {
      expect(code, `根编号必须仍是数字 code，不许出现 .1 / .-1：${code}`).toMatch(/^\d+(\.\d+)*$/)
    }
    expect(() => validateCard(next), '删完之后的卡必须仍然合法（不楔死）').not.toThrow()

    // 再删刚刚前移的根（原 3）也不许楔死
    const again = removeNode(next, '2')
    expect(again.state.map((item) => item.code)).toEqual(['0', '1'])
    expect(valueAt(again, '1')).toBe('ONE')
  })

  it('删兄弟里的 1.1 ⇒ 旧 1.2 变 1.1；根 initial 的 .0 键与 .0 引用一起映射', async () => {
    const { removeNode } = await loadState()
    const next = removeNode(nestedSiblingsCard(), '1.1')
    expect(next.state.map((item) => item.code)).toEqual(['0', '1', '1.1', '1.1.1'])
    const root = next.state.find((item) => item.code === '1')
    expect(root.initial, '.0 与孩子键都要跟着改名').toEqual({ '1.1.0': 'B1', '1.1.1': 'B_CHILD' })
    expect(next.chain[1].reads, 'reads 里的 .0 引用跟着映射').toEqual(['1.1.0', '1.1.1'])
    expect(next.chain[1].writable, 'writable 里的 .0 引用跟着映射').toEqual(['1.1.0', '1.1.1'])
  })

  it('删中间的孩子：同层重排为 1..n，根 initial 与 reads/writable 跟着映射', async () => {
    const { removeNode } = await loadState()
    const next = removeNode(siblingsCard(), '1.2')
    const codes = next.state.map((item) => item.code)
    expect(codes).toContain('1.2')
    expect(codes).not.toContain('1.3')
    expect(valueAt(next, '1.2'), '旧 1.3 的值挪到 1.2').toBe('C')
    expect(valueAt(next, '1.3')).toBeUndefined()
    expect(next.chain[1].reads, 'reads 跟着映射').toEqual(['1.1', '1.2'])
    expect(next.chain[1].writable, 'writable 跟着映射').toEqual(['1.1', '1.2'])
  })

  it('删 object 节点：整棵子树一起走；时间 0 删不得', async () => {
    const { removeNode } = await loadState()
    const next = removeNode(v5Card(), '2')
    expect(next.state.some((item) => item.code.startsWith('2'))).toBe(false)
    // 根 initial 里也不许剩下 2.x 的键（根元素都没了，它的表一起走）
    const keys = next.state.flatMap((item) =>
      item.initial && typeof item.initial === 'object' ? Object.keys(item.initial) : [],
    )
    for (const gone of ['2.1', '2.2', '2.3', '2.4.1']) expect(keys).not.toContain(gone)
    const error = errorOf(() => removeNode(v5Card(), '0'))
    expect(error?.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })
})
