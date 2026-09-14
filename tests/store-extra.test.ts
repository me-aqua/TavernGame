/**
 * store 的补充测试 —— 覆盖 tests/store.test.ts 未触及的分支。
 *
 * 重点：
 *   - abortRunningTurn 真正中止一个在飞的回合（重入保护的核心）
 *   - 取消路径（AbortError）与失败路径的区分
 *   - handleEvent 的 tool / toolResult / warn / raw 分支（调试痕迹，不是故事）
 *   - 回合没产出文字、存档写不进去时的通知分支
 *   - 一轮 = 一次事务：失败的回合一字节都不写回、不落盘
 *   - 强制收尾阶段（forcing）玩家侧看不出区别：状态行与禁用输入都不变
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGame } from '../src/stores/game'
import { t } from '../src/i18n'
import { SAVE_KEY } from '../src/utils/storage'
import { configureFakeProvider } from './support/game-fixtures'
import { installFakeLlm, installFakeLlmThen, type FakeLlm } from './support/fakeLlm'

/** 测试自造的 fixture（模型回复与玩家行动），不是产品文案 */
const MAX_STEPS = 5
const TOOL_NAME = 'advance_time'
const TOOL_ARGS = '{"step":1}'
const ADVANCE_STEP_REPLY = { toolCalls: [{ name: TOOL_NAME, arguments: TOOL_ARGS }] }
/** 用满步数上限的一串纯工具回复（一步叙事都没写） */
const STEP_LIMIT_REPLIES = Array.from({ length: MAX_STEPS }, () => ADVANCE_STEP_REPLY)
const WAIT_ACTION = 'wait'
const WAIT_REPLY = 'A long wait went by.'
const DAWN_REPLY = 'Dawn breaks.'
const PATCHED_REPLY = 'A patched-up narration.'
const KEEP_WAITING_ACTION = 'keep waiting'
const RAW_BODY_REPLY = 'raw response body'
const LOOK_ACTION = 'look around'
const BLANK_REPLY = '   '
const IDLE_ACTION = 'idle'
const NETWORK_ERROR = 'network down'

let fake: FakeLlm | null = null

const storyRows = (g: ReturnType<typeof useGame>) => g.rows.value.filter((row) => !row.debug)

const debugRows = (g: ReturnType<typeof useGame>) => g.rows.value.filter((row) => row.debug)

beforeEach(() => {
  configureFakeProvider(MAX_STEPS)
  useGame().resetGame()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

describe('aborting an in-flight turn (store-internal abortRunningTurn)', () => {
  /**
   * abortRunningTurn 不是公开 API，但**取消路径是可测的**：
   * resetGame() 与 importSave() 都会先调它。回合在飞时调 resetGame 即可。
   */
  it('resetting while a turn is running takes the cancelled branch and clears busy', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // 请求挂住不返回；只有被 abort 时才结束 —— 这才是真实的取消语义
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch

    const g = useGame()
    const pending = g.runTurnAction(WAIT_ACTION)
    // 等 store 建好 controller 并进入 fetch
    await new Promise((r) => setTimeout(r, 20))
    expect(g.busy.value).toBe(true)

    g.resetGame() // 内部 abortRunningTurn() → controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(g.busy.value).toBe(false)

    globalThis.fetch = original
  })

  it('aborting with no turn running is a safe no-op', () => {
    const g = useGame()
    expect(() => g.resetGame()).not.toThrow()
    expect(g.busy.value).toBe(false)
  })
})

describe('handleEvent - each trace branch (debug only)', () => {
  it('a tool call and its result each record one trace line, and never the story', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm([{ content: WAIT_REPLY, toolCalls: ADVANCE_STEP_REPLY.toolCalls }, DAWN_REPLY])
    await g.runTurnAction(WAIT_ACTION)

    const texts = debugRows(g).map((l) => l.text)
    expect(texts).toContain(t('toolbar.toolCall', { tool: TOOL_NAME, args: TOOL_ARGS }))
    const resultPrefix = t('store.toolResultLine', { result: '' })
    const advanceHead = t('tools.advanceResult', { before: '', after: '' }).split('\n')[0].trim()
    expect(texts.some((line) => line.startsWith(resultPrefix) && line.includes(advanceHead))).toBe(true)

    // 故事区只有故事：工具调用是 agent 信息，玩家看不到
    const kinds = storyRows(g).map((l) => l.kind)
    expect(kinds[0]).toBe('action')
    expect(kinds.every((kind) => kind === 'action' || kind === 'narration')).toBe(true)
    expect(storyRows(g).map((l) => l.text)).not.toContain(
      t('toolbar.toolCall', { tool: TOOL_NAME, args: TOOL_ARGS }),
    )
    g.debugMode.value = false
  })

  it('exhausting the step budget records a warn trace line', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm([...STEP_LIMIT_REPLIES, PATCHED_REPLY])
    await g.runTurnAction(KEEP_WAITING_ACTION)

    const warns = debugRows(g).filter((l) => l.kind === 'warn')
    expect(warns.length).toBeGreaterThan(0)
    const stepLimit = t('store.warnLine', { message: t('agent.stepLimit', { max: MAX_STEPS }) })
    expect(warns.map((w) => w.text)).toContain(stepLimit)
    g.debugMode.value = false
  })

  it('with debug mode on, the raw branch records the response JSON', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm([RAW_BODY_REPLY])

    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null

    const rawRows = debugRows(g).filter((row) => row.detail !== undefined)
    // 一次调用两条：请求体 + 响应体，都是可折叠的 JSON
    expect(rawRows.map((row) => row.kind)).toEqual(['request', 'reply'])
    expect(() => JSON.parse(rawRows[0].detail ?? '')).not.toThrow()
    g.debugMode.value = false
  })
})

