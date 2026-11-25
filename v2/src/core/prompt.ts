/**
 * 提示词拼装（CONTRACT §5）。一个节点拼一次，五样东西按固定顺序进来：
 *
 *   1. 公共提示词（`prompts[].id ∈ node.reads` 的那些，`body` 逐字）
 *   2. 状态（`state[].code ∈ node.reads` 的那些，一行「`<code> <name> = <值>`」）
 *   3. 历史（最近 `historyTurns` 个**已完成**回合，每回合 action 一行、narration 一行；
 *      **本回合的玩家行动挂在历史块的最后一行** —— 它是「刚刚发生的事」，不是独立一段）
 *   4. 上游输出（`node.readsUpstream` 点名的那些节点，按**链顺序**取它们的输出，逐字）
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
  /** 本回合已执行节点的输出，按节点 id 索引；只有排在当前节点前面的那些有值 */
  outputs: Record<string, string>
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
export function buildPrompt({ card, save, node, action, outputs }: BuildPromptArgs): string {
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

  // 上游按**链顺序**拼（不是按点击/存储顺序）：谁先跑完，谁的话在前
  const upstreamTexts = card.chain
    .filter((other) => node.readsUpstream.includes(other.id))
    .map((other) => outputs[other.id])
    .filter((text) => text !== '')
  if (upstreamTexts.length > 0) sections.push(upstreamTexts.join('\n\n'))

  if (node.prompt !== '') sections.push(node.prompt)

  return sections.join('\n\n')
}
