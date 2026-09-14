/**
 * src/dev/card-graph.ts —— 把一张卡摊成一张能画的图（作者 / 调试工具，只进 Storybook 与 dev）。
 *
 * 只读卡里三处：节点、拓扑、节点约定。图的形状全部从这三处推出来 ——
 * 这里不认识任何一张具体的卡：节点数、名字、谁读谁都从 JSON 里数。
 *
 * 两种边：
 *   · 主干 —— 拓扑是线性的，相邻两个节点一条实线边；
 *   · 读   —— 「节点约定」里讲某个节点的那一行还点到哪些节点，那些就是它的上游，
 *             从每个上游连一条虚线过来。这一行是作者写下的数据流，
 *             也正是这张卡真正的信息（④ 时间读 ③ 大纲、⑥ 角色读 ⓪ 精神分析）。
 *
 * 约定里用圈号指代节点（⓪ = 拓扑[0]，① = 拓扑[1]…），一行讲谁看「圈号 + 节点 id」
 * （「· ④ time 公共部分 + ⓪①②③」）。认不出来的行（公共部分的组成清单、说明段落）不动图 ——
 * 它们没在说数据流。
 *
 * 坐标也在这里算：按拓扑顺序铺开，一行最多 COLUMNS 个。布局是纯计算，组件只负责画。
 */

import type { CardData } from '../game/card'
import * as K from '../game/card-keys'

/** 读边的标签（画成虚线）—— 源码必须 ASCII，所以转义写 */
export const READ_LABEL = '\u8bfb'

/** 副标题里 id 与职责摘要之间的分隔（中点） */
const SUBLABEL_SEPARATOR = ' \u00b7 '

/** 职责摘要的长度上限（节点框里只放得下一行） */
const DUTY_LIMIT = 40

/** 摘要被截断时补的省略号 */
const ELLIPSIS = '\u2026'

/** 圈号 ⓪ 的码点 */
const CIRCLED_ZERO = 0x24ea

/** 圈号 ① 的码点；①–⑳ 的码点是连着的 */
const CIRCLED_ONE = 0x2460

/** 圈号 ⑳ 的码点 —— 再多的节点没有圈号可用，那种卡的约定就读不出上游 */
const CIRCLED_TWENTY = 0x2473

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

/** 图里的一条边：主干边的 label 是空串，读边是 READ_LABEL */
export interface GraphEdge {
  source: string
  target: string
  label: string
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

/** 第 index 个节点在节点约定里的圈号 */
function markOf(index: number): string {
  return String.fromCodePoint(index === 0 ? CIRCLED_ZERO : CIRCLED_ONE + index - 1)
}

/** 圈号字符在拓扑里的下标；不是圈号、或超出 ⑳ 就是 -1 */
function circledIndex(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if (code === CIRCLED_ZERO) return 0
  if (code < CIRCLED_ONE || code > CIRCLED_TWENTY) return -1
  return code - CIRCLED_ONE + 1
}

/** 一行里提到的节点（按出现位置、去重）：圈号按拓扑下标解，节点 id 按字面认 */
function mentionedIn(line: string, ids: string[]): string[] {
  const found: Array<[number, string]> = []
  for (let at = 0; at < line.length; at += 1) {
    const index = circledIndex(line[at])
    if (index >= 0 && index < ids.length) found.push([at, ids[index]])
  }
  for (const id of ids) {
    // 与校验器同一条边界规则：story 不算提到 story-chain
    const at = line.search(new RegExp('(?<![a-z0-9-])' + id + '(?![a-z0-9-])'))
    if (at >= 0) found.push([at, id])
  }
  found.sort(([left], [right]) => left - right)
  const mentioned: string[] = []
  for (const [, id] of found) if (!mentioned.includes(id)) mentioned.push(id)
  return mentioned
}

/** 这一行讲的是哪个节点：圈号紧跟自己的 id（「④ time」）才算数，认不出来就是 null */
function subjectOf(line: string, ids: string[]): string | null {
  for (const [index, id] of ids.entries()) {
    if (new RegExp(markOf(index) + '\\s*' + id + '(?![a-z0-9-])').test(line)) return id
  }
  return null
}

/** 职责压成一行摘要：超长就截断加省略号（节点框里放不下整段职责） */
function summarize(duty: string): string {
  const chars = [...duty]
  return chars.length <= DUTY_LIMIT ? duty : chars.slice(0, DUTY_LIMIT).join('') + ELLIPSIS
}

/** 按拓扑顺序取节点 —— 卡的执行顺序由拓扑说了算，不是它们在数组里的下标 */
function orderedNodes(card: CardData): Array<Record<string, unknown>> {
  const nodes = card[K.KEY_NODES] as Array<Record<string, unknown>>
  const byId = new Map(nodes.map((node) => [node[K.KEY_ID] as string, node]))
  // 校验保证拓扑里每个 id 都有节点（src/game/card.ts 的 checkTopology）
  return (card[K.KEY_TOPOLOGY] as string[]).map((id) => byId.get(id)!)
}

/** 把一张卡摊成图：节点按拓扑排，边来自相邻关系与「节点约定」里写明的上游 */
export function toGraph(card: CardData): CardGraphLayout {
  const ids = card[K.KEY_TOPOLOGY] as string[]
  const nodes = orderedNodes(card).map((node, index) => {
    const id = node[K.KEY_ID] as string
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
    .map((node, index) => ({ source: nodes[index].id, target: node.id, label: '' }))
  for (const line of card[K.KEY_CONVENTION] as string[]) {
    const subject = subjectOf(line, ids)
    if (!subject) continue
    for (const upstream of mentionedIn(line, ids)) {
      if (upstream !== subject) edges.push({ source: upstream, target: subject, label: READ_LABEL })
    }
  }
  return { nodes, edges }
}
