/**
 * 引擎测试 —— 一轮 = 照卡里的图跑，每个节点一段带工具的模型循环。
 *
 * 断言的重点（决定 #25/#26/#46）：
 *   - 调用次数与顺序 = 卡里 `声明.图.拓扑`（每个节点至少一次；工具往返多问一次）
 *   - 每个节点的请求 = 公共部分（状态快照 + 玩家原话 + 卡的五块设定/剧本/约定/工具说明）
 *     + **它前面全部节点**的本轮产出 + 它自己的提示词，并且**声明了工具**
 *   - **工具调用被真的执行**（时间真的推进），结果以 role:'tool' 回传给模型
 *   - 叙事 = story 节点的**文字**；上游 = 拓扑前缀
 *   - 失败就抛错：模型调用失败、story 节点没写出文字、工具轮次到顶
 *
 * 期望值从示例卡的 JSON 现读（卡改了断言跟着走）；文案断言走 t('key')；
 * 夹具是 ASCII 常量，本文件保持 ASCII。
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runTurn, type AgentEvent } from '../src/agent/agent'
import { graphOfCard, MAX_TOOL_ROUNDS, narrationOf, STORY_NODE, TIME_NODE } from '../src/agent/card-graph'
import { executeGraph } from '../src/agent/graph'
import { parseCard } from '../src/game/card'
import { currentCard } from '../src/game/current-card'
import { iso, timeLabel, turn } from '../src/game/state'
import * as K from '../src/game/card-keys'
import { t } from '../src/i18n'
import { installFakeLlm, type FakeLlm, type FakeReply } from './support/fakeLlm'
import { fixture } from './support/card-fixtures'
import { advanceTimeCall, cardTurnReplies } from './support/card-replies'
import { ADVANCE_OK_MARKER, REASON_LABEL } from './support/locale-patterns'
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
const TIME_TEXT = 'time node finished'
const EARLIER_QUESTION = 'what was that noise'
const EARLIER_ANSWER = 'the wind, probably'
const UNREACHED = 'this reply must never be used'
const DAY_MS = 86400000
/** 一次合法的推进量（理由由测试自己给） */
const THREE_DAYS = { step: 3, unit: 'day', reason: 'walked for three days' }

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

/** 时间节点在拓扑里的位置（0 起）—— 它的第一次调用是第 TIME_CALL + 1 次 */
const TIME_CALL = topology.indexOf(TIME_NODE)

/**
 * 工具往返之后那一次调用的下标。
 *
 * ⚠️ 数值上它同时等于「时间节点第一次调用的 1 起编号」（前面每个节点一次，
 *    再加这一条），所以 `agent.toolsOnly` 的 {step} 也用它 —— 两处含义都在这里说清。
 */
const afterToolCall = TIME_CALL + 1

