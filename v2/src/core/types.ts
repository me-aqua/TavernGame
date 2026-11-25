/**
 * 阶段 1 的数据形状（CONTRACT §2）。只有类型，没有运行时代码。
 *
 * 一句话记住边界：**卡与存档里没有模型绑定** —— 用哪个预设、Key 是多少，住在
 * `tg2.nodeModels` / `tg2.presets`（玩家本机的东西），不进卡。
 */

/** 时间元素的值（`tree['0']`）；其余元素是字符串 */
export interface TimeValue {
  day: number
  hour: number
}

export type NodeType = 'time' | 'normal' | 'output'

export interface StateElement {
  code: string
  name: string
  note: string
  type: 'string'
  initial: string | TimeValue
}

export interface ChainNode {
  id: string
  type: NodeType
  name: string
  reads: string[]
  writable: string[]
  /** 读哪些上游节点的输出；id 必须在链上、且排在它前面 */
  readsUpstream: string[]
  historyTurns: number
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

/** 存档里的事件类型；`chunk` 只走流式回调，不落盘（§2.2） */
export type EventType =
  'action' | 'narration' | 'node' | 'request' | 'tool' | 'write' | 'toolResult' | 'error'

export interface SaveEvent {
  type: EventType
  text: string
  detail?: unknown
  at: string
}

export type Tree = Record<string, string | TimeValue>

export interface Save {
  schemaVersion: 1
  id: string
  cardId: string
  cardSnapshot: Card
  name: string
  turn: number
  tree: Tree
  events: SaveEvent[]
  updatedAt: string
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

/** token 用量（各家字段名不同，这里统一成三个数） */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** 一次 provider 调用的结果 */
export interface ProviderReply {
  text: string
  toolCalls: ProviderToolCall[]
  usage: TokenUsage | null
}
