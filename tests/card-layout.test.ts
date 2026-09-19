/**
 * card-layout 测试 —— 把卡摊成图的那层纯逻辑（src/game/card-layout.ts）。
 *
 * 四条验收标准：节点按拓扑一条链、带序号（① ② ③）；主干每条相邻关系一条边，
 * 跨行那条带**折行序号**（行间留回边通道）；读边 = 拓扑前缀（9 节点 36 条），
 * 但只是数据 —— 默认画不画由界面按选中 / 悬停决定；自造的最小卡也画得出来。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCard, validateCard } from '../src/game/card'
import { numeral, toGraph, type CardGraphLayout } from '../src/game/card-layout'
import { EXAMPLE_CARD, NODE_A, NODE_B, minimalCard } from './support/card-fixtures'

const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
// 显示模型的类型带 Card 前缀：它与执行器的图同名不同义（agent/card-graph.ts）
const graph: CardGraphLayout = toGraph(card)

/** 卡里的图 —— 拓扑（顺序）与节点（名 / 职责 / 声明）都从这一处取 */
const declared = card.graph
/** 拓扑里的节点 id —— 顺序就是卡的执行顺序 */
const topology = declared.topology
/** 图里的节点：键是 id，值是名 / 职责 / 声明 */
const nodes = declared.nodes

/** 主干边（含跨行的折行边）—— 读者默认看得见的那一条链 */
const chain = graph.edges.filter((edge) => edge.kind !== 'read')
/** 读边（上游 = 拓扑前缀）—— 选中 / 悬停那个节点时才画 */
const reads = graph.edges.filter((edge) => edge.kind === 'read')

/** 一行最多几个节点（与 card-layout 的 COLUMNS 一致；折行点靠它算） */
const COLUMNS = 5

