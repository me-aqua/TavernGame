/**
 * src/game/card-layout.ts —— 把一张卡摊成一张能画的图（卡界面的布局，纯计算，不 import Vue）。
 *
 * 只读卡里的图（拓扑 + 每个节点的声明）—— 这里不认识任何一张具体的卡：节点数、
 * 名字、谁读了谁、谁有哪个角色全从 JSON 里数。
 *
 * 三种边（决定 #26 与设计 13.1.1）：
 *   · 主干 chain —— 拓扑相邻的两个节点一条实线；**默认只看得到主干**；
 *   · 折行 wrap —— 主干跨行的那一条，走行与行之间的回边通道，边上写着接到第几个节点；
 *   · 读 read —— 上游 = 拓扑前缀：排在它前面的每个节点各一条虚线。九节点就是 36 条，
 *     全画出来是零信息量的实况转播 —— 只在选中 / 悬停那个节点时才画它自己的那几条。
 *
 * 坐标也在这里算：按拓扑一条链从左往右铺，一行最多 COLUMNS 个，折行时留出行距
 * （回边通道）。图的形状与坐标都是纯计算，组件只负责画。
 */

import type { CardData } from './card'

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

/** 行距（像素）—— 比节点本身高出一截，行间那条空档就是回边通道 */
const ROW_STEP = 236

/** 带圈序号的上限：1..20 是 ①..⑳，再大就用普通数字 */
const CIRCLED_MAX = 20

/** 带圈数字的起始码位（①） */
const CIRCLED_BASE = 0x2460

/**
 * 拓扑序号写成图上的那个记号：① ② ③……
 *
 * 折行之后光看位置认不出先后（第二行的左边那个其实排在第六），序号是行与行之间
 * 唯一可靠的读法 —— 图例里的「上游 = 拓扑前缀」也靠它。
 */
export function numeral(index: number): string {
  if (index < 1 || index > CIRCLED_MAX) return String(index)
  return String.fromCodePoint(CIRCLED_BASE + index - 1)
}

/** 图里的一个节点：序号 + 显示用的字 + 只读声明 + 算好的坐标（与执行器的 GraphNode 无关） */
export interface LayoutNode {
  id: string
  /** 拓扑序号，从 1 起（节点框上的 ① ② ③） */
  index: number
  /** 行号，从 0 起（折行点靠它认，行间留回边通道） */
  row: number
  /** 名字那一行：序号 + 节点的 name */
  label: string
  /** 第二行：节点 id + 职责摘要 */
  sublabel: string
  /** 只读声明：本回合的叙事取自它（不写 = 不是故事节点） */
  role: string | null
  /** 只读声明：这个节点能用的动作（null = 卡里全部） */
  tools: string[] | null
  /** 只读声明：这个节点看得见哪几块状态（null = 全部） */
  reads: string[] | null
  position: { x: number; y: number }
}

/** 一条边的三种形态 —— 画法与含义都在界面上（CardGraph.vue） */
export type EdgeKind = 'chain' | 'wrap' | 'read'

/** 图里的一条边：主干实线、折行实线（带序号）、读边虚线 */
export interface GraphEdge {
  source: string
  target: string
  kind: EdgeKind
  /** 折行边上写的那个序号（接到第几个节点）——别的边不带文字 */
  label?: string
}

/**
 * 一张卡摊开后的显示模型。
 *
 * ⚠️ 名字带 Card：agent/card-graph.ts 里另有一组执行用的类型 —— 两组同名不同义，
 *    同一个文件里都 import 时极易看错（这里只有 id、文字、声明与坐标）。
 */
export interface CardGraphLayout {
  nodes: LayoutNode[]
  /** 主干 + 折行 + 全部读边；读边画不画由界面按选中 / 悬停决定 */
  edges: GraphEdge[]
}

/** 职责压成一行摘要：超长就截断加省略号（节点框里放不下整段职责） */
function summarize(duty: string): string {
  const chars = [...duty]
  return chars.length <= DUTY_LIMIT ? duty : chars.slice(0, DUTY_LIMIT).join('') + ELLIPSIS
}

/** 把一张卡摊成图：节点按拓扑排成一条链，边由拓扑相邻与拓扑前缀推出来 */
export function toGraph(card: CardData): CardGraphLayout {
  const topology = card.graph.topology
  const nodes: LayoutNode[] = topology.map((id, index) => {
    // 校验保证拓扑里每个 id 都有节点、节点里也没有拓扑外的 id（src/game/card.ts 的 checkGraph）
    const node = card.graph.nodes[id]
    const row = Math.floor(index / COLUMNS)
    return {
      id,
      index: index + 1,
      row,
      label: numeral(index + 1) + ' ' + node.name,
      sublabel: id + SUBLABEL_SEPARATOR + summarize(node.duty),
      role: node.role ?? null,
      tools: node.tools ?? null,
      reads: node.reads ?? null,
      position: { x: PADDING + (index % COLUMNS) * COLUMN_STEP, y: PADDING + row * ROW_STEP },
    }
  })

  const edges: GraphEdge[] = []
  nodes.slice(1).forEach((node, index) => {
    const source = nodes[index]
    // 跨行的那一条带上目标节点的序号：折行处不许让人猜「下一行从哪儿接上」
    if (source.row === node.row) {
      edges.push({ source: source.id, target: node.id, kind: 'chain' })
      return
    }
    edges.push({ source: source.id, target: node.id, kind: 'wrap', label: numeral(node.index) })
  })
  nodes.forEach((node, index) => {
    for (const upstream of nodes.slice(0, index)) {
      edges.push({ source: upstream.id, target: node.id, kind: 'read' })
    }
  })
  return { nodes, edges }
}
