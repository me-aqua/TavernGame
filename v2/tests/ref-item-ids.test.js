/**
 * 阶段 4 · 数组 item 隐藏 id（引用契约 §二 · 验收 1 / 12 / 26）。
 *
 * 这一份钉的是「id 是机器生成的身份，不是作者字段」：
 *   · 新 id = 本数组当前最大编号 + 1；每个数组各自从 `id_1` 起；**删除后不回收 / 不复用**；
 *   · 作用域只在本数组内（`2.4` 的 `id_1` 与 `1.4` 的 `id_1` 是两条不同记录）；
 *   · 新建 / 复制 / 缺 id 都由机器生成，编辑者不手写；
 *   · 可见性（契约 §二 2026-11-28 口径）：**玩家界面 / 编辑器字段列表不显示**；
 *     **模型提示词可见**，`write_state` 入参也收 id —— 整表写入靠它稳定保留身份；
 *   · 整表写入：已有 item 带回原 id ⇒ 保留；新 item 省略 id ⇒ 引擎生成；
 *     未知 id / 重复 id / 改已有 id ⇒ 拒绝；
 *   · 所有数组 item 都必须带 id（卡的初始值与树都一样）；同名 / 同内容靠 id 区分。
 *
 * ⚠️ **API 假设（契约没点名函数，这一份按现有入口钉）**：新建 item 的唯一数据层入口是
 * `arrayItemOf(state, code, items)` —— 第三格是**这个数组当前的值**（算 max+1 必须看得见它）。
 * 若实现改成别的签名，这条判据要跟着改口径，不算功能做错。
 */
