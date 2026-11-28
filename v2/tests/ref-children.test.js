/**
 * 阶段 4 · 带子元素的引用（引用契约 §4.3 · 验收 22）。
 *
 * 这一份钉的是「关系自己的数据」：
 *   · 有子元素时，ref 自身值住 `<code>.0`（`2.5.0`），子元素值住 `<code>.<编号>`（`2.5.1` / `2.5.2`）；
 *     没有子元素时自身值住 `<code>`（`2.5`）—— 两套口径由「有没有子元素」决定，不是另开一种节点；
 *   · 子元素属于**这次引用关系**，不属于源 item：改握法不改背包那一格；
 *   · `min` / `max` 只数自身值，**不数子元素**；
 *   · 自身值为 `null` 时子元素不展示、不生效；写子元素前必须先有目标；
 *   · 投影字段仍是元数据（不进 `state[]`、不是值路径），子元素才是状态树的子元素。
 */
import { describe, expect, it } from 'vitest'
import {
  bagItems,
  lineOf,
  nodeOf,
  patchElement,
  patchNode,
  payloadOf,
  refCard,
  refChildCard,
  saveOf,
  stateLines,
  treeOf,
  withInitialValue,
  withoutInitialValue,
} from './support/ref-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

const CJK = /[\u4e00-\u9fff]/

function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 状态段里 ref 元素那一行的 payload（JSON 或 `null`） */
async function mainHandPayload(card) {
  const { buildPrompt } = await loadPrompt()
  const prompt = buildPrompt({
    card,
    save: saveOf(card),
    node: nodeOf(card, 'check'),
    action: 'ACT',
    outputs: {},
  })
  const lines = stateLines(prompt)
  const line = lineOf(lines, '2.5')
  expect(line, `状态段里应当有 2.5 那一行（实际：${JSON.stringify(lines)}）`).toBeTruthy()
  return payloadOf(line)
}

describe('带子元素的引用 · 值路径（§4.3）', () => {
  it('有子元素 ⇒ 自身值住 2.5.0，子元素住 2.5.1 / 2.5.2（深度优先、同级升序）', async () => {
    const { pathsOf, elementOfPath } = await loadState()
    const state = refChildCard().state
    expect(pathsOf(state, '2.5')).toEqual(['2.5.0', '2.5.1', '2.5.2'])
    expect(elementOfPath(state, '2.5.0')?.code, '.0 归它的基元素').toBe('2.5')
    expect(elementOfPath(state, '2.5.1')?.code).toBe('2.5.1')
    expect(elementOfPath(state, '2.5.2')?.code).toBe('2.5.2')
  })

  it('没有子元素 ⇒ 自身值住 2.5，没有 .0 那一格', async () => {
    const { pathsOf } = await loadState()
    expect(pathsOf(refCard().state, '2.5')).toEqual(['2.5'])
  })

  it('初始值展开：自身值在 2.5.0，子元素各占一条；没有 2.5 这个键', async () => {
    const { initialTreeOf } = await loadState()
    const tree = initialTreeOf(refChildCard())
    expect(tree['2.5.0']).toBe('id_1')
    expect(tree['2.5.1']).toBe('双手')
    expect(tree['2.5.2']).toBe('火')
    expect('2.5' in tree, '有子元素时自身值不在裸 code 上').toBe(false)
  })

  it('初始值表必须覆盖三条路径：缺 .0 / 多出裸 2.5 都被拦', async () => {
    const { cardIssues } = await loadState()
    expect(cardIssues(refChildCard()), '正控：三条路径齐全').toEqual([])
    const missingOwn = withoutInitialValue(refChildCard(), '2.5.0')
    const issues = cardIssues(missingOwn)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((issue) => issue.path === '2.5.0' || issue.code === '2.5')).toBe(true)
    for (const issue of issues) expect(issue.message).toMatch(CJK)

    const extraOwn = withInitialValue(refChildCard(), '2.5', 'id_1')
    expect(
      cardIssues(extraOwn).some((issue) => issue.path === '2.5'),
      '多了裸 2.5 键 ⇒ 多余路径',
    ).toBe(true)
  })
})

