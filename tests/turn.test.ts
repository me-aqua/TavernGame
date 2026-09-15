/**
 * 回合事务（src/stores/turn.ts）—— 一轮 = 一次提交。
 *
 * 成功标准：
 *   ① 中途抛错：内存里的 data 与开跑前逐字节相同，落盘一次都没调
 *   ② 跑起来后取消（AbortError）：同上（调试痕迹除外）
 *   ③ 成功回合：副本一次性写回并落盘，落盘拿到的就是内存里的那一份
 *   ④ 调试投影：草稿只在回合进行中存在，写入清单（stateChange）留到下一轮开始
 *
 * ⚠️ 失败点在「已经改过数据」之后：时间节点调工具把时钟推进了**工作副本**，
 *    之后某个节点一个字都没写出来 —— 回滚必须把已经推进的时间也一起丢掉（决定 #27/#39）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, watch, type Ref } from 'vue'
import { createTurnRunner } from '../src/stores/turn'
import { IDLE, type TurnPhase, type TurnState } from '../src/game/lifecycle'
import { addEvent, endTurn, initialState, save, type GameState } from '../src/game/state'
import { isStoryKind } from '../src/game/save'
import { advance } from '../src/game/card-calendar'
import { currentCard } from '../src/game/current-card'
import { configureFakeProvider } from './support/game-fixtures'
import {
  advanceTimeCall,
  cardPassReplies,
  cardTurnReplies,
  CARD_TOPOLOGY,
  storyNodeOf,
  timeNodeOf,
} from './support/card-replies'
import { installFakeLlm, installFakeLlmThen, type FakeLlm } from './support/fakeLlm'
import type { GameData } from '../src/types/state'
import type { SaveStore } from '../src/utils/storage'

/* ---- 测试自己编的 fixture（模型回复与玩家行动），不是产品文案 ---- */
const SECOND_DRAFT = 'Second draft.'
const LOOK_ACTION = 'look around'
const NETWORK_ERROR = 'network down'
const TIME_MINUTES = 90
const TIME_REASON = 'kept walking'

const STORY = storyNodeOf()
const TIME = timeNodeOf()

/** 一整轮的假回复：时间推 TIME_MINUTES，叙事用 SECOND_DRAFT */
const REPLIES = cardTurnReplies({ story: SECOND_DRAFT, time: { minutes: TIME_MINUTES, reason: TIME_REASON } })

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

/**
 * 造一个跑回合的运行器。
 *
 * 落盘走真的 game.save（存储是 spy）—— 与组合根的接法一致，
 * 这样才能断言「save 读到的就是刚提交的内存」。
 */
function createRunner(state: GameState = initialState()) {
  const write = vi.fn((_data: GameData) => true)
  const store: SaveStore = { save: write }
  const phase = ref<TurnState>(IDLE)
  const debugMode = ref(false)
  const runner = createTurnRunner({
    state,
    card: currentCard,
    addEvent: (target, event) => addEvent(target, event),
    notify: () => {},
    endTurn: (target) => endTurn(target),
    save: () => save(state, store),
    phase,
    debugMode,
  })
  return { state, write, phase, debugMode, ...runner }
}