describe('runTurn - one model loop per node, in the card topology order', () => {
  it('calls the model once per node, in topology order, each with its own prompt and the tools', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT }))
    const ctx = createAgentContext()
    const events: AgentEvent[] = []

    await runTurn(ctx, { action: ACTION, onEvent: (e) => events.push(e) })

    // 拓扑里的每个节点各调一次（没有工具调用时）：九节点卡就是九次（次数从卡里数，不写死）
    expect(fake.calls).toHaveLength(topology.length)
    expect(topology.length).toBeGreaterThan(1)

    // 顺序 = 拓扑：第 n 次调用带着第 n 个节点的提示词与它的显示名
    topology.forEach((id, index) => {
      expect(requestOf(index), 'call #' + index + ' must be node ' + id).toContain(nodePrompts[id][0])
      expect(requestOf(index)).toContain('## ' + String(nodeMeta[id][K.KEY_NODE_NAME]))
    })

    // 每个节点都**声明了工具**：引擎的动作白名单只有 advance_time（决定 #46）
    for (const call of fake.calls) {
      const tools = call.body.tools as Array<{ function: { name: string } }>
      expect(tools.map((tool) => tool.function.name)).toEqual(['advance_time'])
      expect(call.body.tool_choice).toBe('auto')
    }

    // 进度事件也按拓扑发（决定 #38）：node 事件流就是拓扑本身
    const nodeEvents = events.filter((e) => e.type === 'node').map((e) => (e as { id: string }).id)
    expect(nodeEvents).toEqual(topology)
    // 每次调用前有一次 thinking（第几次模型调用）
    const steps = events.filter((e) => e.type === 'thinking').map((e) => (e as { step: number }).step)
    expect(steps).toEqual(topology.map((_, index) => index + 1))
  })

  it('keeps the shared part byte-identical across nodes (the snapshot is frozen before the graph)', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT }))
    const ctx = createAgentContext()
    const beforeLabel = timeLabel(ctx.state)

    await runTurn(ctx, { action: ACTION })

    // system（五块设定 + 剧本 + 历法 + 工具说明 + 节点约定）九个节点逐字相同
    const systems = topology.map((_, index) => requestMessages(index)[0].content)
    expect(new Set(systems).size).toBe(1)

    // 公共部分：五块设定（顺序固定）、剧本、历法、工具说明、节点约定
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
    // 历法与工具说明（引擎自带的两份）也在公共部分里 —— 文件原文必须逐字进请求
    expect(system).toContain(readFileSync('prompts/zh-CN/calendar.md', 'utf8').trim())
    expect(system).toContain(readFileSync('prompts/zh-CN/tools.md', 'utf8').trim())

    // 每个节点的 user 消息都以同一份快照开头，且时间是**开跑前**的那一刻：
    // 工具中途推进了时间也不会让后面节点的快照与前面对不上（决定 #26）
    topology.forEach((_, index) => {
      const user = requestMessages(index).at(-1)?.content ?? ''
      expect(user).toContain(t('snapshot.turn', { turn: 0 }))
      expect(user).toContain(t('snapshot.time', { time: beforeLabel }))
      expect(user).toContain(t('agent.playerAction', { action: ACTION }))
    })
  })

  it('has no later node output in an earlier request (upstream is the topology prefix)', async () => {
    fake = installFakeLlm(cardTurnReplies({ node: (id) => marker(id) }))
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

  it('turns the story node text into the narration (and the action is logged first)', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_OUTPUT }))
    const ctx = createAgentContext()
    const events: AgentEvent[] = []

    const result = await runTurn(ctx, { action: ACTION, onEvent: (e) => events.push(e) })

    // 叙事就是那段文字：没有 JSON、没有围栏要剥
    expect(result.text).toBe(STORY_OUTPUT)
    expect(events.at(-1)).toEqual({ type: 'narration', text: STORY_OUTPUT })
    // 事件流：行动在前、叙事在后（刷新后故事区就是它的投影）
    expect(ctx.state.data.events.map((e) => e.kind)).toEqual(['action', 'narration'])
    expect(ctx.state.data.events[0].text).toBe(ACTION)
    expect(ctx.state.data.events[1].text).toBe(STORY_OUTPUT)
    expect(turn(ctx.state)).toBe(1)
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

