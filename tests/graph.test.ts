/**
 * 图执行器（src/agent/graph.ts）—— 阶段 3 装的那台机器。
 *
 * 这里只测机器本身：节点是假的、产出是假串。要证明五件事：
 * 顺序与上游累加、错原样上抛、取消后不再跑、单节点 = 直接调它、空图快速失败。
 */
import { describe, expect, it } from 'vitest'
import { executeGraph, type Graph, type GraphEvent, type GraphNode, type NodeInput } from '../src/agent/graph'

/** ASCII 夹具：节点 id 与产出都取得能看出顺序 */
const NODE_A = 'node-a'
const NODE_B = 'node-b'
const NODE_C = 'node-c'
const OUT_A = 'out-a'
const OUT_B = 'out-b'
const OUT_C = 'out-c'

/** 造一个只会记录、不会出错的假节点：跑的时候把 id 压进 order、把输入压进 inputs */
function recorder(id: string, output: string, order: string[], inputs: NodeInput[] = []): GraphNode {
  return {
    id,
    /** 记录这一次调用，然后交回固定产出 */
    run: async (input) => {
      order.push(id)
      inputs.push(input)
      return output
    },
  }
}

describe('executeGraph -- order and upstream', () => {
  it('runs nodes in order and hands each one the outputs of every node before it', async () => {
    const order: string[] = []
    const inputs: NodeInput[] = []
    const graph: Graph = {
      nodes: [
        recorder(NODE_A, OUT_A, order, inputs),
        recorder(NODE_B, OUT_B, order, inputs),
        recorder(NODE_C, OUT_C, order, inputs),
      ],
    }

    const outputs = await executeGraph(graph)

    expect(order).toEqual([NODE_A, NODE_B, NODE_C])
    expect(outputs).toEqual([OUT_A, OUT_B, OUT_C])
    // 第 n 个拿到的 = 排在它前面的节点的产出，顺序就是拓扑顺序（决定 #26）
    expect(inputs[1].upstream).toEqual([{ node: NODE_A, output: OUT_A }])
    expect(inputs[2].upstream).toEqual([
      { node: NODE_A, output: OUT_A },
      { node: NODE_B, output: OUT_B },
    ])
    // ⚠️ 整个图跑完再回头看第一个节点那份：必须仍是空数组
    //    （执行器后面累加的产出不能出现在已经交给它的那份输入里）
    expect(inputs[0].upstream).toEqual([])
  })
})

describe('executeGraph -- errors propagate untouched', () => {
  it('rethrows the very error a node threw, and stops the nodes after it', async () => {
    const boom = new Error('node-b exploded')
    const order: string[] = []
    const graph: Graph = {
      nodes: [
        recorder(NODE_A, OUT_A, order),
        {
          id: NODE_B,
          /** 抛错节点：记一笔就抛，用来验证错误原样上抛 */
          run: async () => {
            order.push(NODE_B)
            throw boom
          },
        },
        recorder(NODE_C, OUT_C, order),
      ],
    }

    await expect(executeGraph(graph)).rejects.toBe(boom)
    expect(order).toEqual([NODE_A, NODE_B])
  })
})

describe('executeGraph -- cancellation', () => {
  it('an already-aborted signal runs no node at all', async () => {
    const order: string[] = []
    const controller = new AbortController()
    controller.abort()
    const graph: Graph = { nodes: [recorder(NODE_A, OUT_A, order), recorder(NODE_B, OUT_B, order)] }

    // 消息是协议层的（'aborted'）：断言 name，不比文案
    await expect(executeGraph(graph, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(order).toEqual([])
  })

  it('stops right after the node that aborted the signal', async () => {
    const order: string[] = []
    const controller = new AbortController()
    const graph: Graph = {
      nodes: [
        {
          id: NODE_A,
          /** 一跑就取消信号：用来验证后面的节点不再执行 */
          run: async () => {
            order.push(NODE_A)
            controller.abort()
            return OUT_A
          },
        },
        recorder(NODE_B, OUT_B, order),
        recorder(NODE_C, OUT_C, order),
      ],
    }

    await expect(executeGraph(graph, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(order).toEqual([NODE_A])
  })
})

describe('executeGraph -- the degenerate shapes', () => {
  it('a one-node graph is exactly that node, called once with no upstream', async () => {
    const inputs: NodeInput[] = []
    const events: GraphEvent[] = []
    const graph: Graph = {
      nodes: [
        {
          id: NODE_A,
          /** 单节点图的节点：只记下收到的输入 */
          run: async (input) => {
            inputs.push(input)
            return OUT_A
          },
        },
      ],
    }

    const outputs = await executeGraph(graph, { onEvent: (evt) => events.push(evt) })

    expect(outputs).toEqual([OUT_A])
    expect(inputs).toEqual([{ upstream: [], signal: undefined }])
    // 每跑一个节点回传一次进度（本阶段 runTurn 不把它转给界面，见 src/agent/agent.ts）
    expect(events).toEqual([{ type: 'node', id: NODE_A }])
  })

  it('an empty graph fails fast instead of quietly returning an empty round', async () => {
    await expect(executeGraph({ nodes: [] })).rejects.toThrow('graph has no nodes')
  })
})
