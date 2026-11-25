/**
 * 组件层的几个小类型（只给界面用，不放进 core —— 那边是数据与引擎的语言）。
 */
import type { TraceDetail, TurnStatsDetail } from '../core/types'

/** 故事流的一行：玩家行动 / 叙事 */
export interface StoryLine {
  type: 'action' | 'narration'
  text: string
}

/**
 * 故事流时间轴上的一项（按 `save.events` 的顺序排）：
 *   · `action` / `narration` —— 故事本身，永远显示；
 *   · `trace` —— 一个节点的执行读数，只在调试开关打开时由对话页放进来；
 *   · `turnStats` —— 一回合的合计读数，永远显示。
 */
export type StoryItem =
  StoryLine | { type: 'trace'; trace: TraceDetail } | { type: 'turnStats'; stats: TurnStatsDetail }

/** 编辑器中间栏当前选中的对象 */
export type EditorSelection = { kind: 'node'; id: string } | { kind: 'state'; code: string } | null