describe('a notice when the turn produced nothing', () => {
  it('a notice is shown when the model wrote nothing (!result.text branch)', async () => {
    // 五步全调工具、补写也空 → result.text 为空
    fake = installFakeLlm([...STEP_LIMIT_REPLIES, BLANK_REPLY])
    const g = useGame()
    await g.runTurnAction(IDLE_ACTION)

    expect(g.status.value).toEqual({ kind: 'info', text: t('store.noText') })
  })
})

/**
 * 响应式边界：领域函数原地改数据，追踪由 store 的 reactive 代理提供。
 *
 * ⚠️ 「引擎改数据 → 界面自己变」这条性质由 tests/store.test.ts 的
 *    reactivity 用例守着（那里经变异测试验证过：把代理换成 toRaw 就会红）。
 *    这里只留「不需要手动通知就能看到时间线」这一条。
 */
describe('the store timeline updates without manual notification', () => {
  it('addEvent from the engine shows up in the store timeline without manual notification', async () => {
    fake = installFakeLlm([{ content: WAIT_REPLY, toolCalls: ADVANCE_STEP_REPLY.toolCalls }, DAWN_REPLY])
    const g = useGame()
    // 提交之后时间线自己就更新了：没有第二次「刷新界面」的动作
    const pending = g.runTurnAction(WAIT_ACTION)
    await vi.waitFor(() => expect(g.timeline.value.length).toBeGreaterThan(0))
    await pending
  })
})

describe('a save that fails must be announced (the store owns persistence)', () => {
  /**
   * ⚠️ 落盘归组合根（引擎不碰存储），所以这条用例住在 store 而不是 agent：
   * 回合成功后 store 调 save()，返回 false 时必须让玩家看见 ——
   * 静默失败会让玩家以为进度已保存，刷新后才发现没了。
   */
  it('a failed save shows an error notice', async () => {
    fake = installFakeLlm([DAWN_REPLY])
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const g = useGame()
    await g.runTurnAction(WAIT_ACTION)

    expect(g.status.value).toEqual({ kind: 'error', text: t('agent.saveFailed') })

    spy.mockRestore()
  })

  it('a successful save leaves no notice', async () => {
    fake = installFakeLlm([DAWN_REPLY])
    const g = useGame()
    await g.runTurnAction(WAIT_ACTION)

    expect(g.status.value).toBeNull()
  })
})

