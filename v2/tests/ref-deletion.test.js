/**
 * 阶段 4 · 删除被引用的 item / 源数组（引用契约 §8.3 · 验收 11 / 11b / 20）。
 *
 * 删除**不是一律禁止**，按「删完引用还合不合法」判：
 *   1. 找出所有指向该 item 的引用；
 *   2. 模拟删除后的引用值（单引用 ⇒ `null`，多引用 ⇒ 从列表里去掉该 id）；
 *   3. 只要有一个引用会 `< min` 或形状不合法 ⇒ **整笔拒绝**，点名引用元素；
 *   4. 全部仍合法 ⇒ 允许，但必须显式级联清引用（**不静默清**）；
 *   5. 没有任何引用 ⇒ 直接删。
 *
 * 这一份走两条现有入口：**整表写入**（`applyWrite`，模型那条路）与**删除整个源数组元素**
 * （`removeNode`，编辑器那条路）。⚠️ 契约没点名函数：单条 item 的「删除 + 确认」没有数据层入口
 * （`ArrayValue.vue` 是把新数组整份 commit 出去），所以这里只钉模型写与整元素删除两半。
 */
import { describe, expect, it } from 'vitest'
import {
  bagItems,
  itemRefChildCard,
  refChildRefCard,
  scalarChildRefCard,
  nestedArrayRefCard,
  objectFieldRefCard,
  element,
  buffDefs,
  chars,
  elementOf,
  nodeOf,
  patchElement,
  refCard,
  treeOf,
  withElement,
  withInitialValue,
} from './support/ref-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

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

/** 错误里能点名的几格（message + detail） */
function textOf(error) {
  return `${error?.message ?? ''} ${JSON.stringify(error?.detail ?? {})}`
}

/** 模型整表写一个数组（`1.4` / `1.5` / `2.4` / `2.6` / 引用自身）；成功返回新 tree */
async function write(card, path, value, tree = treeOf(card)) {
  const { applyWrite } = await loadEngine()
  return applyWrite({ card, node: nodeOf(card, 'check'), tree, path, value })
}

/** 同上，但期望被拒；返回抛出来的错误（没抛 ⇒ null） */
async function writeError(card, path, value, tree = treeOf(card)) {
  const { applyWrite } = await loadEngine()
  try {
    applyWrite({ card, node: nodeOf(card, 'check'), tree, path, value })
    return null
  } catch (cause) {
    return cause
  }
}

/** 期望整表写入被拒：E_VALIDATION + 中文 + 点名引用元素 */
async function expectWriteReject(card, path, value, refCode, note) {
  const tree = treeOf(card)
  const error = await writeError(card, path, value, tree)
  expect(error, `${note}：应当被拒`).not.toBeNull()
  expect(error.code, `${note}：删除引起的非法值仍是 E_VALIDATION`).toBe('E_VALIDATION')
  expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
  expect(textOf(error), `${note}：报文要点名引用元素 ${refCode}`).toContain(refCode)
  return { error, tree }
}

describe('删除 · 模型整表写入不静默清引用（§8.3 / 验收 11b）', () => {
  it('0..1 单引用：删掉被引用的 item、又没写引用 ⇒ E_VALIDATION，引用值原样留着', async () => {
    const card = refCard()
    const { tree } = await expectWriteReject(
      card,
      '2.4',
      bagItems().filter((item) => item.id !== 'id_1'),
      '2.5',
      '删掉主手指着的短剑',
    )
    expect(tree['2.5'], '不许静默清引用').toBe('id_1')
    expect(tree['2.4']).toEqual(bagItems())
  })

  it('1..1 单引用：清成 null 也不行（低于 min）⇒ 两笔都拒', async () => {
    const card = refCard()
    const cleared = await writeError(card, '2.6', [{ id: 'id_1', '2.6.1': null, '2.6.2': '轻' }])
    expect(cleared, '2.6.1 是 1..1，清成 null 非法').not.toBeNull()
    expect(cleared.code).toBe('E_VALIDATION')
    expect(cleared.message).toMatch(CJK)

    const { error } = await expectWriteReject(
      card,
      '1.4',
      buffDefs().filter((item) => item.id !== 'id_1'),
      '2.6',
      '删掉 2.6.1 指着的增益定义',
    )
    expect(textOf(error)).toMatch(/2\.6(\.1)?/)
  })

  it('多引用：只删一条、没同步改 3.2 ⇒ 拒（悬空 id）', async () => {
    const card = refCard()
    const { error, tree } = await expectWriteReject(
      card,
      '1.5',
      chars().filter((item) => item.id !== 'id_1'),
      '3.2',
      '删掉队伍里的艾琳',
    )
    expect(tree['3.2']).toEqual(['id_1', 'id_2'])
    expect(error.code).toBe('E_VALIDATION')
  })
})

