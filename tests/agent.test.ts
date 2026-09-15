/**
 * 引擎测试 —— 一轮 = 照卡里的图跑，每个节点一次模型调用。
 *
 * 断言的重点（决定 #25/#26/#36）：
 *   - 调用次数与顺序 = 卡里 `声明.图.拓扑`（不是写死的节点表）
 *   - 每个节点的请求 = 公共部分（状态快照 + 玩家原话 + 卡的五块设定/剧本/约定）
 *     + **它前面全部节点**的本轮产出 + 它自己的提示词
 *   - 上下游隔离：排在第 n 个的请求里没有后面节点的产出
 *   - 叙事 = story 节点的正文；时间 = time 节点的推进量（唯一写状态的节点产出）
 *   - 失败就抛错：解析不出来、卡里缺有消费者的节点，都不静默跳过
 *
 * 期望值从示例卡的 JSON 现读（卡改了断言跟着走）；文案断言走 t('key')；
 * 夹具是 ASCII 常量，本文件保持 ASCII。
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runTurn, type AgentEvent } from '../src/agent/agent'
import { applyTimeNode, graphOfCard, narrationOf, STORY_NODE, TIME_NODE } from '../src/agent/card-graph'
import { executeGraph } from '../src/agent/graph'
import { parseCard } from '../src/game/card'
import { currentCard } from '../src/game/current-card'
import { iso, timeLabel, turn } from '../src/game/state'
import * as K from '../src/game/card-keys'
import { t } from '../src/i18n'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'
import { fixture } from './support/card-fixtures'
import { cardTurnReplies, jsonBlock } from './support/card-replies'
import { configureFakeProvider, createAgentContext } from './support/game-fixtures'
import type { ChatMessage } from '../src/types/state'

/** 示例卡里引擎要读的那几块（已校验，形状由 game/card.ts 守） */
const card = currentCard as Record<string, unknown>
const decl = card[K.KEY_DECL] as Record<string, unknown>
const graph = decl[K.KEY_GRAPH] as Record<string, unknown>
const topology = graph[K.KEY_TOPOLOGY] as string[]
const nodeMeta = graph[K.KEY_NODES] as Record<string, Record<string, unknown>>
const prompts = card[K.KEY_PROMPT] as Record<string, unknown>
const nodePrompts = prompts[K.KEY_NODES] as Record<string, string[]>
const settings = prompts[K.KEY_SETTING] as Record<string, string[]>
const convention = prompts[K.KEY_CONVENTION] as string[]

/** 测试自造的夹具（不是产品文案） */
const ACTION = 'look out the window'
const STORY_OUTPUT = 'The story node wrote this paragraph.'
const EARLIER_QUESTION = 'what was that noise'
const EARLIER_ANSWER = 'the wind, probably'
const UNREACHED = 'this reply must never be used'
const DAY_MS = 86400000

/** 第 n 个节点的产出标记：每个节点的请求里只该有排在它前面的那些 */
const marker = (id: string) => 'OUT-' + id + '-END'

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

/** 第 n 次调用的消息数组 */
const requestMessages = (index: number): ChatMessage[] => fake?.calls[index].body.messages ?? []

/**
 * 一次调用的请求内容（各条消息的正文拼起来，方便断言「里面有什么」）。
 *
 * ⚠️ 不 JSON.stringify：卡里的提示词自带 ASCII 引号，转义后会与原文对不上。
 */
function requestOf(index: number): string {
  return requestMessages(index)
    .map((m) => m.content)
    .join('\n\n')
}

/** 递归收集一段卡内容里的所有字符串（剧本的键名不写进测试，按内容断言） */
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringLeaves)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringLeaves)
  return []
}

