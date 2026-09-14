/**
 * src/types/state.ts —— 世界状态的数据形状
 *
 * 转 TypeScript 最大的收益就在这里：
 * 以前「存档里有哪些字段」只存在于注释和防御性代码里，
 * 现在编译器知道，写错字段名会在构建期直接报错。
 *
 * ⚠️ 存档是**外部数据**（用户能手改、能从文件导入、可能是旧版本），
 *    所以读存档时必须当 unknown 校验，不能信任类型标注 —— 见 game/GameState.ts。
 */

/** 日志条目：叙事流里的每一行 */
export interface LogEntry {
  /** narration = GM 写的正文；action = 玩家输入；system = 系统提示 */
  kind: 'narration' | 'action' | 'system'
  text: string
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
  log: LogEntry[]
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
