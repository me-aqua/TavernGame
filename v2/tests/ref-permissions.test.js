/**
 * 阶段 4 · 写权限的方向性传播（引用契约 §8.4 · 验收 23）。
 *
 * 写权限**只从源数组容器流向引用者**，不反向，且只走一跳：
 *   · 写 `2.4 背包`（能增删 item / 整表替换）⇒ 自动获得**直接引用 `2.4` 的 ref 的自身值写权限**
 *     （`2.5` 改指针 / 清成 null；带子元素时是 `2.5.0`）；
 *   · 只给 ref **自身值**，不给 ref 子元素（握法、临时附魔）；
 *   · **字段写不传播**：写 `2.4.1` / `2.4.2` / `2.4.3` ⇒ 不获得 `2.5`；
 *   · **反向不传播**：写 `2.5` 不获得写 `2.4`；
 *   · 只走**直接引用**：写 `2.4` 不获得写 `2.8`（`2.8` 引用的是嵌套数组 `2.4.4`）。
 *
 * ⚠️ 「派生写权限必须在编辑器里显示（例如『随 2.4 级联』）」没有数据层入口（那是编辑器那一格），
 * 这一份只钉**许可本身**。
 */
import { describe, expect, it } from 'vitest'
import {
  bagItems,
  itemRefChildCard,
  nodeOf,
  patchNode,
  refCard,
  refChildCard,
  saveOf,
  scalarChildRefCard,
  treeOf,
} from './support/ref-fixtures.js'
import { loadModule } from './support/load.js'

const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

const CJK = /[\u4e00-\u9fff]/

/** 只改 `check` 节点的 writable，然后写一条路径；成功返回新 tree */
async function writeWith(card, writable, path, value) {
  const { applyWrite } = await loadEngine()
  const node = { ...nodeOf(card, 'check'), writable }
  return applyWrite({ card, node, tree: treeOf(card), path, value })
}

/** 同上，但期望被拒；返回抛出来的错误（没抛 ⇒ null） */
async function writeErrorWith(card, writable, path, value) {
  const { applyWrite } = await loadEngine()
  const node = { ...nodeOf(card, 'check'), writable }
  try {
    applyWrite({ card, node, tree: treeOf(card), path, value })
    return null
  } catch (cause) {
    return cause
  }
}

describe('写权限 · 源数组容器写 ⇒ 直接引用者的自身值可写（§8.4）', () => {
  it('writable = ["2.4"] ⇒ 可以改 2.5 的指针（id）/ 清成 null', async () => {
    const card = refCard()
    expect(await writeWith(card, ['2.4'], '2.5', 'id_2')).toBeTruthy()
    expect((await writeWith(card, ['2.4'], '2.5', 'id_2'))['2.5']).toBe('id_2')
    expect((await writeWith(card, ['2.4'], '2.5', null))['2.5']).toBeNull()
  })

  it('多个直接引用者都获得：2.5 与 2.7 都指向 2.4', async () => {
    const card = refCard()
    expect((await writeWith(card, ['2.4'], '2.5', 'id_2'))['2.5']).toBe('id_2')
    expect((await writeWith(card, ['2.4'], '2.7', 'id_2'))['2.7']).toBe('id_2')
  })

  it('带子元素时给的是自身值 2.5.0（不是裸 2.5）', async () => {
    const card = refChildCard()
    const written = await writeWith(card, ['2.4'], '2.5.0', null)
    expect(written['2.5.0']).toBeNull()
  })

  it('只给 ref 自身值：写 2.5.1（握法，关系子元素）⇒ E_CHAIN', async () => {
    const card = refChildCard()
    const error = await writeErrorWith(card, ['2.4'], '2.5.1', '双手')
    expect(error, '源写不带出 ref 子元素的写权限').not.toBeNull()
    expect(error.code).toBe('E_CHAIN')
    expect(error.message).toMatch(CJK)
  })

  it('改指针不动源 item（写的是引用值，不是背包）', async () => {
    const card = refCard()
    const tree = treeOf(card)
    const { applyWrite } = await loadEngine()
    const written = applyWrite({
      card,
      node: { ...nodeOf(card, 'check'), writable: ['2.4'] },
      tree,
      path: '2.5',
      value: 'id_2',
    })
    expect(written['2.4'], '源 item 一个字不动').toEqual(bagItems())
    expect(written['2.5']).toBe('id_2')
  })
})

