/**
 * 票「模型没调工具」· 判据 —— **S2 先写、先红**（功能还没做）。
 *
 * 契约：`.team/test/2026-10-09/contract-no-change.md`（编号与它 §6 那张表一一对应）。
 * 起点读数：`probe5-读数-工具整条关掉.md` —— 今天「不调工具」「纯叙事」「忘了调」在引擎的报面上
 * **一个字符都分不开**（连一条 warn 都没有），所以这份用例**在功能做出来之前必须全红**。
 *
 * 三条口径（照契约写死）：
 *   · 引擎内置的那个动作叫 **`no_change`**，参数 **`{ reason }`**（非空字符串，理由**走参数、不走散文**）；
 *   · 有牌可打的节点：调工具 ⇒ `updated`；调 `no_change(reason)` ⇒ `unchanged`（**只给调试看**）；
 *     两者都没有 ⇒ `error`（该调没调 / 调了全失败）；**没牌可打的节点**（卡里 `tools: []`）只回文字，**不罚**；
 *   · **玩家那一侧一个字节都看不见 `reason`** —— 它只进调试类痕迹。
 *
 * ⚠️ 节点 id / 键名 / 展示名一律**从卡与引擎现取**，不在这里抄第二份（卡换了这份用例要跟着走）。
 * ⚠️ 新事件的类型 / 新 kind 还没进 `AgentEvent` 与 `EventKind` 的联合类型 —— 一律**按字符串现读**
 *    （`typeOf` / `kindOf` / `fieldOf`）：不然整份文件会在收集阶段炸掉，看起来像"测试坏了"。
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runTurn, type AgentEvent } from '../src/agent/agent'
import { availableActions, runAction, toolSchemas } from '../src/game/card-actions'
import { parseCard } from '../src/game/card'
import { currentCard } from '../src/game/current-card'
import { initialState } from '../src/game/state'
import { t } from '../src/i18n'
import { useGame, type Row } from '../src/stores/game'
import { configureFakeProvider, createAgentContext } from './support/game-fixtures'
import { CARD_TOPOLOGY, storyNodeOf, timeNodeOf } from './support/card-replies'
import { installFakeLlm, type FakeLlm, type FakeReply } from './support/fakeLlm'

/* ---- 测试自己编的 fixture（模型回复、玩家行动、理由文本），不是产品文案 ---- */
const PLAYER_ACTION = 'I look around'
const STORY_TEXT = 'The wind smells of rain.'
const NO_CHANGE = 'no_change'
const REASON = 'nothing to update in this step'
const NEUTRAL_REASON = 'checked this step; no change'
const PROSE_CLAIM = 'no change: I decided not to call any tool this turn.'
const TIME_MINUTES = 15
const TIME_REASON = 'walked across town'

/** 有牌可打的节点 / 一张牌都没有的节点 —— **由卡说了算**（契约 §3.3 的 `offered`） */
const TOOL_NODES = CARD_TOPOLOGY.filter((id) => availableActions(currentCard, id).length > 0)
const PLAIN_NODES = CARD_TOPOLOGY.filter((id) => availableActions(currentCard, id).length === 0)
const STORY = storyNodeOf()
const TIME = timeNodeOf()
/** 报账的那个节点（挑一个不推时间的，免得两件事互相盖住） */
const DECLARER = TOOL_NODES.find((id) => id !== TIME) ?? TOOL_NODES[0]
/** 犯规的那个节点（既不是报账那个、也不是叙事那个） */
const DEVIANT = TOOL_NODES.find((id) => id !== DECLARER) ?? DECLARER

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
  useGame().resetGame()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

/** 事件的 type（新事件还没进联合类型之前也读得到） */
const typeOf = (evt: AgentEvent): string => evt.type as string

/** 读一个新事件上还没有的字段；没有就是 undefined */
function fieldOf<T>(evt: unknown, key: string): T | undefined {
  return (evt as Record<string, unknown>)[key] as T | undefined
}

/** 行的 kind（同上：新 kind 还没进联合类型） */
const kindOf = (row: Row): string => row.kind as string