describe('one turn = one transaction (the composition root commits)', () => {
  /**
   * ⚠️ 失败点必须在「已经改过数据」之后：第一步返回叙事 + 推时间，第二步请求失败 ——
   * 这正是审查报的那个形状：时间跳了、行动在内存里，而落盘在末尾。
   */
  it('a failed turn leaves memory and storage untouched, and the next save holds only itself', async () => {
    fake = installFakeLlmThen([{ content: WAIT_REPLY, toolCalls: ADVANCE_STEP_REPLY.toolCalls }], () => {
      throw new Error(NETWORK_ERROR)
    })

    const g = useGame()
    const before = g.exportSave()
    const setItem = vi.spyOn(localStorage, 'setItem')

    await expect(g.runTurnAction(WAIT_ACTION)).rejects.toThrow(NETWORK_ERROR)

    // 时间 / 日志 / 时间线 / 回合数逐字节相同，localStorage 一次都没写
    expect(g.exportSave()).toBe(before)
    expect(setItem).not.toHaveBeenCalled()
    expect(g.turn.value).toBe(0)
    expect(storyRows(g)).toEqual([])
    setItem.mockRestore()

    // 下一次成功回合只持久化它自己：没有「被取消的行动 + 已推进的时间 + 没有对应剧情」
    fake.restore()
    fake = installFakeLlm([DAWN_REPLY])
    await g.runTurnAction(KEEP_WAITING_ACTION)

    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) as string) as {
      events: Array<{ kind: string; text: string }>
      time: { iso: string }
      meta: { turn: number }
    }
    expect(saved.events.map((e) => e.kind)).toEqual(['action', 'narration'])
    expect(saved.events[0].text).toBe(KEEP_WAITING_ACTION)
    expect(saved.time.iso).toBe((JSON.parse(before) as { time: { iso: string } }).time.iso)
    expect(saved.meta.turn).toBe(1)
  })

  /**
   * 用户可见的变化：叙事在**提交时**整轮一起出现，不再是每一步实时出现。
   * 实时写就等于把未提交的改动先摆给玩家看 —— 事务与「边跑边显示」不可兼得（决定 #39）。
   */
  it('while a turn is in flight, the draft is not visible in the store', async () => {
    let secondStep = () => {}
    const reachedSecondStep = new Promise<void>((resolve) => {
      secondStep = () => resolve()
    })
    fake = installFakeLlmThen([{ content: WAIT_REPLY, toolCalls: ADVANCE_STEP_REPLY.toolCalls }], (init) => {
      secondStep()
      // 挂住第二步，让「在飞」这个状态可以被断言
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const g = useGame()
    const startTime = g.timeLabel.value
    const pending = g.runTurnAction(WAIT_ACTION)
    await reachedSecondStep

    // 第一步已经写过副本（叙事 + 推时间），但界面这一侧一个字节都看不到
    expect(storyRows(g)).toEqual([])
    expect(g.timeline.value).toEqual([])
    expect(g.timeLabel.value).toBe(startTime)
    expect(g.turn.value).toBe(0)

    g.resetGame() // 公开的中止路径：换局前先 abort
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    // 被中止的那一轮在存档里也没留下东西：换上的是一局干净的新游戏
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) as string) as { events: unknown[] }
    expect(saved.events).toEqual([])
  })
})

describe('the forced closing is the same status line the player already saw', () => {
  /**
   * ⚠️ 补写是生命周期里的一个独立阶段（引擎专门回传 forcing），但玩家侧**必须没有区别**：
   *    阶段再细分，状态行还是「思考中…」，输入框还是禁用。阶段是否真的到了 forcing
   *    由 tests/turn.test.ts 的 watcher 证明，这里证明它没有漏到界面上。
   */
  it('still says thinking while the forced closing request is in flight', async () => {
    let forcedStarted = () => {}
    const inForcedClosing = new Promise<void>((resolve) => {
      forcedStarted = () => resolve()
    })
    // 六次调用起（前五次已经由 replies 用掉）才是补写：挂住它，让这个阶段可断言
    fake = installFakeLlmThen([...STEP_LIMIT_REPLIES], (init) => {
      forcedStarted()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const g = useGame()
    const pending = g.runTurnAction(KEEP_WAITING_ACTION)
    await inForcedClosing

    // 前五步原样跑完（假模型只记到第五次），第六次请求正在等模型补写
    expect(fake.calls).toHaveLength(MAX_STEPS)
    expect(g.status.value).toEqual({ kind: 'busy', text: t('story.thinking') })
    expect(g.busy.value).toBe(true)

    g.resetGame()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(g.busy.value).toBe(false)
  })
})
