/**
 * 票 66 · 段 7b：**旧表名与那 6 条 `applies` 的落点**（S0 §七 的 F3 / F4 / F5）。
 *
 * 契约 `.team/test/2026-09-20/contract-66.md`；S0 `.team/leader/2026-09-20/段7b-S0.md` §七。
 *
 * 段 7a 把卡顶层那张 `generators` 表删了、把那 30 行原则搬进了各步的主提示词，但：
 *   · **F3**：6 张旧表的**表名**变成了 `- 填充晨风镇` 这种**列表项** ——
 *     在模型眼里它长得像一条待办，而"这是标题不是条目"只存在于人的脑子里；
 *   · **F4**：6 条 `applies`（这一整片内容在什么场合下生成）**一条都没进新卡**，
 *     而且**没有任何判据记账**（`.txt` 里只记 `principles`）；
 *   · **F5**：那 30 行从 **system 消息**搬到了 **user 消息**（语义位置变了），契约里没锁。
 *
 * 这一份把三件事一起钉住：**表名 → `#### ` 小标题**、**applies → 小标题下一行的原文**、
 * **这些行走 user、system 里一条都没有**。
 *
 * ⚠️ 中文一律来自卡或 `generator-applies.txt`（`.githooks/checks/ascii.mjs` 拦字面量）。
 * ⚠️ 判据里所有位置都**从卡现取**，一个节点 id、一个表名都不写死。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildNodeMessages } from '../src/agent/prompts'
import { parseCard, type CardData } from '../src/game/card'
import { createInitialState } from '../src/game/save'
import { TABLE_APPLIES } from './support/generator-moves'

const cardPath = (name: string): string => 'cards/' + name + '.json'

function load(name: string): CardData {
  return parseCard(readFileSync(cardPath(name), 'utf8'))
}

const CARD_NAMES = [...new Set(TABLE_APPLIES.map((row) => row.card))]

/**
 * 卡**按需**载入（不在收集阶段读盘）。
 *
 * ⚠️ 模块级 `load()` 在卡过不了校验时会让整份文件**载入即抛** —— 那种红只证到"文件会红"，
 *    证不了"判据抓到了那一处"（工序 §S1 点名过）。
 */
const CACHE = new Map<string, CardData>()

function cardOf(name: string): CardData {
  const hit = CACHE.get(name)
  if (hit !== undefined) return hit
  const card = load(name)
  CACHE.set(name, card)
  return card
}

/** 这一票覆盖的三张卡（顺序 = 锚点表里的卡序） */
const cards = (): Array<{ name: string; card: CardData }> =>
  CARD_NAMES.map((name) => ({ name, card: cardOf(name) }))

/** 一个节点的主提示词，按行 */
const linesOf = (card: CardData, node: string): string[] => card.graph.nodes[node].prompt

/** 一个节点的主提示词并成一段文本 */
const promptOf = (card: CardData, node: string): string => linesOf(card, node).join('\n')

/** 全卡所有节点的主提示词并成一段（问"这一句到底在卡里出现了几次"） */
const allPrompts = (card: CardData): string =>
  card.graph.topology.map((node) => promptOf(card, node)).join('\n')

/** 出现次数（用 `split` 数，别用 `indexOf` —— 那只能回答"在不在"） */
const countIn = (haystack: string, needle: string): number => haystack.split(needle).length - 1

/**
 * 一次节点请求的消息，按角色取（问 **F5**：这些行发在哪一侧）。
 *
 * ⚠️ 走**真装配器**（`buildNodeMessages`），不是自己拼一段 —— 自己拼只证明"我拼的那份"，
 *    证不了"生产路径发出去的"。
 */
function messagesFor(card: CardData, node: string): Record<string, string> {
  const data = createInitialState(card)
  const sent = buildNodeMessages({
    card,
    node,
    state: data.state,
    events: [],
    memoryUpTo: 0,
    playerWords: 'open the door',
    upstream: [],
  })
  const byRole: Record<string, string> = {}
  for (const message of sent) byRole[message.role] = message.content
  return byRole
}