describe('toGraph: the example card', () => {
  it('draws one node per card node, ordered by topology, numbered from 1', () => {
    expect(graph.nodes.map((node) => node.id)).toEqual(topology)
    expect(graph.nodes).toHaveLength(topology.length)
    expect(graph.nodes.map((node) => node.index)).toEqual(topology.map((_, index) => index + 1))
  })

  it('labels each node with its number and name, and its id plus duty in the sublabel', () => {
    for (const [index, node] of graph.nodes.entries()) {
      const id = topology[index]
      expect(node.label).toBe(numeral(index + 1) + ' ' + nodes[id].name)
      expect(node.sublabel.startsWith(id)).toBe(true)
      expect(node.sublabel).toContain(nodes[id].duty.slice(0, 10))
    }
  })

  it('keeps the sublabel short: long duties are cut and end with an ellipsis', () => {
    expect(graph.nodes.some((node) => node.sublabel.endsWith('\u2026'))).toBe(true)
  })

  it('carries the declarations the graph annotates: role / tools / reads', () => {
    for (const node of graph.nodes) {
      const declaredNode = nodes[node.id]
      expect(node.role).toBe(declaredNode.role ?? null)
      expect(node.tools).toEqual(declaredNode.tools ?? null)
      expect(node.reads).toEqual(declaredNode.reads ?? null)
    }
    // 恰好一个节点声明 role: story —— 图上那一个带 role 标记
    expect(graph.nodes.filter((node) => node.role === 'story')).toHaveLength(1)
  })

  it('chains adjacent nodes with one solid edge each', () => {
    const chainIds = topology.slice(1).map((id, index) => ({ source: topology[index], target: id }))
    // 相邻两两一条实线，最后一条换成折行回边（wrap）
    expect(chain).toHaveLength(topology.length - 1)
    expect(chain.map(({ source, target }) => ({ source, target }))).toEqual(chainIds)
    expect(chain.filter((edge) => edge.kind === 'chain')).toHaveLength(topology.length - 2)
  })

  it('wraps the chain once and writes the target number on the wrap edge', () => {
    const wraps = chain.filter((edge) => edge.kind === 'wrap')
    expect(wraps).toHaveLength(1)
    // 折行发生在第 5 → 第 6 个节点之间，边上写着 ⑥
    expect(wraps[0].source).toBe(topology[COLUMNS - 1])
    expect(wraps[0].target).toBe(topology[COLUMNS])
    expect(wraps[0].label).toBe(numeral(COLUMNS + 1))
  })

  it('lays the nodes out on rows: same row same y, wrapped row one step lower', () => {
    const rowOf = (index: number) => graph.nodes[index]
    for (let index = 0; index < topology.length; index += 1) {
      expect(rowOf(index).row).toBe(Math.floor(index / COLUMNS))
      if (index % COLUMNS === 0) continue
      expect(rowOf(index).position.y).toBe(rowOf(index - 1).position.y)
      expect(rowOf(index).position.x).toBeGreaterThan(rowOf(index - 1).position.x)
    }
    // 折行那一步：y 往下走，且留出的空档比节点本身高（行间是回边通道）
    const before = rowOf(COLUMNS - 1).position
    const after = rowOf(COLUMNS).position
    expect(after.y - before.y).toBeGreaterThan(180)
    expect(after.x).toBeLessThan(before.x)
  })

  it('lays the nodes out at distinct positions (the viewer reads them as coordinates)', () => {
    const places = graph.nodes.map((node) => node.position.x + ':' + node.position.y)
    expect(new Set(places).size).toBe(graph.nodes.length)
  })

  it('draws one dashed read edge per upstream: the whole topology prefix', () => {
    // 每个节点都读它前面所有的节点 ⇒ 条数是 n(n-1)/2（下面的循环逐条钉住"读了谁"）
    expect(reads).toHaveLength((topology.length * (topology.length - 1)) / 2)
    topology.forEach((id, index) => {
      const sources = reads.filter((edge) => edge.target === id).map((edge) => edge.source)
      expect(sources).toEqual(topology.slice(0, index))
    })
  })

  it('never draws a read edge from a node that runs later', () => {
    expect(reads.every((edge) => topology.indexOf(edge.source) < topology.indexOf(edge.target))).toBe(true)
  })

  it('spells no text on the chain edges (the numbers are the only labels)', () => {
    expect(chain.filter((edge) => edge.kind === 'chain').every((edge) => edge.label === undefined)).toBe(true)
    expect(reads.every((edge) => edge.label === undefined)).toBe(true)
  })
})

describe('numeral', () => {
  it('writes circled numbers up to twenty and plain digits above that', () => {
    expect(numeral(1)).toBe('\u2460')
    expect(numeral(9)).toBe('\u2468')
    expect(numeral(20)).toBe('\u2473')
    expect(numeral(21)).toBe('21')
    expect(numeral(0)).toBe('0')
  })
})

describe('toGraph: a hand-made minimal card', () => {
  const minimal = toGraph(validateCard(minimalCard()))

  it('draws the two nodes in topology order, on one row', () => {
    expect(minimal.nodes.map((node) => node.id)).toEqual([NODE_A, NODE_B])
    expect(minimal.nodes.map((node) => node.row)).toEqual([0, 0])
  })

  it('draws the solid chain plus the read edge the prefix implies (no wrap on one row)', () => {
    expect(minimal.edges).toEqual([
      { source: NODE_A, target: NODE_B, kind: 'chain' },
      { source: NODE_A, target: NODE_B, kind: 'read' },
    ])
  })

  it('keeps the declarations it found, and null where the card wrote none', () => {
    expect(minimal.nodes[0].tools).toEqual(['set_place'])
    expect(minimal.nodes[0].reads).toEqual(['world'])
    expect(minimal.nodes[0].role).toBe(null)
    expect(minimal.nodes[1].role).toBe('story')
    expect(minimal.nodes[1].tools).toEqual([])
    expect(minimal.nodes[1].reads).toBe(null)
  })
})