describe('a turn that never reaches the end leaves no trace', () => {
  it('throwing mid-turn keeps the data byte-identical and never saves', async () => {
    // 第一个节点正常跑完，第二个节点的请求失败
    fake = installFakeLlmThen([REPLIES[0]], () => {
      throw new Error(NETWORK_ERROR)
    })
    const state = initialState()
    const before = JSON.stringify(state.data)
    const { write, phase, runTurnAction } = createRunner(state)

    await expect(runTurnAction(LOOK_ACTION)).rejects.toThrow(NETWORK_ERROR)

    expect(fake?.calls).toHaveLength(1)
    expect(JSON.stringify(state.data)).toBe(before)
    expect(write).not.toHaveBeenCalled()
    expect(phase.value.phase).toBe('idle')
  })

  it('a failure after the time node rolls the clock back too', async () => {
    // 时间节点调了工具：推进已经写进工作副本；随后故事节点只回空白（协议层允许，引擎判空）
    fake = installFakeLlm(
      cardTurnReplies({
        time: { minutes: TIME_MINUTES },
        node: (id) => (id === STORY ? '   ' : undefined),
      }),
    )
    const state = initialState()
    const before = JSON.stringify(state.data)
    const { write, runTurnAction } = createRunner(state)

    await expect(runTurnAction(LOOK_ACTION)).rejects.toThrow(currentCard.graph.nodes[STORY].name)

    // 前面几个节点都问过了（时间那一步的推进真的发生过），但权威状态一个字节都没动
    expect(fake?.calls.length ?? 0).toBeGreaterThan(1)
    expect(JSON.stringify(state.data)).toBe(before)
    expect(state.data.timeline).toEqual([])
    expect(write).not.toHaveBeenCalled()
  })

  it('aborting a running turn keeps the game state and leaves only debug traces', async () => {
    let secondStep = () => {}
    const reachedSecondStep = new Promise<void>((resolve) => {
      secondStep = () => resolve()
    })
    fake = installFakeLlmThen([REPLIES[0]], (init) => {
      secondStep()
      // 挂住不返回；只有被 abort 时才结束 —— 这才是真实的取消语义
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    const state = initialState()
    const before = JSON.stringify(state.data)
    const { write, phase, debugMode, runTurnAction, abortRunningTurn } = createRunner(state)
    // 调试痕迹也是这一轮的写入：取消后游戏状态一条都不该留下
    debugMode.value = true

    const pending = runTurnAction(LOOK_ACTION)
    await reachedSecondStep
    abortRunningTurn()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    // 游戏状态一个字节没变：故事 / 时间 / 时间线 / 回合数都不动（决定 #39）。
    // ⚠️ 唯一的例外是调试痕迹（决定 #39 的补充）：一轮失败或取消时最需要看的就是
    //    「发出去的是什么」，而工作副本一丢这些就没了。
    const { events, ...rest } = state.data
    const { events: beforeEvents, ...beforeRest } = JSON.parse(before) as {
      events: unknown[]
      [key: string]: unknown
    }
    expect(rest).toEqual(beforeRest)
    expect(beforeEvents).toEqual([])
    expect(events.some((event) => event.kind === 'request')).toBe(true)
    expect(events.every((event) => !isStoryKind(event.kind))).toBe(true)

    expect(write).not.toHaveBeenCalled()
    expect(phase.value.phase).toBe('idle')
  })
})

describe('a successful turn commits the draft', () => {
  it('writes the draft back and saves exactly what is in memory', async () => {
    fake = installFakeLlm(REPLIES)
    const state = initialState()
    const before = state.data
    const startTime = { ...before.time }
    const { write, runTurnAction } = createRunner(state)

    await runTurnAction(LOOK_ACTION)

    // 提交换了对象：跑之前那份数据一个字节都没被改过
    expect(state.data).not.toBe(before)
    expect(before.events).toEqual([])
    expect(before.time).toEqual(startTime)
    expect(before.meta.turn).toBe(0)

    // 落盘一次，拿到的就是刚提交的内存（save 读权威状态，所以提交必须先于它）
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toBe(state.data)

    // 提交的是整轮结果：玩家原话 + 一段叙事 + 推进后的时间与时间线 + 回合数
    expect(state.data.meta.turn).toBe(1)
    expect(state.data.events.map((event) => event.kind)).toEqual(['action', 'narration'])
    expect(state.data.events[0].text).toBe(LOOK_ACTION)
    expect(state.data.events[1].text).toBe(SECOND_DRAFT)
    expect(state.data.time).toEqual(advance(currentCard.time.calendar, startTime, TIME_MINUTES))
    expect(state.data.timeline).toHaveLength(1)
  })
})

describe('the runner drives the lifecycle table', () => {
  /** 观察真实回合走过的阶段：迁移表本身在 tests/lifecycle.test.ts 里逐条走通 */
  function trackPhases(phase: Ref<TurnState>) {
    const seen: TurnPhase[] = []
    watch(phase, (state) => seen.push(state.phase), { flush: 'sync' })
    return seen
  }

  it('a whole turn walks prompting -> finishing -> committed -> idle', async () => {
    fake = installFakeLlm(REPLIES)
    const { phase, runTurnAction } = createRunner()
    const seen = trackPhases(phase)

    await runTurnAction(LOOK_ACTION)

    // 九个节点各请求一次模型：每次都在 prompting 里自环，相邻重复的合成一次
    expect(seen.filter((entry, i) => entry !== seen[i - 1])).toEqual([
      'prompting',
      'finishing',
      'committed',
      'idle',
    ])
  })

  it('a failed turn ends in idle with no terminal phase left behind', async () => {
    fake = installFakeLlm(REPLIES)
    fake.failNextWith(new Error(NETWORK_ERROR))
    const { phase, runTurnAction } = createRunner()
    const seen = trackPhases(phase)

    await expect(runTurnAction(LOOK_ACTION)).rejects.toThrow(NETWORK_ERROR)

    expect(seen).toContain('rolled-back')
    expect(seen.at(-1)).toBe('idle')
  })
})

describe('the debug projections (draft and write list)', () => {
  /** 跑到地图节点前挂住：此刻时间节点已经把时钟推了、写入清单里有一条 */
  async function runUntilHanging(debug = true) {
    let reached = () => {}
    const hanging = new Promise<void>((resolve) => {
      reached = () => resolve()
    })
    const head = cardPassReplies(CARD_TOPOLOGY.slice(0, CARD_TOPOLOGY.indexOf(TIME) + 1), (id) =>
      id === TIME ? [advanceTimeCall(TIME_MINUTES, TIME_REASON), 'time done'] : undefined,
    )
    fake = installFakeLlmThen(head, (init) => {
      reached()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    const runner = createRunner()
    runner.debugMode.value = debug
    const pending = runner.runTurnAction(LOOK_ACTION)
    await hanging
    return { runner, pending }
  }

  it('shows the working copy and the writes while the turn is running', async () => {
    const { runner, pending } = await runUntilHanging()

    // 草稿就是正在跑的工作副本：时钟已经推进，而权威状态还没有
    expect(runner.draft.value).not.toBeNull()
    expect(runner.draft.value?.time).toEqual(
      advance(currentCard.time.calendar, runner.state.data.time, TIME_MINUTES),
    )
    expect(runner.state.data.time).not.toEqual(runner.draft.value?.time)
    expect(runner.writes.value).toEqual([{ path: 'time', value: runner.draft.value?.time }])

    runner.abortRunningTurn()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    // 副本只活在回合里：回滚之后草稿消失，写入清单留着当记录
    expect(runner.draft.value).toBeNull()
    expect(runner.writes.value).toHaveLength(1)
  })

  it('stays empty when debug mode is off (the panel is a debug-only thing)', async () => {
    const { runner, pending } = await runUntilHanging(false)
    runner.abortRunningTurn()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(runner.draft.value).toBeNull()
    expect(runner.writes.value).toEqual([])
  })
})
