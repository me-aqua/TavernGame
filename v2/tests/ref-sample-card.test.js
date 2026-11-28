/**
 * 阶段 4 · 晨风镇样例卡的引用迁移（引用契约 §十一 · 验收 13 / 16 / 19 / 20 / 21 / 25 / 26）。
 *
 * 样例卡是**产品资产**（`v2/src/data/sample-card.json`），玩家第一次打开看到的就是它。
 * 这一票把它升级成「可被引用的实例数组」：
 *
 * ```text
 * 1.4 增益定义（array）  item: id + 1.4.1 名称 / 1.4.2 描述
 * 2.4 背包（array）      item: id + 2.4.1 物品 / 2.4.2 数量 / 2.4.3 可手持（是 / 否）
 * 2.5 主手（ref → 2.4，筛选 2.4.3 = 是，投影 2.4.1 物品，0..1）
 * 2.6 当前增益（array）  item: id + 2.6.1 来源（ref → 1.4，投影 1.4.1 + 1.4.2，1..1）/ 2.6.2 严重程度
 * ```
 *
 * 钉的几件事：每个数组 item 都补了隐藏 id（各自从 `id_1` 起，玩家 / 编辑器看不到、模型提示词看得到）；
 * `2.5` / `2.6.1` 的定义逐字；增益**没有**层数 / 持续时长 / 到期字段（卸载由 LLM 判断）；
 * 读提示词时引用投影成对象、数组 item 带 id；整表写 `2.4` 要带回原 id；
 * 删掉正被 `2.6.1` 引用的增益定义 ⇒ 拒绝并点名 `2.6`。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lineOf, payloadOf, saveOf, stateLines, treeOf } from './support/ref-fixtures.js'
import { loadModule } from './support/load.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

const CJK = /[\u4e00-\u9fff]/

/** 阶段 4 的样例卡（每次读盘一份新的，用例之间不共享引用） */
function sampleCard() {
  return JSON.parse(readFileSync(join(SRC, 'data', 'sample-card.json'), 'utf8'))
}

function elementOf(card, code) {
  return card.state.find((item) => item.code === code)
}

function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 状态段里某个 code 那一行的 payload */
async function statePayload(card, code, nodeId = 'output') {
  const { buildPrompt } = await loadPrompt()
  const node = card.chain.find((item) => item.id === nodeId)
  const prompt = buildPrompt({ card, save: saveOf(card), node, action: 'ACT', outputs: {} })
  const line = lineOf(stateLines(prompt), code)
  expect(line, `状态段里应当有 ${code} 那一行（实际：${JSON.stringify(stateLines(prompt))}）`).toBeTruthy()
  return payloadOf(line)
}

/** 某个数组的 item id 清单 */
function idsOf(items) {
  return items.map((item) => item.id)
}

