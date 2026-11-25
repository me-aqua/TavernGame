/**
 * 组件层的几个小类型（只给界面用，不放进 core —— 那边是数据与引擎的语言）。
 */
import type { TraceDetail, TurnStatsDetail } from '../core/types'

/** 故事流的一行：玩家行动 / 叙事 */
export interface StoryLine {
  type: 'action' | 'narration'
  text: string
  /**
   * 乐观显示、还没落盘的那句行动（只在跑回合时出现）。
   * 回合成功时存档事件里已经有它 ⇒ 这份副本撤掉；中止 / 出错时整条撤掉。
   */
  pending?: boolean
}

/**
 * 故事流时间轴上的一项（按 `save.events` 的顺序排，再补上本回合还在路上的那几条）：
 *   · `action` / `narration` —— 故事本身，永远显示（`pending` 那条是还没落盘的乐观副本）；
 *   · `trace` —— 一个节点的执行读数，只在调试开关打开时由对话页放进来；
 *   · `turnStats` —— 一回合的合计读数，永远显示。
 */
export type StoryItem =
  StoryLine | { type: 'trace'; trace: TraceDetail } | { type: 'turnStats'; stats: TurnStatsDetail }

/** 编辑器中间栏当前选中的对象 */
export type EditorSelection = { kind: 'node'; id: string } | { kind: 'state'; code: string } | null
