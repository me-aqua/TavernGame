/**
 * src/dev/card-graph.ts —— 把一张卡摊成一张能画的图（作者 / 调试工具，只进 Storybook 与 dev）。
 *
 * 只读「声明.图」的两处：拓扑（执行顺序）与节点（名 / 职责 / 输出）——
 * 这里不认识任何一张具体的卡：节点数、名字、谁读谁都从 JSON 里数。
 *
 * 两种边：
 *   · 主干 —— 拓扑是线性的，相邻两个节点一条实线边；
 *   · 读   —— 上游 = 拓扑前缀（决定 #26）：排在它前面的每个节点都连一条虚线过来。
 *             上游是规则推出来的，卡里不逐节点再写一遍，虚线也就不带文字。
 *
 * 坐标也在这里算：按拓扑顺序铺开，一行最多 COLUMNS 个。布局是纯计算，组件只负责画。
 */

import type { CardData } from '../game/card'
import * as K from '../game/card-keys'

/** 副标题里 id 与职责摘要之间的分隔（中点） */
const SUBLABEL_SEPARATOR = ' \u00b7 '

/** 职责摘要的长度上限（节点框里只放得下一行） */
const DUTY_LIMIT = 40

/** 摘要被截断时补的省略号 */
const ELLIPSIS = '\u2026'

/** 一行最多摆几个节点：再多就顶出视口，页面的结构检查也不允许元素出界 */
const COLUMNS = 5

/** 图的左上留白（像素）—— 节点框贴着容器边不好看 */
const PADDING = 24

/** 节点间距（像素）—— 要比节点本身宽，边才看得清 */
const COLUMN_STEP = 230

/** 行距（像素）—— 要比节点本身高，虚线才不会压在字上 */
const ROW_STEP = 170

/** 图里的一个节点：显示用的两行字 + 算好的坐标（画图用的，与执行器的 GraphNode 无关） */
export interface LayoutNode {
  id: string
  label: string
  sublabel: string
  position: { x: number; y: number }
}

/** 图里的一条边：读边（read）画成虚线，主干边画实线；两者都不带文字 */
export interface GraphEdge {
  source: string
  target: string
  read: boolean
}

/**
 * 一张卡摊开后的显示模型。
 *
 * ⚠️ 名字带 Card：agent/graph.ts 里另有一组执行用的 Graph/GraphNode —— 两组类型同名不同义，
 *    同一个文件里都 import 时极易看错（这里只有 id、文字与坐标，节点怎么跑与它无关）。
 */
export interface CardGraphLayout {
  nodes: LayoutNode[]
  edges: GraphEdge[]
}

/** 职责压成一行摘要：超长就截断加省略号（节点框里放不下整段职责） */
function summarize(duty: string): string {
  const chars = [...duty]
  return chars.length <= DUTY_LIMIT ? duty : chars.slice(0, DUTY_LIMIT).join('') + ELLIPSIS
}

/** 把一张卡摊成图：节点按拓扑排，主干边来自相邻关系，读边来自拓扑前缀 */
export function toGraph(card: CardData): CardGraphLayout {
  const decl = card[K.KEY_DECL] as Record<string, unknown>
  const graph = decl[K.KEY_GRAPH] as Record<string, unknown>
  // 校验保证拓扑里每个 id 都有节点、节点里也没有拓扑外的 id（src/game/card.ts 的 checkGraph）
  const ids = graph[K.KEY_TOPOLOGY] as string[]
  const byId = graph[K.KEY_NODES] as Record<string, Record<string, unknown>>
  const nodes: LayoutNode[] = ids.map((id, index) => {
    const node = byId[id]
    return {
      id,
      label: node[K.KEY_NODE_NAME] as string,
      sublabel: id + SUBLABEL_SEPARATOR + summarize(node[K.KEY_DUTY] as string),
      position: {
        x: PADDING + (index % COLUMNS) * COLUMN_STEP,
        y: PADDING + Math.floor(index / COLUMNS) * ROW_STEP,
      },
    }
  })
  const edges: GraphEdge[] = nodes
    .slice(1)
    .map((node, index) => ({ source: nodes[index].id, target: node.id, read: false }))
  nodes.forEach((node, index) => {
    for (const upstream of nodes.slice(0, index)) {
      edges.push({ source: upstream.id, target: node.id, read: true })
    }
  })
  return { nodes, edges }
}
