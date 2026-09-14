/**
 * src/types/state.ts —— 世界状态的数据形状
 *
 * 转 TypeScript 最大的收益就在这里：
 * 以前「存档里有哪些字段」只存在于注释和防御性代码里，
 * 现在编译器知道，写错字段名会在构建期直接报错。
 *
 * ⚠️ 存档是**外部数据**（用户能手改、能从文件导入、可能是旧版本），
 *    所以读存档时必须当 unknown 校验，不能信任类型标注 —— 见 game/save.ts。
 */

/**
 * 事件流里的一条事件。
 *
 * ⚠️ 故事与调试痕迹**共用这一个数组**（顺序即真相：痕迹就插在它发生的那段叙事之间）。
 *    谁能看到由**投影**决定，不由存储位置决定：
 *      · 玩家看 game/state.ts 的 lines 投影（只有故事类）
 *      · 模型看 snapshot()（只有故事类）
 *      · 开发者看调试投影（只有调试类，且要打开调试模式）
 *    分类与上限见 game/save.ts 的 isStoryKind / MAX_STORY / MAX_DEBUG。
 */
export type EventKind =
  /** 故事类：GM 正文 */
  | 'narration'
  /** 故事类：玩家输入 */
  | 'action'
  /** 故事类：回合标记（给模型看，不给玩家看） */
  | 'system'
  /** 调试类：模型收到的输入（请求体） */
  | 'request'
  /** 调试类：模型的原始响应 */
  | 'reply'
  /** 调试类：一次工具调用 */
  | 'tool'
  /** 调试类：一次工具结果 */
  | 'toolResult'
  /** 调试类：引擎警告（步数用尽、只调工具没写叙事…） */
  | 'warn'

/** 故事类事件的 kind（引擎只写这三种；玩家与模型看到的也都是它们） */
export type StoryKind = 'narration' | 'action' | 'system'

export interface GameEvent {
  kind: EventKind
  /** 界面上那一行字 */
  text: string
  /** 可折叠的原始内容（请求体 / 响应体 JSON）；只有调试类事件有 */
  detail?: string
  /** 写入时刻（ISO 字符串） */
  at: string
}

/** timelineLines：记录一次「值得记」的时间推进 */
export interface TimelineEntry {
  /** 推进**前**的时刻（简短格式）。⚠️ 必须是起点，不能是终点 */
  from: string
  /** 推进**后**的时刻（简短格式） */
  to: string
  /** 为什么会流逝，例如「连夜赶路」 */
  reason: string
  elapsedMs: number
  at: string
}

/** 世界状态的全部字段 */
export interface GameData {
  meta: {
    turn: number
  }
  player: {
    name: string
  }
  scene: {
    name: string
    description: string
  }
  /**
   * 唯一的引擎状态：一个绝对时刻。
   * 不存「第几天第几段」——那样跨月跨年全靠手算，边界必错。
   */
  time: {
    iso: string
  }
  /** 事件流：故事 + 调试痕迹，按发生顺序（见 GameEvent） */
  events: GameEvent[]
  timeline: TimelineEntry[]
}

/**
 * 对话消息。
 *
 * ⚠️ 含工具协议字段：原生 tool calling 要求把模型的 tool_calls 原样回传，
 * 并把每个工具的执行结果作为 role: 'tool' 的消息发回去（用 tool_call_id 关联）。
 * 这是协议的一部分，不是我们自创的格式。
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** 仅 assistant：模型要求调用的工具 */
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  /** 仅 tool：对应哪一次调用 */
  tool_call_id?: string
}