describe('the tool loop: the engine acts only on native tool calls (never on text)', () => {
  /** 造一轮：指定节点的回复序列（其余节点回自己的标记） */
  function repliesWith(node: string, replies: FakeReply[]): FakeReply[] {
    return cardTurnReplies({ node: (id) => (id === node ? replies : marker(id)) })
  }

  it('executes the call, feeds the result back as role:"tool", then takes the text of the next reply', async () => {
    fake = installFakeLlm(repliesWith(TIME_NODE, [advanceTimeCall(THREE_DAYS), TIME_TEXT]))
    const ctx = createAgentContext()
    const before = Date.parse(iso(ctx.state))
    const events: AgentEvent[] = []

    const result = await runTurn(ctx, { action: ACTION, onEvent: (e) => events.push(e) })

    // 工具真的改了状态：时钟走了三天，理由进了时间线
    expect(Date.parse(iso(ctx.state)) - before).toBe(3 * DAY_MS)
    expect(ctx.state.data.timeline).toHaveLength(1)
    expect(ctx.state.data.timeline[0].reason).toBe(THREE_DAYS.reason)

    // 回传的形状：assistant 的 tool_calls 原样 + 一条 role:'tool' 结果（内容与引擎报的逐字相同）
    const followUp = requestMessages(afterToolCall)
    const assistant = followUp.find((m) => m.tool_calls?.length)
    expect(assistant?.content).toBe('')
    expect(assistant?.tool_calls?.[0]).toEqual({
      id: 'call_0',
      type: 'function',
      function: { name: 'advance_time', arguments: JSON.stringify(THREE_DAYS) },
    })
    const resultEvent = events.find((e) => e.type === 'toolResult') as { result: string }
    const toolMessage = followUp.find((m) => m.role === 'tool')
    expect(toolMessage?.tool_call_id).toBe('call_0')
    expect(toolMessage?.content).toBe(resultEvent.result)
    expect(toolMessage?.content).toContain(ADVANCE_OK_MARKER)
    expect(toolMessage?.content).toContain(REASON_LABEL)

    // 事件：工具调用的参数是协议原样给的字符串
    const toolEvent = events.find((e) => e.type === 'tool') as { tool: string; args: string }
    expect(toolEvent.tool).toBe('advance_time')
    expect(toolEvent.args).toBe(JSON.stringify(THREE_DAYS))

    // 上游传的是**时间节点的文字**，不是工具的参数（节点的文字只有两个用途）
    expect(requestMessages(afterToolCall + 1).at(-1)?.content ?? '').toContain(TIME_TEXT)
    // 叙事仍然来自 story 节点的文字（这个用例里 story 回的是它自己的标记）
    expect(result.text).toBe(marker(STORY_NODE))
  })

  it('returns a structured error when the arguments are not valid JSON (the model can fix it)', async () => {
    fake = installFakeLlm(
      repliesWith(TIME_NODE, [
        { toolCalls: [{ name: 'advance_time', arguments: '{"step": 3, ' }] },
        TIME_TEXT,
      ]),
    )
    const ctx = createAgentContext()
    const before = iso(ctx.state)

    await runTurn(ctx, { action: ACTION })

    // 错误文案原样回传（带着模型自己写的那串参数），让它自己改
    const toolMessage = requestMessages(afterToolCall).find((m) => m.role === 'tool')
    expect(toolMessage?.content).toContain('{"step": 3, ')
    expect(toolMessage?.content).toContain(t('tools.invalidJson', { message: '', got: '' }).split('（')[0])
    // 解析不出来就一个字节都不动（不是静默跳过）
    expect(iso(ctx.state)).toBe(before)
    expect(ctx.state.data.timeline).toEqual([])
  })

  it('rejects a non-object argument payload the same way (never guesses)', async () => {
    fake = installFakeLlm(
      repliesWith(TIME_NODE, [{ toolCalls: [{ name: 'advance_time', arguments: '[1,2]' }] }, TIME_TEXT]),
    )
    const ctx = createAgentContext()

    await runTurn(ctx, { action: ACTION })

    const toolMessage = requestMessages(afterToolCall).find((m) => m.role === 'tool')
    expect(toolMessage?.content).toBe(t('tools.notJsonObject', { got: '[1,2]' }))
  })

  it('refuses a tool that is not on the whitelist, including Object.prototype names', async () => {
    for (const name of ['teleport', 'constructor']) {
      fake?.restore()
      fake = installFakeLlm(repliesWith(TIME_NODE, [{ toolCalls: [{ name }] }, TIME_TEXT]))
      const ctx = createAgentContext()

      await runTurn(ctx, { action: ACTION })

      const toolMessage = requestMessages(afterToolCall).find((m) => m.role === 'tool')
      expect(toolMessage?.content).toBe(t('tools.unknown', { name, available: 'advance_time' }))
    }
  })

  it('stops at the tool round limit and warns instead of burning the whole quota', async () => {
    // 模型拿工具当玩具：每一轮都只调工具、不写字（假 fetch 把最后一条回复重复到底）
    fake = installFakeLlm([advanceTimeCall({ step: 1, unit: 'day' })])
    const ctx = createAgentContext()
    const events: AgentEvent[] = []
    const before = Date.parse(iso(ctx.state))

    await expect(runTurn(ctx, { action: ACTION, onEvent: (e) => events.push(e) })).rejects.toThrow(
      /tool round limit/,
    )

    // 上限就是上限：只问了这么多次，工具也只执行了这么多次
    expect(fake.calls).toHaveLength(MAX_TOOL_ROUNDS)
    expect(Date.parse(iso(ctx.state)) - before).toBe(MAX_TOOL_ROUNDS * DAY_MS)
    // 到顶要留一行警告（调试痕迹里看得见），而不是静默收场
    expect(events).toContainEqual({
      type: 'warn',
      message: t('agent.stepLimit', { max: MAX_TOOL_ROUNDS }),
    })
    // 一个节点都没写出文字，整轮失败：没有叙事、没有落盘
    expect(ctx.state.data.events.map((e) => e.kind)).toEqual(['action'])
  })

  it('ignores text written in the same step as a tool call (the next text is the output)', async () => {
    fake = installFakeLlm(
      repliesWith(TIME_NODE, [
        {
          content: 'let me move the clock first',
          toolCalls: [{ name: 'advance_time', arguments: JSON.stringify(THREE_DAYS) }],
        },
        TIME_TEXT,
      ]),
    )
    const ctx = createAgentContext()
    const events: AgentEvent[] = []

    await runTurn(ctx, { action: ACTION, onEvent: (e) => events.push(e) })

    // 工具照样执行；这一步的文字不是产出（它不是「没有工具调用」的那一次），
    // 所以也不该报「只调工具」——那一行的条件是「一个字都没写」
    expect(ctx.state.data.timeline).toHaveLength(1)
    expect(events.some((e) => e.type === 'warn')).toBe(false)
  })

  it('stops before the next request when the turn is aborted between tool rounds', async () => {
    fake = installFakeLlm(repliesWith(TIME_NODE, [advanceTimeCall(THREE_DAYS), TIME_TEXT]))
    const ctx = createAgentContext()
    const controller = new AbortController()
    let callsAtAbort = 0
    /** 工具一执行完就取消：模拟「模型还在跑的时候玩家按了重来」 */
    function abortOnTool(e: AgentEvent): void {
      if (e.type !== 'tool') return
      callsAtAbort = fake?.calls.length ?? 0
      controller.abort()
    }

    await expect(
      runTurn(ctx, { action: ACTION, signal: controller.signal, onEvent: abortOnTool }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // 工具已经执行完，但取消之后一次请求都不许再发（取消立刻停）
    expect(fake.calls.length).toBe(callsAtAbort)
    expect(ctx.state.data.timeline).toHaveLength(1)
  })

  it('warns when a step only called tools and wrote nothing (then keeps asking)', async () => {
    fake = installFakeLlm(repliesWith(TIME_NODE, [advanceTimeCall(THREE_DAYS), TIME_TEXT]))
    const ctx = createAgentContext()
    const events: AgentEvent[] = []

    await runTurn(ctx, { action: ACTION, onEvent: (e) => events.push(e) })

    expect(events).toContainEqual({ type: 'warn', message: t('agent.toolsOnly', { step: afterToolCall }) })
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

    fake = installFakeLlm(['one', 'two'])
    const outputs = await executeGraph(
      graphOfCard({
        card: twoNode,
        state: createAgentContext().state,
        snapshot: 'SNAPSHOT',
        history: [],
        playerWords: 'PLAYER WORDS',
      }),
    )

    // 产出就是模型返回的文字，原样（trim 后）交给上游
    expect(outputs).toEqual(['one', 'two'])
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
})

/** 夹具卡（两个节点）的节点提示词：键就是拓扑里的 id */
function promptsOf(twoNode: Record<string, unknown>): Record<string, string[]> {
  const block = twoNode[K.KEY_PROMPT] as Record<string, unknown>
  return block[K.KEY_NODES] as Record<string, string[]>
}

describe('narrationOf - the one node text the engine reads', () => {
  /** 造一份「示例卡拓扑 + 指定产出」的输出数组：只改 story 那一个 */
  function outputsWith(story: string): string[] {
    return topology.map((id) => (id === STORY_NODE ? story : 'out of ' + id))
  }

  it('takes the story node text and trims it (no JSON, no fence to unwrap)', () => {
    expect(narrationOf(currentCard, outputsWith('  hello  '))).toBe('hello')
  })

  it('keeps a fenced block as-is -- it is just text now (nothing is parsed)', () => {
    const raw = '```json\n{"note": 1}\n```'
    expect(narrationOf(currentCard, outputsWith(raw))).toBe(raw)
  })

  it('throws when the story node wrote nothing (a turn with no text must not commit)', () => {
    for (const blank of ['', '   ', '\n\t']) {
      expect(() => narrationOf(currentCard, outputsWith(blank))).toThrow(STORY_NODE)
    }
  })
})