import { describe, expect, it } from 'vitest'
import {
  bagItems,
  chars,
  lineOf,
  nodeOf,
  patchElement,
  payloadOf,
  refCard,
  saveOf,
  stateLines,
  treeOf,
  withInitialValue,
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

/** 一排 id（`['id_1','id_2']`） */
function idsOf(items) {
  return items.map((item) => item.id)
}

/** 期望 `cardIssues` 至少一条落在这些 code / path 上，**并且是 baseline 之外新冒出来的那条规则** */
async function expectIssue(card, codes, note, baseline = refCard()) {
  const { cardIssues } = await loadState()
  const wanted = Array.isArray(codes) ? codes : [codes]
  const issues = cardIssues(card)
  expect(issues.length, `${note}：应当报错`).toBeGreaterThan(0)
  for (const issue of issues) expect(issue.message, `${note}：message 必须是中文`).toMatch(CJK)
  const hit = issues.some((issue) =>
    wanted.some((code) => issue.code === code || issue.path === code || issue.path?.startsWith(`${code}.`)),
  )
  expect(hit, `${note}：没有一条 issue 指到 ${wanted.join(' / ')}（实际：${JSON.stringify(issues)}）`).toBe(
    true,
  )
  const known = new Set(cardIssues(baseline).map((issue) => `${issue.code}|${issue.path}|${issue.message}`))
  expect(
    issues.some((issue) => !known.has(`${issue.code}|${issue.path}|${issue.message}`)),
    `${note}：必须报出这条规则本身，不能只靠 baseline 里已有的问题`,
  ).toBe(true)
  return issues
}

describe('数组 item 隐藏 id · 生成（§二）', () => {
  it('新建 item：空数组 ⇒ id_1；已有 id_1…id_3 ⇒ id_4（当前最大 + 1）', async () => {
    const { arrayItemOf } = await loadState()
    const state = refCard().state
    expect(arrayItemOf(state, '2.4', []).id, '空数组的第一条是 id_1').toBe('id_1')
    expect(arrayItemOf(state, '1.4', []).id, '另一个数组也各自从 id_1 起').toBe('id_1')
    expect(arrayItemOf(state, '2.4', bagItems()).id, '已有三条 ⇒ 下一条是 id_4').toBe('id_4')
  })

  it('删除后不回收、不复用：只剩 id_1 / id_3 ⇒ 新 id 是 id_4', async () => {
    const { arrayItemOf } = await loadState()
    const state = refCard().state
    const left = [bagItems()[0], bagItems()[2]]
    expect(arrayItemOf(state, '2.4', left).id, 'id_2 被删过也不许再发它').toBe('id_4')
  })

  it('复制 / 新建都不复用现有 id（来源清单里一个都不许出现）', async () => {
    const { arrayItemOf } = await loadState()
    const state = refCard().state
    const items = bagItems()
    const fresh = arrayItemOf(state, '2.4', items)
    expect(idsOf(items), '正控：夹具本身 id 各不相同').toEqual(['id_1', 'id_2', 'id_3'])
    expect(typeof fresh.id, '新 item 必须带 id').toBe('string')
    expect(idsOf(items), '新 id 不许与任何现有 id 相同').not.toContain(fresh.id)
  })

  it('作用域只在本数组：2.4 与 1.4 各有一条 id_1，新 id 只看自己那张数组', async () => {
    const { arrayItemOf } = await loadState()
    const state = refCard().state
    expect(idsOf(bagItems())[0]).toBe('id_1')
    expect(idsOf(chars())[0]).toBe('id_1')
    expect(arrayItemOf(state, '1.5', chars()).id, '1.5 的最大编号是 3 ⇒ id_4（不受 2.4 影响）').toBe('id_4')
  })

  it('编辑别的格子不改 id：加字段 / 改字段名 / 改名字都不搬 id', async () => {
    const { addChild, setElementType } = await loadState()
    const before = treeOf(refCard())['2.4']
    const idsIn = (card) => idsOf(card.state.find((item) => item.code === '2').initial['2.4'])
    expect(idsIn(refCard()), '正控：夹具的 id 就是 id_1…id_3').toEqual(['id_1', 'id_2', 'id_3'])
    expect(idsIn(addChild(refCard(), '2.4.1')), '加子字段后 id 原样').toEqual(idsOf(before))
    expect(idsIn(patchElement(refCard(), '2.4.1', { name: '道具' })), '改字段名不影响 id').toEqual(
      idsOf(before),
    )
    expect(idsIn(setElementType(refCard(), '2.3', 'integer')), '换别的元素类型不影响 id').toEqual(
      idsOf(before),
    )
  })
})

describe('数组 item 隐藏 id · 必需与唯一（§二）', () => {
  it('所有数组 item 都要带 id：缺 id 的卡初始值被拦，合法卡一条问题都没有', async () => {
    const { cardIssues } = await loadState()
    expect(cardIssues(refCard()), '正控：每个数组各有一条 id_1 是合法的').toEqual([])
    const noIds = bagItems().map((item) => {
      const fields = { ...item }
      delete fields.id
      return fields
    })
    await expectIssue(withInitialValue(refCard(), '2.4', noIds), '2.4', '背包 item 缺 id')
    await expectIssue(withInitialValue(refCard(), '1.4', buffDefsWithoutIds()), '1.4', '增益定义 item 缺 id')
  })

  it('数组内 id 不许重复；不同数组之间同号合法', async () => {
    const { cardIssues } = await loadState()
    const dup = bagItems().map((item, index) => (index === 2 ? { ...item, id: 'id_1' } : item))
    await expectIssue(withInitialValue(refCard(), '2.4', dup), '2.4', '重复 id')
    expect(cardIssues(refCard()), '正控：1.4 / 1.5 / 2.4 / 2.6 都有 id_1，这是合法的').toEqual([])
  })

  it('同名 / 同内容靠 id 区分：两条完全一样的字段值只靠 id 就合法', async () => {
    const { cardIssues } = await loadState()
    const twins = [
      { id: 'id_1', '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '是' },
      { id: 'id_2', '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '是' },
    ]
    const card = withInitialValue(refCard(), '2.4', twins)
    expect(cardIssues(card), '字段值全同、id 不同 ⇒ 合法').toEqual([])
  })

  it('id 不是值路径、不可编辑：pathsOf / elementOfPath / childrenOf / setInitial 四处都不认它', async () => {
    const { pathsOf, elementOfPath, childrenOf, setInitial } = await loadState()
    const state = refCard().state
    expect(pathsOf(state, '2.4'), '数组只占自己那一条值路径').toEqual(['2.4'])
    expect(pathsOf(state, '2.4.id'), 'id 不是值路径').toEqual([])
    expect(elementOfPath(state, '2.4.id'), 'id 不是元素').toBeUndefined()
    expect(
      childrenOf(state, '2.4').map((item) => item.code),
      '编辑器字段列表 = 字段定义，id 不在里面',
    ).toEqual(['2.4.1', '2.4.2', '2.4.3'])
    const error = errorOf(() => setInitial(refCard(), '2.4.id', 'id_9'))
    expect(error, '写 id 这条路径应当被拒').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })

  it('id 进提示词：数组行每一项带 id（§7.1 例），但引用值仍是投影对象', async () => {
    const { buildPrompt } = await loadPrompt()
    const card = refCard()
    const prompt = buildPrompt({
      card,
      save: saveOf(card),
      node: nodeOf(card, 'output'),
      action: 'ACT',
      outputs: {},
    })
    const bag = JSON.parse(payloadOf(lineOf(stateLines(prompt), '2.4')))
    expect(
      bag.map((item) => item.id),
      '数组行每项都要带 id',
    ).toEqual(['id_1', 'id_2', 'id_3'])
    for (const item of bag) {
      expect(new Set(Object.keys(item)), 'item 的键 = id + 字段中文名').toEqual(
        new Set(['id', '物品', '数量', '可手持']),
      )
    }
    expect(prompt, '整份提示词里能看到 id').toContain('"id_1"')
    const mainHand = JSON.parse(payloadOf(lineOf(stateLines(prompt), '2.5')))
    expect(mainHand, '引用值仍是投影对象，不打印自己的指针').toEqual({ ['物品']: '短剑' })
    expect(mainHand.id, '引用自己不投影 id').toBeUndefined()
  })
})

describe('数组 item 隐藏 id · 整表写入的身份规则（§二 · 验收 1 / 12 / 26）', () => {
  it('已有 item 带回原 id ⇒ 保留身份、字段可改（引用仍解析到它）', async () => {
    const { applyWrite } = await loadEngine()
    const card = refCard()
    const tree = treeOf(card)
    const renamed = bagItems().map((item) => (item.id === 'id_1' ? { ...item, '2.4.1': '长剑' } : item))
    const written = applyWrite({ card, node: nodeOf(card, 'check'), tree, path: '2.4', value: renamed })
    expect(idsOf(written['2.4']), 'id 一个都不许变').toEqual(['id_1', 'id_2', 'id_3'])
    expect(written['2.4'][0]['2.4.1']).toBe('长剑')
    expect(written['2.5'], '引用仍指向 id_1').toBe('id_1')
    expect(tree['2.4'], '入参 tree 不动').toEqual(bagItems())
  })

  it('新 item 省略 id ⇒ 引擎生成（当前最大编号 + 1）', async () => {
    const { applyWrite } = await loadEngine()
    const card = refCard()
    const tree = treeOf(card)
    // 2.6 没有引用指向它，可以整份换掉（两条旧 item 都消失 ⇒ 都是新 item）
    const incoming = [{ '2.6.1': 'id_1', '2.6.2': '轻' }]
    const written = applyWrite({ card, node: nodeOf(card, 'check'), tree, path: '2.6', value: incoming })
    expect(idsOf(written['2.6']), '旧数组最大是 id_2 ⇒ 新 item 是 id_3').toEqual(['id_3'])
    expect(written['2.6'][0]['2.6.1']).toBe('id_1')
  })

  it('省略 id 的 item 与带回原 id 的 item 可以混在同一笔整表写里', async () => {
    const { applyWrite } = await loadEngine()
    const card = refCard()
    const tree = treeOf(card)
    const mixed = [
      { '2.6.1': 'id_1', '2.6.2': '轻' },
      { id: 'id_2', '2.6.1': 'id_2', '2.6.2': '重' },
    ]
    const written = applyWrite({ card, node: nodeOf(card, 'check'), tree, path: '2.6', value: mixed })
    expect(idsOf(written['2.6'])).toEqual(['id_3', 'id_2'])
  })

  it('未知 id ⇒ E_VALIDATION（新 item 不许自带 id）', async () => {
    const { applyWrite } = await loadEngine()
    const card = refCard()
    const incoming = [{ id: 'id_9', '2.4.1': '长弓', '2.4.2': 7, '2.4.3': '是' }]
    const error = errorOf(() =>
      applyWrite({ card, node: nodeOf(card, 'check'), tree: treeOf(card), path: '2.4', value: incoming }),
    )
    expect(error, '未知 id 应当被拒').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(`${error.message} ${JSON.stringify(error.detail ?? {})}`).toContain('id_9')
  })

  it('改已有 item 的 id（换成一个旧数组里没有的值）⇒ E_VALIDATION', async () => {
    const { applyWrite } = await loadEngine()
    const card = refCard()
    const renamed = bagItems().map((item) => (item.id === 'id_1' ? { ...item, id: 'id_7' } : item))
    const error = errorOf(() =>
      applyWrite({ card, node: nodeOf(card, 'check'), tree: treeOf(card), path: '2.4', value: renamed }),
    )
    expect(error, 'id 一旦生成永不改').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })

  it('重复 id ⇒ E_VALIDATION', async () => {
    const { applyWrite } = await loadEngine()
    const card = refCard()
    const dup = [
      { id: 'id_1', '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '是' },
      { id: 'id_1', '2.4.1': '斗篷', '2.4.2': 1, '2.4.3': '是' },
    ]
    const error = errorOf(() =>
      applyWrite({ card, node: nodeOf(card, 'check'), tree: treeOf(card), path: '2.4', value: dup }),
    )
    expect(error, '重复 id 应当被拒').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
  })

  it('隐藏 id 不影响值形状：两条同内容不同 id 的整表写入被接受', async () => {
    const { applyWrite } = await loadEngine()
    const card = refCard()
    const tree = treeOf(card)
    const twins = [
      { id: 'id_1', '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '是' },
      { id: 'id_2', '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '是' },
    ]
    const written = applyWrite({ card, node: nodeOf(card, 'check'), tree, path: '2.4', value: twins })
    expect(written['2.4']).toEqual(twins)
  })
})

/** `1.4` 的两项去掉 id（造「导入的卡缺 id」） */
function buffDefsWithoutIds() {
  return [
    { '1.4.1': '微醺', '1.4.2': '脚步有点飘' },
    { '1.4.1': '潮湿', '1.4.2': '衣服贴在身上' },
  ]
}
