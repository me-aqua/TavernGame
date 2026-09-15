/**
 * src/types/state.ts —— 世界状态的数据形状。
 *
 * ⚠️ 存档是**外部数据**（用户能手改、能从文件导入、可能是旧版本），
 *    所以读存档时必须当 unknown 校验，不能信任类型标注 —— 见 game/save.ts。
 */

/**
 * 事件流里的一条事件。
 *
 * ⚠️ 故事与调试痕迹**共用这一个数组**（顺序即真相：痕迹就插在它发生的那段叙事之间）。
 *    谁能看到由**投影**决定，不由存储位置决定 —— 玩家与模型只看故事类，
 *    开发者看调试投影；分类与上限见 game/save.ts 的 isStoryKind / MAX_STORY / MAX_DEBUG。
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
  /** 调试类：图执行器进入了哪个节点（一轮的进度，只有调试模式看得见） */
  | 'node'

/** 故事类事件的 kind（引擎只写这三种；玩家与模型看到的也都是它们） */
export type StoryKind = 'narration' | 'action' | 'system'

export interface GameEvent {
  kind: EventKind
  text: string
  /** 可折叠的原始内容（请求体 / 响应体 JSON）；只有调试类事件有 */
  detail?: string
  /** 写入时刻（ISO 字符串） */
  at: string
}

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
  events: GameEvent[]
  timeline: TimelineEntry[]
}

/**
 * 对话消息 —— 引擎手上的历史（角色 + 文本）。
 *
 * ⚠️ 引擎每轮把历史原样发给每个节点（决定 #26 的公共部分）；窗口多大由组合根决定，
 *    这里不裁剪。快照会读 role 区分「玩家」与「GM」。
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
