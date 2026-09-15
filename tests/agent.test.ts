/**
 * 引擎测试（src/agent/agent.ts + card-graph.ts）—— 一回合怎么跑。
 *
 * 成功标准（都在这里守）：
 *   · 照卡的拓扑，每个节点问一次模型；每个节点只能用它声明的工具（tools 白名单）；
 *   · 模型申请的动作**真的执行**（时间真的被推进、状态真的被写进工作副本），
 *     结果原样回传给模型；
 *   · 本回合叙事 = role: "story" 那个节点的文字；
 *   · redo：回滚到 from 开跑前的快照（撤销 from 与它之后的一切）、把 why 交给重跑节点、
 *     从 from 重跑到末尾、一轮最多 MAX_REDO 次；
 *   · 模型调用失败 / 取消：原样上抛，一个字节都不改。
 *
 * ⚠️ 节点 id 一个都不写死：用「谁的 tools 里有这个动作」现查（引擎自己就是这么认的）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runTurn, type AgentEvent } from '../src/agent/agent'
import { MAX_REDO, MAX_TOOL_ROUNDS } from '../src/agent/card-graph'
import { openingInstruction } from '../src/agent/prompts'
import { availableActions } from '../src/game/card-actions'
import { advance } from '../src/game/card-calendar'
import { currentCard } from '../src/game/current-card'
import { hydrateFromSave, initialState, save } from '../src/game/state'
import { localStorageStore } from '../src/utils/storage'
import { t } from '../src/i18n'
import { configureFakeProvider, createAgentContext, createGame } from './support/game-fixtures'
import {
  cardPassReplies,
  cardTurnReplies,
  CARD_TOPOLOGY,
  redoCall,
  storyNodeOf,
  timeNodeOf,
} from './support/card-replies'
import { installFakeLlm, type FakeLlm, type FakeReply } from './support/fakeLlm'

/* ---- 测试自己编的 fixture（模型回复与玩家行动），不是产品文案 ---- */
const PLAYER_ACTION = 'I go to the docks'
const STORY_TEXT = 'The wind smells of rain.'
const SECOND_STORY = 'The wind has turned.'
const NEXT_ACTION = 'I keep walking'
const NETWORK_ERROR = 'network down'
const TIME_MINUTES = 90
const TIME_REASON = 'walked across town'
const KEYED_NAME = 'newcomer'
const ROLLED_BACK_ROLE = 'rolled-back-role'
const REDO_WHY = 'the map is wrong'

/** 有名有姓的节点 id：按「谁的 tools 里有这个动作」查 —— 不在这里抄卡的 id */
function nodeWithTool(tool: string): string {
  const id = CARD_TOPOLOGY.find((node) => availableActions(currentCard, node).includes(tool))
  if (!id) throw new Error('the example card has no node with tool "' + tool + '"')
  return id
}

const MAP = nodeWithTool('move_to')
const CAST = nodeWithTool('update_role')
const STORY = storyNodeOf()
const VERIFY = nodeWithTool('redo')

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

/** 造一次 advance_time 调用（参数是协议原样的 JSON 字符串） */
function advanceTimeCall(minutes: number, reason = ''): FakeReply {
  return { toolCalls: [{ name: 'advance_time', arguments: JSON.stringify({ minutes, reason }) }] }
}

/** 造一次 update_role 调用：只给名字（元素 schema 的字段都可以不写） */
function addRoleCall(name: string): FakeReply {
  return { toolCalls: [{ name: 'update_role', arguments: JSON.stringify({ name }) }] }
}

/** 造一次 set_chain 调用（字典写入，键 = 链名） */
function setChainCall(name: string): FakeReply {
  return { toolCalls: [{ name: 'set_chain', arguments: JSON.stringify({ name, stage: 1 }) }] }
}

/** 造一次 move_to 调用（world.location 是整体替换，三个字段都得给） */
function moveToCall(where: string): FakeReply {
  return {
    toolCalls: [{ name: 'move_to', arguments: JSON.stringify({ area: where, spot: where, scene: where }) }],
  }
}

/** 从一次请求里取要发给模型的工具名 */
function toolNamesOf(callIndex: number): string[] {
  const tools = (fake?.calls[callIndex].body.tools ?? []) as Array<{ function: { name: string } }>
  return tools.map((tool) => tool.function.name)
}

