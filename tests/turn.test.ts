/**
 * 回合事务（src/stores/turn.ts）—— 一轮 = 一次提交。
 *
 * 三条成功标准：
 *   ① 中途抛错：内存里的 data 与开跑前逐字节相同，落盘一次都没调
 *   ② 跑起来后取消（AbortError）：同上
 *   ③ 成功回合：副本一次性写回并落盘，落盘拿到的就是内存里的那一份
 *
 * ⚠️ 失败点比旧循环更靠后：时间节点的产出会被解析并推进**工作副本**，之后故事节点的
 *    产出解析不出来 —— 回滚必须把已经推进的时间也一起丢掉（决定 #27/#39）。
 *
 * 这里直接驱动 createTurnRunner：取消只有一个入口（abortRunningTurn），
 * store 把它藏在 resetGame / importSave 后面 —— 那两条路都会换掉整份 data，
 * 证明不了「取消不留痕」。store 那一层另有一条端到端用例（tests/store-extra.test.ts）。
 *
 * 末尾另有一组用例盯**生命周期**：迁移表本身由 tests/lifecycle.test.ts 走通，
 * 这里证明真实回合确实按那张表走（引擎事件真的驱动了状态）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, watch, type Ref } from 'vue'
import { createTurnRunner } from '../src/stores/turn'
import { IDLE, type TurnPhase, type TurnState } from '../src/game/lifecycle'
import { addEvent, endTurn, initialState, iso, save, snapshot, type GameState } from '../src/game/state'
import { STORY_NODE, TIME_NODE } from '../src/agent/card-graph'
import { configureFakeProvider } from './support/game-fixtures'
import { cardTurnReplies, CARD_TOPOLOGY } from './support/card-replies'
import { installFakeLlm, installFakeLlmThen, type FakeLlm } from './support/fakeLlm'
import type { ChatMessage, GameData } from '../src/types/state'
import type { SaveStore } from '../src/utils/storage'

/** 测试自造的 fixture（模型回复与玩家行动），不是产品文案 */
const SECOND_DRAFT = 'Second draft.'
const LOOK_ACTION = 'look around'
const NETWORK_ERROR = 'network down'
const BAD_STORY_OUTPUT = 'this is not a JSON block'
const DAY_MS = 86400000
/** 一整轮的假回复：时间推一天，叙事用 SECOND_DRAFT */
const REPLIES = cardTurnReplies({
  story: SECOND_DRAFT,
  time: { step: 1, unit: 'day', reason: 'kept walking' },
})

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
  const history = ref<ChatMessage[]>([])
  const phase = ref<TurnState>(IDLE)
  const debugMode = ref(false)
  const runner = createTurnRunner({
    state,
    addEvent,
    notify: () => {},
    endTurn,
    snapshot: (target) => snapshot(target),
    save: () => save(state, store),
    history,
    phase,
    debugMode,
  })
  return { state, write, history, phase, debugMode, ...runner }
}

