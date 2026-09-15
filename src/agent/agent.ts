/**
 * src/agent/agent.ts —— 引擎跑一轮：照卡里的图，每个节点跑一段带工具的模型循环。
 *
 * ## 大原则（决定 #46）
 *
 * **模型只能申请，不能直接改状态。** 引擎要做的任何动作（推进时间、换地点、改状态……）
 * 只能来自模型的**原生工具调用**（工具表由卡的 actions 推导，game/card-actions.ts），
 * **绝不解析模型的文字**：文字只有两个用途 —— 当上游上下文、当故事正文
 * （用户 2026-09-14 明确要求，2026-09-15 重申）。
 *
 * 关键点：
 *   - **一轮 = 跑一张卡里的图**（src/agent/card-graph.ts 是执行器）：节点顺序来自
 *     `graph.topology`，每个节点的提示词 / 角色 / 工具白名单 / reads / uses 都来自卡。
 *   - **引擎只做四件事**：持有状态、把卡里的动作变成工具、按拓扑叫模型、事务提交
 *     （提交与回滚在组合根 stores/turn.ts，这里一个字节都不落盘）。
 *   - **不猜、不兜底、快速失败**：模型调用失败、story 节点一个字都没写、退回次数用光
 *     都抛错，由组合根按事务回滚（决定 #27/#39）。
 */

import { t } from '../i18n'
import { narrationOf, runCardGraph } from './card-graph'
import { openingInstruction } from './prompts'
import { openingOf } from '../game/opening'
import type { CardData } from '../game/card'
import type { GameData, StoryKind } from '../types/state'
import type { ChatReply } from './llm'

/**
 * 引擎干活需要的东西：**纯数据** + 卡 + 两个领域动作。
 *
 * ⚠️ 故意不接「类」也不接存储：
 *   · data 是这一轮的**工作副本**（纯数据），工具与时间推进改的就是它；
 *   · addEvent / endTurn 由调用方注入 —— 引擎不知道叙事流怎么存、更不知道存档怎么写。
 * 这样同一个引擎既能在界面里跑（响应式 + 真 localStorage），也能在脚本里跑
 * （手写数据 + 假存储）。
 */
export interface AgentContext {
  /** 这一轮的工作副本；提交与回滚由组合根负责 */
  data: GameData
  /** 当前卡（图、动作、状态 schema、开局事实都从它来） */
  card: CardData
  /** 把故事写进事件流（引擎只写故事类；调试痕迹由界面侧写） */
  addEvent: (kind: StoryKind, text: string) => void
  /** 工作副本的回合 +1 */
  endTurn: () => void
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
  /**
   * 模型在协议层申请了一次工具调用（args 是协议原样给的 JSON 字符串）。
   *
   * ⚠️ node 是**发出它的节点 id**（执行器知道）—— 调试面板靠它分组，
   *    不必从渲染好的文案里反解。
   */
  | { type: 'tool'; node: string; tool: string; args: string }
  /** 引擎执行完那次调用，原样回传给模型的结果（node / tool 同 tool 事件） */
  | { type: 'toolResult'; node: string; tool: string; result: string }
  /** 一次工具调用写进了状态树的哪条路径、写成了什么（调试面板的「本轮写入清单」） */
  | { type: 'stateChange'; node: string; path: string; value: unknown }
  /** 有节点要求退回重来（引擎已经把工作副本回滚到 from 开跑前，接下来从 from 重跑） */
  | { type: 'redo'; from: string; why: string }
  /** 引擎的警告（只调工具没写文字、工具轮次到顶……）—— 给调试痕迹，不是给玩家 */
  | { type: 'warn'; message: string }
  /** 本回合的叙事正文（玩家看到的就是它） */
  | { type: 'narration'; text: string }

interface TurnResult {
  /** 本回合的叙事正文 */
  text: string
}

interface TurnOptions {
  /** 玩家输入；不传表示开新游戏 */
  action?: string
  signal?: AbortSignal
  onEvent?: (evt: AgentEvent) => void
}

/**
 * 开场时「玩家原话」那一段：引擎自带的开场指令 + 卡里的开局要求。
 *
 * 卡只写要求（「让他先听见海，再看见灯」），正文由模型现写（决定 #31）。
 */
function openingWords(card: CardData): string {
  const facts = openingOf(card)
  return t('agent.gameStart', { instruction: [openingInstruction(), ...facts.requirements].join('\n\n') })
}

/**
 * 跑一个回合：照卡里的图依次跑每个节点，把 role: "story" 节点的文字交回调用方。
 *
 * 顺序（每一步失败都原样上抛，什么都不写回）：
 *   把玩家的原话写进事件流（模型与界面都从那里读）→ 跑图（每个节点一段带工具的模型循环，
 *   工具随手就执行）→ 取 story 节点的文字当叙事 → 回合 +1。
 *
 * ⚠️ **没有对话历史这条线**：事件流是唯一的记忆。前面每一轮的 action 与叙事都会进
 *    节点请求里的「最近发生的事」—— 刷新之后照样在；这一轮的原话只进「## 玩家」，
 *    不在历史那一段里重复（不然模型会以为玩家说了两遍）。
 *    开场没有玩家原话，所以开场不写 action 事件（第一轮的事件流就是一条叙事）。
 */
export async function runTurn(ctx: AgentContext, opts: TurnOptions = {}): Promise<TurnResult> {
  const { action, signal, onEvent = () => {} } = opts

  // 这一轮的事件（action）从这一条开始：历史那一段只给这一轮之前的事
  const memoryUpTo = ctx.data.events.length
  if (action) ctx.addEvent('action', action)
  const playerWords = action ? t('agent.playerAction', { action }) : openingWords(ctx.card)
  const outputs = await runCardGraph({
    card: ctx.card,
    data: ctx.data,
    memoryUpTo,
    playerWords,
    signal,
    onEvent,
  })

  const text = narrationOf(ctx.card, outputs)
  ctx.addEvent('narration', text)
  onEvent({ type: 'narration', text })
  ctx.endTurn()

  return { text }
}
