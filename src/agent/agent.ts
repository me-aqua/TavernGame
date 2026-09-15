/**
 * src/agent/agent.ts —— 引擎跑一轮：照卡里的图，每个节点跑一段带工具的模型循环。
 *
 * ## 大原则（决定 #46）
 *
 * **模型只能申请，不能直接改状态。** 引擎要做的任何动作（推进时间，将来还有换地点、
 * 改状态……）只能来自模型的**原生工具调用**（src/agent/tools.ts 是动作白名单），
 * **绝不解析模型的文字**：文字只有两个用途 —— 当上游上下文、当故事正文。
 * 模型直接改状态没法校验，而在文字里写 JSON 一飘就整轮失败（用户 2026-09-14 明确要求，
 * 2026-09-15 重申）。
 *
 * 关键点：
 *   - **一轮 = 执行一张图**（src/agent/graph.ts 是执行器，src/agent/card-graph.ts 把卡
 *     翻译成图）：节点顺序来自 `声明.图.拓扑`，每个节点自己的提示词来自
 *     `提示词.节点[id]`，上游 = 拓扑前缀（决定 #25/#26/#37）。
 *   - **引擎持有一切事实**：每个节点请求都带上工具，模型要调就执行、把结果回传、
 *     再问一次（同一个节点内，上限见 card-graph.ts 的 MAX_TOOL_ROUNDS）。
 *   - **不猜、不兜底、快速失败**：模型调用失败、节点一个字都没写、卡里缺东西都抛错，
 *     由组合根按事务回滚（决定 #27/#39）。
 */

import { t } from '../i18n'
import { executeGraph } from './graph'
import { graphOfCard, narrationOf } from './card-graph'
import { openingInstruction } from './prompts'
import { currentCard } from '../game/current-card'
import type { ChatMessage, StoryKind } from '../types/state'
import type { GameState } from '../game/state'
import type { ChatReply } from './llm'

/**
 * 引擎干活需要的东西：**纯数据** + 几个领域动作。
 *
 * ⚠️ 故意不接「类」也不接存储：
 *   · state 是纯数据（game/state.ts 的 GameState），时间节点要改它（advanceTime）
 *   · 三个动作由调用方注入 —— 引擎不知道叙事流怎么存、更不知道存档怎么写
 * 这样同一个引擎既能在界面里跑（响应式代理 + 真 localStorage），
 * 也能在脚本里跑（手写数据 + 假存储）。
 */
export interface AgentContext {
  state: GameState
  /** 把故事写进事件流（引擎只写故事类；调试痕迹由界面侧写） */
  addEvent: (kind: StoryKind, text: string) => void
  /** 回合 +1 */
  endTurn: () => void
  /** 世界状态快照，拼提示词用（不传历史 —— 历史以消息的形式进请求） */
  snapshot: () => string
}

/** agent 循环回传给调用方的事件（叙事、调试痕迹、节点进度）—— 何时可见由调用方决定 */
export type AgentEvent =
  /** 图执行器进入了哪个节点（进度的来源；写不写成痕迹由界面侧决定，见决定 #38） */
  | { type: 'node'; id: string }
  /** 第几次模型调用（从 1 起）—— 同一个节点里的工具往返也算一次 */
  | { type: 'thinking'; step: number }
  /**
   * 请求**发出去之前**的请求体（调试模式展示用）。
   *
   * ⚠️ 与 model 事件分开是有意的：模型调用失败时没有 model 事件，
   *    只有它能证明「我们发出去的是什么」—— 排查 401 / 500 / 请求体写错时全靠它。
   */
  | { type: 'request'; step: number; body: unknown }
  /** 模型这一步的原始响应（输入侧见上面的 request 事件） */
  | { type: 'model'; step: number; reply: ChatReply }
  /** 模型在协议层申请了一次工具调用（参数是协议原样给的字符串） */
  | { type: 'tool'; tool: string; args: string }
  /** 引擎执行完那次调用，原样回传给模型的结果 */
  | { type: 'toolResult'; tool: string; result: string }
  /** 引擎的警告（只调工具没写文字、工具轮次到顶……）—— 给调试痕迹，不是给玩家 */
  | { type: 'warn'; message: string }
  /** 本回合的叙事正文（玩家看到的就是它） */
  | { type: 'narration'; text: string }

interface TurnResult {
  /** 本回合的叙事正文 */
  text: string
  /** 供下一回合拼接的对话历史 */
  history: ChatMessage[]
}

interface TurnOptions {
  /** 玩家输入；不传表示开新游戏 */
  action?: string
  history?: ChatMessage[]
  signal?: AbortSignal
  onEvent?: (evt: AgentEvent) => void
}

/**
 * 跑一个回合：照卡里的图依次跑每个节点，把 story 节点的文字交回调用方。
 *
 * 顺序（每一步失败都原样上抛，什么都不写回）：
 *   记玩家行动 → 定快照 → 跑图（每个节点一段带工具的模型循环，工具随手就执行）
 *   → 取 story 节点的文字当叙事
 */
export async function runTurn(ctx: AgentContext, opts: TurnOptions = {}): Promise<TurnResult> {
  const { action, history = [], signal, onEvent = () => {} } = opts

  const playerWords = action
    ? t('agent.playerAction', { action })
    : t('agent.gameStart', { instruction: openingInstruction() })

  // 先把玩家的行动记入日志。
  // 必须在拼装上下文之前做 —— 快照会读日志，这样模型就能看到
  // 玩家刚说了什么（而不是只看到一堆历史数值）。
  ctx.addEvent(action ? 'action' : 'system', action || t('agent.newAdventure'))

  // 公共部分里的快照在开跑前定死成**字符串**：工具中途改了状态也不会让后面节点的
  // 快照与前面对不上，九个节点拿到的它逐字相同（决定 #26）。
  const snapshot = ctx.snapshot()

  // 节点产出只是文字：工具（advance_time）在执行的那一刻就已经改过 ctx.state 了，
  // 这里不再从产出里解析任何东西 —— 取叙事是引擎读节点文字的唯一一处（决定 #46）
  const outputs = await executeGraph(
    graphOfCard({ card: currentCard, state: ctx.state, snapshot, history, playerWords, onEvent }),
    { signal, onEvent },
  )

  const text = narrationOf(currentCard, outputs)
  ctx.addEvent('narration', text)
  onEvent({ type: 'narration', text })
  ctx.endTurn()

  const appended: ChatMessage[] = [
    { role: 'user', content: playerWords },
    { role: 'assistant', content: text },
  ]
  const newHistory: ChatMessage[] = [...history.slice(-6), ...appended].slice(-8)

  return { text, history: newHistory }
}