describe('F3: the old table names are sub-headings, not list items', () => {
  it('P1 no card still carries a table name as a list item', () => {
    let checked = 0
    for (const { name, card } of cards()) {
      for (const node of card.graph.topology) {
        for (const row of TABLE_APPLIES.filter((item) => item.card === name)) {
          expect(linesOf(card, node), name + '.' + node).not.toContain('- ' + row.table)
          checked += 1
        }
      }
    }
    // 前置断言：这一段真的走过东西（否则它是一条恒真的守卫）
    expect(checked).toBeGreaterThan(0)
  })

  it('P2 each table name is a sub-heading in the nodes that carry its rows, and nowhere else', () => {
    for (const row of TABLE_APPLIES) {
      const card = cardOf(row.card)
      const carriers = card.graph.topology.filter((node) => linesOf(card, node).includes('#### ' + row.table))
      expect(carriers.slice().sort(), row.table).toEqual(row.spreads.slice().sort())
    }
  })
})

describe('F4: the six applies lines land in the main prompt, and only there', () => {
  it('P3 every applies line is in the prompt of the node it belongs to, exactly once per card', () => {
    for (const row of TABLE_APPLIES) {
      const card = cardOf(row.card)
      expect(promptOf(card, row.node), row.table).toContain(row.text)
      expect(countIn(allPrompts(card), row.text), row.table + ' must appear once').toBe(1)
    }
  })

  it('P4 an applies line is the line right under its table heading', () => {
    for (const row of TABLE_APPLIES) {
      const card = cardOf(row.card)
      const lines = linesOf(card, row.node)
      const at = lines.indexOf('#### ' + row.table)
      expect(at, row.card + ': ' + row.table + ' must have a heading in ' + row.node).toBeGreaterThan(-1)
      expect(lines[at + 1], row.card + ': ' + row.table + ' must be followed by its applies line').toBe(
        row.text,
      )
    }
  })

  it('P5 no applies line came back as an action segment (they are not "whenToUse")', () => {
    for (const row of TABLE_APPLIES) {
      const card = cardOf(row.card)
      for (const [action, entry] of Object.entries(card.actions)) {
        for (const segment of [entry.whenToUse, entry.what, entry.principles]) {
          expect(segment, row.card + '.' + action).not.toContain(row.text)
        }
      }
    }
  })

  it('P6 the catalogue itself is complete: six applies lines, one per old table, names all different', () => {
    const tables = TABLE_APPLIES.map((row) => row.table)
    expect(tables).toHaveLength(6)
    expect(new Set(tables).size, 'table names must be different').toBe(6)
    for (const row of TABLE_APPLIES) {
      expect(row.why, row.table + ' must say why it landed there').toBeTruthy()
      expect(row.spreads.length, row.table + ' must name where its rows live').toBeGreaterThan(0)
    }
  })
})

describe('F5: those lines travel in the user message, never in system', () => {
  it('P7 the applies line and the moved principles are in user, and nothing of them is in system', () => {
    for (const row of TABLE_APPLIES) {
      const card = cardOf(row.card)
      const messages = messagesFor(card, row.node)
      expect(Object.keys(messages).sort(), 'one system, one user').toEqual(['system', 'user'])
      expect(messages.user, row.table + ' must travel in the user message').toContain(row.text)
      expect(messages.system, row.table + ' must not travel in system').not.toContain(row.text)
      // 反向控制：**同一份 system 里真的探得到东西**（否则上一条是通道瞎，不是判据有牙）
      expect(messages.system, 'the positive control must be found in system').toContain(card.convention[0])
      // 阴性控制：一句不在卡里的话，这条路必须探不到
      expect(messages.system).not.toContain('NOT-IN-ANY-CARD-AT-ALL')
      expect(messages.user).not.toContain('NOT-IN-ANY-CARD-AT-ALL')
    }
  })
})
