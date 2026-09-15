/**
 * 一轮九节点的假回复 —— 组合根 / store 那几层要跑通一整轮时用它。
 *
 * 形状全部现取：节点数、顺序、哪个节点管时间、哪个管叙事，都从示例卡的拓扑与引擎常量来，
 * 不在这里抄第二份（卡加一个节点、约定换了名字，这里跟着变）。
 *
 * ⚠️ 模型走**原生工具调用**：默认每个节点回一段普通文字（不调工具）；
 *    传了 `time` 时，时间节点先回一条 `advance_time` 的 tool_calls，
 *    引擎执行完再问一次，它才回文字 —— 所以那个节点在回复序列里占**两个槽位**。
 *    （「回复按顺序消费」是假 fetch 的契约，见 tests/support/fakeLlm.ts。）
 */
import { currentCard } from '../../src/game/current-card'
import { STORY_NODE, TIME_NODE } from '../../src/agent/card-graph'
import * as K from '../../src/game/card-keys'
import type { FakeReply } from './fakeLlm'

/** 示例卡的拓扑（已校验的卡，形状由 game/card.ts 守） */
const card = currentCard as Record<string, unknown>
const decl = card[K.KEY_DECL] as Record<string, unknown>
const graph = decl[K.KEY_GRAPH] as Record<string, unknown>
const topology = graph[K.KEY_TOPOLOGY] as string[]

/** 示例卡的拓扑 —— 调试痕迹那类断言用它数「每个节点一行」 */
export const CARD_TOPOLOGY = topology

/** 默认正文（测试想认出来源时可以换成自己的常量） */
export const DEFAULT_STORY = 'The story node wrote this.'

/** 默认推进量：一天 */
export const DEFAULT_TIME = { step: 1, unit: 'day', reason: 'a day went by' }

/**
 * 调试痕迹的形状：每个节点一行 node + 每次模型调用一对请求/响应。
 *
 * 时间节点推进时间时多一次往返：第一步只调工具、一个字都没写 → 先一行 warn
 * （「只调用了工具」），再 `tool` / `toolResult` 两行，然后是第二对请求/响应。
 */
export function traceCycle(timeAdvances = false): string[] {
  return CARD_TOPOLOGY.flatMap((id) =>
    id === TIME_NODE && timeAdvances
      ? ['node', 'request', 'reply', 'warn', 'tool', 'toolResult', 'request', 'reply']
      : ['node', 'request', 'reply'],
  )
}

/** 模型在协议层申请一次 advance_time（参数是 JSON 字符串，与真实服务商给的形态一致） */
export function advanceTimeCall(time: { step: number; unit: string; reason?: string }): FakeReply {
  return {
    toolCalls: [
      {
        name: 'advance_time',
        arguments: JSON.stringify({ step: time.step, unit: time.unit, reason: time.reason ?? '' }),
      },
    ],
  }
}

/** 节点的默认文字产出（只有上游与叙事认它，引擎不解析它） */
function textOf(id: string): string {
  return '[' + id + '] wrote this line.'
}

export interface CardTurnOverrides {
  /** story 节点的正文 */
  story?: string
  /** 时间节点要推进的量：给了就先回 tool_calls 再回文字；不给就只回文字 */
  time?: { step: number; unit: string; reason?: string }
  /**
   * 逐节点覆盖：返回这个节点这一轮贡献的回复（可以是多条 —— 先调工具再回文字）；
   * 返回 undefined 表示这个节点用默认回复。给了它就接管这个节点，
   * `story` / `time` 对它不再生效。
   */
  node?: (id: string) => FakeReply | FakeReply[] | undefined
}

/** 按拓扑顺序造齐一轮的假回复（顺序 = 引擎问模型的顺序） */
export function cardTurnReplies(over: CardTurnOverrides = {}): FakeReply[] {
  const replies: FakeReply[] = []
  for (const id of topology) {
    const custom = over.node?.(id)
    if (custom !== undefined) {
      replies.push(...(Array.isArray(custom) ? custom : [custom]))
      continue
    }
    if (id === TIME_NODE && over.time) {
      replies.push(advanceTimeCall(over.time), textOf(id))
      continue
    }
    replies.push(id === STORY_NODE ? (over.story ?? DEFAULT_STORY) : textOf(id))
  }
  return replies
}