type DebugRow = Extract<Row, { debug: true }>

/** 调试行（玩家看不到的那些） */
const debugRows = (g: ReturnType<typeof useGame>): DebugRow[] =>
  g.rows.value.filter((row): row is DebugRow => row.debug)

/** 玩家看的行 */
const storyRows = (g: ReturnType<typeof useGame>): Row[] => g.rows.value.filter((row) => !row.debug)

/** 只取某一类事件的某个字段 */
function fieldList<T>(events: AgentEvent[], type: string, key: string): T[] {
  return events.filter((evt) => typeOf(evt) === type).map((evt) => fieldOf<T>(evt, key) as T)
}

/** 某个节点在事件里报出来的节点名单（排序后好对） */
const nodesReporting = (events: AgentEvent[], type: string): string[] =>
  fieldList<string>(events, type, 'node').slice().sort()

/** 节点这一轮的文字产出 */
const lineOf = (id: string) => '[' + id + '] wrote this line.'

/** 展示名（痕迹里写的是它，不是 id） */
const nameOf = (id: string) => currentCard.graph.nodes[id].name

/** 一次 no_change 调用：理由走参数（`content` 给空 = 它只报账、不写文字） */
function noChangeCall(reason: string, content = ''): FakeReply {
  return { content, toolCalls: [{ name: NO_CHANGE, arguments: JSON.stringify({ reason }) }] }
}

/** 一次 advance_time 调用（协议原样的 JSON 字符串） */
function advanceTimeCall(minutes: number, reason = ''): FakeReply {
  return { toolCalls: [{ name: 'advance_time', arguments: JSON.stringify({ minutes, reason }) }] }
}

interface TurnScript {
  /** 报账的节点：它这一轮调 no_change + 这个理由（默认给一句中性的） */
  declarer?: string
  /** 报账用的理由 */
  reason?: string
  /** 犯规的节点：它这一轮**一张牌都不打、也不报账** */
  deviant?: string
  /** 犯规节点这一轮回什么（默认一段普通文字） */
  deviantReply?: FakeReply
  /** 时间节点这一轮真的调一次 advance_time（给了它就不再报账） */
  time?: { minutes: number; reason: string }
}

/**
 * 一整轮的假回复：**有牌可打的节点一律合规地报账**，没牌可打的节点只回文字。
 *
 * 这样每一条用例里"红/绿"都只由**那一个**被点名的节点决定 —— 别的节点不搅局。
 */
function turnReplies(script: TurnScript = {}): FakeReply[] {
  return CARD_TOPOLOGY.flatMap((id) => {
    if (id === script.deviant) return [script.deviantReply ?? lineOf(id)]
    if (id === TIME && script.time)
      return [advanceTimeCall(script.time.minutes, script.time.reason), lineOf(id)]
    if (TOOL_NODES.includes(id)) {
      return [noChangeCall(id === script.declarer ? (script.reason ?? NEUTRAL_REASON) : NEUTRAL_REASON)]
    }
    return [id === STORY ? STORY_TEXT : lineOf(id)]
  })
}

/** 在引擎层真跑一轮（假模型，不联网） */
async function runEngineTurn(
  replies: FakeReply[],
): Promise<{ fake: FakeLlm; events: AgentEvent[]; text: string }> {
  fake = installFakeLlm(replies)
  const ctx = createAgentContext()
  const events: AgentEvent[] = []
  const result = await runTurn(ctx, { action: PLAYER_ACTION, onEvent: (evt) => events.push(evt) })
  return { fake, events, text: result.text }
}

/** 在组合根层（界面走的那条路）真跑一轮 */
async function runStoreTurn(replies: FakeReply[], debug: boolean): Promise<ReturnType<typeof useGame>> {
  const g = useGame()
  g.debugMode.value = debug
  fake = installFakeLlm(replies)
  await g.runTurnAction(PLAYER_ACTION)
  fake.restore()
  fake = null
  return g
}