describe('runTurn - one call per node, in the card topology order', () => {
  it('calls the model once per node, in topology order, each with its own prompt', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT }))
    const ctx = createAgentContext()
    const events: AgentEvent[] = []

    await runTurn(ctx, { action: ACTION, onEvent: (e) => events.push(e) })

    // 拓扑里的每个节点各调一次：九节点卡就是九次（次数从卡里数，不写死）
    expect(fake.calls).toHaveLength(topology.length)
    expect(topology.length).toBeGreaterThan(1)

    // 顺序 = 拓扑：第 n 次调用带着第 n 个节点的提示词与它的显示名
    topology.forEach((id, index) => {
      expect(requestOf(index), 'call #' + index + ' must be node ' + id).toContain(nodePrompts[id][0])
      expect(requestOf(index)).toContain('## ' + String(nodeMeta[id][K.KEY_NODE_NAME]))
    })

    // 每个节点的请求里必须念出**它自己声明要输出的键**（卡的 声明.图.节点[id].输出）。
    // 少了这一段，模型只知道「输出是一个 JSON 代码块」却不知道键名 —— 开场那一轮
    // 实测就是这么失败的：story 回一段散文，引擎解析「正文」失败、整轮回滚。
    topology.forEach((id, index) => {
      const declared = nodeMeta[id][K.KEY_OUTPUT] as Record<string, unknown>
      for (const key of Object.keys(declared)) {
        expect(requestOf(index), 'call #' + index + ' (' + id + ') must name its output key').toContain(key)
      }
    })

    // 进度事件也按拓扑发（决定 #38）：node 事件流就是拓扑本身
    const nodeEvents = events.filter((e) => e.type === 'node').map((e) => (e as { id: string }).id)
    expect(nodeEvents).toEqual(topology)
    // 每次调用前有一次 thinking（第几次模型调用）
    const steps = events.filter((e) => e.type === 'thinking').map((e) => (e as { step: number }).step)
    expect(steps).toEqual(topology.map((_, index) => index + 1))
  })

  it('keeps the shared part byte-identical across nodes and freezes the clock during the graph', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT }))
    const ctx = createAgentContext()
    const beforeLabel = timeLabel(ctx.state)

    await runTurn(ctx, { action: ACTION })

    // system（五块设定 + 剧本 + 历法 + 节点约定）九个节点逐字相同
    const systems = topology.map((_, index) => requestMessages(index)[0].content)
    expect(new Set(systems).size).toBe(1)

    // 公共部分：五块设定（顺序固定）、剧本、节点约定、状态快照、玩家原话
    const system = systems[0]
    expect(system).toContain('## ' + K.KEY_SETTING)
    K.SETTING_BLOCKS.forEach((block) => {
      expect(system).toContain('### ' + block)
      for (const line of settings[block]) expect(system).toContain(line)
    })
    const scriptLeaves = stringLeaves(prompts[K.KEY_SCRIPT]).sort((a, b) => b.length - a.length)
    expect(system).toContain(scriptLeaves[0])
    expect(system).toContain('## ' + K.KEY_SCRIPT)
    expect(system).toContain('## ' + K.KEY_CONVENTION)
    for (const line of convention) expect(system).toContain(line)
    // 历法说明（含时间单位的写法）也在公共部分里 —— 文件原文必须逐字进请求
    expect(system).toContain(readFileSync('prompts/zh-CN/calendar.md', 'utf8').trim())

    // 每个节点的 user 消息都以同一份快照开头，且时钟还是**推进前**的那一刻：
    // 时间在图跑完之后才落进状态，中途改会让后面的节点与前面对不上
    topology.forEach((_, index) => {
      const user = requestMessages(index).at(-1)?.content ?? ''
      expect(user).toContain(t('snapshot.turn', { turn: 0 }))
      expect(user).toContain(t('snapshot.time', { time: beforeLabel }))
      expect(user).toContain(t('agent.playerAction', { action: ACTION }))
    })
  })

  it('has no later node output in an earlier request (upstream is the topology prefix)', async () => {
    // 每个节点的**原始产出**里都带自己的标记；有消费者的两个节点把标记放进合法 JSON 里
    const replies = topology.map((id) => {
      if (id === TIME_NODE) {
        return jsonBlock({ [K.KEY_ADVANCE]: { step: 1, unit: 'day' }, [K.KEY_REASON]: marker(id) })
      }
      if (id === STORY_NODE) return jsonBlock({ [K.KEY_STORY_TEXT]: STORY_OUTPUT })
      return marker(id)
    })
    replies[topology.indexOf(STORY_NODE)] = jsonBlock({
      [K.KEY_STORY_TEXT]: STORY_OUTPUT,
      [K.KEY_REASON]: marker(STORY_NODE),
    })
    fake = installFakeLlm(replies)
    const ctx = createAgentContext()

    await runTurn(ctx, { action: ACTION })

    topology.forEach((_, index) => {
      const request = requestOf(index)
      // 前面每个节点的产出都在（逐条断言）
      for (const earlier of topology.slice(0, index)) expect(request).toContain(marker(earlier))
      // 自己与后面的节点：一个都不能出现
      for (const later of topology.slice(index)) expect(request).not.toContain(marker(later))
    })
    // 第一个节点只有公共部分：一个产出标记都没有
    for (const id of topology) expect(requestOf(0)).not.toContain(marker(id))
  })

  it('turns the story node output into the narration (and the action is logged first)', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT }))
    const ctx = createAgentContext()
    const events: AgentEvent[] = []

    const result = await runTurn(ctx, { action: ACTION, onEvent: (e) => events.push(e) })

    expect(result.text).toBe(STORY_OUTPUT)
    expect(events.at(-1)).toEqual({ type: 'narration', text: STORY_OUTPUT })
    // 事件流：行动在前、叙事在后（刷新后故事区就是它的投影）
    expect(ctx.state.data.events.map((e) => e.kind)).toEqual(['action', 'narration'])
    expect(ctx.state.data.events[0].text).toBe(ACTION)
    expect(ctx.state.data.events[1].text).toBe(STORY_OUTPUT)
    expect(turn(ctx.state)).toBe(1)
  })

  it('advances the world clock by the time node JSON and records the reason', async () => {
    const reason = 'walked for three days'
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT, time: { step: 3, unit: 'day', reason } }))
    const ctx = createAgentContext()
    const before = Date.parse(iso(ctx.state))

    await runTurn(ctx, { action: ACTION })

    expect(Date.parse(iso(ctx.state)) - before).toBe(3 * DAY_MS)
    expect(ctx.state.data.timeline).toHaveLength(1)
    expect(ctx.state.data.timeline[0].reason).toBe(reason)
  })

  it('carries every node the same history and returns the next one', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT }))
    const ctx = createAgentContext()
    const history: ChatMessage[] = [
      { role: 'user', content: EARLIER_QUESTION },
      { role: 'assistant', content: EARLIER_ANSWER },
    ]

    const result = await runTurn(ctx, { action: ACTION, history })

    topology.forEach((_, index) => {
      expect(requestMessages(index).map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
      expect(requestOf(index)).toContain(EARLIER_QUESTION)
      expect(requestOf(index)).toContain(EARLIER_ANSWER)
    })
    expect(result.history).toHaveLength(4)
    expect(result.history[2].content).toBe(t('agent.playerAction', { action: ACTION }))
    expect(result.history[3].content).toBe(STORY_OUTPUT)
  })

  it('leaves persistence to the caller (the engine never saves)', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT }))
    const ctx = createAgentContext()
    await runTurn(ctx, { action: ACTION })
    expect(localStorage.getItem('tavernGame.save')).toBeNull()
  })
})