describe('删除 · 全部仍合法 ⇒ 显式级联清引用（§8.3 / 验收 11）', () => {
  it('0..1：先把 2.5 写 null，再删短剑 ⇒ 接受，结果合法', async () => {
    const { saveTreeIssues } = await loadState()
    const card = refCard()
    const tree = treeOf(card)
    const cleared = await write(card, '2.5', null, tree)
    const next = await write(
      card,
      '2.4',
      bagItems().filter((item) => item.id !== 'id_1'),
      cleared,
    )
    expect(next['2.5']).toBeNull()
    expect(next['2.4']).toHaveLength(2)
    expect(saveTreeIssues(card, next), '级联完的树应当合法').toEqual([])
  })

  it('多引用 2..4：当前 3 人，删 1 人 + 同步写 2 人（仍 ≥ min）⇒ 接受', async () => {
    const { saveTreeIssues } = await loadState()
    const card = withInitialValue(refCard(), '3.2', ['id_1', 'id_2', 'id_3'])
    const tree = treeOf(card)
    const shrunk = await write(card, '3.2', ['id_1', 'id_2'], tree)
    const next = await write(card, '1.5', chars().slice(0, 2), shrunk)
    expect(next['3.2']).toEqual(['id_1', 'id_2'])
    expect(next['1.5'], '角色数组只剩前两条').toHaveLength(2)
    expect(saveTreeIssues(card, next)).toEqual([])
  })

  it('多引用 2..4：当前 2 人，删 1 人后只剩 1 人（< min）⇒ 拒绝', async () => {
    const { saveTreeIssues } = await loadState()
    const card = refCard()
    const tooFew = await writeError(card, '3.2', ['id_2'])
    expect(tooFew, '写 1 条（< min = 2）应当被拒').not.toBeNull()
    expect(tooFew.code).toBe('E_VALIDATION')
    expect(saveTreeIssues(card, { ...treeOf(card), 3.2: ['id_2'] })).not.toHaveLength(0)
  })
})