describe('N1 a declared no-change is recognised: this node stays put this turn', () => {
  it('N1a the engine recognises no_change and reports the node with its reason', async () => {
    const { events } = await runEngineTurn(turnReplies({ declarer: DECLARER, reason: REASON }))

    const declared = events.filter(
      (evt) => typeOf(evt) === 'unchanged' && fieldOf<string>(evt, 'reason') === REASON,
    )
    expect(declared.map((evt) => fieldOf<string>(evt, 'node'))).toEqual([DECLARER])
    // 有牌可打的节点**每一个**都报了账（不是只有那个被点名的）
    expect(nodesReporting(events, 'unchanged')).toEqual([...TOOL_NODES].sort())
  })

  it('N1b the debug projection keeps the line: which node did not move, and why', async () => {
    const g = await runStoreTurn(turnReplies({ declarer: DECLARER, reason: REASON }), true)

    const lines = debugRows(g).filter((row) => kindOf(row) === 'unchanged')
    expect(lines.map((row) => row.detail)).toContain(REASON)
    const text = lines.map((row) => row.text).join('\n')
    for (const id of TOOL_NODES) expect(text).toContain(nameOf(id))
  })

  it('N1c the player side never sees the reason', async () => {
    const g = await runStoreTurn(turnReplies({ declarer: DECLARER, reason: REASON }), false)

    const playerSees = storyRows(g).map((row) => row.text)
    expect(playerSees).toContain(STORY_TEXT)
    expect(playerSees.join('\n')).not.toContain(REASON)
    expect(playerSees.join('\n')).not.toContain(NO_CHANGE)
  })

  it('N1d the same reason is visible to the debugger and invisible to the player', async () => {
    const g = await runStoreTurn(turnReplies({ declarer: DECLARER, reason: REASON }), true)

    const debugSees = debugRows(g)
      .map((row) => [kindOf(row), row.text, row.detail ?? ''].join(' '))
      .join('\n')
    expect(debugSees).toContain(REASON)
    expect(debugSees).toContain(NO_CHANGE)

    g.debugMode.value = false
    const playerSees = g.rows.value.map((row) => row.text).join('\n')
    expect(playerSees).toContain(STORY_TEXT)
    expect(playerSees).not.toContain(REASON)
  })
})

describe('N2 no tool call and no declaration: the third case is judged an error', () => {
  it('N2a a node with tools that called none and declared nothing is reported', async () => {
    const { events } = await runEngineTurn(turnReplies({ deviant: DEVIANT }))

    expect(nodesReporting(events, 'noToolCall')).toEqual([DEVIANT])
  })

  it('N2b the debug projection keeps a warning naming that node', async () => {
    const g = await runStoreTurn(turnReplies({ deviant: DEVIANT }), true)

    const warns = debugRows(g)
      .filter((row) => kindOf(row) === 'warn')
      .map((row) => row.text)
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain(nameOf(DEVIANT))
    expect(warns[0]).toContain(t('agent.nodeNoToolCall', { node: nameOf(DEVIANT) }))
  })

  it('N2c text that claims "no change" is not a declaration (the engine never parses prose)', async () => {
    const { events } = await runEngineTurn(turnReplies({ deviant: DEVIANT, deviantReply: PROSE_CLAIM }))

    expect(nodesReporting(events, 'noToolCall')).toEqual([DEVIANT])
    expect(fieldList<string>(events, 'unchanged', 'reason')).not.toContain(PROSE_CLAIM)
  })
})

