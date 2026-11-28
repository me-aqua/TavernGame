/**
 * 阶段 2.2 的数据形状（CONTRACT §2）。只有类型，没有运行时代码。
 *
 * 一句话记住边界：**卡与存档里没有模型绑定** —— 用哪个预设、Key 是多少，住在
 * `tg2.nodeModels` / `tg2.presets`（玩家本机的东西），不进卡。
 */

/** 时间的推进单位，粗 → 细（`week` 不存，按日期算） */
export type TimeUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute'

/** 时间元素的三种模式：年月日时分 / 年月日 / 天数时分（没有秒） */
export type TimeMode = 'year-minute' | 'year-date' | 'days-minute'

/** `year-minute` 的值：真公历的年月日 + 钟点 */
export interface YearMinuteValue {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** `year-date` 的值：只有日期，没有钟点 */
export interface YearDateValue {
  year: number
  month: number
  day: number
}

/** `days-minute` 的值：`day` 是正整数天数计数，没有年月 */
export interface DaysMinuteValue {
  day: number
  hour: number
  minute: number
}

/**
 * 时间元素的值（`tree['0']`），形状由元素的 `timeMode` 决定。
 * 时间是**一种数据类型**（元素编码 `'0'`），不是一种特权节点 —— 谁能推进它只看 `writable`。
 */
export type TimeValue = YearMinuteValue | YearDateValue | DaysMinuteValue

/** 三组节日的勾选（只有年份模式的时间元素带这一格） */
export interface Holidays {
  international: boolean
  china: boolean
  traditional: boolean
}

export type StateType = 'time' | 'text' | 'integer' | 'enum' | 'object' | 'array' | 'ref'

/** 一个状态元素自己的标量值；结构体（`object`）与数组（`array`）没有这一格 */
export type StateValue = string | number | TimeValue | null

/**
 * 数组 item 里一个字段的值：标量 / 嵌套对象 / 嵌套数组。
 * 键是字段的完整 code（`2.4.1`），不是中文名、不是下标（CONTRACT §2.6）。
 */
export type ItemValue = string | number | ItemObject | ItemValue[] | null

/** 数组的一个 item：以字段完整 code 为键的普通对象（同构，没有隐藏 id） */
export interface ItemObject {
  /** 数组 item 的隐藏 id（id_1…；只在含引用的卡里出现） */
  id?: string
  [fieldCode: string]: ItemValue | undefined
}

/** 数组元素的值：item 结构体列表；空数组 `[]` 合法 */
export type ArrayValue = ItemObject[]

/** 树里的一条值：标量 / 时间 / 数组 / item 对象（后者只出现在数组值内部） */
export type TreeValue = StateValue | ArrayValue | ItemObject | null

/**
 * 根元素的 `initial`：**整棵子树的扁平值表**（键是完整 code，与存档 `tree` 同一套口径）。
 * 时间根是唯一的例外 —— 它的 `initial` 就是时间值本身。
 */
export type InitialTable = Tree

/**
 * 一个状态元素。
 *
 * 编号铁律（CONTRACT §2.1）：`0` 只给时间；节点自己的值住在**隐式**的 `<code>.0`（不进 `state[]`），
 * 可见孩子从 `<code>.1` 起连续编号；深度（`.0` 不计）最大 5。
 * `type` 描述的是**自身值**：标量节点可以有孩子，不会因此变成 `object`。
 *
 * 初始值只在**根元素**（`code` 不含 `.`）身上：它替整棵子树存种子（§2.2）。子元素一个字节都不存。
 */
export interface StateElement {
  code: string
  name: string
  note: string
  type: StateType
  /** 仅 enum：取值白名单（非空、不重复、都是字符串） */
  values?: string[]
  /** 仅 integer：值上下限（缺省 -1e9 / 1e9） */
  min?: number
  max?: number
  /** 仅 integer：**单次更新**的绝对值步幅区间（缺省 0 / 1e9） */
  stepMin?: number
  stepMax?: number
  /** 仅 time：时间模式（三种之一，必填） */
  timeMode?: TimeMode
  /** 仅 time：三个节日勾选；`days-minute` 模式**不许有**这一格 */
  holidays?: Holidays
  /** 根元素：整棵子树的初始值（时间根就是时间值本身）；子元素不许有这一格 */
  initial?: StateValue | InitialTable
  /** 仅 ref：引用源（必须是数组元素的 code） */
  refSource?: string
  /** 仅 ref：投影字段（源 item 的直接子字段 code，至少一个） */
  refFields?: string[]
  /** 仅 ref：可选单字段等值筛选 */
  refFilter?: { field: string; value: string | number }
}

export type NodeType = 'time' | 'normal' | 'output'

export interface ChainNode {
  id: string
  type: NodeType
  name: string
  reads: string[]
  /** 能写哪些状态元素 —— **写权限的唯一来源**；工具由这些元素的数据类型派生（`schema.toolsForNode`） */
  writable: string[]
  /** 读哪些上游节点的输出；id 必须在链上、且排在它前面 */
  readsUpstream: string[]
  historyTurns: number
  /** 第一次之外的**额外**尝试次数（0..5）；旧卡没有这一格 = 0，不迁移 */
  retryCount?: number
  prompt: string
}

export interface PromptBlock {
  id: string
  title: string
  body: string
}

export interface Card {
  schemaVersion: 1
  id: string
  name: string
  state: StateElement[]
  chain: ChainNode[]
  prompts: PromptBlock[]
}

/**
 * 存档里的事件类型；`chunk` 只走流式回调，不落盘（§2.2）。
 *
 * `trace` / `turnStats` 是**调试读数**：每跑完一个节点落一条 trace、回合末尾落一条 turnStats。
 * 它们的 `detail` 形状见下面的 `TraceDetail` / `TurnStatsDetail` —— 对话页的历史调试卡片
 * 全靠它们（重新打开旧存档也能看见当时每一步）。
 */
export type EventType =
  | 'action'
  | 'narration'
  | 'node'
  | 'request'
  | 'tool'
  | 'write'
  | 'toolResult'
  | 'error'
  | 'trace'
  | 'turnStats'

export interface SaveEvent {
  type: EventType
  text: string
  detail?: unknown
  at: string
}

/**
 * 状态树的值：**扁平、键是完整 code**。
 * 没孩子的节点用自身 `code`；有孩子的节点自身值住 `<code>.0`；`object` 一条键都不产出；
 * 数组（`array`）只有一条键 = 它自己的 code，值是整份 item 列表。
 */
export type Tree = Record<string, TreeValue>

/**
 * 上一次**失败**的回合（调试与重发用）：只多这一格 —— 	urn / 	ree / vents 一个字不动。
 * vents 是失败那次的 trace / turnStats 读数（不并进存档的事件流）；	ext 是已经收到的半截正文。
 */
export interface FailedTurn {
  action: string
  at: string
  error: { code: string; message: string; nextStep?: string }
  events: SaveEvent[]
  text: string
}

export interface Save {
  schemaVersion: 1
  id: string
  cardId: string
  cardSnapshot: Card
  /**
   * 这一份存档自己的节点映射（`{ [nodeId]: presetId }`）。新建存档时从卡级
   * `tg2.nodeModels[cardId]` 拷一份；**没有这一格就是本票之前的存档** —— 播放时回落卡级那一片，
   * 不迁移、不补写。存档编辑器改的是它，卡的映射一个字不动。
   */
  nodeModels?: Record<string, string>
  name: string
  turn: number
  tree: Tree
  events: SaveEvent[]
  updatedAt: string
  /** 失败回合的调试槽；成功回合不写、重发前先摘掉，失败时替换这一格 */
  failedTurn?: FailedTurn
}

export type Provider = 'openai-compatible' | 'mock'
export type Reasoning = 'off' | 'low' | 'medium' | 'high'

export interface Preset {
  id: string
  name: string
  provider: Provider
  baseUrl: string
  model: string
  apiKey: string
  reasoning: Reasoning
  /** 只有 provider:'mock' 用；缺省 0 */
  mockChunkDelayMs?: number
}

export interface Settings {
  schemaVersion: 1
  theme: 'light' | 'dark'
  editorColumns: { left: number; right: number }
}

/** `tg2.nodeModels`：`{ [cardId]: { [nodeId]: presetId } }` */
export type NodeModels = Record<string, Record<string, string>>

/** 一次原生工具调用（模型回的 `tool_calls`，不是正文里的 JSON） */
export interface ProviderToolCall {
  name: string
  args: Record<string, unknown>
}

/** 落进 trace 的工具调用：多一个 `result`（引擎执行完之后的读数） */
export interface TraceToolCall extends ProviderToolCall {
  /** 执行结果的可读文本（推进后的时间 / 写入的值）；没执行成功就不会有这条 trace */
  result?: string
}

/** token 用量（各家字段名不同，这里统一成三个数） */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** 一次 provider 调用的结果 */
export interface ProviderReply {
  text: string
  /** 模型返回的思考增量（AI SDK 的 `reasoning-delta`）；没有就是空串，**不许编** */
  reasoning: string
  toolCalls: ProviderToolCall[]
  usage: TokenUsage | null
}

/** 一次尝试里的错误读数（只给 trace 排障；中文原文） */
export interface TraceAttemptError {
  tool: string
  path: string
  code: string
  message: string
}

/** 一个节点的一次模型尝试（重试次数 = `attempts.length - 1`） */
export interface TraceAttempt {
  /** 0 基：本次节点的第几次模型尝试 */
  index: number
  /** 这次尝试里**成功执行**的调用（失败那条不在里面） */
  toolCalls: TraceToolCall[]
  error: TraceAttemptError | null
}

/** `trace` 事件的 `detail`：某一个节点这一次执行的全部读数（§4.3） */
export interface TraceDetail {
  nodeId: string
  nodeName: string
  nodeType: NodeType
  /** 这一步实际解析出的预设 id（模型住在本机映射里，排障就靠它） */
  presetId: string
  /** 这一节点拼出来的提示词（逐字）；重试过时是**最后一次尝试**（成功那次） */
  prompt: string
  /** provider 返回的思考正文；没有就是空串 */
  thinking: string
  /** 最终提交那次尝试的调用列表；与 `attempts.at(-1).toolCalls` 同值 */
  toolCalls: TraceToolCall[]
  /** 每一次模型尝试（含失败的那些）；没有工具可失败的节点长度恒为 1 */
  attempts: TraceAttempt[]
  /** 这一节点的返回正文（只有 output 节点会同时进叙事） */
  output: string
  usage: TokenUsage | null
  /** 这一次 provider / mock 调用的墙钟耗时 */
  durationMs: number
  /** 每秒输出 token；没有用量或耗时为 0 时为 `null` */
  tps: number | null
  turn: number
}

/** `turnStats` 事件的 `detail`：一回合的合计读数（§4.3） */
export interface TurnStatsDetail {
  turn: number
  /** 本回合从头到尾的墙钟耗时 */
  totalMs: number
  /** 本回合所有节点用量之和；一次都没报就是 `null` */
  usage: TokenUsage | null
  /** 本回合整体吞吐（总输出 token / 总耗时）；量不出为 `null` */
  tps: number | null
}
