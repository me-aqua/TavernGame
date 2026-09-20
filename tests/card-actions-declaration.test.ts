/**
 * 票 65 · 段 7a：**节点与动作的声明形状** —— 引擎侧（运行时消费）的判据。
 *
 * 契约 `.team/test/2026-09-20/contract-65.md`；S0 `.team/leader/2026-09-19/段7-S0.md`。
 *
 * 这一份管 S0 §三 的口径 4 与口径 2 的另一半：
 *   · 工具说明 = 该动作那三段拼起来（R49/R58）—— 而且**真的进了请求体**；
 *   · 那三段**不许**同时出现在节点主提示词 / 系统提示里（同一个事实不说两遍）。
 *
 * 🔴 **这一票最贵的那条判据**在这里：`duty` 是必填、被校验，却从不进请求体
 *    （`prompts.ts` 只用节点的 `name` + `prompt`）—— 新增的两段如果照不上那条路，
 *    就是**第二个 `duty`**。所以判据必须落在**请求体**上（`toolSchemas` 的 description
 *    就是它进请求体的那条路：`llm.ts` 把 tools 原样发出去）。
 *
 * ⚠️ 中文一律码点构造（`.githooks/checks/ascii.mjs` 连 `tests/` 里的字面量一起拦），
 *    但**这里不需要中文**：三段的值一律从卡里现取。
 * ⚠️ **动作一个名字都不写死**：遍历卡自己声明的那张表（`Object.keys(card.actions)`）。
 * ⚠️ 拿哪张卡：`morningwind`（引擎的示例卡）。它的节点 id（`map` / `time` / …）由
 *    `card-declaration.test.ts` 那边的归属表负责；这一份按"哪个节点的 `tools` 非空"现取。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCard } from '../src/game/card'
import { toolSchemas } from '../src/game/card-actions'
import { buildNodeMessages, cardSystemPrompt } from '../src/agent/prompts'
import { createInitialState, isRecord } from '../src/game/save'

/** 动作条目认的三个键 —— 格式自己的词表（ASCII） */
const ACTION_SEGMENTS = ['whenToUse', 'what', 'principles'] as const

const card = parseCard(readFileSync('cards/morningwind.json', 'utf8'))

/** 动作名 → 那三段文本（顺序 = 格式声明的顺序） */
const segmentsOf = (name: string): string[] =>
  ACTION_SEGMENTS.map((key) => (card.actions[name] as unknown as Record<string, string>)[key])

/** 一个动作推导出来的工具说明（它就是要发出去的 `tools[].function.description`） */
function descriptionOf(name: string): string {
  const tool = toolSchemas(card).find((entry) => entry.function.name === name)
  if (tool === undefined) throw new Error('no such tool: ' + name)
  return tool.function.description
}

/** 一个节点的 system 消息（提示词装配器写的） */
function systemOf(node: string): string {
  return cardSystemPrompt(card, node)
}

/** 一个节点的 user 消息（含它自己的主提示词） */
function userOf(node: string): string {
  const data = createInitialState(card)
  return buildNodeMessages({
    card,
    node,
    state: data.state,
    events: data.events,
    memoryUpTo: data.events.length,
    playerWords: 'a line from the player',
    upstream: [],
  }).at(-1)?.content as string
}

/** 换行符（源码必须 ASCII，写不了换行字面量） */
const NEWLINE = String.fromCharCode(10)

/** 那些手上真的有动作的节点（本票里"干活的那一步"就是它们） */
const WORKING_NODES = card.graph.topology.filter((id) => (card.graph.nodes[id].tools ?? []).length > 0)

