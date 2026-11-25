/**
 * 提示词拼装（CONTRACT §5）。一个节点拼一次，六样东西按固定顺序进来：
 *
 *   1. 公共提示词（`prompts[].id ∈ node.reads` 的那些，`body` 逐字）
 *   2. 状态（`state[].code ∈ node.reads` 的那些，一行「`<code> <name> = <值>`」）
 *   3. 历史（最近 `historyTurns` 个**已完成**回合，每回合 action 一行、narration 一行；
 *      **本回合的玩家行动挂在历史块的最后一行** —— 它是「刚刚发生的事」，不是独立一段）
 *   4. 上游输出（`readsUpstream` 且上游非空时，逐字）
 *   5. 本节点提示词（逐字；空则整段省略）
 *
 * 眼睛语义一句话：`reads` 里有它就读，没有就一个字符都不出现。
 */
import type { Card, ChainNode, Save, SaveEvent, TimeValue } from './types'

interface BuildPromptArgs {
  card: Card
  save: Save
  node: ChainNode
  /** 本回合玩家的行动（它会作为历史块的最后一行出现） */
  action: string
  /** 上一个已执行节点的输出文本；没有就空串 */
  upstream: string
}

/** 时间元素渲染成 `day <n> hour <n>`；其余元素就是它的字符串值 */
function renderValue(value: string | TimeValue | undefined): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return `day ${value.day} hour ${value.hour}`
}

/**
 * 把事件流切成「回合」：一个 `action` 开一个新回合，其后的 `narration` 归它。
 * 只认这两类 —— `node` / `tool` / `write` 之类是过程记录，不进提示词。
 */
function turnsOf(events: SaveEvent[]): { action: string; narration: string }[] {
  const turns: { action: string; narration: string }[] = []
  for (const event of events) {
    if (event.type === 'action') turns.push({ action: event.text, narration: '' })
    else if (event.type === 'narration' && turns.length > 0) turns[turns.length - 1].narration = event.text
  }
  return turns
}

// 拼一个节点的提示词：五段按契约顺序接起来，眼睛没打开的段一个字都不放
export function buildPrompt({ card, save, node, action, upstream }: BuildPromptArgs): string {
  const sections: string[] = []

  const promptBodies = card.prompts
    .filter((prompt) => node.reads.includes(prompt.id))
    .map((prompt) => prompt.body)
  if (promptBodies.length > 0) sections.push(promptBodies.join('\n\n'))

  const stateLines = card.state
    .filter((element) => node.reads.includes(element.code))
    .map((element) => `${element.code} ${element.name} = ${renderValue(save.tree[element.code])}`)
  if (stateLines.length > 0) sections.push(stateLines.join('\n'))

  const history = node.historyTurns > 0 ? turnsOf(save.events).slice(-node.historyTurns) : []
  const historyLines: string[] = []
  for (const turn of history) {
    historyLines.push(`> ${turn.action}`)
    if (turn.narration !== '') historyLines.push(turn.narration)
  }
  historyLines.push(`> ${action}`)
  sections.push(historyLines.join('\n'))

  if (node.readsUpstream && upstream !== '') sections.push(upstream)
  if (node.prompt !== '') sections.push(node.prompt)

  return sections.join('\n\n')
}
