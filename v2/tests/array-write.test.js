/**
 * 阶段 3 · 数组节点：工具 schema 与整表写入（数组契约 §六）。
 *
 * 这一份钉的是引擎那条路：
 *   · `write_state` 的 value schema 同时收 JSON 数组 / 对象（模型才可能发整份数组）；
 *   · 命中数组值路径 ⇒ **整表替换**：旧 item 全消失、新 item 按给定顺序落盘；
 *   · item 形状按 §3.2 严格收；形状不对 ⇒ `E_VALIDATION`、tree 一个字不动；
 *   · 数组路径不在 writable 覆盖内 / 写 2.4.0 / 写 2.4.1.0 ⇒ `E_CHAIN`
 *     （字段整列写与「容器写 ⊇ 字段写」见 `array-field-write.test.js`）；
 *   · item 里的 integer **不判步幅**（整表替换没有单次写入的旧值可比），数字字符串不收编。
 */
import { describe, expect, it } from 'vitest'
import {
  holdCard,
  holdItems,
  holdSave,
  nestedCard,
  nestedItems,
  patchElement,
} from './support/array-fixtures.js'
import { loadModule } from './support/load.js'

const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))
const loadTools = () =>
  loadModule('core/tool-definitions.ts', () => import('../src/core/tool-definitions.ts'))
const CJK = /[\u4e00-\u9fff]/

function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** `write_state` 的 value schema（工具表里那一格） */
function valueSchema(defs) {
  return defs.write_state.inputSchema.properties.value
}

describe('数组 · write_state 的 value schema（§六）', () => {
  it('同时收 string / integer / array / object（静态表与按模式生成的那份都一样）', async () => {
    const { TOOL_DEFINITIONS, toolDefinitionsOf } = await loadTools()
    for (const defs of [TOOL_DEFINITIONS, toolDefinitionsOf('year-minute')]) {
      const schema = valueSchema(defs)
      expect(Array.isArray(schema.anyOf), 'value 应当是 anyOf 列表').toBe(true)
      const types = schema.anyOf.map((item) => item.type)
      for (const type of ['string', 'integer', 'array', 'object']) {
        expect(types, `value schema 缺少 ${type}`).toContain(type)
      }
    }
  })
})

