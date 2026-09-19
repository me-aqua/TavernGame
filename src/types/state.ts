/**
 * src/types/state.ts —— 世界状态的数据形状。
 *
 * ⚠️ 存档是**外部数据**（用户能手改、能从文件导入、可能是旧版本），
 *    所以读存档时必须当 unknown 校验，不能信任类型标注 —— 见 game/save.ts。
 */

import type { StateTree } from '../game/card-state'
import type { BlockGroup } from '../agent/prompts'

/**
 * 事件流里的一条事件的 kind。
 *
 * ⚠️ 故事与调试痕迹**共用这一个数组**（顺序即真相：痕迹就插在它发生的那段叙事之间）。
 *    谁能看到由**投影**决定，不由存储位置决定 —— 玩家与模型只看故事类，
 *    开发者看调试投影；分类见 game/save.ts 的 isStoryKind，上限只有调试那一路（MAX_DEBUG）。
 */
export type EventKind =
  /** 故事类：玩家这一轮的原话（一轮开始时写的；开场没有玩家原话，所以开场没有它） */
  | 'action'
  /** 故事类：本回合的叙事正文（role: "story" 节点的文字） */
  | 'narration'
  /** 调试类：图执行器进入了哪个节点 */
  | 'node'
  /** 调试类：第几次模型调用开始了 */
  | 'thinking'
  /** 调试类：发出去的请求体 */
  | 'request'
  /** 调试类：模型这一步的原始响应 */
  | 'model'
  /** 调试类：一次工具调用（detail = 协议原样的参数 JSON） */
  | 'tool'
  /** 调试类：一次工具结果（detail = 回传给模型的结果原文） */
  | 'toolResult'
  /** 调试类：一次状态写入（path + value，调试面板的「本轮写入清单」就是它） */
  | 'stateChange'
  /** 调试类：引擎的警告（只调工具没写字、工具轮次到顶……） */
  | 'warn'

/**
 * 故事类事件的 kind —— 玩家与模型看到的就是它。
 *
 * ⚠️ 它同时是**模型的记忆**：事件流进存档，节点请求里的「故事到目前为止」就是它的**全部**
 *    （开局以来的每一条都发，只在 `memoryUpTo` 处截断 —— 见 agent/prompts.ts 的 renderRecent）。
 *    刷新后模型仍然知道前面发生过什么。
 */
export type StoryKind = 'action' | 'narration'

export interface GameEvent {
  kind: EventKind
  text: string
  /** 可折叠的原始内容（请求体 / 响应体 / 工具参数与结果）—— 只有调试类事件有 */
  detail?: string
  /**
   * 发出这条调试痕迹的节点 id。
   *
   * ⚠️ 这些结构化字段是**给调试面板用的**：面板要按节点分组、按工具筛选、按路径列写入，
   *    从渲染好的文案里反解会在换语言或改文案时断掉。
   */
  node?: string
  /** 这次调用的是什么工具（只有 tool / toolResult 有） */
  tool?: string
  /** 写到了哪条路径（stateChange 用它；工具痕迹不带） */
  path?: string
  /**
   * 这次工具调用是不是被引擎打回了（只有 toolResult 有）。
   *
   * ⚠️ 面板靠它标红。**不许**改成「看这次调用有没有写状态」——成功的 redo 也不写状态，
   *    两者会混成一种（引擎在事件里把答案给出来，界面不猜）。
   */
  failed?: boolean
  /**
   * stateChange：写成了什么 —— **结构化的真值**。
   *
   * ⚠️ 这是这一行的唯一真相：界面要显示文本时从它现写（stores/game.ts 的 detailOf），
   *    痕迹里不再存第二份 JSON 文本 —— 那份文本会变成「必须是合法 JSON」的隐藏契约，
   *    而存档是外部数据（旧痕迹 / 手改过的 / 导入的都可能不合契约）。
   */
  value?: unknown
  /**
   * 这一条痕迹的分块清单（request / model 两条有）—— 调试界面按块渲染的就是它。
   *
   * ⚠️ 块与行的边界在**写这条痕迹的时候**就定下来了（stores/turn.ts 调
   *    agent/prompts.ts 的 requestBlocks / agent/llm.ts 的 replyBlocks）：
   *    界面不许再拿文本去猜边界 —— 猜错了不会报错，只会静默显示成另一副样子。
   */
  blocks?: BlockGroup[]
  /** 写入时刻（ISO 字符串） */
  at: string
}

export interface TimelineEntry {
  /** 推进**前**的时刻（按卡的历法渲染的文本） */
  from: string
  /** 推进**后**的时刻（同上） */
  to: string
  /** 为什么会流逝，例如「连夜赶路」 */
  reason: string
  /** 推进了多少分钟（这张卡的历法里的一分钟） */
  minutes: number
  at: string
}

/**
 * 卡的身份 —— 存档认亲用（缺卡 / id / 版本 / 格式不同都拒绝，见 game/save.ts）。
 * 名字只给人看，判亲只比 id / version / format。
 */
export interface CardIdentity {
  id: string
  name: string
  version: string
  format: string
}

export interface GameData {
  meta: {
    turn: number
    /** 这一局是哪张卡开的 —— 不拿旧状态硬跑新卡 */
    card: CardIdentity
  }
  /**
   * 卡的 instantiate() 那一棵树 —— 状态由卡声明、初值也在卡里。
   *
   * ⚠️ **这一局现在是几点也在里面**（`state.world.time`，R39：时刻是世界状态的一部分）
   *    —— 引擎手里没有第二份时钟，见 game/card-time.ts。
   */
  state: StateTree
  events: GameEvent[]
  timeline: TimelineEntry[]
}

/**
 * 对话消息 —— 引擎手上的历史（角色 + 文本）。
 *
 * ⚠️ 引擎每轮把历史原样发给每个节点（决定 #26 的公共部分）；窗口多大由组合根决定，
 *    这里不裁剪。
 *
 * ⚠️ 含工具协议字段：原生 tool calling 要求把模型的 tool_calls **原样回传**，
 *    并把每个工具的执行结果作为 role: 'tool' 的消息发回去（用 tool_call_id 关联）。
 *    这是协议的一部分，不是我们自创的格式（决定 #46）。
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** 仅 assistant：模型在协议层要求调用的工具（id / name / arguments 一字不差地回传） */
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  /** 仅 tool：这是哪一次调用的结果 —— 模型靠它把结果与自己的调用对上 */
  tool_call_id?: string
}