describe('删除 · 删除整个源数组元素（§8.3 第五条）', () => {
  it('有引用 ⇒ 一律拒绝；min ≥ 1 的引用点名（3.2 是 2..4）', async () => {
    const { removeNode } = await loadState()
    const error = errorOf(() => removeNode(refCard(), '1.5'))
    expect(error, '删整个源数组前要判引用').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(textOf(error), '报文要点名 3.2').toContain('3.2')
  })

  it('min = 0 / 值可空也**不许**删：refSource 永不许悬空（2026-11-28 裁决）', async () => {
    const { removeNode } = await loadState()
    for (const [note, card] of [
      ['3.2 改 min = 0（值可以清成 null）', patchElement(refCard(), '3.2', { min: 0 })],
      ['3.2 当前值就是 null', withInitialValue(patchElement(refCard(), '3.2', { min: 0 }), '3.2', null)],
    ]) {
      const error = errorOf(() => removeNode(card, '1.5'))
      expect(error, `${note}：源数组仍被引用，删它必须被拒`).not.toBeNull()
      expect(error.code).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
      expect(textOf(error), `${note}：报文要点名 3.2`).toContain('3.2')
    }
  })

  it('没有任何引用 ⇒ 直接删（正控：不需要级联）', async () => {
    const { removeNode, cardIssues } = await loadState()
    // 用「最后一个孩子」当靶子：删中间的兄弟会把后面的 code 前移，读不出「删没删掉」
    const card = withInitialValue(
      withElement(refCard(), element('1.6', 'text', { name: '备注' })),
      '1.6',
      'X',
    )
    const next = removeNode(card, '1.6')
    expect(
      next.state.some((item) => item.code === '1.6'),
      '没有引用指向它的元素应当直接删',
    ).toBe(false)
    expect(next.state.find((item) => item.code === '1').initial['1.6']).toBeUndefined()
    expect(cardIssues(next)).toEqual([])
    expect(elementOf(card, '1.6'), '入参卡不动').toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 复审缺口（2026-11-28 复审）：跨根 item 引用必须在**删除那一刻**就拦；
// 重排兄弟时 ref 定义（源 / 投影字段 / 筛选字段）要跟着改。
// ---------------------------------------------------------------------------

/**
 * 一次「删源 item」的计划：找出所有直接指向它的引用，再算删完要写回什么 / 谁挡着。
 *
 * 要求：`valueOf` 必须用**真实的逐根 initial 查表**（`initialItemsOf`：按 code 找它所属根，
 * 只读那一张表），**不能**用摊平成一棵的 `treeOf` —— 摊平之后「只从某一个根取 item」这种
 * 单根接线 bug 会照样通过，判据就抓不到它（复审要求）。
 */
async function deletePlanOf(card, sourceCode, id) {
  const { refUsesOf, cascadeOf, initialItemsOf } = await loadModule(
    'components/ref-support.ts',
    () => import('../src/components/ref-support.ts'),
  )
  const uses = refUsesOf(card.state, sourceCode, (path) => initialItemsOf(card.state, path))
  return { uses, ...cascadeOf(uses, id) }
}

describe('删除 · 跨根 item 引用在删除那一刻就要拦（复审缺口 a）', () => {
  it('1.4 的 item 被**另一个根**的 2.6.1（1..1）指着 ⇒ 删除计划里直接 blocked，不会被静默删掉', async () => {
    const card = refCard()
    const { uses, changes, blocked } = await deletePlanOf(card, '1.4', 'id_1')
    expect(
      uses.map((use) => use.element.code),
      '跨根的 item 级引用也要被找出来（2.6.1 在根 2 里）',
    ).toContain('2.6.1')
    expect(
      blocked.map((use) => use.element.code),
      '会低于 min ⇒ 整笔删除被拒并点名 2.6.1',
    ).toEqual(['2.6.1'])
    expect(changes, '被拒时不给任何写回计划（不允许先悄悄改了再在保存时炸）').toEqual([])
  })

  it('另一个根的 3.2（2..4，指向 1.5）：删到低于 min ⇒ blocked；没被指着的 id 不产生写回', async () => {
    const card = refCard()
    const atMin = await deletePlanOf(card, '1.5', 'id_1')
    expect(
      atMin.blocked.map((use) => use.element.code),
      '删到只剩 1 条 < min 2 ⇒ 拒绝',
    ).toEqual(['3.2'])
    expect(atMin.changes).toEqual([])

    const untouched = await deletePlanOf(card, '1.5', 'id_3')
    expect(
      untouched.uses.map((use) => use.element.code),
      '3.2 只指向 id_1 / id_2',
    ).toContain('3.2')
    expect(untouched.changes, '删没被指着的 item 不该动引用').toEqual([])
    expect(untouched.blocked, '也不该被拦').toEqual([])
  })

  it('跨根的可空单引用：删被指着的 item ⇒ 给出「清成 null」的写回计划（确认后才写）', async () => {
    // 把 1.4 的引用改成可空：2.6.1 是 item 级引用（删源 item 一律显式阻断），
    // 所以这里用顶层可空单引用 2.5 → 2.4 验证「可空 ⇒ 给 changes」这一半
    const card = refCard()
    const { changes, blocked } = await deletePlanOf(card, '2.4', 'id_1')
    expect(blocked, '2.5 是 0..1 ⇒ 不拦').toEqual([])
    expect(changes, '要写回的计划里包含把 2.5 清成 null').toEqual([{ path: '2.5', value: null }])
  })

  it('不误伤：删 2.4 的 item 不会把另一个根的 2.6.1 算进来', async () => {
    const card = refCard()
    const { uses } = await deletePlanOf(card, '2.4', 'id_1')
    expect(uses.map((use) => use.element.code)).not.toContain('2.6.1')
  })
})

describe('删除 · 重排兄弟时 ref 定义跟着改（复审缺口 b）', () => {
  it('删 1.3（在被引用的 1.4 / 1.5 前面）⇒ refSource / refFields 全跟着改，卡仍合法', async () => {
    const { removeNode, cardIssues } = await loadState()
    const card = refCard()
    const next = removeNode(card, '1.3')
    const buff = elementOf(next, '2.6.1')
    expect(buff.refSource, '1.4 前移成 1.3 ⇒ 源跟着改').toBe('1.3')
    expect(buff.refFields, '投影字段跟着改').toEqual(['1.3.1', '1.3.2'])
    const party = elementOf(next, '3.2')
    expect(party.refSource, '1.5 前移成 1.4 ⇒ 另一个根上的引用也跟着改').toBe('1.4')
    expect(party.refFields).toEqual(['1.4.1'])
    // 值表也按同一张映射表搬：根 1 的两张表改名，item 的字段键跟着改
    const rootOne = next.state.find((item) => item.code === '1').initial
    expect(Object.keys(rootOne).sort(), '1.4 → 1.3、1.5 → 1.4').toEqual(['1.1', '1.2', '1.3', '1.4'])
    expect(rootOne['1.3'][0], 'item 的字段键跟着 1.4.x → 1.3.x').toEqual({
      id: 'id_1',
      '1.3.1': '微醺',
      '1.3.2': '脚步有点飘',
    })
    expect(cardIssues(next), '改名后的卡应当仍然合法（引用都还指着存在的数组）').toEqual([])
    expect(elementOf(card, '2.6.1').refSource, '入参卡不动').toBe('1.4')
  })

  it('删被投影的字段 1.4.1 ⇒ 拒绝并点名 2.6.1', async () => {
    const { removeNode } = await loadState()
    const error = errorOf(() => removeNode(refCard(), '1.4.1'))
    expect(error, '删被投影的字段要拒绝').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(textOf(error), '报文要点名引用元素 2.6.1').toContain('2.6.1')
  })

  it('删被当作筛选字段的 2.4.3 ⇒ 拒绝并点名 2.5', async () => {
    const { removeNode } = await loadState()
    const error = errorOf(() => removeNode(refCard(), '2.4.3'))
    expect(error).not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(textOf(error), '报文要点名 2.5').toContain('2.5')
  })

  it('删筛选字段**前面的**兄弟 2.4.2 ⇒ 允许，refFilter.field 跟着 2.4.3 → 2.4.2', async () => {
    const { removeNode, cardIssues } = await loadState()
    const next = removeNode(refCard(), '2.4.2')
    expect(elementOf(next, '2.5').refFilter, '筛选字段跟着重排').toEqual({ field: '2.4.2', value: '是' })
    expect(elementOf(next, '2.5').refFields, '投影字段 2.4.1 不动').toEqual(['2.4.1'])
    const items = next.state.find((item) => item.code === '2').initial['2.4']
    expect(items[0], 'item 的字段键也跟着重排（数量列消失、可手持前移）').toEqual({
      id: 'id_1',
      '2.4.1': '短剑',
      '2.4.2': '是',
    })
    expect(cardIssues(next)).toEqual([])
  })

  it('删被引用的源数组本身 ⇒ 拒绝并点名引用（1.4 → 2.6.1，2.4 → 2.5）', async () => {
    const { removeNode } = await loadState()
    const buff = errorOf(() => removeNode(refCard(), '1.4'))
    expect(buff).not.toBeNull()
    expect(buff.code).toBe('E_VALIDATION')
    expect(textOf(buff), '点名 2.6.1').toContain('2.6.1')
    const bag = errorOf(() => removeNode(refCard(), '2.4'))
    expect(bag).not.toBeNull()
    expect(bag.code).toBe('E_VALIDATION')
    expect(textOf(bag), '点名直接引用 2.4 的元素').toMatch(/2\.5|2\.7/)
  })
})

describe('删除 · 穿过嵌套数组 / 更深的对象字段找到引用（2026-11-28 重开）', () => {
  it('嵌套数组 item 里的引用（2.4.4.2）也要被找到：min = 1 ⇒ 删除计划 blocked', async () => {
    const card = patchElement(nestedArrayRefCard(), '2.4.4.2', { min: 1 })
    const { uses, blocked, changes } = await deletePlanOf(card, '1.4', 'id_1')
    expect(
      uses.map((use) => use.element.code),
      '要穿过 2.4.4 的内层 item 找到 2.4.4.2',
    ).toContain('2.4.4.2')
    expect(
      blocked.map((use) => use.element.code),
      'min = 1 ⇒ 整笔删除被拒并点名',
    ).toContain('2.4.4.2')
    expect(changes, '被拒时不写回').toEqual([])
  })

  it('数组 item 的对象字段里的引用（2.4.4.1）也要被找到', async () => {
    const card = patchElement(objectFieldRefCard(), '2.4.4.1', { min: 1 })
    const { uses, blocked } = await deletePlanOf(card, '1.4', 'id_1')
    expect(
      uses.map((use) => use.element.code),
      '要穿过对象字段找到 2.4.4.1',
    ).toContain('2.4.4.1')
    expect(blocked.map((use) => use.element.code)).toContain('2.4.4.1')
  })

  it('item 级引用带子元素（2.6.1.0 指针）也要被找到 ⇒ 删除计划 blocked', async () => {
    const card = itemRefChildCard()
    const { uses, blocked } = await deletePlanOf(card, '1.4', 'id_1')
    expect(
      uses.map((use) => use.element.code),
      '要读 item 里「自身值 + 孩子」对象的 2.6.1.0',
    ).toContain('2.6.1')
    expect(blocked.map((use) => use.element.code)).toContain('2.6.1')
  })
})

describe('删除 · 第五种位置（有孩子的标量字段下的 ref）也要被找到', () => {
  it('删 1.4 的 item ⇒ refUsesOf 找得到 2.4.1.1，min = 1 时 blocked', async () => {
    const card = patchElement(scalarChildRefCard(), '2.4.1.1', { min: 1 })
    const { uses, blocked } = await deletePlanOf(card, '1.4', 'id_1')
    expect(
      uses.map((use) => use.element.code),
      '要穿过 2.4.1 的「自身 + 孩子」找到 2.4.1.1',
    ).toContain('2.4.1.1')
    expect(blocked.map((use) => use.element.code)).toContain('2.4.1.1')
  })
})

describe('删除 · ref 的孩子也是 ref（item 深度）也要被找到', () => {
  it('删 1.5 的 item（2.6.1.1 指着它）⇒ refUsesOf 找得到 2.6.1.1；min = 1 时 blocked', async () => {
    const card = patchElement(refChildRefCard(), '2.6.1.1', { min: 1 })
    const { uses, blocked } = await deletePlanOf(card, '1.5', 'id_2')
    expect(
      uses.map((use) => use.element.code),
      '要下钻到 ref 的孩子那一层',
    ).toContain('2.6.1.1')
    expect(
      blocked.map((use) => use.element.code),
      'min = 1 ⇒ 删除被拒并点名',
    ).toContain('2.6.1.1')
  })
})