describe('the tool description is the three segments of the action', () => {
  it('12 the first three lines of the description are exactly the three segments, in order', () => {
    // ⚠️ **断的是前三行，不是整条**（S3 评审 F2）：契约 §2.2 说的是"三段的顺序固定"，
    //    而在**整条**上做 `toContain` / `indexOf` 断不出"缺一段"——
    //    实测：段缺失时 `indexOf` 返回 `-1`，而 `-1 < 0` 为真 ⇒ 顺序断言照样绿
    //    （`.tools/zof65-fault-segments.txt` 里那条报的正是 `expected < -1 -- got 0`）。
    //    `toEqual` 逐行相等一次管住三件事：**在不在、顺序对不对、有没有多一行**。
    for (const name of Object.keys(card.actions)) {
      const head = descriptionOf(name).split(NEWLINE).slice(0, ACTION_SEGMENTS.length)
      expect(head, name + ' must start with its three segments, in order').toEqual(segmentsOf(name))
    }
  })

  it('13 every segment is carried exactly once (counted, not searched)', () => {
    // 与 12 一对：12 断"前三行正好是那三段"，这一条独立地断"**三段一个不少、一段也没被抄两遍**"。
    // 数出现次数比 `toContain` 硬 —— 「把 `principles` 抄两遍」在 12 里已经红了，这里再钉一次。
    for (const name of Object.keys(card.actions)) {
      const text = descriptionOf(name)
      const segments = segmentsOf(name)
      for (const segment of segments) {
        const first = text.indexOf(segment)
        expect(first, name + ' must carry ' + JSON.stringify(segment)).toBeGreaterThan(-1)
        expect(
          text.indexOf(segment, first + 1),
          name + ' must carry it only once: ' + JSON.stringify(segment),
        ).toBe(-1)
      }
      // 三段都在同一个字符串里 ⇒ 长度当然盖得住它们（这一条不含 note 也成立，不是"长度凑数"）
      expect(text.length, name).toBeGreaterThanOrEqual(segments.join(NEWLINE).length)
    }
  })

  it('14 the state notes start at the fourth line and live only there', () => {
    // 契约 §2.2 的下一句：note 跟在三段**之后**。⇒ 第四行起（如果有）必须全是 note 行，
    //    而**前三行里一行 note 都不许有**（反过来"三段后面混进别的东西"也在这里红）。
    let withNotes = 0
    for (const name of Object.keys(card.actions)) {
      const lines = descriptionOf(name).split(NEWLINE)
      // 每个动作至少有三段，前 **三段** 正好是它们（12 已逐字比过，这里只复核行数）
      expect(lines.length, name + ' must have at least its three segments').toBeGreaterThanOrEqual(
        ACTION_SEGMENTS.length,
      )
      for (const line of lines.slice(0, ACTION_SEGMENTS.length)) {
        expect(line, name + ': a segment line is not a note line').not.toMatch(/^- /)
      }
      for (const line of lines.slice(ACTION_SEGMENTS.length)) {
        expect(line, name + ': everything after the segments is a note line').toMatch(/^- /)
      }
      if (lines.length > ACTION_SEGMENTS.length) withNotes += 1
    }
    // ⚠️ 夹具自检：**至少有一个**动作带 note，否则"第四行起"那一半什么都没验
    //    ⚠️ 不是"每个动作都带 note"—— `advance_time` 是 effect 型、**没有 path 就没有 note**
    //    （我第一版就写成"每个都带"，当场在**当前实现**上红了：`expected > 3 -- got 3`）。
    expect(withNotes, 'this card must have at least one action with schema notes').toBeGreaterThan(0)
  })

  it('15 the state notes still follow the three segments', () => {
    let checked = 0
    for (const name of Object.keys(card.actions)) {
      const tool = toolSchemas(card).find((entry) => entry.function.name === name) as {
        function: { description: string }
      }
      const notes = tool.function.description.split(String.fromCharCode(10)).slice(3)
      if (notes.length === 0) continue
      checked += 1
      for (const line of notes) {
        expect(line, name + ' keeps the schema notes in their own lines').toMatch(/^- /)
      }
    }
    // 夹具自检：卡里**真的**有带 note 的动作，否则这一条什么都没验
    expect(checked, 'this card must have at least one action with schema notes').toBeGreaterThan(0)
  })
})

describe('a declaration is never repeated in the prompt', () => {
  it('16 no action segment leaks into a node system prompt', () => {
    for (const node of card.graph.topology) {
      const system = systemOf(node)
      for (const name of Object.keys(card.actions)) {
        for (const segment of segmentsOf(name)) {
          expect(system, node + ' must not repeat ' + JSON.stringify(segment)).not.toContain(segment)
        }
      }
    }
  })

  it('17 no action segment leaks into a node main prompt either', () => {
    for (const node of WORKING_NODES) {
      const user = userOf(node)
      for (const name of card.graph.nodes[node].tools ?? []) {
        for (const segment of segmentsOf(name)) {
          expect(user, node + ' must not repeat ' + JSON.stringify(segment)).not.toContain(segment)
        }
      }
    }
  })

  it('18 the request keeps its shape: one system message and one user message', () => {
    const data = createInitialState(card)
    for (const node of card.graph.topology) {
      const messages = buildNodeMessages({
        card,
        node,
        state: data.state,
        events: data.events,
        memoryUpTo: data.events.length,
        playerWords: 'a line from the player',
        upstream: [],
      })
      expect(
        messages.map((message) => message.role),
        node,
      ).toEqual(['system', 'user'])
      expect(messages[0].content, node).not.toBe('')
      expect(messages[1].content, node).not.toBe('')
    }
  })
})

describe('the parameter contract did not move', () => {
  it('19 every action still derives its own parameters (nothing else changed)', () => {
    for (const name of Object.keys(card.actions)) {
      const tool = toolSchemas(card).find((entry) => entry.function.name === name)
      expect(tool, name).toBeDefined()
      const action = card.actions[name] as unknown as Record<string, unknown>
      // path 型动作摊平 schema 的字段；effect 型走引擎给的那几个参数
      if (typeof action.path === 'string') {
        const properties = (tool as { function: { parameters: { properties: Record<string, unknown> } } })
          .function.parameters.properties
        expect(
          Object.keys(properties).length,
          name + ' must derive parameters from the schema',
        ).toBeGreaterThan(0)
      } else {
        expect(isRecord(action), name + ' is an effect action').toBe(true)
      }
    }
  })

  it('20 the three segments are text, so the tool description is one string', () => {
    for (const name of Object.keys(card.actions)) {
      const action = card.actions[name] as unknown as Record<string, unknown>
      for (const key of ACTION_SEGMENTS) {
        expect(typeof action[key], name + '.' + key).toBe('string')
      }
      expect(typeof descriptionOf(name), name).toBe('string')
    }
  })
})
