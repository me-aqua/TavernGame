/**
 * src/agent/card-graph.ts —— 把一张卡翻译成这一轮要跑的图，并消费两个有名字的产出。
 *
 * 图执行器（graph.ts）只认「有序节点 + 上游」；卡这一侧的翻译在这里：
 * 拓扑 → 节点顺序、提示词.节点[id] → 节点的 run、每个节点一次模型调用（不带 tools）。
 * 上游 = 拓扑前缀（决定 #26）；公共部分与逐节点提示词的拼装见 prompts.ts。
 *
 * ⚠️ **机制不认识卡里的任何一个节点 id**，只有两处例外 —— 哪个节点的产出当叙事、
 *    哪个节点的产出推进时间。卡格式还没有声明这两件事的地方，所以名字集中在下面
 *    两个常量里（「引擎与示例卡的约定」）；等格式支持声明再搬进卡。
 *
 * ⚠️ 时间在**图跑完之后**才推进，不是在 time 节点返回的那一刻：公共部分里的状态快照
 *    对所有节点必须逐字相同（决定 #26），中途改时间会让后面节点的快照与前面对不上。
 */

import { chat } from './llm'
import { buildNodeMessages } from './prompts'
import { advanceTime, iso } from '../game/state'
import { isRecord } from '../game/save'
import * as K from '../game/card-keys'
import type { CardData } from '../game/card'
import type { GameState } from '../game/state'
import type { Graph } from './graph'
import type { AgentEvent } from './agent'
import type { ChatMessage } from '../types/state'

/** 产出当本回合叙事的节点 */
export const STORY_NODE = 'story'

/** 产出时间推进量的节点 */
export const TIME_NODE = 'time'

/** 拓扑：执行顺序的唯一声明（卡已校验，形状由 game/card.ts 守） */
function topologyOf(card: CardData): string[] {
  const decl = card[K.KEY_DECL] as Record<string, unknown>
  const graph = decl[K.KEY_GRAPH] as Record<string, unknown>
  return graph[K.KEY_TOPOLOGY] as string[]
}

/** 造一张这一轮要跑的图要的东西 */
export interface CardGraphInput {
  card: CardData
  /** 世界状态快照（公共部分里的那一段；图跑完之前它不会变） */
  snapshot: string
  /** 全部历史 */
  history: ChatMessage[]
  /** 玩家这一轮的原话；开场时是开场指令 */
  playerWords: string
  onEvent?: (evt: AgentEvent) => void
}

/**
 * 把一张卡翻译成图：数组顺序 = 拓扑顺序（决定 #25：依次各调用一次）。
 *
 * 一个节点 = 一次模型调用，产出就是模型返回的原文 —— 原样进上游，引擎不改写。
 */
export function graphOfCard(input: CardGraphInput): Graph {
  const ids = topologyOf(input.card)
  return {
    nodes: ids.map((id, index) => ({
      id,
      /** 拼该节点的请求 → 问模型 → 交回产出原文 */
      run: async ({ upstream, signal }) => {
        input.onEvent?.({ type: 'thinking', step: index + 1 })
        const reply = await chat(
          buildNodeMessages({
            card: input.card,
            snapshot: input.snapshot,
            history: input.history,
            playerWords: input.playerWords,
            upstream,
            node: id,
          }),
          { signal },
        )
        input.onEvent?.({ type: 'model', step: index + 1, reply })
        return reply.content
      },
    })),
  }
}

/** 取某个有名字的节点的本轮产出；卡里没有它就直接抛错（引擎要的东西卡必须给） */
function outputOf(card: CardData, outputs: string[], node: string): string {
  const ids = topologyOf(card)
  const index = ids.indexOf(node)
  if (index < 0) {
    throw new Error('card has no "' + node + '" node (topology: ' + ids.join(', ') + ')')
  }
  return outputs[index]
}

/**
 * 从节点产出里取出 JSON 对象。
 *
 * ⚠️ 卡的节点约定就是「每个节点的输出都是一个 JSON 代码块」，所以模型产出是**外部输入**：
 *    围栏可有可无，解析失败一律抛错 —— 不猜、不修、不替它兜底。
 */
function parseJsonOutput(output: string, where: string): Record<string, unknown> {
  // 围栏的语言标记可能写成 json / JSON：大小写不敏感，内容一律照原文解析
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : output).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (err) {
    // 把解析器的原始错误带上：排查的人需要知道是哪个字符让它断的
    throw new Error(where + ': output is not valid JSON (' + (err as Error).message + ')', {
      cause: err,
    })
  }
  if (!isRecord(parsed)) throw new Error(where + ': output must be a JSON object')
  return parsed
}

/**
 * 叙事 = story 节点的产出里的正文。
 *
 * ⚠️ 玩家看到的是**正文那一段**，不是模型返回的 JSON 块 —— 展示前先解析出来；
 *    缺正文或正文是空的都抛错（一轮没有正文就不该提交，决定 #27）。
 */
export function narrationOf(card: CardData, outputs: string[]): string {
  const where = 'node "' + STORY_NODE + '"'
  const parsed = parseJsonOutput(outputOf(card, outputs, STORY_NODE), where)
  const text = parsed[K.KEY_STORY_TEXT]
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(where + ': "' + K.KEY_STORY_TEXT + '" must be a non-empty string')
  }
  return text.trim()
}

/**
 * 时间 = time 节点的产出 → 世界状态（第一个「节点产出 → 状态」的消费者）。
 *
 * 推进量的形状由卡声明（{step, unit}）：step 必须是 number、unit 必须是 string，
 * 单位与幅度合不合法由日历把关（utils/calendar.ts）。这里只把「推进没成功」也当失败 ——
 * 新流程里没有「把错误回传给模型让它改」这一步，静默不动时间等于这一轮白跑。
 */
export function applyTimeNode(state: GameState, card: CardData, outputs: string[]): void {
  const where = 'node "' + TIME_NODE + '"'
  const parsed = parseJsonOutput(outputOf(card, outputs, TIME_NODE), where)
  const advance = parsed[K.KEY_ADVANCE]
  if (!isRecord(advance) || typeof advance.step !== 'number' || typeof advance.unit !== 'string') {
    throw new Error(where + ': "' + K.KEY_ADVANCE + '" must be {step: number, unit: string}')
  }
  const reason = parsed[K.KEY_REASON]
  if (typeof reason !== 'string') throw new Error(where + ': "' + K.KEY_REASON + '" must be a string')

  // 0 = 这一轮时间没动（例如开局那一刻，或一场没跨过时间线的对话）—— 合法判断：不推进，也不报错
  if (advance.step === 0) return

  const before = iso(state)
  const message = advanceTime(state, advance.step, advance.unit, reason)
  // 推不动 = 日历拒了它（单位不认识 / 倒退 / 防呆上限）：时间一个字节没动就抛错
  if (iso(state) === before) throw new Error(where + ': ' + message)
}
