/**
 * 提示词拼装（CONTRACT §5）。一个节点拼一次，五段按固定顺序进来，每段自带标记：
 *
 *   1. `<公共提示词·{title}>` + 正文（`prompts[].id ∈ node.reads` 的那些，`body` 逐字，**一块一个标记**）
 *   2. `<世界状态树>` + 读到的每个状态元素一行 `- <code>「<name>」：<JSON>`（`state[].code ∈ node.reads`）；
 *      JSON 的键是**中文名**：自身值 `"自身"`、子字段是元素 `name`（没有 `"0"` / `"1"` 这种 code 键）
 *   3. `<游戏历史记录>` + 历史条目（开场白打头，其后是最近 `historyTurns` 条叙事 + 行动，按事件先后排；
 *      本回合行动在最后）
 *   4. `<上游输出·{nodeName}>` + 正文（`node.readsUpstream` 点名的那些节点，按**链顺序**取输出，逐字）
 *   5. `<节点提示词>` + 正文（逐字）
 *
 * 空段连标记一起省略：那一段没有正文，就不留一行光秃秃的标题。
 * 眼睛语义一句话：`reads` 里有它就读，没有就一个字符都不出现。
 */
import type { Card, ChainNode, Save, SaveEvent, TimeMode, TimeValue, Tree } from './types'
import { OPENING_PROMPT_ID } from './schema'
import { childrenOf, formatTime, pathsOf } from './statetree'
import { holidaysOf } from './holidays'
import { t } from '../i18n'

interface BuildPromptArgs {
  card: Card
  save: Save
  node: ChainNode
  /** 本回合玩家的行动（它会作为历史块的最后一条出现） */
  action: string
  /** 本回合已执行节点的输出，按节点 id 索引；只有排在当前节点前面的那些有值 */
  outputs: Record<string, string>
}

/**
 * 一个节点下面那棵子树，**按中文名**拼成对象：自己的值用 `自身`（`prompt.ownKey`），
 * 孩子用元素的 `name` 做键；孩子还有孩子就继续嵌套。结构体没有 `自身`。
 *
 * 键**不是** code（`"0"` / `"1"` 这种）：模型读的是人话，不是编号（契约 §5）。
 */
function subtreeOf(state: Card['state'], tree: Tree, element: Card['state'][number]): unknown {
  const children = childrenOf(state, element.code)
  if (element.type === 'object') {
    return Object.fromEntries(children.map((child) => [child.name, subtreeOf(state, tree, child)]))
  }
  const own = tree[children.length > 0 ? `${element.code}.0` : element.code]
  if (children.length === 0) return own
  const subtree: Record<string, unknown> = { [t('prompt.ownKey')]: own }
  for (const child of children) subtree[child.name] = subtreeOf(state, tree, child)
  return subtree
}

/**
 * 一个元素投影成提示词里的那一段：时间是按模式格式化的那一行（`2024-02-10 08:30（周六）` /
 * `2024-02-10（周六）` / `第 5 天 08:30`）；有孩子的节点是「自身值 + 整棵子树」的 JSON；
 * 叶子就是自己的值（JSON 形态）。
 */
function projectOf(card: Card, tree: Tree, element: Card['state'][number]): string {
  if (element.type === 'time') {
    // 模式必填由 `cardIssues` 兜住：能走到提示词这一步的卡，时间元素一定带着合法模式
    return formatTime(tree[pathsOf(card.state, element.code)[0]] as TimeValue, element.timeMode as TimeMode)
  }
  return JSON.stringify(subtreeOf(card.state, tree, element))
}

/**
 * 时间元素那一行下面紧跟的节日行：节日是**派生只读**的（由时间值 + 三个勾选当场算出来），
 * 所以它不进 `state[]` / `tree`，只在这里出现；一个节日都没有 ⇒ 连这一行都不出现。
 */
function holidayLineOf(element: Card['state'][number], value: TimeValue): string | undefined {
  const names = holidaysOf(value, element.timeMode as TimeMode, element.holidays)
  if (names.length === 0) return undefined
  return t('prompt.holidayLine', { names: names.join(t('prompt.holidaySeparator')) })
}

/** 历史里的一个回合：一个 `action` 开一个回合，后面跟着它的 `narration`（可能不止一条） */
interface HistoryTurn {
  action: string
  narrations: string[]
}

/**
 * 把事件流切成回合：一个 `action` 开一个新回合，其后的 `narration` 归它。
 * 只认这两类 —— `node` / `tool` / `write` 之类是过程记录，不进提示词。
 * **没有叙事的回合整条丢掉**：光有行动、没有下文的回合不占历史块的格子。
 */
function turnsOf(events: SaveEvent[]): HistoryTurn[] {
  const turns: HistoryTurn[] = []
  for (const event of events) {
    if (event.type === 'action') turns.push({ action: event.text, narrations: [] })
    else if (event.type === 'narration' && event.text !== '' && turns.length > 0) {
      turns[turns.length - 1].narrations.push(event.text)
    }
  }
  return turns.filter((turn) => turn.narrations.length > 0)
}

/**
 * 历史块的行：**开场白**（非空时）排最前，然后是最近 `turns` 条叙事 + 最近 `turns - 1` 条历史行动，
 * **按事件原有的先后穿插**，本回合这一条行动由调用方传进来、**恒排最后**（第 `turns` 条行动就是它，
 * 所以事件流里的只取 `turns - 1` 条）。
 *
 * 开场白是**最早的一条叙事**，与事件流里的叙事共用同一个预算 —— 预算满了就让位给更近的那些：
 *   · 新存档（没有事件）+ `turns = 1` ⇒ `开场白 · 本回合行动`（没有上一个行动可带）；
 *   · 一个已完成回合 `a1 n1` + `turns = 1` ⇒ `n1 · 本回合行动`（开场白不进来）；
 *   · 同样一条事件流、`turns = 2` ⇒ `开场白 · a1 · n1 · 本回合行动`；
 *   · `turns = 0` ⇒ 一条叙事都不取（开场白也不取），只剩本回合行动。
 *
 * 例（`turns = 2`，三个已完成回合 `a1 n1 a2 n2 a3 n3`）：`n2 · a3 · n3 · 本回合行动`。
 * 行动行带 `> ` 前缀，叙事（含开场白）就是正文本身。
 */
