/**
 * 一轮九节点的假回复 —— 组合根 / store 那几层要跑通一整轮时用它。
 *
 * 形状全部现取：节点数、顺序、哪个节点管时间、哪个管叙事，都从示例卡的拓扑与引擎常量来，
 * 不在这里抄第二份（卡加一个节点、约定换了名字，这里跟着变）。
 *
 * time 节点给一份合法的推进量、story 节点给一段正文；其余节点给一段带自己 id 的
 * JSON 代码块 —— 上游累加的断言用得上。要覆盖别的形状时用 `over` 覆盖。
 */
import { currentCard } from '../../src/game/current-card'
import { STORY_NODE, TIME_NODE } from '../../src/agent/card-graph'
import * as K from '../../src/game/card-keys'
import type { FakeReply } from './fakeLlm'

/** 示列卡的拓扑（已校验的卡，形状由 game/card.ts 守） */
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

/** 节点产出的统一包装：卡的节点约定是「一个 JSON 代码块」 */
export function jsonBlock(value: unknown): string {
  return '```json\n' + JSON.stringify(value) + '\n```'
}

export interface CardTurnOverrides {
  /** story 节点的正文 */
  story?: string
  /** time 节点的推进量 */
  time?: { step: number; unit: string; reason?: string }
  /** 其余节点的产出；不传就给一段带 id 的 JSON */
  node?: (id: string) => string
}

/** 按拓扑顺序造齐一轮的假回复 */
export function cardTurnReplies(over: CardTurnOverrides = {}): FakeReply[] {
  return topology.map((id) => {
    if (id === TIME_NODE) {
      const time = over.time ?? DEFAULT_TIME
      return jsonBlock({
        [K.KEY_ADVANCE]: { step: time.step, unit: time.unit },
        [K.KEY_REASON]: time.reason ?? '',
      })
    }
    if (id === STORY_NODE) {
      return jsonBlock({ [K.KEY_STORY_TEXT]: over.story ?? DEFAULT_STORY })
    }
    return over.node ? over.node(id) : jsonBlock({ note: id })
  })
}