describe('runTurn - failures fail fast', () => {
  it('propagates a model call failure and does not bump the turn counter', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT }))
    fake.failNextWith(new Error('network down'))
    const ctx = createAgentContext()

    await expect(runTurn(ctx, { action: ACTION })).rejects.toThrow('network down')
    expect(turn(ctx.state)).toBe(0)
    // 引擎层只保证「没有叙事、没有推进」；丢弃行动那条日志是组合根的事务
    expect(ctx.state.data.events.map((e) => e.kind)).toEqual(['action'])
  })

  it('an already-aborted signal runs no node at all', async () => {
    fake = installFakeLlm([UNREACHED])
    const ctx = createAgentContext()
    const controller = new AbortController()
    controller.abort()

    await expect(runTurn(ctx, { action: ACTION, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fake.calls).toHaveLength(0)
  })
})

describe('the graph shape comes from the card, not from the engine', () => {
  it('builds the nodes from the topology, even when the node object is in another order', async () => {
    const raw = fixture()
    const graphOfFixture = raw[K.KEY_DECL][K.KEY_GRAPH] as Record<string, unknown>
    const nodes = graphOfFixture[K.KEY_NODES] as Record<string, unknown>
    // 节点对象的键顺序和拓扑相反：执行顺序只认拓扑（决定 #40）
    graphOfFixture[K.KEY_NODES] = { second: nodes.second, first: nodes.first }
    const twoNode = parseCard(JSON.stringify(raw))

    fake = installFakeLlm([jsonBlock({ note: 'one' }), jsonBlock({ note: 'two' })])
    const outputs = await executeGraph(
      graphOfCard({
        card: twoNode,
        snapshot: 'SNAPSHOT',
        history: [],
        playerWords: 'PLAYER WORDS',
      }),
    )

    expect(outputs).toEqual([jsonBlock({ note: 'one' }), jsonBlock({ note: 'two' })])
    expect(fake.calls).toHaveLength(2)
    // 两个节点的提示词来自卡（夹具里是 ASCII 的 "prompt"），公共部分来自卡与快照
    expect(requestOf(0)).toContain(promptsOf(twoNode).first[0])
    expect(requestOf(1)).toContain(promptsOf(twoNode).second[0])
    expect(requestOf(0)).toContain('SNAPSHOT')
    expect(requestOf(1)).toContain('PLAYER WORDS')
  })

  it('fast-fails when the card has no node for the narration (the engine needs that name)', () => {
    const twoNode = parseCard(JSON.stringify(fixture()))
    expect(() => narrationOf(twoNode, ['a', 'b'])).toThrow(STORY_NODE)
  })

  it('fast-fails when the card has no node for the clock', () => {
    const twoNode = parseCard(JSON.stringify(fixture()))
    const s = createAgentContext().state
    expect(() => applyTimeNode(s, twoNode, ['a', 'b'])).toThrow(TIME_NODE)
  })
})

