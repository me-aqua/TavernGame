/**
 * src/agent/agent.ts —— 引擎跑一轮：照卡里的图，每个节点调一次模型。
 *
 * 关键点：
 *   - **一轮 = 执行一张图**（src/agent/graph.ts 是执行器，src/agent/card-graph.ts 把卡
 *     翻译成图）：节点顺序来自 `声明.图.拓扑`，每个节点自己的提示词来自
 *     `提示词.节点[id]`，上游 = 拓扑前缀（决定 #25/#26/#37）。
 *   - **引擎持有一切事实**：节点只写文字；唯一能改世界状态的是 time 节点的产出 ——
 *     引擎解析它、调 advanceTime 写进工作副本。
 *   - **不猜、不兜底、快速失败**：模型调用失败、节点产出解析不出来、卡里缺东西都抛错，
 *     由组合根按事务回滚（决定 #27/#39）。
 *   - **每个节点一次调用**：没有 tools、没有步数上限、没有强制收尾 —— 产出格式由卡的
 *     节点约定约束（JSON 代码块），引擎只在有消费者的地方解析它。
 */

import { t } from '../i18n'
import { executeGraph } from './graph'
import { applyTimeNode, graphOfCard, narrationOf } from './card-graph'
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
  /** 第几次模型调用（从 1 起）—— 这张图里节点与调用一一对应 */
  | { type: 'thinking'; step: number }
  /** 模型这一步的输入与输出（调试模式展示用；输入是实际发出去的请求体） */
  | { type: 'model'; step: number; reply: ChatReply }
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
 * 跑一个回合：照卡里的图依次跑每个节点，把 story 节点的正文交回调用方。
 *
 * 顺序（每一步失败都原样上抛，什么都不写回）：
 *   记玩家行动 → 定快照 → 跑图（每个节点一次模型调用）→ 时间落进状态 → 取正文
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

  // 公共部分里的快照在开跑前定死：图跑完之前没有东西会改状态，
  // 所以九个节点拿到的它逐字相同（决定 #26）。时间在整张图跑完之后才推进。
  const snapshot = ctx.snapshot()

  const outputs = await executeGraph(
    graphOfCard({ card: currentCard, snapshot, history, playerWords, onEvent }),
    { signal, onEvent },
  )

  // 节点产出 → 世界状态：目前只有时间这一个消费者
  applyTimeNode(ctx.state, currentCard, outputs)

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