describe('one turn = the card graph, one model call per node', () => {
  it('asks each node of the topology once, in order', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_TEXT }))
    const ctx = createAgentContext()
    const seen: string[] = []

    const result = await runTurn(ctx, {
      action: PLAYER_ACTION,
      onEvent: (evt) => {
        if (evt.type === 'node') seen.push(evt.id)
      },
    })

    expect(seen).toEqual(CARD_TOPOLOGY)
    expect(fake.calls).toHaveLength(CARD_TOPOLOGY.length)
    expect(result.text).toBe(STORY_TEXT)
    expect(ctx.data.meta.turn).toBe(1)
  })

  it('puts the player words in the task message', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_TEXT }))
    const ctx = createAgentContext()
    await runTurn(ctx, { action: PLAYER_ACTION })

    const user = (fake.calls[0].body.messages ?? []).find((message) => message.role === 'user')?.content ?? ''
    expect(user).toContain(PLAYER_ACTION)
  })

  it('opens with the engine instruction plus the card requirements (no player action)', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_TEXT }))
    const ctx = createAgentContext()
    await runTurn(ctx)

    const user = (fake.calls[0].body.messages ?? []).find((message) => message.role === 'user')?.content ?? ''
    expect(user).toContain(openingInstruction())
    for (const requirement of currentCard.opening.requirements) expect(user).toContain(requirement)
  })

  it('declares exactly the tools each node is allowed to use', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_TEXT }))
    const ctx = createAgentContext()
    await runTurn(ctx, { action: PLAYER_ACTION })

    CARD_TOPOLOGY.forEach((id, index) => {
      expect(toolNamesOf(index), id).toEqual(availableActions(currentCard, id))
    })
    // 一个工具都不给它的节点（story）连 tools 字段都不发
    const storyIndex = CARD_TOPOLOGY.indexOf(STORY)
    expect(availableActions(currentCard, STORY)).toEqual([])
    expect(fake?.calls[storyIndex].body.tools).toBeUndefined()
  })

  it('writes the player words and the narration into the event stream', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_TEXT }))
    const ctx = createAgentContext()
    await runTurn(ctx, { action: PLAYER_ACTION })

    expect(ctx.data.events.map((event) => event.kind)).toEqual(['action', 'narration'])
    expect(ctx.data.events[0].text).toBe(PLAYER_ACTION)
    expect(ctx.data.events[1].text).toBe(STORY_TEXT)
  })

  it('writes no action event on the opening (there is no player action yet)', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_TEXT }))
    const ctx = createAgentContext()
    await runTurn(ctx)

    expect(ctx.data.events.map((event) => event.kind)).toEqual(['narration'])
  })

  it('shows the player this round what happened in earlier rounds (the event stream is the memory)', async () => {
    // 第一轮：说一句、写一段
    fake = installFakeLlm(cardTurnReplies({ story: STORY_TEXT }))
    const first = createGame()
    await runTurn(createAgentContext(first), { action: PLAYER_ACTION })
    fake.restore()

    // 模拟刷新：内存里什么都不留，只从存档读回来
    save(first, localStorageStore(localStorage))
    const reopened = initialState()
    hydrateFromSave(reopened, localStorage)
    expect(reopened.data.events.map((event) => event.kind)).toEqual(['action', 'narration'])

    // 第二轮：节点请求里仍然看得到上一轮的原话与正文
    fake = installFakeLlm(cardTurnReplies({ story: SECOND_STORY }))
    await runTurn(createAgentContext(reopened), { action: NEXT_ACTION })

    const user = (fake.calls[0].body.messages ?? []).find((message) => message.role === 'user')?.content ?? ''
    // 上一轮的原话与正文都在历史里；这一轮的原话只在「## 玩家」，不在历史里重复
    expect(user).toContain(t('prompts.recentLine', { who: t('prompts.player'), text: PLAYER_ACTION }))
    expect(user).toContain(t('prompts.recentLine', { who: t('prompts.gm'), text: STORY_TEXT }))
    expect(user).toContain('## ' + t('prompts.player'))
    expect(user).toContain(NEXT_ACTION)
    expect(user).not.toContain(t('prompts.recentLine', { who: t('prompts.player'), text: NEXT_ACTION }))
  })

  it('throws when the story node writes nothing (a round without a body must not commit)', async () => {
    fake = installFakeLlm(cardTurnReplies({ node: (id) => (id === STORY ? '   ' : undefined) }))
    const ctx = createAgentContext()
    await expect(runTurn(ctx, { action: PLAYER_ACTION })).rejects.toThrow(currentCard.graph.nodes[STORY].name)
  })
})