/** 夹具卡（两个节点）的节点提示词：键就是拓扑里的 id */
function promptsOf(twoNode: Record<string, unknown>): Record<string, string[]> {
  const block = twoNode[K.KEY_PROMPT] as Record<string, unknown>
  return block[K.KEY_NODES] as Record<string, string[]>
}

describe('narrationOf / applyTimeNode - the two named consumers', () => {
  /** 造一份「示例卡拓扑 + 指定产出」的输出数组：只改有消费者的那两个节点 */
  function outputsWith(over: Record<string, string>): string[] {
    return topology.map((id) => over[id] ?? jsonBlock({ note: id }))
  }

  it('unwraps a fenced JSON block (any case) and trims the narration', () => {
    for (const tag of ['json', 'JSON']) {
      const out = outputsWith({
        [STORY_NODE]: '```' + tag + '\n{"' + K.KEY_STORY_TEXT + '": "  hello  "}\n```',
      })
      expect(narrationOf(currentCard, out)).toBe('hello')
    }
  })

  it('accepts a bare JSON object as well as a fenced block', () => {
    const out = outputsWith({ [STORY_NODE]: JSON.stringify({ [K.KEY_STORY_TEXT]: 'bare' }) })
    expect(narrationOf(currentCard, out)).toBe('bare')
  })

  it('throws when the narration is not JSON, has no text, or is blank', () => {
    expect(() => narrationOf(currentCard, outputsWith({ [STORY_NODE]: 'not json at all' }))).toThrow(
      /not valid JSON/,
    )
    expect(() => narrationOf(currentCard, outputsWith({ [STORY_NODE]: jsonBlock({ other: 1 }) }))).toThrow(
      K.KEY_STORY_TEXT,
    )
    expect(() =>
      narrationOf(currentCard, outputsWith({ [STORY_NODE]: jsonBlock({ [K.KEY_STORY_TEXT]: '   ' }) })),
    ).toThrow(K.KEY_STORY_TEXT)
  })

  it('applies the advance from the time node and keeps the clock when parsing fails', () => {
    const ctx = createAgentContext()
    const before = iso(ctx.state)

    applyTimeNode(
      ctx.state,
      currentCard,
      outputsWith({
        [TIME_NODE]: jsonBlock({
          [K.KEY_ADVANCE]: { step: 2, unit: 'week' },
          [K.KEY_REASON]: 'two weeks',
        }),
      }),
    )
    expect(Date.parse(iso(ctx.state)) - Date.parse(before)).toBe(14 * DAY_MS)

    const bad = [
      'not json',
      jsonBlock({}),
      jsonBlock({ [K.KEY_ADVANCE]: { step: 1, unit: 'lightyear' }, [K.KEY_REASON]: 'x' }),
      jsonBlock({ [K.KEY_ADVANCE]: { step: 'many', unit: 'day' }, [K.KEY_REASON]: 'x' }),
      jsonBlock({ [K.KEY_ADVANCE]: { step: 1, unit: 'day' } }),
      jsonBlock({ [K.KEY_ADVANCE]: [1, 'day'], [K.KEY_REASON]: 'x' }),
    ]
    const after = iso(ctx.state)
    for (const output of bad) {
      expect(() => applyTimeNode(ctx.state, currentCard, outputsWith({ [TIME_NODE]: output }))).toThrow()
      // 失败的那一次一个字节都没推进
      expect(iso(ctx.state)).toBe(after)
    }
  })
})