describe('数组 · applyWrite 整表替换（§六）', () => {
  it('正控：合法数组整份写进 tree["2.4"]，原 tree 不被改', async () => {
    const { applyWrite } = await loadEngine()
    const card = holdCard()
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    const next = [
      { '2.4.1': '长弓', '2.4.2': 7 },
      { '2.4.1': '火把', '2.4.2': 2 },
    ]
    // 新 item 省略 id ⇒ 引擎按「当前最大编号 + 1」生成（旧数组是 id_1…id_3）
    const expected = next.map((item, index) => ({ id: `id_${4 + index}`, ...item }))
    const written = applyWrite({ card, node, tree, path: '2.4', value: next })
    expect(written['2.4']).toEqual(expected)
    expect(tree['2.4'], '入参 tree 一个字都不许改').toEqual(holdItems())
    expect(Object.keys(written), '不许冒出 2.4.0 / 2.4.1 键').not.toContain('2.4.0')
  })

  it('整表替换：新数组比旧的短 / 长都按新数组来，不是追加', async () => {
    const { applyWrite } = await loadEngine()
    const card = holdCard()
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    const one = applyWrite({ card, node, tree, path: '2.4', value: [{ '2.4.1': '银币', '2.4.2': 100 }] })
    expect(one['2.4']).toHaveLength(1)
    expect(one['2.4'][0]).toEqual({ id: 'id_4', '2.4.1': '银币', '2.4.2': 100 })

    const empty = applyWrite({ card, node, tree, path: '2.4', value: [] })
    expect(empty['2.4']).toEqual([])
  })

  it('嵌套数组 / 对象整份写入', async () => {
    const { applyWrite } = await loadEngine()
    const card = nestedCard()
    const node = card.chain.find((item) => item.id === 'check')
    // 外层 item 换成全新的一条（省略 id ⇒ 生成 id_2，旧数组只有 id_1）；
    // 嵌套数组的旧 item 也是 id_1 ⇒ 新嵌套 item 取旧最大 + 1（id_2 / id_3）
    const next = [
      {
        '2.4.1': '法杖',
        '2.4.2': {
          '2.4.2.1': '稀有',
          '2.4.2.2': [
            { '2.4.2.2.1': '回响', '2.4.2.2.2': 9 },
            { '2.4.2.2.1': '微光', '2.4.2.2.2': 1 },
          ],
        },
      },
    ]
    const expected = [
      {
        id: 'id_2',
        '2.4.1': '法杖',
        '2.4.2': {
          '2.4.2.1': '稀有',
          '2.4.2.2': [
            { id: 'id_2', '2.4.2.2.1': '回响', '2.4.2.2.2': 9 },
            { id: 'id_3', '2.4.2.2.1': '微光', '2.4.2.2.2': 1 },
          ],
        },
      },
    ]
    const written = applyWrite({ card, node, tree: holdSave(card).tree, path: '2.4', value: next })
    expect(written['2.4']).toEqual(expected)
  })

  it('item 形状不对 ⇒ E_VALIDATION + 中文，tree 一个字不动', async () => {
    const { applyWrite } = await loadEngine()
    const card = holdCard()
    const node = card.chain.find((item) => item.id === 'check')
    const tree = holdSave(card).tree
    const bad = [
      ['不是数组', { id: 'id_1', '2.4.1': '短剑', '2.4.2': 1 }],
      ['item 不是对象', ['短剑']],
      ['缺字段', [{ id: 'id_1', '2.4.1': '短剑' }]],
      ['多字段', [{ id: 'id_1', '2.4.1': '短剑', '2.4.2': 1, '2.4.3': 'X' }]],
      ['id 不是 id_N 形状', [{ id: 'it_1', '2.4.1': '短剑', '2.4.2': 1 }]],
      ['text 写成数字', [{ id: 'id_1', '2.4.1': 7, '2.4.2': 1 }]],
      ['integer 写成字符串', [{ id: 'id_1', '2.4.1': '短剑', '2.4.2': '1' }]],
      ['integer 越界', [{ id: 'id_1', '2.4.1': '短剑', '2.4.2': 1000 }]],
    ]
    for (const [note, value] of bad) {
      const error = errorOf(() => applyWrite({ card, node, tree, path: '2.4', value }))
      expect(error, `${note}：应当被拒`).not.toBeNull()
      expect(error.code, `${note}：值错是 E_VALIDATION`).toBe('E_VALIDATION')
      expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
      expect(tree['2.4'], `${note}：失败的写不许改 tree`).toEqual(holdItems())
    }
  })

  it('嵌套 item 形状不对 ⇒ E_VALIDATION', async () => {
    const { applyWrite } = await loadEngine()
    const card = nestedCard()
    const node = card.chain.find((item) => item.id === 'check')
    const bad = JSON.parse(JSON.stringify(nestedItems()))
    bad[0]['2.4.2']['2.4.2.2'][0]['2.4.2.2.2'] = 11
    const error = errorOf(() =>
      applyWrite({ card, node, tree: holdSave(card).tree, path: '2.4', value: bad }),
    )
    expect(error?.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })

  it('item 里的 integer 不判步幅：stepMin=50 时整表写入数量 1 仍然成功', async () => {
    const { applyWrite } = await loadEngine()
    const card = patchElement(holdCard(), '2.4.2', { stepMin: 50, stepMax: 100 })
    const node = card.chain.find((item) => item.id === 'check')
    const next = [{ '2.4.1': '银币', '2.4.2': 1 }]
    const expected = [{ id: 'id_4', ...next[0] }]
    const written = applyWrite({
      card,
      node,
      tree: holdSave(card).tree,
      path: '2.4',
      value: next,
    })
    expect(written['2.4']).toEqual(expected)
  })

  it('路径不在 writable 覆盖内 / 不是引用 ⇒ E_CHAIN（容器授权字段写在另一份判据里）', async () => {
    const { applyWrite } = await loadEngine()
    const card = holdCard()
    const tree = holdSave(card).tree
    const noWrite = card.chain.find((item) => item.id === 'output')
    expect(
      errorOf(() => applyWrite({ card, node: noWrite, tree, path: '2.4', value: [] }))?.code,
      'output 节点什么也不写',
    ).toBe('E_CHAIN')

    const check = card.chain.find((item) => item.id === 'check')
    // 2.4.0 / 2.4.1.0 不是引用、也不是值路径：容器 2.4 的授权也覆盖不到它们。
    for (const path of ['2.4.0', '2.4.1.0']) {
      const error = errorOf(() => applyWrite({ card, node: check, tree, path, value: 'X' }))
      expect(error, `${path} 不是引用`).not.toBeNull()
      expect(error.code).toBe('E_CHAIN')
      expect(error.message).toMatch(CJK)
    }
    expect(tree['2.4']).toEqual(holdItems())
  })
})
