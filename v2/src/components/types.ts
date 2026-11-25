/**
 * 组件层的几个小类型（只给界面用，不放进 core —— 那边是数据与引擎的语言）。
 */

/** 故事流的一行：玩家行动 / 叙事 */
export interface StoryLine {
  type: 'action' | 'narration'
  text: string
}

/** 编辑器中间栏当前选中的对象 */
export type EditorSelection = { kind: 'node'; id: string } | { kind: 'state'; code: string } | null
