/**
 * card-graph 测试 —— 把卡摊成图的那层纯逻辑。
 *
 * 三条验收标准：示例卡画出 9 个节点、8 条主干边与约定里逐行写明的读边；节点顺序就是拓扑；
 * 自造的最小卡（两个节点、没有上游）也画得出来 —— 图的形状全部从 JSON 推，
 * 这里不认《晨风镇》的任何事实（除了断言里那几个「这张卡就是长这样」的期望值）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCard, validateCard } from '../src/game/card'
import { KEY_DUTY, KEY_NODES, KEY_NODE_NAME, KEY_TOPOLOGY } from '../src/game/card-keys'
import { READ_LABEL, toGraph } from '../src/dev/card-graph'
import { EXAMPLE_CARD, NODE_A, NODE_B, minimalCard } from './support/card-fixtures'

const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
const graph = toGraph(card)

/** 拓扑里的节点 id —— 顺序就是卡的执行顺序 */
const topology = card[KEY_TOPOLOGY] as string[]

/**
 * 示例卡「节点约定」里逐行写明的上游个数（按拓扑顺序）：0,1,2,3,4,5,6,7,7。
 * 这是人读卡数出来的期望值，不是实现的复述 —— 卡改了约定，这里要跟着改。
 */
const UPSTREAMS_PER_NODE = [0, 1, 2, 3, 4, 5, 6, 7, 7]

describe('toGraph: the example card', () => {
  it('draws one node per card node, ordered by topology', () => {
    expect(graph.nodes.map((node) => node.id)).toEqual(topology)
    expect(graph.nodes).toHaveLength(9)
  })

  it('labels each node with its card name, and its id plus duty in the sublabel', () => {
    const nodes = card[KEY_NODES] as Array<Record<string, unknown>>
    for (const [index, node] of graph.nodes.entries()) {
      expect(node.label).toBe(nodes[index][KEY_NODE_NAME])
      expect(node.sublabel.startsWith(node.id)).toBe(true)
      expect(node.sublabel).toContain((nodes[index][KEY_DUTY] as string).slice(0, 10))
    }
  })

  it('keeps the sublabel short: long duties are cut and end with an ellipsis', () => {
    expect(graph.nodes.some((node) => node.sublabel.endsWith('\u2026'))).toBe(true)
  })

  it('chains adjacent nodes with one solid edge each (8 edges for 9 nodes)', () => {
    const chain = topology.slice(1).map((id, index) => ({ source: topology[index], target: id, label: '' }))
    expect(chain).toHaveLength(8)
    expect(graph.edges.filter((edge) => edge.label === '')).toEqual(chain)
  })

  it('draws one dashed read edge per upstream the convention names', () => {
    const reads = graph.edges.filter((edge) => edge.label === READ_LABEL)
    expect(reads).toHaveLength(35)
    // 每一行的上游正好是排在它前面的那几个：④ 时间读 ③ 大纲、「或者」⑧ 主读 ①–⑦ 都在里面
    UPSTREAMS_PER_NODE.forEach((count, index) => {
      const sources = reads.filter((edge) => edge.target === topology[index]).map((edge) => edge.source)
      expect(sources).toEqual(topology.slice(index - count, index))
    })
  })

  it('never draws a read edge from a node that runs later', () => {
    const reads = graph.edges.filter((edge) => edge.label === READ_LABEL)
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

  it('draws the single solid edge and no read edges (the convention names no upstream)', () => {
    expect(minimal.edges).toEqual([{ source: NODE_A, target: NODE_B, label: '' }])
  })
})
