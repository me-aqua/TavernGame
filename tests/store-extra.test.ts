/**
 * store 的补充测试 —— 覆盖 tests/store.test.ts 未触及的分支。
 *
 * 重点：
 *   - abortRunningTurn 真正中止一个在飞的回合（重入保护的核心）
 *   - 取消路径（AbortError）与失败路径的区分
 *   - handleEvent 的 node / request / reply / tool / toolResult 分支（调试痕迹，不是故事）
 *   - 回合成功后落盘、写不进去时通知玩家
 *   - 一轮 = 一次事务：失败的回合一字节都不写回、不落盘
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGame } from '../src/stores/game'
import { t } from '../src/i18n'
import { SAVE_KEY } from '../src/utils/storage'
import { configureFakeProvider } from './support/game-fixtures'
import { cardTurnReplies, CARD_TOPOLOGY, traceCycle } from './support/card-replies'
import { installFakeLlm, installFakeLlmThen, type FakeLlm } from './support/fakeLlm'

/** 测试自造的 fixture（模型回复与玩家行动），不是产品文案 */
const WAIT_ACTION = 'wait'
const WAIT_REPLY = 'A long wait went by.'
const DAWN_REPLY = 'Dawn breaks.'
const KEEP_WAITING_ACTION = 'keep waiting'
const NETWORK_ERROR = 'network down'
/** 一整轮的假回复（时间推一天、叙事是 WAIT_REPLY）；失败用例按前缀截取 */
const REPLIES = cardTurnReplies({
  story: WAIT_REPLY,
  time: { step: 1, unit: 'day', reason: 'kept waiting' },
})

let fake: FakeLlm | null = null

const storyRows = (g: ReturnType<typeof useGame>) => g.rows.value.filter((row) => !row.debug)

const debugRows = (g: ReturnType<typeof useGame>) => g.rows.value.filter((row) => row.debug)

beforeEach(() => {
  configureFakeProvider()
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
  it('a node line and the model I/O pairs land in the debug rows, never in the story', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm(REPLIES)
    await g.runTurnAction(WAIT_ACTION)

    // 每个节点一行 node + 每次模型调用一对请求/响应；
    // 时间节点走了一次工具往返：多「工具调用 / 工具结果」两行 + 第二对请求/响应
    const kinds = debugRows(g).map((l) => l.kind)
    expect(kinds).toEqual(traceCycle(true))
    expect(debugRows(g).map((l) => l.text)).toContain(t('store.nodeLine', { node: CARD_TOPOLOGY[0] }))
    // 工具那两行就是它该显示的内容（模型申请了什么、引擎执行出什么）
    expect(debugRows(g).map((l) => l.kind)).toContain('tool')
    expect(debugRows(g).map((l) => l.kind)).toContain('toolResult')

    // 故事区只有故事：节点进度是 agent 信息，玩家看不到
    expect(storyRows(g).map((l) => l.kind)).toEqual(['action', 'narration'])
    g.debugMode.value = false
  })

  it('with debug mode on, every raw branch records parseable JSON', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm(REPLIES)

    await g.runTurnAction(WAIT_ACTION)
    fake.restore()
    fake = null

    const rawRows = debugRows(g).filter((row) => row.detail !== undefined)
    // 每次调用两条：请求体 + 响应体，都是可折叠的 JSON。
    // ⚠️ node / warn / tool / toolResult 没有 detail（不是可折叠的原始报文），
    //    所以这里只留下 traceCycle(true) 里的 request / reply
    expect(rawRows.map((row) => row.kind)).toEqual(
      traceCycle(true).filter((k) => k === 'request' || k === 'reply'),
    )
    for (const row of rawRows) expect(() => JSON.parse(row.detail ?? '')).not.toThrow()
    g.debugMode.value = false
  })
})

describe('a save that fails must be announced (the store owns persistence)', () => {
  /**
   * ⚠️ 落盘归组合根（引擎不碰存储），所以这条用例住在 store 而不是 agent：
   * 回合成功后 store 调 save()，返回 false 时必须让玩家看见 ——
   * 静默失败会让玩家以为进度已保存，刷新后才发现没了。
   */
  it('a failed save shows an error notice', async () => {
    fake = installFakeLlm(REPLIES)
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const g = useGame()
    await g.runTurnAction(WAIT_ACTION)

    expect(g.status.value).toEqual({ kind: 'error', text: t('agent.saveFailed') })

    spy.mockRestore()
  })

  it('a successful save leaves no notice', async () => {
    fake = installFakeLlm(REPLIES)
    const g = useGame()
    await g.runTurnAction(WAIT_ACTION)

    expect(g.status.value).toBeNull()
  })
})

describe('one turn = one transaction (the composition root commits)', () => {
  /**
   * ⚠️ 失败点必须在「已经改过数据」之后：第一个节点已经调用过模型（行动写进了副本），
   * 第二个节点的请求失败 —— 这正是审查报的那个形状。
   */
  it('a failed turn leaves memory and storage untouched, and the next save holds only itself', async () => {
    fake = installFakeLlmThen([REPLIES[0]], () => {
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
    expect(g.timeline.value).toEqual([])
    setItem.mockRestore()

    // 下一次成功回合只持久化它自己：没有「被取消的行动 + 已推进的时间 + 没有对应剧情」
    fake.restore()
    fake = installFakeLlm(cardTurnReplies({ story: DAWN_REPLY, time: { step: 1, unit: 'day' } }))
    await g.runTurnAction(KEEP_WAITING_ACTION)

    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) as string) as {
      events: Array<{ kind: string; text: string }>
      timeline: unknown[]
      meta: { turn: number }
    }
    expect(saved.events.map((e) => e.kind)).toEqual(['action', 'narration'])
    expect(saved.events[0].text).toBe(KEEP_WAITING_ACTION)
    // 时间线只有成功那一轮的一条 —— 失败那轮的时间推进没有留下任何东西
    expect(saved.timeline).toHaveLength(1)
    expect(saved.meta.turn).toBe(1)
  })

  /**
   * 用户可见的变化：叙事在**提交时**整轮一起出现，不再是每个节点实时出现。
   * 实时写就等于把未提交的改动先摆给玩家看 —— 事务与「边跑边显示」不可兼得（决定 #39）。
   */
  it('while a turn is in flight, the draft is not visible in the store', async () => {
    let secondStep = () => {}
    const reachedSecondStep = new Promise<void>((resolve) => {
      secondStep = () => resolve()
    })
    fake = installFakeLlmThen([REPLIES[0]], (init) => {
      secondStep()
      // 挂住第二个节点，让「在飞」这个状态可以被断言
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const g = useGame()
    const startTime = g.timeLabel.value
    const pending = g.runTurnAction(WAIT_ACTION)
    await reachedSecondStep

    // 第一个节点已经跑过（行动已经写进副本），但界面这一侧一个字节都看不到
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
