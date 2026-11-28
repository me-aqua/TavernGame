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
  elementOf,
  itemRefChildCard,
  lineOf,
  nodeOf,
  patchElement,
  patchNode,
  payloadOf,
  refCard,
  refChildCard,
  refChildRefCard,
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

/** 状态段里某个 code 那一行的 payload（JSON 或 `null`） */
async function payloadOfCode(card, code) {
  const { buildPrompt } = await loadPrompt()
  const prompt = buildPrompt({
    card,
    save: saveOf(card),
    node: nodeOf(card, 'check'),
    action: 'ACT',
    outputs: {},
  })
  const lines = stateLines(prompt)
  const line = lineOf(lines, code)
  expect(line, `状态段里应当有 ${code} 那一行（实际：${JSON.stringify(lines)}）`).toBeTruthy()
  return payloadOf(line)
}

/** 2.5 主手那一行（本文件另一半判据用的名字保留） */
const mainHandPayload = (card) => payloadOfCode(card, '2.5')

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

describe('item 级引用带子元素（2026-11-28 重开：任何标量位置都能放 ref）', () => {
  it('值形状是「自身值 + 孩子」的对象：2.6.1.0 / 2.6.1.1；裸指针不算合法值', async () => {
    const { fieldValueFits } = await loadState()
    const card = itemRefChildCard()
    const field = elementOf(card, '2.6.1')
    expect(
      fieldValueFits(card.state, field, { '2.6.1.0': 'id_1', '2.6.1.1': '单手' }),
      '自身值 + 孩子 ⇒ 合法',
    ).toBe(true)
    expect(fieldValueFits(card.state, field, 'id_1'), '有孩子的引用不接受裸指针').toBe(false)
    expect(fieldValueFits(card.state, field, { '2.6.1.0': 'id_1' }), '缺孩子 ⇒ 坏值').toBe(false)
  })

  it('卡校验通过（2.6 的 item 里是嵌套对象），读投影 + 本地孩子都读得到', async () => {
    const { cardIssues } = await loadState()
    const card = itemRefChildCard()
    expect(cardIssues(card)).toEqual([])
    const payload = await payloadOfCode(card, '2.6')
    expect(payload, '投影字段（来源 → 名称）要在').toContain('微醺')
    expect(payload, '关系子元素（握法）也要在').toContain('单手')
    // 数组 item 自己的隐藏 id 照常出现在模型提示词里（§7.1 / 阶段 4 口径）；
    // 要禁的是「引用位被吐成裸指针」，不是 item 的 id。
    const buffs = JSON.parse(payload)
    expect(buffs[0].id, 'item 自己的 id 照常出现').toBe('id_1')
    for (const [index, item] of buffs.entries()) {
      expect(typeof item.来源, `第 ${index + 1} 条：引用位是投影对象，不是裸指针`).toBe('object')
      expect(
        Object.keys(item.来源),
        `第 ${index + 1} 条：投影对象里只有字段中文名 + 关系子元素，没有指针字段 code`,
      ).not.toContain('2.6.1.0')
      expect(item.来源.握法, '关系子元素住在这条引用的投影里').toBe('单手')
    }
  })

  it('写：整表写 2.6 收「自身值 + 孩子」的对象；字段列写 2.6.1 也收', async () => {
    const { applyWrite } = await loadEngine()
    const card = itemRefChildCard()
    const node = patchNode(card, 'check', { writable: ['2.6', '2.6.1'] })
    const next = [{ id: 'id_1', '2.6.1': { '2.6.1.0': 'id_2', '2.6.1.1': '双手' }, '2.6.2': '轻' }]
    const table = applyWrite({
      card: node,
      node: nodeOf(node, 'check'),
      tree: treeOf(node),
      path: '2.6',
      value: next,
    })
    expect(table['2.6'][0]['2.6.1']).toEqual({ '2.6.1.0': 'id_2', '2.6.1.1': '双手' })
    const column = applyWrite({
      card: node,
      node: nodeOf(node, 'check'),
      tree: treeOf(node),
      path: '2.6.1',
      value: [
        { '2.6.1.0': 'id_2', '2.6.1.1': '双手' },
        { '2.6.1.0': 'id_1', '2.6.1.1': '单手' },
      ],
    })
    expect(column['2.6'][0]['2.6.1']).toEqual({ '2.6.1.0': 'id_2', '2.6.1.1': '双手' })
    expect(column['2.6'][1]['2.6.1']).toEqual({ '2.6.1.0': 'id_1', '2.6.1.1': '单手' })
  })

  it('指针已设置 ⇒ 写子元素 2.6.1.1 成功，并落进 item["2.6.1"]["2.6.1.1"]', async () => {
    // 决定性判据：item 级 ref 的指针住在 item 里（item['2.6.1']['2.6.1.0']），
    // 不在扁平 tree 上 —— 任何拿 `tree[element.code + '.0']` 判「有没有目标」的写法都会把这里误拒。
    const { applyWrite } = await loadEngine()
    const card = itemRefChildCard()
    const node = patchNode(card, 'check', { writable: ['2.6.1.1'] })
    const tree = treeOf(card)
    const written = applyWrite({
      card: node,
      node: nodeOf(node, 'check'),
      tree,
      path: '2.6.1.1',
      value: ['双手', '单手'],
    })
    expect(written['2.6'][0]['2.6.1']['2.6.1.1'], '第 1 条的握法写进去了').toBe('双手')
    expect(written['2.6'][1]['2.6.1']['2.6.1.1'], '第 2 条的握法写进去了').toBe('单手')
    expect(written['2.6'][0]['2.6.1']['2.6.1.0'], '指针不动').toBe('id_1')
    expect(tree['2.6'][0]['2.6.1']['2.6.1.1'], '入参 tree 一个字都不改').toBe('单手')
  })

  it('指针为 null ⇒ 写子元素 2.6.1.1 被拒，报文点名 2.6.1', async () => {
    const { applyWrite } = await loadEngine()
    const base = itemRefChildCard()
    const card = withInitialValue(
      patchElement(base, '2.6.1', { min: 0 }),
      '2.6',
      [0, 1].map((index) => ({
        id: `id_${index + 1}`,
        '2.6.1': { '2.6.1.0': null, '2.6.1.1': '单手' },
        '2.6.2': index === 0 ? '轻' : '中',
      })),
    )
    const node = patchNode(card, 'check', { writable: ['2.6.1.1'] })
    const error = errorOf(() =>
      applyWrite({
        card: node,
        node: nodeOf(node, 'check'),
        tree: treeOf(node),
        path: '2.6.1.1',
        value: ['双手', '双手'],
      }),
    )
    expect(error, '指针为 null 时写子元素必须被拒').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(`${error.message} ${JSON.stringify(error.detail ?? {})}`, '报文要点名 2.6.1').toContain('2.6.1')
  })
})