describe('a turn that never reaches the end leaves no trace', () => {
  it('throwing mid-turn keeps the data byte-identical and never saves', async () => {
    // 第一个节点正常跑完（行动已经写进副本），第二个节点的请求失败
    fake = installFakeLlmThen([REPLIES[0]], () => {
      throw new Error(NETWORK_ERROR)
    })
    const state = initialState()
    const before = JSON.stringify(state.data)
    const { write, history, phase, runTurnAction } = createRunner(state)

    await expect(runTurnAction(LOOK_ACTION)).rejects.toThrow(NETWORK_ERROR)

    // 这一步真的发生过（它调用了模型），而权威数据一个字节都没动：
    // 时间 / 日志 / 时间线 / 回合数全在 data 里，逐字节相同就覆盖了这四样
    expect(fake.calls).toHaveLength(1)
    expect(JSON.stringify(state.data)).toBe(before)
    expect(write).not.toHaveBeenCalled()
    expect(phase.value.phase).toBe('idle')
    expect(history.value).toEqual([])
  })

  it('a failure after the time node rolls the clock back too', async () => {
    // 时间节点的产出合法：推进已经写进工作副本；随后故事节点的产出不是 JSON
    const replies = cardTurnReplies({ time: { step: 1, unit: 'day' } })
    replies[CARD_TOPOLOGY.indexOf(STORY_NODE)] = BAD_STORY_OUTPUT
    fake = installFakeLlm(replies)
    const state = initialState()
    const before = JSON.stringify(state.data)
    const startIso = iso(state)
    const { write, runTurnAction } = createRunner(state)

    await expect(runTurnAction(LOOK_ACTION)).rejects.toThrow(/not valid JSON/)

    // 九个节点全都调过（时间那一步的推进真的发生过），但权威状态一个字节都没动
    expect(fake.calls.length).toBeGreaterThan(1)
    expect(JSON.stringify(state.data)).toBe(before)
    expect(iso(state)).toBe(startIso)
    expect(state.data.timeline).toEqual([])
    expect(write).not.toHaveBeenCalled()
  })

  it('a time node output that is not JSON fails the whole turn too', async () => {
    // 时间节点的产出必须能解析成 {推进: {step, unit}}：解析不出来就整轮失败，
    // 不静默跳过（时间不动等于这一轮白跑）
    const replies = cardTurnReplies({ story: SECOND_DRAFT })
    replies[CARD_TOPOLOGY.indexOf(TIME_NODE)] = BAD_STORY_OUTPUT
    fake = installFakeLlm(replies)
    const state = initialState()
    const before = JSON.stringify(state.data)
    const { write, runTurnAction } = createRunner(state)

    await expect(runTurnAction(LOOK_ACTION)).rejects.toThrow(/not valid JSON/)

    expect(JSON.stringify(state.data)).toBe(before)
    expect(write).not.toHaveBeenCalled()
  })

  it('aborting a running turn keeps the data byte-identical and never saves', async () => {
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
    const { write, history, phase, debugMode, runTurnAction, abortRunningTurn } = createRunner(state)
    // 调试痕迹也是这一轮的写入：取消后一条都不该留下
    debugMode.value = true

    const pending = runTurnAction(LOOK_ACTION)
    await reachedSecondStep
    abortRunningTurn()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(JSON.stringify(state.data)).toBe(before)
    expect(write).not.toHaveBeenCalled()
    expect(phase.value.phase).toBe('idle')
    expect(history.value).toEqual([])
  })
})

describe('a successful turn commits the draft', () => {
  it('writes the draft back and saves exactly what is in memory', async () => {
    fake = installFakeLlm(REPLIES)
    const state = initialState()
    const before = state.data
    const startIso = before.time.iso
    const { write, runTurnAction } = createRunner(state)

    await runTurnAction(LOOK_ACTION)

    // 提交换了对象：跑之前那份数据一个字节都没被改过
    expect(state.data).not.toBe(before)
    expect(before.events).toEqual([])
    expect(before.time.iso).toBe(startIso)
    expect(before.meta.turn).toBe(0)

    // 落盘一次，拿到的就是刚提交的内存（save 读权威状态，所以提交必须先于它）
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toBe(state.data)

    // 提交的是整轮结果：行动 + 一段叙事 + 推进后的时间与时间线 + 回合数
    expect(state.data.meta.turn).toBe(1)
    expect(state.data.events.map((e) => e.kind)).toEqual(['action', 'narration'])
    expect(state.data.events[1].text).toBe(SECOND_DRAFT)
    expect(Date.parse(state.data.time.iso) - Date.parse(startIso)).toBe(DAY_MS)
    expect(state.data.timeline).toHaveLength(1)
  })
})

describe('the runner drives the lifecycle table', () => {
  /**
   * 观察真实回合走过的阶段：迁移表本身在 tests/lifecycle.test.ts 里逐条走通，
   * 这里盯的是「引擎事件真的在推它」—— 表再对，没接上也等于没有。
   */
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
    expect(seen.filter((p, i) => p !== seen[i - 1])).toEqual(['prompting', 'finishing', 'committed', 'idle'])
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