describe('晨风镇 stage 4 · 资产形状（§11.1）', () => {
  it('过得了 validateCard，问题清单为空', async () => {
    const { validateCard } = await loadSchema()
    const { cardIssues } = await loadState()
    const card = sampleCard()
    expect(card.name).toMatch(CJK)
    expect(() => validateCard(card)).not.toThrow()
    expect(cardIssues(card)).toEqual([])
  })

  it('元素表就是 §11.1 那一棵（含新增的 1.4 / 2.4.3 / 2.5 / 2.6）', async () => {
    const card = sampleCard()
    expect(card.state.map((item) => item.code).sort()).toEqual(
      [
        '0',
        '1',
        '1.1',
        '1.1.1',
        '1.2',
        '1.3',
        '1.4',
        '1.4.1',
        '1.4.2',
        '2',
        '2.1',
        '2.2',
        '2.3',
        '2.4',
        '2.4.1',
        '2.4.2',
        '2.4.3',
        '2.5',
        '2.6',
        '2.6.1',
        '2.6.2',
      ].sort(),
    )
  })

  it('2.5 主手的定义逐字（引用自 2.4、筛选 2.4.3 = 是、投影 2.4.1、0..1）', async () => {
    const card = sampleCard()
    expect(elementOf(card, '2.5')).toMatchObject({
      type: 'ref',
      name: '主手',
      refSource: '2.4',
      refFilter: { field: '2.4.3', value: '是' },
      refFields: ['2.4.1'],
      min: 0,
      max: 1,
    })
    expect(elementOf(card, '2.4.3')).toMatchObject({ type: 'enum', name: '可手持', values: ['是', '否'] })
  })

  it('2.6 当前增益：来源是 1.4 的 1..1 引用（投影名称 + 描述），严重程度是枚举', async () => {
    const card = sampleCard()
    expect(elementOf(card, '2.6')).toMatchObject({ type: 'array', name: '当前增益' })
    expect(elementOf(card, '2.6.1')).toMatchObject({
      type: 'ref',
      name: '来源',
      refSource: '1.4',
      refFields: ['1.4.1', '1.4.2'],
      min: 1,
      max: 1,
    })
    expect(elementOf(card, '2.6.2')).toMatchObject({
      type: 'enum',
      name: '严重程度',
      values: ['轻', '中', '重'],
    })
    expect(elementOf(card, '1.4')).toMatchObject({ type: 'array', name: '增益定义' })
    expect(elementOf(card, '1.4.1')).toMatchObject({ type: 'text', name: '名称' })
    expect(elementOf(card, '1.4.2')).toMatchObject({ type: 'text', name: '描述' })
  })

  it('增益没有层数 / 持续时长 / 到期字段（验收 25）', async () => {
    const card = sampleCard()
    const { childrenOf } = await loadState()
    expect(
      childrenOf(card.state, '2.6').map((item) => item.code),
      '2.6 的字段恰好是 来源 + 严重程度（没有 2.6.3）',
    ).toEqual(['2.6.1', '2.6.2'])
    const names = card.state.map((item) => `${item.name}${item.note ?? ''}`).join('\n')
    for (const word of ['持续', '时长', '到期', '层数', '剩余回合']) {
      expect(names, `增益那一族不许出现「${word}」字段`).not.toContain(word)
    }
  })

  it('链的 reads / writable 跟着更新（§11.4）', async () => {
    const card = sampleCard()
    const check = card.chain.find((node) => node.id === 'check')
    const output = card.chain.find((node) => node.id === 'output')
    for (const code of ['1.4', '2.4', '2.5', '2.6']) {
      expect(check.reads, `check.reads 要含 ${code}`).toContain(code)
      expect(check.writable, `check.writable 要含 ${code}`).toContain(code)
      expect(output.reads, `output.reads 要含 ${code}`).toContain(code)
    }
  })
})