describe('tools: the model asks, the engine acts', () => {
  it('moves the clock for real and hands the result back to the model', async () => {
    fake = installFakeLlm(
      cardTurnReplies({ story: STORY_TEXT, time: { minutes: TIME_MINUTES, reason: TIME_REASON } }),
    )
    const ctx = createAgentContext()
    const events: AgentEvent[] = []
    const before = { ...ctx.data.time }

    await runTurn(ctx, { action: PLAYER_ACTION, onEvent: (evt) => events.push(evt) })

    expect(ctx.data.time).toEqual(advance(currentCard.time.calendar, before, TIME_MINUTES))
    // 时间节点的第二次请求里看得到引擎回传的结果（模型靠它知道现在几点）
    const timeIndex = CARD_TOPOLOGY.indexOf(timeNodeOf())
    const followUp = fake.calls[timeIndex + 1].body.messages ?? []
    const result = followUp.find((message) => message.role === 'tool')
    expect(result?.content).toContain(String(TIME_MINUTES))
    expect(events).toContainEqual({
      type: 'stateChange',
      node: timeNodeOf(),
      path: 'time',
      value: ctx.data.time,
    })
  })

  it('writes a state-tree path through the card action (keyed map merge)', async () => {
    fake = installFakeLlm(
      cardTurnReplies({
        story: STORY_TEXT,
        node: (id) => (id === CAST ? [setChainCall(KEYED_NAME)] : undefined),
      }),
    )
    const ctx = createAgentContext()
    const events: AgentEvent[] = []

    await runTurn(ctx, { action: PLAYER_ACTION, onEvent: (evt) => events.push(evt) })

    const world = ctx.data.state.world as Record<string, unknown>
    expect((world.chains as Record<string, unknown>)[KEYED_NAME]).toEqual({ stage: 1 })
    const change = events.find((evt) => evt.type === 'stateChange')
    expect(change).toEqual({
      type: 'stateChange',
      node: CAST,
      path: 'world.chains.' + KEYED_NAME,
      value: { stage: 1 },
    })
    expect(ctx.data.timeline).toEqual([])
  })

  it('turns an invalid tool call into a tool result the model can fix (the turn still commits)', async () => {
    // 第一次给一个引擎不接受的参数（map 的键是空串），第二次才写对
    fake = installFakeLlm(
      cardTurnReplies({
        story: STORY_TEXT,
        node: (id) => (id === CAST ? [setChainCall(''), setChainCall(KEYED_NAME), 'cast done'] : undefined),
      }),
    )
    const ctx = createAgentContext()
    await runTurn(ctx, { action: PLAYER_ACTION })

    const castIndex = CARD_TOPOLOGY.indexOf(CAST)
    const followUp = fake.calls[castIndex + 1].body.messages ?? []
    expect(followUp.some((message) => message.role === 'tool' && message.content.includes('must be'))).toBe(
      true,
    )
    const chains = (ctx.data.state.world as Record<string, unknown>).chains as Record<string, unknown>
    expect(chains[KEYED_NAME]).toBeDefined()
    expect(chains['']).toBeUndefined()
  })

  it('fails the node when it keeps calling tools without ever writing text', async () => {
    const call = addRoleCall(KEYED_NAME)
    fake = installFakeLlm(
      cardTurnReplies({ node: (id) => (id === CAST ? [call, call, call, call] : undefined) }),
    )
    const ctx = createAgentContext()
    await expect(runTurn(ctx, { action: PLAYER_ACTION })).rejects.toThrow(
      t('agent.nodeStepLimit', { node: currentCard.graph.nodes[CAST].name, max: MAX_TOOL_ROUNDS }),
    )
  })
})