describe('带子元素的引用 · min / max 只数自身值（§4.3）', () => {
  it('min = 1 且自身值 null（子元素有值）⇒ 不合法；自身值有 id ⇒ 合法', async () => {
    const { cardIssues } = await loadState()
    const required = patchElement(refChildCard(), '2.5', { min: 1 })
    const nullOwn = withInitialValue(required, '2.5.0', null)
    expect(cardIssues(nullOwn), '子元素有值不算数 ⇒ 0 < min').not.toHaveLength(0)
    expect(cardIssues(required), '正控：自身值 id_1 ⇒ 1 ≥ min').toEqual([])
  })

  it('子元素不参与数量：多一个子元素不会让 0..1 变成两条引用', async () => {
    const { cardIssues } = await loadState()
    const card = withInitialValue(patchElement(refChildCard(), '2.5', { min: 0, max: 1 }), '2.5.2', '冰')
    expect(cardIssues(card)).toEqual([])
  })
})

describe('带子元素的引用 · 读取（§4.3 / §7.1）', () => {
  it('自身值非空：投影字段与关系子元素都能读到，不出现裸 id', async () => {
    const payload = await mainHandPayload(refChildCard())
    expect(payload, '投影字段（物品）要在').toContain('短剑')
    expect(payload, '关系子元素（握法）也要在').toContain('双手')
    expect(payload, '不许出现裸 id').not.toContain('id_1')
    expect(() => JSON.parse(payload), `payload 必须是合法 JSON：${payload}`).not.toThrow()
  })

  it('自身值 null：显示 null，子元素不展示（不展示 = 一个字都不出现）', async () => {
    const card = withInitialValue(patchElement(refChildCard(), '2.5', { min: 0 }), '2.5.0', null)
    expect(await mainHandPayload(card), '空引用就是 null').toBe('null')
  })
})

describe('带子元素的引用 · 写（§4.3）', () => {
  it('写子元素前必须先有目标：自身值 null 时写 2.5.1 ⇒ E_VALIDATION', async () => {
    const { applyWrite } = await loadEngine()
    const base = patchElement(refChildCard(), '2.5', { min: 0 })
    const tree = { ...treeOf(base), '2.5.0': null }
    const node = patchNode(base, 'check', { writable: ['2.5.1'] })
    const error = errorOf(() =>
      applyWrite({ card: node, node: nodeOf(node, 'check'), tree, path: '2.5.1', value: '单手' }),
    )
    expect(error, '没有目标就写子元素应当被拒').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(textOf(error), '报文要点名 2.5 或 2.5.0').toMatch(/2\.5(\.0)?/)
  })

  it('有目标之后写子元素：成功，且源 item（2.4）一个字不动', async () => {
    const { applyWrite } = await loadEngine()
    const card = patchNode(refChildCard(), 'check', { writable: ['2.5.1', '2.5'] })
    const tree = treeOf(card)
    const written = applyWrite({ card, node: nodeOf(card, 'check'), tree, path: '2.5.1', value: '单手' })
    expect(written['2.5.1']).toBe('单手')
    expect(written['2.5.0'], '改握法不改指针').toBe('id_1')
    expect(written['2.4'], '子元素不属于源 item').toEqual(bagItems())
    expect(tree['2.5.1'], '入参 tree 不动').toBe('双手')
  })

  it('ref 自身值写 null：清指针（子元素留着，但从此不生效）', async () => {
    const { applyWrite } = await loadEngine()
    const card = refChildCard()
    const written = applyWrite({
      card,
      node: nodeOf(card, 'check'),
      tree: treeOf(card),
      path: '2.5.0',
      value: null,
    })
    expect(written['2.5.0']).toBeNull()
    expect(written['2.5.1'], '子元素值不被顺手清掉（清不清是编辑器的事）').toBe('双手')
  })
})

/** 错误里能点名的那几格（message + detail） */
function textOf(error) {
  return `${error?.message ?? ''} ${JSON.stringify(error?.detail ?? {})}`
}
