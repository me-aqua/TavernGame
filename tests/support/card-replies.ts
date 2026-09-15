/**
 * 一轮的假回复 —— 组合根 / store / 引擎那几层要跑通一整轮时用它。
 *
 * 形状全部现取：节点数、顺序、哪个节点管叙事、哪个节点能推时间，都从传进来的卡
 * （默认示例卡）的 graph 来，不在这里抄第二份 —— 卡加一个节点、换一张卡，这里跟着变。
 *
 * ⚠️ 模型走**原生工具调用**：默认每个节点回一段普通文字（不调工具）；
 *    传了 `time` 时，能推时间的那个节点先回一条 advance_time 的 tool_calls，
 *    引擎执行完再问一次，它才回文字 —— 所以那个节点在回复序列里占**两个槽位**。
 *    （「回复按顺序消费」是假 fetch 的契约，见 tests/support/fakeLlm.ts。）
 */
import { currentCard } from '../../src/game/current-card'
import type { CardData } from '../../src/game/card'
import type { FakeReply } from './fakeLlm'

/** 示例卡的拓扑 —— 调试痕迹那类断言用它数「每个节点一行」 */
export const CARD_TOPOLOGY: string[] = currentCard.graph.topology

/** 本回合叙事来自哪个节点（卡的声明：恰好一个 role: "story"） */
export function storyNodeOf(card: CardData = currentCard): string {
  const id = card.graph.topology.find((node) => card.graph.nodes[node].role === 'story')
  if (!id) throw new Error('fixture card has no role "story" node')
  return id
}

/** 哪个节点能用这个动作（默认第一个；卡的 tools 白名单不写 = 全部动作） */
export function nodeWith(tool: string, card: CardData = currentCard): string {
  const id = card.graph.topology.find((node) => {
    const tools = card.graph.nodes[node].tools
    return tools === undefined ? Object.hasOwn(card.actions, tool) : tools.includes(tool)
  })
  if (!id) throw new Error('fixture card has no node with tool "' + tool + '"')
  return id
}

/** 能推时间的那个节点 */
export function timeNodeOf(card: CardData = currentCard): string {
  return nodeWith('advance_time', card)
}

/** 默认正文（测试想认出来源时可以换成自己的常量） */
export const DEFAULT_STORY = 'The story node wrote this.'

/**
 * 一轮的调试痕迹形状：每个节点一行 node + 一对请求/响应。
 *
 * 时间节点推时间时多两对：第一步只调工具、一个字都没写 → 先一行 warn（「只调用了工具」），
 * 再 tool / toolResult / stateChange 三行，然后是第二对请求/响应。
 */
export function traceCycle(timeAdvances = false): string[] {
  const timeNode = timeNodeOf()
  return currentCard.graph.topology.flatMap((id) =>
    id === timeNode && timeAdvances
      ? ['node', 'request', 'model', 'warn', 'tool', 'stateChange', 'toolResult', 'request', 'model']
      : ['node', 'request', 'model'],
  )
}

/** 模型在协议层申请一次 advance_time（参数是 JSON 字符串，与真实服务商给的形态一致） */
export function advanceTimeCall(minutes: number, reason = ''): FakeReply {
  return {
    toolCalls: [{ name: 'advance_time', arguments: JSON.stringify({ minutes, reason }) }],
  }
}

/** 模型在协议层申请一次 redo（退回某一步重跑） */
export function redoCall(from: string, why: string): FakeReply {
  return {
    toolCalls: [{ name: 'redo', arguments: JSON.stringify({ from, why }) }],
  }
}

/** 节点的默认文字产出（只有上游与叙事认它，引擎不解析它） */
function textOf(id: string): string {
  return '[' + id + '] wrote this line.'
}

/**
 * 一轮里若干部件的假回复：逐个节点给文字，`pick` 返回自定义回复的节点用它的。
 *
 * redo 的用例要按「第几遍跑哪些节点」精确排回复 —— 这个助手让那几段读起来就是
 * 「第一遍 / 重跑那一段」，不用手数槽位。
 */
export function cardPassReplies(
  ids: string[],
  pick: (id: string) => FakeReply | FakeReply[] | undefined = () => undefined,
): FakeReply[] {
  return ids.flatMap((id) => {
    const custom = pick(id)
    if (custom === undefined) return [textOf(id)]
    return Array.isArray(custom) ? custom : [custom]
  })
}

export interface CardTurnOverrides {
  /** 用哪张卡（默认示例卡） */
  card?: CardData
  /** story 节点的正文 */
  story?: string
  /** 能推时间的节点要推进的量：给了就先回 tool_calls 再回文字；不给就只回文字 */
  time?: { minutes: number; reason?: string }
  /**
   * 逐节点覆盖：返回这个节点这一轮贡献的回复（可以是多条 —— 先调工具再回文字）；
   * 返回 undefined 表示这个节点用默认回复。给了它就接管这个节点，
   * `story` / `time` 对它不再生效。
   */
  node?: (id: string) => FakeReply | FakeReply[] | undefined
}

/** 按拓扑顺序造齐一轮的假回复（顺序 = 引擎问模型的顺序） */
export function cardTurnReplies(over: CardTurnOverrides = {}): FakeReply[] {
  const card = over.card ?? currentCard
  const topology = card.graph.topology
  const story = storyNodeOf(card)
  const timeNode = timeNodeOf(card)
  const replies: FakeReply[] = []
  for (const id of topology) {
    const custom = over.node?.(id)
    if (custom !== undefined) {
      replies.push(...(Array.isArray(custom) ? custom : [custom]))
      continue
    }
    if (id === timeNode && over.time) {
      replies.push(advanceTimeCall(over.time.minutes, over.time.reason), textOf(id))
      continue
    }
    replies.push(id === story ? (over.story ?? DEFAULT_STORY) : textOf(id))
  }
  return replies
}
