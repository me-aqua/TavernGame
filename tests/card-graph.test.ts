/**
 * card-graph 测试 —— 把卡摊成图的那层纯逻辑。
 *
 * 三条验收标准：示例卡画出 9 个节点、8 条主干边与 36 条读边（上游 = 拓扑前缀）；
 * 节点顺序就是拓扑；自造的最小卡（两个节点）也画得出来 —— 图的形状全部从 JSON 推，
 * 这里不认《晨风镇》的任何事实（除了断言里那几个「这张卡就是长这样」的期望值）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCard, validateCard } from '../src/game/card'
import { KEY_DECL, KEY_DUTY, KEY_GRAPH, KEY_NODES, KEY_NODE_NAME, KEY_TOPOLOGY } from '../src/game/card-keys'
import { toGraph, type CardGraphLayout } from '../src/dev/card-graph'
import { EXAMPLE_CARD, NODE_A, NODE_B, minimalCard } from './support/card-fixtures'

const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
// 显示模型的类型带 Card 前缀：它与执行器的 Graph 同名不同义（agent/graph.ts）
const graph: CardGraphLayout = toGraph(card)

/** 卡里的图 —— 拓扑（顺序）与节点（名 / 职责）都从这一处取 */
const declared = (card[KEY_DECL] as Record<string, unknown>)[KEY_GRAPH] as Record<string, unknown>
/** 拓扑里的节点 id —— 顺序就是卡的执行顺序 */
const topology = declared[KEY_TOPOLOGY] as string[]
/** 图里的节点：键是 id，值是名 / 职责 / 输出 */
const nodes = declared[KEY_NODES] as Record<string, Record<string, unknown>>

describe('toGraph: the example card', () => {
  it('draws one node per card node, ordered by topology', () => {
    expect(graph.nodes.map((node) => node.id)).toEqual(topology)
    expect(graph.nodes).toHaveLength(9)
  })

  it('labels each node with its card name, and its id plus duty in the sublabel', () => {
    for (const [index, node] of graph.nodes.entries()) {
      expect(node.label).toBe(nodes[topology[index]][KEY_NODE_NAME])
      expect(node.sublabel.startsWith(node.id)).toBe(true)
      expect(node.sublabel).toContain((nodes[topology[index]][KEY_DUTY] as string).slice(0, 10))
    }
  })

  it('keeps the sublabel short: long duties are cut and end with an ellipsis', () => {
    expect(graph.nodes.some((node) => node.sublabel.endsWith('\u2026'))).toBe(true)
  })

  it('chains adjacent nodes with one solid edge each (8 edges for 9 nodes)', () => {
    const chain = topology.slice(1).map((id, index) => ({ source: topology[index], target: id, read: false }))
    expect(chain).toHaveLength(8)
    expect(graph.edges.filter((edge) => !edge.read)).toEqual(chain)
  })

  it('draws one dashed read edge per upstream: the whole topology prefix', () => {
    const reads = graph.edges.filter((edge) => edge.read)
    expect(reads).toHaveLength(36)
    topology.forEach((id, index) => {
      const sources = reads.filter((edge) => edge.target === id).map((edge) => edge.source)
      expect(sources).toEqual(topology.slice(0, index))
    })
  })

  it('never draws a read edge from a node that runs later', () => {
    const reads = graph.edges.filter((edge) => edge.read)
    expect(reads.every((edge) => topology.indexOf(edge.source) < topology.indexOf(edge.target))).toBe(true)
  })

  it('lays the nodes out at distinct positions (the viewer reads them as coordinates)', () => {
    const places = graph.nodes.map((node) => node.position.x + ':' + node.position.y)
    expect(new Set(places).size).toBe(graph.nodes.length)
  })
})

describe('toGraph: a hand-made minimal card', () => {
  const minimal = toGraph(validateCard(minimalCard()))

  it('draws the two nodes in topology order', () => {
    expect(minimal.nodes.map((node) => node.id)).toEqual([NODE_A, NODE_B])
  })

  it('draws the solid chain plus the read edge the prefix implies', () => {
    expect(minimal.edges).toEqual([
      { source: NODE_A, target: NODE_B, read: false },
      { source: NODE_A, target: NODE_B, read: true },
    ])
  })
})