describe('redo: partial rollback, then rerun from that step to the end', () => {
  /** 第一遍：地图写「错的」、角色写一个临时条目、校对要求退回地图 */
  function firstPass(): FakeReply[] {
    return cardPassReplies(CARD_TOPOLOGY, (id) => {
      if (id === MAP) return [moveToCall('wrong'), 'map first pass']
      if (id === CAST) return [addRoleCall(ROLLED_BACK_ROLE), 'cast first pass']
      if (id === STORY) return 'first body'
      if (id === VERIFY) return redoCall(MAP, REDO_WHY)
      return undefined
    })
  }

  /** 重跑那一段：地图写「对的」、角色不再写那条、正文重写、校对通过 */
  function rerunPass(story = SECOND_STORY): FakeReply[] {
    return cardPassReplies([MAP, CAST, STORY, VERIFY], (id) => {
      if (id === MAP) return [moveToCall('right'), 'map second pass']
      if (id === STORY) return story
      return undefined
    })
  }

  it('rolls back everything from the redone node on, and commits the last rerun', async () => {
    fake = installFakeLlm([...firstPass(), ...rerunPass()])
    const ctx = createAgentContext()
    const events: AgentEvent[] = []

    const result = await runTurn(ctx, { action: PLAYER_ACTION, onEvent: (evt) => events.push(evt) })

    // 叙事取**最后一次**重跑的结果
    expect(result.text).toBe(SECOND_STORY)
    const world = ctx.data.state.world as Record<string, unknown>
    expect(world.location).toEqual({ area: 'right', spot: 'right', scene: 'right' })
    // 第一遍写下的角色被回滚掉（重跑时没有再写它）
    expect((ctx.data.state.roles as Record<string, unknown>)[ROLLED_BACK_ROLE]).toBeUndefined()
    // 节点事件：跑完一遍之后从地图重跑到末尾
    const nodeEvents = events.filter((evt) => evt.type === 'node') as Array<{ id: string }>
    expect(nodeEvents.map((evt) => evt.id)).toEqual([...CARD_TOPOLOGY, MAP, CAST, STORY, VERIFY])
    expect(events).toContainEqual({ type: 'redo', from: MAP, why: REDO_WHY })
  })

  it('hands the reason to the rerun node as a system message', async () => {
    fake = installFakeLlm([...firstPass(), ...rerunPass()])
    const ctx = createAgentContext()
    await runTurn(ctx, { action: PLAYER_ACTION })

    // 重跑的那一段请求：从第一次跑完的槽位之后开始
    const rerunStart = fake.calls.length - rerunPass().length
    const rerunMessages = fake.calls[rerunStart].body.messages ?? []
    const hint = rerunMessages.find(
      (message) => message.role === 'system' && message.content.includes(REDO_WHY),
    )
    expect(hint).toBeDefined()
    expect(hint?.content).toContain(currentCard.graph.nodes[VERIFY].name)
    // 正常节点拿不到这条提示
    expect((fake.calls[0].body.messages ?? []).some((message) => message.content.includes(REDO_WHY))).toBe(
      false,
    )
  })

  it('keeps the writes made before the redone node (only from that step on is rolled back)', async () => {
    // 时间节点在地图之前：它推进的时间必须留下
    const minutes = 30
    const first = cardPassReplies(CARD_TOPOLOGY, (id) => {
      if (id === timeNodeOf()) return [advanceTimeCall(minutes), 'time pass']
      if (id === MAP) return [moveToCall('wrong'), 'map first pass']
      if (id === STORY) return 'first body'
      if (id === VERIFY) return redoCall(MAP, REDO_WHY)
      return undefined
    })
    fake = installFakeLlm([...first, ...rerunPass()])
    const ctx = createAgentContext()
    const before = { ...ctx.data.time }

    await runTurn(ctx, { action: PLAYER_ACTION })

    expect(ctx.data.time).toEqual(advance(currentCard.time.calendar, before, minutes))
  })

  it('gives up after MAX_REDO reruns in one round (no two nodes burning the budget)', async () => {
    const insist = cardPassReplies([MAP, CAST, STORY, VERIFY], (id) =>
      id === VERIFY ? redoCall(MAP, REDO_WHY) : undefined,
    )
    const first = cardPassReplies(CARD_TOPOLOGY, (id) =>
      id === VERIFY ? redoCall(MAP, REDO_WHY) : undefined,
    )
    fake = installFakeLlm([...first, ...insist, ...insist, ...insist])
    const ctx = createAgentContext()

    expect(MAX_REDO).toBe(2)
    await expect(runTurn(ctx, { action: PLAYER_ACTION })).rejects.toThrow(currentCard.graph.nodes[MAP].name)
  })
})

describe('failure and cancellation change nothing', () => {
  it('a failed model call is thrown as-is and only the action event was written', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_TEXT }))
    fake.failNextWith(new Error(NETWORK_ERROR))
    const ctx = createAgentContext()
    // 工作副本在开跑时写了一条 action（玩家原话）；其余一个字节都不许动 ——
    // 副本连同这条事件由调用方在回滚时丢掉（见 tests/turn.test.ts）
    const { events: _events, ...before } = JSON.parse(JSON.stringify(ctx.data)) as Record<string, unknown>

    await expect(runTurn(ctx, { action: PLAYER_ACTION })).rejects.toThrow(NETWORK_ERROR)

    const { events, ...rest } = JSON.parse(JSON.stringify(ctx.data)) as Record<string, unknown>
    expect(rest).toEqual(before)
    expect((events as Array<{ kind: string }>).map((event) => event.kind)).toEqual(['action'])
  })

  it('an aborted signal stops before the next model call', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: STORY_TEXT }))
    const ctx = createAgentContext()
    const controller = new AbortController()
    controller.abort()

    await expect(runTurn(ctx, { action: PLAYER_ACTION, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fake.calls).toHaveLength(0)
  })
})
