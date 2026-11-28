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