describe('写权限 · 不传播的两侧（§8.4）', () => {
  it('字段写不传播：writable = ["2.4.1"] ⇒ 写 2.5 ⇒ E_CHAIN', async () => {
    const card = refCard()
    const error = await writeErrorWith(card, ['2.4.1'], '2.5', null)
    expect(error, '只改一列不增删 item，不该获得清引用权限').not.toBeNull()
    expect(error.code).toBe('E_CHAIN')
  })

  it('反向不传播：writable = ["2.5"] ⇒ 写 2.4 ⇒ E_CHAIN', async () => {
    const card = refCard()
    const error = await writeErrorWith(card, ['2.5'], '2.4', bagItems())
    expect(error, '改引用不获得写源的权限').not.toBeNull()
    expect(error.code).toBe('E_CHAIN')
  })

  it('传播只给直接引用者：写 2.4 带出 2.5 / 2.7，但不带出引用 1.4 的 2.6.1', async () => {
    // 2026-11-28 收敛后「嵌套数组当源」被删掉，原「只走一跳（2.8 引用 2.4.4）」没有实例了；
    // 这里钉同一件事的另一面：传播只认自己那条源数组，不串到别的数组的引用者。
    const card = refCard()
    expect((await writeWith(card, ['2.4'], '2.5', 'id_2'))['2.5'], '直接引用者 2.5 可写').toBe('id_2')
    expect((await writeWith(card, ['2.4'], '2.7', null))['2.7'], '直接引用者 2.7 可写').toBeNull()
    const denied = await writeErrorWith(card, ['2.4'], '2.6.1', null)
    expect(denied, '2.6.1 引用的是 1.4，和 2.4 无关').not.toBeNull()
    expect(denied.code).toBe('E_CHAIN')
  })
  it('派生写权限关掉就消失：writable 里没有 2.4、只有 2.5 ⇒ 两侧都只认自己', async () => {
    const card = refCard()
    expect((await writeWith(card, ['2.5'], '2.5', 'id_2'))['2.5']).toBe('id_2')
    expect(await writeErrorWith(card, ['2.5'], '2.4', [])).not.toBeNull()
  })
})

describe('写权限 · 工具派生（§7.2「引用路径对模型可写」）', () => {
  it('只写引用（writable = ["2.5"]）也发 write_state（该节点能改指针）', async () => {
    const { toolsForNode } = await loadSchema()
    const card = patchNode(refCard(), 'check', { writable: ['2.5'] })
    expect(toolsForNode(card, nodeOf(card, 'check'))).toContain('write_state')
  })

  it('只读引用（没有任何 writable）⇒ 该节点没有工具', async () => {
    const { toolsForNode } = await loadSchema()
    const card = patchNode(refCard(), 'check', { writable: [] })
    expect(toolsForNode(card, nodeOf(card, 'check'))).toEqual([])
    expect(saveOf(card).tree['2.5'], '读引用不需要写权限').toBe('id_1')
  })
})

describe('写权限 · item / 更深位置上的直接引用者（派生）', () => {
  it('写源数组 1.4 ⇒ item 里 ref 的**自身值**可写（有孩子的标量字段下也照给）', async () => {
    const card = scalarChildRefCard()
    const written = await writeWith(card, ['1.4'], '2.4.1.1', ['id_2', null, null])
    expect(written['2.4'][0]['2.4.1']['2.4.1.1'], '指针写进去了').toBe('id_2')
    expect(written['2.4'][1]['2.4.1']['2.4.1.1'], 'null 清空也授权').toBeNull()
    expect(written['2.4'][0]['2.4.1']['2.4.1.0'], '自己的值不动').toBe('短剑')
  })

  it('派生只给自身值：写 ref 的**子元素**仍然 E_CHAIN', async () => {
    const card = itemRefChildCard()
    const denied = await writeErrorWith(card, ['1.4'], '2.6.1.1', ['双手', '单手'])
    expect(denied, '源数组写权限不带出 ref 子元素的写权限').not.toBeNull()
    expect(denied.code).toBe('E_CHAIN')
  })
})
