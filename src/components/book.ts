/**
 * src/components/book.ts —— 把事件流的投影（rows）折成一本古书的**书叶**。
 *
 * 一本书的一次翻页 = 一回：左页是玩家写下的行动，右页是模型现写的叙事。
 * **一回合固定一叶**：行动一提交就翻到新页，模型的回答在同一页上写，不再因为
 * 回答长就把同一回拆成几片（那样会在模型落笔时又翻页，还会跳过开头）。
 * 极长的回答由页面自己滚动，不改变「一回一页」的节奏。
 *
 * 这是**纯函数**，不 import Vue：分组能单测，视图只负责把叶子摆上书架。
 * 调试痕迹不进书页：书是给玩家读的，模型的请求体/工具调用归调试台账。
 */
import type { Row } from '../stores/game'

/** 一页书叶：左页的行动 + 右页的叙事 */
export interface BookLeaf {
  /** 回目：0 = 序（开场），>=1 = 第 N 回 */
  turn: number
  /** 左页的行动；序为空 */
  action: string
  /** 右页的叙事；行动刚提交、模型还没写时为空 */
  narration: string
}

/**
 * 把事件流折成书叶。
 *
 * 分组规则：一个 action 开一回；它后面的 narration 都归这一回；开场在第一个
 * action 之前，是「序」。调试行跳过。narration 有多条时按空行接起来。
 */
export function toLeaves(rows: Row[], latestTurn: number): BookLeaf[] {
  const groups: { action: string; narration: string[] }[] = []
  let current: { action: string; narration: string[] } | null = null

  for (const row of rows) {
    if (row.debug) continue
    if (row.kind === 'action') {
      current = { action: row.text, narration: [] }
      groups.push(current)
      continue
    }
    if (current === null) {
      current = { action: '', narration: [] }
      groups.push(current)
    }
    current.narration.push(row.text)
  }

  if (groups.length === 0) return []

  const actions = groups.filter((group) => group.action !== '').length
  const firstTurn = actions > 0 ? Math.max(1, latestTurn - actions + 1) : 0
  let actionIndex = 0

  return groups.map((group) => ({
    turn: group.action === '' ? 0 : firstTurn + actionIndex++,
    action: group.action,
    narration: group.narration.join('\n\n'),
  }))
}