describe('item 级 ref 的孩子也要递归查值（坏 id 别漏）', () => {
  it('2.6.1.1 写了一个不存在的 id ⇒ cardIssues 点名它', async () => {
    const { cardIssues } = await loadState()
    const base = refChildRefCard()
    const items = treeOf(base)['2.6'].map((item, index) => ({
      ...item,
      '2.6.1': { '2.6.1.0': 'id_1', '2.6.1.1': index === 0 ? 'id_99' : 'id_2' },
    }))
    const card = withInitialValue(base, '2.6', items)
    const issues = cardIssues(card)
    const hit = issues.find((issue) => issue.code === '2.6.1.1' || issue.path === '2.6.1.1')
    expect(hit, `要有一条指到 2.6.1.1 的问题（实际：${JSON.stringify(issues)}）`).toBeTruthy()
    expect(hit.message, '报文要说这个 id 不在源数组里').toContain('id_99')
  })

  it('同样的坏 id 落在存档树里 ⇒ saveTreeIssues 也点名它', async () => {
    const { saveTreeIssues } = await loadState()
    const base = refChildRefCard()
    const tree = treeOf(base)
    const badTree = {
      ...tree,
      2.6: tree['2.6'].map((item, index) => ({
        ...item,
        '2.6.1': { '2.6.1.0': 'id_1', '2.6.1.1': index === 0 ? 'id_99' : 'id_2' },
      })),
    }
    const issues = saveTreeIssues(base, badTree)
    const hit = issues.find((issue) => issue.code === '2.6.1.1' || issue.path === '2.6.1.1')
    expect(hit, `存档校验也要递归到孩子那层（实际：${JSON.stringify(issues)}）`).toBeTruthy()
    expect(hit.message).toContain('id_99')
  })
})