describe('N3 a tool that wrote stays as before / no tools to play is not punished / an empty reason is a structured error', () => {
  it('N3a a node that wrote state reports neither unchanged nor noToolCall', async () => {
    const { events } = await runEngineTurn(
      turnReplies({ time: { minutes: TIME_MINUTES, reason: TIME_REASON } }),
    )

    expect(events.filter((evt) => evt.type === 'stateChange')).toHaveLength(1)
    expect(nodesReporting(events, 'noToolCall')).toEqual([])
    expect(fieldList<string>(events, 'unchanged', 'node')).not.toContain(TIME)
  })

  it('N3b a node with no tools at all is never asked to declare anything', async () => {
    const { events } = await runEngineTurn(turnReplies())

    expect(PLAIN_NODES.length).toBeGreaterThan(0)
    const flagged = nodesReporting(events, 'noToolCall')
    for (const id of PLAIN_NODES) expect(flagged).not.toContain(id)
  })

  it('N3c an empty or missing reason is refused with a structured error', () => {
    const state = initialState().data.state
    const ok = runAction(currentCard, state, NO_CHANGE, { reason: REASON }, DECLARER)
    expect(ok.ok).toBe(true)
    expect(fieldOf<string>(ok, 'kind')).toBe(NO_CHANGE)
    expect(fieldOf<string>(ok, 'reason')).toBe(REASON)

    for (const args of [{ reason: '' }, {}]) {
      const bad = runAction(currentCard, state, NO_CHANGE, args, DECLARER)
      expect(bad.ok).toBe(false)
      expect(fieldOf<string>(bad, 'error')).toContain('reason')
    }
  })
})

describe('N4 the three locale keys exist in both locales', () => {
  it('N4 the debug line and the acknowledgment exist in zh-CN and en', () => {
    const keys = ['store.unchangedLine', 'agent.nodeNoToolCall', 'agent.noChangeAck']
    for (const name of ['zh-CN', 'en']) {
      const table = JSON.parse(readFileSync('src/locales/' + name + '.json', 'utf8')) as Record<
        string,
        Record<string, string>
      >
      for (const key of keys) {
        const [section, leaf] = key.split('.')
        expect(table[section]?.[leaf], name + ': ' + key).toBeTruthy()
      }
    }
  })
})

describe('N5 the tool table: exactly once, only where the card declares tools; the card may not claim that name', () => {
  it('N5a the built-in action is offered once, and only where the card declares tools', () => {
    for (const id of TOOL_NODES) {
      const names = toolSchemas(currentCard, id).map((tool) => tool.function.name)
      expect(
        names.filter((name) => name === NO_CHANGE),
        id,
      ).toHaveLength(1)
      for (const own of availableActions(currentCard, id)) expect(names).toContain(own)
    }
    for (const id of PLAIN_NODES) {
      expect(
        toolSchemas(currentCard, id).map((tool) => tool.function.name),
        id,
      ).toEqual([])
    }

    const schema = toolSchemas(currentCard, DECLARER).find((tool) => tool.function.name === NO_CHANGE)
    expect(schema?.function.parameters.required).toContain('reason')
    expect(schema?.function.parameters.properties.reason?.type).toBe('string')
  })

  it('N5b a card that declares the engine-reserved action name is refused at load time', () => {
    const raw = JSON.parse(readFileSync('cards/morningwind.json', 'utf8')) as Record<string, any>
    // 拿一条**已有的**动作改名：path 的归属不变 ⇒ 不引入第二条违规（否则会红错地方）
    const donor = Object.keys(raw.actions)[0]
    raw.actions[NO_CHANGE] = raw.actions[donor]
    delete raw.actions[donor]
    for (const node of Object.values(raw.graph.nodes) as Array<Record<string, any>>) {
      if (Array.isArray(node.tools)) {
        node.tools = node.tools.map((name: string) => (name === donor ? NO_CHANGE : name))
      }
    }

    expect(() => parseCard(JSON.stringify(raw))).toThrow(/reserved/i)
  })
})

describe('N6 no_change is terminal: one call per node, and the reason is never fed back', () => {
  it('N6 a declaring reply ends the node: one call per node, no "tools only" warning', async () => {
    const { fake: handle, events } = await runEngineTurn(turnReplies({ declarer: DECLARER, reason: REASON }))

    expect(handle.calls).toHaveLength(CARD_TOPOLOGY.length)
    expect(events.filter((evt) => evt.type === 'warn')).toEqual([])
    // 理由只给调试看 ⇒ 它不进任何一次请求体（终结 + 历史只喂故事类事件）
    expect(handle.calls.map((call) => JSON.stringify(call.body)).join('\n')).not.toContain(REASON)
  })
})
