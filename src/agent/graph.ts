/**
 * src/agent/graph.ts —— 图执行器：照着一张图跑完一轮。
 *
 * 一张图 = **有序的节点数组**；一个节点 = **id + 一个 run 函数**（决定 #25/#37）。
 * 执行器只做三件事：按顺序跑节点、把已跑完节点的产出按顺序作为 upstream 交给下一个、
 * 出错原样上抛。它不认卡、不认晨风镇、不认 Vue —— 卡到图的翻译是别处的事
 * （doc/DESIGN.md 第四节）。本阶段的默认图只有一个节点，就是 agent 循环。
 *
 * 三条纪律：
 *   · 上游按拓扑顺序累加，且只含**已经跑完**的节点（决定 #26）
 *   · 节点抛出的错原样上抛，不包装也不吞（决定 #27 的「一轮是一个事务」靠它）
 *   · 取消立刻停：抛 AbortError，后面的节点一个都不跑
 */

import type { UpstreamOutput } from '../game/state'

/** 一个节点本轮拿到的输入 */
export interface NodeInput {
  /** 排在本节点前面、**本轮**已经跑完的节点产出，按拓扑顺序；第一个节点拿到空数组 */
  upstream: UpstreamOutput[]
  /** 取消信号：节点发起请求时透传给下层的 fetch，别自己吞 */
  signal?: AbortSignal
}

/** 图上的一个节点：id 是它在上下游里的名字，run 返回它本轮的产出原文 */
export interface GraphNode {
  id: string
  run: (input: NodeInput) => Promise<string>
}

/** 一张图：数组顺序就是执行顺序（本阶段是线性图，决定 #25） */
export interface Graph {
  nodes: GraphNode[]
}

/**
 * 执行一步时回传给调用方的事件。
 *
 * ⚠️ 用独立的 node 事件，而不是复用 AgentEvent 的 thinking：后者表达的是「模型第几步」，
 *    这里表达的是「轮到哪个节点」—— 九节点图里两者会同时出现，混用会丢掉一个维度。
 */
export interface GraphEvent {
  type: 'node'
  id: string
}

/** 执行器要的调用方环境 */
export interface GraphDeps {
  /** 取消信号 */
  signal?: AbortSignal
  /** 进入每个节点时回传一次；不传表示调用方不关心进度 */
  onEvent?: (evt: GraphEvent) => void
}

/**
 * 按顺序跑完一张图，返回每个节点本轮的产出原文（数组顺序 = 节点顺序）。
 *
 * @param graph 要跑的图
 * @param deps 取消信号与进度事件回调
 *
 * ⚠️ 空图**抛错**，不返回空结果：零个节点跑完等于「这一轮什么都没发生」，
 *    静默成功会让坏卡看起来像正常回合 —— 快速失败比一个空回合好排查。
 */
export async function executeGraph(graph: Graph, deps: GraphDeps = {}): Promise<string[]> {
  if (!graph.nodes.length) throw new Error('executeGraph: graph has no nodes')

  const upstream: UpstreamOutput[] = []
  const outputs: string[] = []
  for (const node of graph.nodes) {
    if (deps.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    deps.onEvent?.({ type: 'node', id: node.id })
    // 交给节点的是**快照**：节点拿到手之后，执行器继续累加的那份不会变到它眼皮底下
    const output = await node.run({ upstream: upstream.slice(), signal: deps.signal })
    outputs.push(output)
    upstream.push({ node: node.id, output })
  }
  return outputs
}
