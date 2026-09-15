/**
 * src/agent/card-graph.ts —— 把一张卡翻译成这一轮要跑的图，并取出本回合的叙事。
 *
 * 图执行器（graph.ts）只认「有序节点 + 上游」；卡这一侧的翻译在这里：
 * 拓扑 → 节点顺序、提示词.节点[id] → 节点的 run、每个节点一次**带工具的模型循环**。
 * 上游 = 拓扑前缀（决定 #26）；公共部分与逐节点提示词的拼装见 prompts.ts。
 *
 * ## 大原则：模型只能申请，不能直接改状态
 *
 * 引擎要做的动作 —— 推进时间，将来还有换地点、改状态…… —— **只能来自模型的原生工具
 * 调用**（src/agent/tools.ts 是动作白名单）。卡要求「输出一个 JSON 代码块」那套解析
 * 已经整条拆掉：模型在文字里写歪一点（漏个引号、参数写成中文）就整轮失败，
 * 而原生 tool calling 把格式交给协议、把结构化错误回传给模型自己改
 * （用户 2026-09-14 定下、2026-09-15 重申）。
 * **节点的文字只有两个用途：① 当上游上下文 ② story 节点的文字就是本回合叙事** ——
 * 除此之外引擎不读它、不猜它、不据此做任何判断。
 *
 * ⚠️ **机制不认识卡里的任何一个节点 id**，只有两处例外：哪个节点的文字当叙事、
 *    哪个节点负责时间（后者现在只是文档 —— 时间由 advance_time 工具推进，
 *    任何节点都能调；卡靠逐节点提示词约束各节点该做什么）。
 *
 * ⚠️ 工具在**节点跑到那一刻**就执行（模型说推进就推进），但公共部分里的状态快照在
 *    开跑前就定成了字符串：所有节点拿到的快照仍然逐字相同（决定 #26）。
 */

import { chat } from './llm'
import { buildNodeMessages } from './prompts'
import { runTool, toolSchemas } from './tools'
import { t } from '../i18n'
import * as K from '../game/card-keys'
import type { CardData } from '../game/card'
import type { GameState } from '../game/state'
import type { Graph } from './graph'
import type { AgentEvent } from './agent'
import type { ChatMessage } from '../types/state'

/** 文字当本回合叙事的节点 */
export const STORY_NODE = 'story'

/** 负责时间的节点（卡声明的那一个；时间由工具推进，这里只用来读/写测试夹具） */
export const TIME_NODE = 'time'

/**
 * 一个节点内最多问模型几轮（工具往返也算一轮）。
 *
 * ⚠️ 上限的用途是**防呆**：模型可能拿工具当玩具 —— 反复用同一个参数调 advance_time，
 *    或者「我再确认一下」个没完。没有上限，一个节点就能把 API 额度烧光。
 * 3 = 一次正常调用 + 一次参数写错后的重试 + 一次富余；到顶还没写出文字就是这一轮失败。
 */
export const MAX_TOOL_ROUNDS = 3

/** 拓扑：执行顺序的唯一声明（卡已校验，形状由 game/card.ts 守） */
function topologyOf(card: CardData): string[] {
  const decl = card[K.KEY_DECL] as Record<string, unknown>
  const graph = decl[K.KEY_GRAPH] as Record<string, unknown>
  return graph[K.KEY_TOPOLOGY] as string[]
}

/** 造一张这一轮要跑的图要的东西 */
export interface CardGraphInput {
  card: CardData
  /** 这一局的**工作副本**：工具（advance_time）改的就是它；提交与回滚由组合根负责 */
  state: GameState
  /** 世界状态快照（公共部分里的那一段；图跑完之前它不会变） */
  snapshot: string
  /** 全部历史 */
  history: ChatMessage[]
  /** 玩家这一轮的原话；开场时是开场指令 */
  playerWords: string
  onEvent?: (evt: AgentEvent) => void
}

/**
 * 把一张卡翻译成图：数组顺序 = 拓扑顺序（决定 #25：依次各跑一次）。
 *
 * 一个节点 = 一段模型循环：请求带上工具，模型要调工具就执行、把结果回传、再问一次；
 * **没有工具调用的那一次的文字**就是这个节点的产出（trim 后进上游）。
 */
export function graphOfCard(input: CardGraphInput): Graph {
  const ids = topologyOf(input.card)
  const tools = toolSchemas()
  /** 整张图的模型调用计数（工具往返也算一次）—— request / model 事件的 step 用它 */
  let calls = 0

  return {
    nodes: ids.map((id) => ({
      id,
      /** 这个节点的一段模型循环：带工具问 → 执行 → 回传 → 问到它写出文字 */
      run: async ({ upstream, signal }) => {
        const messages = buildNodeMessages({
          card: input.card,
          snapshot: input.snapshot,
          history: input.history,
          playerWords: input.playerWords,
          upstream,
          node: id,
        })

        for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
          if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
          calls += 1
          const step = calls
          input.onEvent?.({ type: 'thinking', step })
          const reply = await chat(messages, {
            signal,
            tools,
            // 请求体在发出去之前就报一次：这样调用失败（401 / 500 / 断网）时
            // 调试痕迹里也能看到我们到底发了什么
            onRequest: (body) => input.onEvent?.({ type: 'request', step, body }),
          })
          input.onEvent?.({ type: 'model', step, reply })

          // 没有工具调用 = 这个节点说完了：它的文字就是产出（不解析、不改写）
          if (!reply.toolCalls.length) return reply.content.trim()

          // 只调工具、一个字都没写：提示一句，继续问（模型有时会偷懒）
          if (!reply.content.trim()) {
            input.onEvent?.({ type: 'warn', message: t('agent.toolsOnly', { step }) })
          }

          // 协议要求：先把模型这一步原样记进对话（id / name / arguments 一字不差），
          // 再把每个工具的结果以 role:'tool' 回传 —— 模型靠 tool_call_id 对上号。
          messages.push({
            role: 'assistant',
            content: reply.content,
            tool_calls: reply.toolCalls.map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.name, arguments: c.arguments },
            })),
          })
          for (const call of reply.toolCalls) {
            input.onEvent?.({ type: 'tool', tool: call.name, args: call.arguments })
            const result = runTool(input.state, call)
            input.onEvent?.({ type: 'toolResult', tool: call.name, result })
            messages.push({ role: 'tool', tool_call_id: call.id, content: result })
          }
        }

        // 到顶还在调工具 = 这个节点一个字都没写出来：不静默收场（决定 #27）
        input.onEvent?.({ type: 'warn', message: t('agent.stepLimit', { max: MAX_TOOL_ROUNDS }) })
        throw new Error('node "' + id + '" hit the tool round limit (' + MAX_TOOL_ROUNDS + ') without text')
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
 * 叙事 = story 节点的文字（trim 后）。
 *
 * ⚠️ 引擎只做「取出来 + 剁掉首尾空白」：没有 JSON、没有围栏、没有要解析的字段。
 *    一个字都没有就抛错（一轮没有正文就不该提交，决定 #27）。
 */
export function narrationOf(card: CardData, outputs: string[]): string {
  const text = outputOf(card, outputs, STORY_NODE).trim()
  if (!text) throw new Error('node "' + STORY_NODE + '" produced no text')
  return text
}