describe('晨风镇 stage 4 · 隐藏 id 与初始值（§11.2 · 验收 26）', () => {
  it('每个数组 item 都有 id：各自从 id_1 起、数组内唯一', async () => {
    const card = sampleCard()
    const { childrenOf } = await loadState()
    const arrays = ['1.4', '2.4', '2.6']
    for (const code of arrays) {
      const items = elementOf(card, code.split('.')[0]).initial[code]
      expect(Array.isArray(items), `${code} 的初始值应当是数组`).toBe(true)
      expect(idsOf(items), `${code} 各自从 id_1 起`).toEqual(items.map((_, index) => `id_${index + 1}`))
      expect(new Set(idsOf(items)).size, `${code} 内 id 唯一`).toBe(items.length)
      for (const item of items) {
        expect(typeof item.id, `${code} 的每一项都要有 id`).toBe('string')
        expect(Object.keys(item).sort(), `${code} 的 item 键 = id + 字段全集`).toEqual(
          ['id', ...childrenOf(card.state, code).map((field) => field.code)].sort(),
        )
      }
    }
  })

  it('初始值：2.5 指短剑（id_1），2.6 两条各自指向 1.4 的 id_1 / id_2', async () => {
    const { initialTreeOf } = await loadState()
    const tree = initialTreeOf(sampleCard())
    expect(tree['2.5']).toBe('id_1')
    expect(tree['2.6']).toEqual([
      { id: 'id_1', '2.6.1': 'id_1', '2.6.2': '轻' },
      { id: 'id_2', '2.6.1': 'id_2', '2.6.2': '中' },
    ])
    expect(tree['2.4']).toEqual([
      { id: 'id_1', '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '是' },
      { id: 'id_2', '2.4.1': '斗篷', '2.4.2': 1, '2.4.3': '是' },
      { id: 'id_3', '2.4.1': '银币', '2.4.2': 3, '2.4.3': '否' },
    ])
    expect(tree['1.4']).toEqual([
      { id: 'id_1', '1.4.1': '微醺', '1.4.2': '脚步有点飘' },
      { id: 'id_2', '1.4.1': '潮湿', '1.4.2': '衣服贴在身上' },
    ])
  })

  it('同号 id 是两个数组的记录：2.5 的 id_1 是短剑，2.6.1 的 id_1 是微醺', async () => {
    expect(JSON.parse(await statePayload(sampleCard(), '2.5'))).toEqual({ ['物品']: '短剑' })
    const buffs = JSON.parse(await statePayload(sampleCard(), '2.6'))
    expect(buffs[0].来源).toEqual({ ['名称']: '微醺', ['描述']: '脚步有点飘' })
    expect(buffs[1].来源).toEqual({ ['名称']: '潮湿', ['描述']: '衣服贴在身上' })
  })

  it('模型整表写 2.4 要带回原 id：带回 ⇒ 保留身份；丢 id / 改 id ⇒ 拒绝（验收 26）', async () => {
    const { applyWrite } = await loadEngine()
    const card = sampleCard()
    const node = card.chain.find((item) => item.id === 'check')
    const tree = treeOf(card)
    const renamed = tree['2.4'].map((item) => (item.id === 'id_1' ? { ...item, '2.4.1': '长剑' } : item))
    const written = applyWrite({ card, node, tree, path: '2.4', value: renamed })
    expect(written['2.4'].map((item) => item.id)).toEqual(['id_1', 'id_2', 'id_3'])
    expect(written['2.4'][0]['2.4.1']).toBe('长剑')
    expect(written['2.5'], '主手仍指向 id_1').toBe('id_1')

    const changed = tree['2.4'].map((item) => (item.id === 'id_1' ? { ...item, id: 'id_7' } : item))
    expect(
      errorOf(() => applyWrite({ card, node, tree, path: '2.4', value: changed })),
      '改 id 被拒',
    ).not.toBeNull()
    const dropped = tree['2.4'].filter((item) => item.id !== 'id_1')
    expect(
      errorOf(() => applyWrite({ card, node, tree, path: '2.4', value: dropped })),
      '删掉 id_1 被拒',
    ).not.toBeNull()
  })

  it('旧存档的初始树也过得了校验；2.5 = null（min = 0）同样合法（验收 3）', async () => {
    const { validateSave } = await loadSchema()
    const { saveTreeIssues } = await loadState()
    const card = sampleCard()
    expect(() => validateSave(saveOf(card), card)).not.toThrow()
    expect(saveTreeIssues(card, treeOf(card))).toEqual([])
    const emptyHand = { ...treeOf(card), 2.5: null }
    expect(() => validateSave(saveOf(card, { tree: emptyHand }), card)).not.toThrow()
    const emptyHandCard = patchInitial(card, '2.5', null)
    expect(await statePayload(emptyHandCard, '2.5')).toBe('null')
  })
})

describe('晨风镇 stage 4 · 提示词（§11.3 · 验收 13 / 21 / 26）', () => {
  it('状态段：2.4 每项带 id、2.5 投影成对象、2.6 每条来源递归投影（不打印指针）', async () => {
    const card = sampleCard()
    const { buildPrompt } = await loadPrompt()
    const prompt = buildPrompt({
      card,
      save: saveOf(card),
      node: card.chain.find((node) => node.id === 'output'),
      action: 'ACT',
      outputs: {},
    })
    const lines = stateLines(prompt)
    const bag = JSON.parse(payloadOf(lineOf(lines, '2.4')))
    expect(
      bag.map((item) => item.id),
      '数组行每项都要带 id（§7.1 例）',
    ).toEqual(['id_1', 'id_2', 'id_3'])
    expect(bag[0]).toEqual({ id: 'id_1', ['物品']: '短剑', ['数量']: 1, ['可手持']: '是' })
    expect(prompt, '整份提示词里能看见 id').toContain('"id_1"')
    expect(JSON.parse(payloadOf(lineOf(lines, '2.5'))), '引用值仍是投影').toEqual({ ['物品']: '短剑' })
    const buffs = JSON.parse(payloadOf(lineOf(lines, '2.6')))
    expect(buffs, '数组 item 内引用字段递归投影，item 自己的 id 也在').toEqual([
      { id: 'id_1', ['来源']: { ['名称']: '微醺', ['描述']: '脚步有点飘' }, ['严重程度']: '轻' },
      { id: 'id_2', ['来源']: { ['名称']: '潮湿', ['描述']: '衣服贴在身上' }, ['严重程度']: '中' },
    ])
  })

  it('模型写 2.5：银币（可手持 = 否）被拒并点名过滤；短剑可写（验收 16）', async () => {
    const { applyWrite } = await loadEngine()
    const card = sampleCard()
    const node = card.chain.find((item) => item.id === 'check')
    const tree = treeOf(card)
    const bad = errorOf(() => applyWrite({ card, node, tree, path: '2.5', value: 'id_3' }))
    expect(bad, '银币不该能当主手').not.toBeNull()
    expect(bad.code).toBe('E_VALIDATION')
    expect(bad.message).toMatch(CJK)
    expect(`${bad.message} ${JSON.stringify(bad.detail ?? {})}`).toMatch(/2\.4(\.3)?|过滤/)
    expect(applyWrite({ card, node, tree, path: '2.5', value: 'id_1' })['2.5']).toBe('id_1')
  })

  it('同一种增益挂两条：两条都指向 1.4 的 id_1，严重程度各自独立（验收 19）', async () => {
    const { validateSave } = await loadSchema()
    const { saveTreeIssues } = await loadState()
    const card = sampleCard()
    const twice = {
      ...treeOf(card),
      2.6: [
        { id: 'id_1', '2.6.1': 'id_1', '2.6.2': '轻' },
        { id: 'id_2', '2.6.1': 'id_1', '2.6.2': '重' },
      ],
    }
    expect(saveTreeIssues(card, twice)).toEqual([])
    expect(() => validateSave(saveOf(card, { tree: twice }), card)).not.toThrow()
  })

  it('删除正被 2.6.1 引用的增益定义 ⇒ 拒绝并点名 2.6（验收 20）', async () => {
    const { applyWrite } = await loadEngine()
    const card = sampleCard()
    const node = card.chain.find((item) => item.id === 'check')
    const tree = treeOf(card)
    expect(Array.isArray(tree['1.4']), '样例卡必须有 1.4 增益定义（§11.1）').toBe(true)
    const dropped = tree['1.4'].filter((item) => item.id !== 'id_1')
    const error = errorOf(() => applyWrite({ card, node, tree, path: '1.4', value: dropped }))
    expect(error, '删掉 2.6.1 指着的增益定义应当被拒').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(`${error.message} ${JSON.stringify(error.detail ?? {})}`).toMatch(/2\.6/)
  })

  it('改源 item 的显示字段 ⇒ 引用读到新值（验收 12）', async () => {
    const items = JSON.parse(JSON.stringify(treeOf(sampleCard())['2.4']))
    items[0]['2.4.1'] = '长剑'
    const card = patchInitial(sampleCard(), '2.4', items)
    expect(JSON.parse(await statePayload(card, '2.5'))).toEqual({ ['物品']: '长剑' })
  })
})

/** 换一个根元素的初始值表里的一条（样例卡专用；不引入夹具的其它形状假设） */
function patchInitial(card, path, value) {
  const rootCode = path.split('.')[0]
  return {
    ...card,
    state: card.state.map((item) =>
      item.code === rootCode ? { ...item, initial: { ...item.initial, [path]: value } } : item,
    ),
  }
}