function historyLines(opening: string, events: SaveEvent[], turns: number, action: string): string[] {
  const entries: { isAction: boolean; text: string }[] = []
  if (opening !== '') entries.push({ isAction: false, text: opening })
  for (const turn of turnsOf(events)) {
    entries.push({ isAction: true, text: turn.action })
    for (const narration of turn.narrations) entries.push({ isAction: false, text: narration })
  }

  // 从尾往前各数各的：叙事最多 `turns` 条，历史行动最多 `turns - 1` 条
  const picked = new Set<number>()
  let narrations = 0
  let actions = 0
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    if (entries[at].isAction) {
      if (actions < turns - 1) {
        picked.add(at)
        actions += 1
      }
    } else if (narrations < turns) {
      picked.add(at)
      narrations += 1
    }
  }

  const lines = entries
    .filter((_, at) => picked.has(at))
    .map((entry) => (entry.isAction ? `> ${entry.text}` : entry.text))
  lines.push(`> ${action}`)
  return lines
}

/**
 * 这个元素的**祖先** code 里有没有被读到的：有的话，子孙不再单独出行（父那一行已经把它们包进去了）。
 * 例：读了 `1.1` ⇒ `1.1.1` 不出行；只读 `1.1.0`（自身值）不算读了父，孩子照旧出行。
 */
function underReadParent(code: string, reads: string[]): boolean {
  const segments = code.split('.')
  for (let at = segments.length - 1; at > 0; at -= 1) {
    if (reads.includes(segments.slice(0, at).join('.'))) return true
  }
  return false
}

/**
 * 状态段的几行。三类读法各出各的：
 *   · 读**元素 code** ⇒ 一行：自己这个节点（有孩子就是自身值 + 整棵子树的 JSON，`object` 没有 `"0"`）；
 *   · 读 **`<code>.0`** ⇒ 一行：只输出这个元素自己的值（`code` 那一格写的是值路径）；
 *   · 读**叶子 code** ⇒ 一行：就是它自己的值。
 * 父 code 读到时，子孙不再单独出行；只读了 `.0` 时孩子照旧可以单独读。
 * 时间那一行下面可以多一行 `节日：…`（见 `holidayLineOf`）。
 */
function stateLinesOf(card: Card, tree: Tree, reads: string[]): string[] {
  const lines: string[] = []
  for (const element of card.state) {
    if (underReadParent(element.code, reads)) continue
    if (reads.includes(element.code)) {
      lines.push(
        `${t('prompt.stateLine', { code: element.code, name: element.name })}${projectOf(card, tree, element)}`,
      )
      if (element.type === 'time') {
        const line = holidayLineOf(element, tree[pathsOf(card.state, element.code)[0]] as TimeValue)
        if (line !== undefined) lines.push(line)
      }
      continue
    }
    // 结构体没有自身值：`.0` 那一支与它无关（`pathsOf` 的首项在它身上是孩子的路径）
    if (element.type === 'object') continue
    const [ownPath] = pathsOf(card.state, element.code)
    if (ownPath !== undefined && ownPath !== element.code && reads.includes(ownPath)) {
      lines.push(
        `${t('prompt.stateLine', { code: ownPath, name: element.name })}${JSON.stringify(tree[ownPath])}`,
      )
    }
  }
  return lines
}

// 拼一个节点的提示词：五段按契约顺序接起来，眼睛没打开的段一个字都不放
export function buildPrompt({ card, save, node, action, outputs }: BuildPromptArgs): string {
  const blocks: string[] = []

  // 公共提示词：一块一个标记；正文为空的那一块没有东西可读，标记也不留
  for (const prompt of card.prompts) {
    if (node.reads.includes(prompt.id) && prompt.body !== '') {
      blocks.push(`<${t('prompt.publicBlock', { title: prompt.title })}>\n${prompt.body}`)
    }
  }

  // 状态段：读到的每个引用一行；**正文逐字接在格式后面**（不经过插值，JSON 里的花括号不会被吃掉）
  const stateLines = stateLinesOf(card, save.tree, node.reads)
  if (stateLines.length > 0) blocks.push(`<${t('prompt.stateBlock')}>\n${stateLines.join('\n')}`)

  // 历史块恒有正文（本回合行动总在里面），所以它没有「空段」这一档。
  // 开场白读卡上 `opening` 那一块（§6.1 保证每张卡都有），正文为空就是这张卡没有开场白。
  const opening = card.prompts.find((prompt) => prompt.id === OPENING_PROMPT_ID)?.body ?? ''
  blocks.push(
    `<${t('prompt.historyBlock')}>\n${historyLines(opening, save.events, node.historyTurns, action).join('\n')}`,
  )

  // 上游按**链顺序**拼（不是按点击/存储顺序）：谁先跑完，谁的话在前；一段一个标记
  for (const other of card.chain) {
    const text = node.readsUpstream.includes(other.id) ? outputs[other.id] : undefined
    if (text !== undefined && text !== '') {
      blocks.push(`<${t('prompt.upstreamBlock', { name: other.name })}>\n${text}`)
    }
  }

  if (node.prompt !== '') blocks.push(`<${t('prompt.nodeBlock')}>\n${node.prompt}`)

  return blocks.join('\n\n')
}
