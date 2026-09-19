/**
 * store 测试 —— 界面与游戏之间唯一的桥梁。
 *
 * 只通过公开 API 驱动：store 的实例是模块级的，
 * 所以每个用例开头都「resetGame」清空（数据、事件流、历史、通知一起清）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { watchEffect } from 'vue'
import { isDevHost, readStoredDebug, resolveDebug, storeDebug, useGame } from '../src/stores/game'
import { initialState, hydrateFromSave, turn } from '../src/game/state'
import { format } from '../src/game/card-calendar'
import { clockIn } from '../src/game/card-time'
import { currentCard } from '../src/game/current-card'
import { nodeLabel } from '../src/game/display'
import { SAVE_KEY } from '../src/utils/storage'
import { t } from '../src/i18n'
import { configureFakeProvider } from './support/game-fixtures'
import { cardTurnReplies, CARD_TOPOLOGY } from './support/card-replies'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

/* ---- 测试自己编的 fixture（模型回复与玩家行动），不是产品文案 ---- */
const WAKE_REPLY = 'You wake up in the tavern.'
const OPEN_EYES = 'open my eyes'
const RACE_DRAFTS = ['First turn draft.', 'Second turn draft.']
const RACE_ACTIONS = ['action one', 'action two']
const UNREACHED_REPLY = 'x'
const DONE_REPLY = 'All written.'
const NUDGE_ACTION = 'do something'
const NETWORK_ERROR = 'network down'
const RETRY_ACTION = 'try again'
const SAVED_NARRATION = 'narration from the save'
const SAVED_DEBUG = 'a trace from the save'
const BROKEN_SAVE = '{broken'
const RAW_REPLY = 'raw output sample'
const PLAIN_REPLY = 'plain output'
const LOOK_ACTION = 'look around'
const TIME_MINUTES = 120
/** 跨过时段边界的一次推进：时间标签必须跟着变（19:30 之后再 5 小时就是次日上午） */
const CLOCK_MINUTES = 300
/** 一条普通回合的调试痕迹：每个节点一行 node + 一对请求/响应 */
const TRACE_CYCLE = CARD_TOPOLOGY.flatMap(() => ['node', 'request', 'model'])

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
  useGame().resetGame()
})

const storyRows = (g: ReturnType<typeof useGame>) => g.rows.value.filter((row) => !row.debug)

const debugRows = (g: ReturnType<typeof useGame>) => g.rows.value.filter((row) => row.debug)

/** 跑一个已写完一回合的 store */
async function runOneTurn(draft = WAKE_REPLY) {
  fake = installFakeLlm(cardTurnReplies({ story: draft }))
  const g = useGame()
  await g.runTurnAction(OPEN_EYES)
  fake.restore()
  fake = null
  return g
}

describe('derived state (what the topbar and the panels read)', () => {
  it('starts at the card clock, turn 0, and the scene line reads the state tree', () => {
    const g = useGame()
    expect(g.timeLabel.value).toBe(format(currentCard.time.calendar, clockIn(initialState().data.state)))
    expect(g.turn.value).toBe(0)
    // 场景读状态树的 world.location —— 这张卡没有声明那一段，于是三段都是空串
    // （顶栏那个条目照样画，只是什么都不显示；卡声明了它就有内容）
    const world = initialState().data.state.world as Record<string, unknown>
    expect(world.location).toBeUndefined()
    expect(g.scene.value).toEqual({ area: '', spot: '', scene: '' })
    // 状态树与卡都摆出来了（界面按它们渲染）
    expect(g.stateTree.value).toEqual(initialState().data.state)
    expect(g.card).toBe(currentCard)
    expect(g.timeline.value).toEqual([])
  })

  it('after one turn: turn +1 and the story holds the action and the narration', async () => {
    const g = await runOneTurn()
    expect(g.turn.value).toBe(1)
    expect(storyRows(g).map((row) => row.kind)).toEqual(['action', 'narration'])
    expect(storyRows(g)[0].text).toBe(OPEN_EYES)
    expect(storyRows(g)[1].text).toBe(WAKE_REPLY)
  })
})

describe('runTurnAction', () => {
  it('refuses re-entrant calls while a turn is running (re-entrancy guard)', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: RACE_DRAFTS[0] }))
    const g = useGame()
    await Promise.all([g.runTurnAction(RACE_ACTIONS[0]), g.runTurnAction(RACE_ACTIONS[1])])
    // 只有第一个回合跑了：刚好一张图的调用数，第二次提交的行动一个字都没进来
    expect(fake.calls).toHaveLength(CARD_TOPOLOGY.length)
    // 只有第一个回合的事件进了事件流：一条行动 + 一条叙事
    expect(storyRows(g).map((row) => row.kind)).toEqual(['action', 'narration'])
    fake.restore()
    fake = null
  })

  it('resets the busy flag after a successful turn', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: DONE_REPLY }))
    const g = useGame()
    expect(g.busy.value).toBe(false)
    await g.runTurnAction(NUDGE_ACTION)
    expect(g.busy.value).toBe(false)
    fake.restore()
    fake = null
  })

  it('resets the flag after a failed turn (otherwise the UI stays stuck thinking)', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: UNREACHED_REPLY }))
    fake.failNextWith(new Error(NETWORK_ERROR))
    const g = useGame()

    await expect(g.runTurnAction(RETRY_ACTION)).rejects.toThrow(NETWORK_ERROR)
    expect(g.busy.value).toBe(false)
    fake.restore()
    fake = null
  })
})

describe('the story is a projection of the event stream (nothing to restore)', () => {
  it('shows the narration right after import and hides debug traces', async () => {
    const g = await runOneTurn()
    const save = JSON.parse(g.exportSave()) as { events: Array<{ kind: string; text: string; at: string }> }
    save.events = [
      { kind: 'narration', text: SAVED_NARRATION, at: new Date().toISOString() },
      { kind: 'tool', text: SAVED_DEBUG, at: new Date().toISOString() },
    ]

    // ⚠️ 没有 restoreLog 这一步：渲染的是事件流本身，导入完就该是这两行里该显示的
    g.importSave(JSON.stringify(save))

    expect(storyRows(g).map((row) => row.text)).toEqual([SAVED_NARRATION])
    expect(debugRows(g)).toEqual([])
    g.debugMode.value = true
    expect(debugRows(g).map((row) => row.text)).toEqual([SAVED_DEBUG])
    g.debugMode.value = false
  })
})

describe('the three entry points that swap state', () => {
  it('resetGame: turn back to 0, story cleared, save overwritten', async () => {
    const g = await runOneTurn()
    expect(g.turn.value).toBe(1)
    g.resetGame()
    expect(g.turn.value).toBe(0)
    expect(storyRows(g)).toHaveLength(0)
    const reloaded = initialState()
    hydrateFromSave(reloaded, localStorage)
    expect(turn(reloaded)).toBe(0)
  })

  it('export -> resetGame -> import: the turn count comes back', async () => {
    const g = await runOneTurn()
    const json = g.exportSave()
    g.resetGame()
    expect(g.turn.value).toBe(0)
    g.importSave(json)
    expect(g.turn.value).toBe(1)
    expect(storyRows(g).map((row) => row.kind)).toEqual(['action', 'narration'])
  })

  it('importing broken JSON throws (the UI reports it)', () => {
    const g = useGame()
    expect(() => g.importSave(BROKEN_SAVE)).toThrow()
  })

  it('importing a save from another card throws (the UI reports it)', () => {
    const g = useGame()
    const save = JSON.parse(g.exportSave()) as { meta: { card: { id: string } } }
    save.meta.card.id = 'someone.else'
    expect(() => g.importSave(JSON.stringify(save))).toThrow('someone.else')
  })
})

describe('debugMode', () => {
  it('when on, the model input and output land in the rows -- never in the story', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm(cardTurnReplies({ story: RAW_REPLY }))
    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null

    const payloads = debugRows(g).filter((row) => row.detail !== undefined)
    // 每个节点两条：先请求体（模型输入），再响应体
    expect(payloads.map((row) => row.kind)).toEqual(CARD_TOPOLOGY.flatMap(() => ['request', 'model']))
    expect(payloads[0].detail).toContain('"messages"')
    const replyRows = payloads.filter((row) => row.kind === 'model')
    expect(replyRows.filter((row) => row.detail?.includes(RAW_REPLY))).toHaveLength(1)
    expect(storyRows(g).map((row) => row.text)).not.toContain(payloads[0].text)
    g.debugMode.value = false
  })

  it('with debug on, a turn that uses a tool shows the call, the result and the write', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm(cardTurnReplies({ story: RAW_REPLY, time: { minutes: TIME_MINUTES } }))
    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null

    const kinds = debugRows(g).map((row) => row.kind)
    for (const kind of ['node', 'request', 'model', 'tool', 'toolResult', 'stateChange']) {
      expect(kinds, kind).toContain(kind)
    }
    // 写入清单只给调试面板，不进故事（时刻那一笔现在写在状态树里的 world.time）
    expect(g.debugWrites.value).toEqual([{ path: 'world.time', value: expect.anything() }])
    expect(g.debugDraft.value).toBeNull()
    g.debugMode.value = false
  })

  it('entering a graph node writes one trace line before the model I/O', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm(cardTurnReplies({ story: RAW_REPLY }))
    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null

    // 每个节点进一次（决定 #38）：node 行 + 它的请求/响应，顺序就是拓扑顺序
    const traces = debugRows(g)
    expect(traces.map((row) => row.kind)).toEqual(TRACE_CYCLE)
    traces.forEach((row, index) => {
      const node = CARD_TOPOLOGY[Math.floor(index / 3)]
      if (row.kind === 'node')
        expect(row.text).toBe(t('store.nodeLine', { node: nodeLabel(currentCard, node) }))
    })
    // 玩家看到的仍然只有故事
    expect(storyRows(g).map((row) => row.text)).not.toContain(traces[0].text)
    g.debugMode.value = false
  })

  it('with debug off, no debug event is written at all', async () => {
    const g = useGame()
    g.debugMode.value = false
    fake = installFakeLlm(cardTurnReplies({ story: PLAIN_REPLY }))
    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null

    // 源头上就没有：不是「写了但界面藏起来」（与模型 I/O 同一条规则）
    expect(debugRows(g)).toEqual([])
    expect(g.debugWrites.value).toEqual([])
    const saved = JSON.parse(g.exportSave()) as { events: Array<{ kind: string }> }
    expect(saved.events.map((event) => event.kind)).toEqual(['action', 'narration'])
  })
})

describe('one event stream: debug rows are interleaved where they happened', () => {
  it('keeps the story in order and puts the traces before the narration', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm(cardTurnReplies({ story: DONE_REPLY }))
    await g.runTurnAction(OPEN_EYES)
    fake.restore()
    fake = null

    const shape = g.rows.value.map((row) => (row.debug ? row.kind : 'story:' + row.kind))
    g.debugMode.value = false
    // 行动在回合最前（它在事件流里就是第一条），痕迹与叙事跟在后面
    expect(shape).toEqual(['story:action', ...TRACE_CYCLE, 'story:narration'])
  })

  it('with debug off the same events are still there -- only the projection changes', async () => {
    const g = useGame()
    g.debugMode.value = false
    fake = installFakeLlm(cardTurnReplies({ story: DONE_REPLY }))
    await g.runTurnAction(OPEN_EYES)
    fake.restore()
    fake = null

    expect(g.rows.value.map((row) => row.kind)).toEqual(['action', 'narration'])
    const saved = JSON.parse(g.exportSave()) as { events: Array<{ kind: string }> }
    expect(saved.events.map((event) => event.kind)).toEqual(['action', 'narration'])
  })
})

describe('the event stream is the store: it survives a reload', () => {
  /** 跑一个带调试痕迹的回合（调试开 → 有模型请求与响应） */
  async function runWithDebug() {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm(cardTurnReplies({ story: RAW_REPLY }))
    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null
    g.debugMode.value = false
    return g
  }

  it('saves debug events next to the story (one array, one key)', async () => {
    const g = await runWithDebug()

    const saved = JSON.parse(g.exportSave()) as { events: Array<{ kind: string; detail?: string }> }
    expect(saved.events.map((event) => event.kind)).toEqual(['action', ...TRACE_CYCLE, 'narration'])
    expect(saved.events.some((event) => event.detail?.includes(RAW_REPLY))).toBe(true)
  })

  it('loads them back on the next startup (module reload = F5)', async () => {
    await runWithDebug()

    vi.resetModules()
    const reloaded = await import('../src/stores/game')
    const g = reloaded.useGame()

    expect(g.debugMode.value).toBe(false)
    expect(g.rows.value.every((row) => !row.debug)).toBe(true)
    g.debugMode.value = true
    expect(g.rows.value.filter((row) => row.debug).map((row) => row.kind)).toEqual(TRACE_CYCLE)
  })

  it('after an F5 the model still sees what happened before (the event stream is the memory)', async () => {
    const g = await runWithDebug()
    expect(storyRows(g).map((row) => row.kind)).toEqual(['action', 'narration'])

    // 刷新：模块重新加载 —— 内存里的东西（对话历史、回合状态）一概没有，只剩存档
    vi.resetModules()
    const reloaded = await import('../src/stores/game')
    const reopened = reloaded.useGame()

    fake = installFakeLlm(cardTurnReplies({ story: PLAIN_REPLY }))
    await reopened.runTurnAction(NUDGE_ACTION)
    const user = (fake.calls[0].body.messages ?? []).find((message) => message.role === 'user')?.content ?? ''
    fake.restore()
    fake = null

    expect(user).toContain(LOOK_ACTION) // 刷新前玩家说过的话
    expect(user).toContain(RAW_REPLY) // 刷新前 GM 写过的正文
    expect(user).toContain(NUDGE_ACTION) // 这一轮的原话
  })

  it('resetGame clears them so a new game does not inherit the old traces', async () => {
    const g = await runWithDebug()
    const saved = JSON.parse(g.exportSave()) as { events: Array<{ kind: string }> }
    expect(saved.events.map((event) => event.kind)).toContain('request')

    g.resetGame()
    g.debugMode.value = true

    expect(g.rows.value).toEqual([])
    expect((JSON.parse(g.exportSave()) as { events: unknown[] }).events).toEqual([])
  })
})

describe('hasStory', () => {
  it('is false on a fresh game and true once something was played', async () => {
    const g = useGame()
    expect(g.hasStory.value).toBe(false)

    fake = installFakeLlm(cardTurnReplies({ story: WAKE_REPLY }))
    await g.runTurnAction(OPEN_EYES)
    fake.restore()
    fake = null

    expect(g.hasStory.value).toBe(true)
  })
})

describe('reactivity: the UI updates when the domain mutates the data', () => {
  /**
   * ⚠️ 这是纯函数方案的**新风险**所在：领域函数原地改它拿到的对象，
   *    前提是那个对象是 `reactive()` 的**代理**。传原对象（toRaw）不会报错，
   *    但界面静默不更新 —— 没有任何类型能拦住它。
   *
   * 所以这里不测「函数改了数据」（那只证明函数对），而是测**读到渲染的那份值**上。
   */
  it('a turn that advances time updates the time label a component reads', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: WAKE_REPLY, time: { minutes: CLOCK_MINUTES } }))
    const g = useGame()
    const seen: string[] = []
    const stop = watchEffect(() => seen.push(g.timeLabel.value))

    const before = g.timeLabel.value
    await g.runTurnAction(OPEN_EYES)
    const after = g.timeLabel.value

    expect(after, 'the clock must actually move, or this test proves nothing').not.toBe(before)
    expect(seen, 'the computed must recompute after the advance').toContain(after)
    expect(seen.length, 'it must be evaluated more than once').toBeGreaterThan(1)
    stop()
  })

  it('the story the UI renders changes when the engine writes the narration', async () => {
    fake = installFakeLlm(cardTurnReplies({ story: WAKE_REPLY }))
    const g = useGame()
    const counts: number[] = []
    const stop = watchEffect(() => counts.push(storyRows(g).length))

    expect(counts.length).toBe(1)
    await g.runTurnAction(OPEN_EYES)

    expect(counts.length, 'an event stream change must trigger a recompute').toBeGreaterThan(1)
    expect(counts.at(-1)).toBe(storyRows(g).length)
    stop()
  })
})

describe('status line: in-progress and notices are computed, never stored', () => {
  it('is empty when idle and there is no notice', () => {
    expect(useGame().status.value).toBeNull()
  })

  it('holds one notice at a time: a new one replaces the old, null clears', () => {
    const g = useGame()
    g.notify('exported')
    expect(g.status.value).toEqual({ kind: 'info', text: 'exported' })
    g.notify('failed', 'error')
    expect(g.status.value).toEqual({ kind: 'error', text: 'failed' })
    g.notify(null)
    expect(g.status.value).toBeNull()
  })

  it('says the opening is being generated while it runs, and clears when it ends', async () => {
    const g = useGame()
    fake = installFakeLlm(cardTurnReplies({ story: WAKE_REPLY }))
    const opening = g.runTurnAction()
    // 开场那一轮也报节点名（「正在生成开场…（精神分析）」），不再是笼统的一句
    expect(g.status.value).toEqual({
      kind: 'busy',
      text: t('app.openingNodeRunning', { node: nodeLabel(currentCard, CARD_TOPOLOGY[0]) }),
    })

    await opening
    fake.restore()
    fake = null
    expect(g.busy.value).toBe(false)
    expect(g.status.value).toBeNull()
  })

  it('drops the previous notice when a new turn starts, and says it is thinking', async () => {
    const g = useGame()
    g.notify('exported')
    fake = installFakeLlm(cardTurnReplies({ story: WAKE_REPLY }))
    const running = g.runTurnAction(OPEN_EYES)
    // 状态行写出正在跑的那个节点（显示名来自卡）
    expect(g.status.value).toEqual({
      kind: 'busy',
      text: t('story.nodeRunning', { node: nodeLabel(currentCard, CARD_TOPOLOGY[0]) }),
    })

    await running
    fake.restore()
    fake = null
    expect(g.status.value).toBeNull()
  })

  /**
   * 原始 bug 的回归网：点「重来」之后，故事区不能留下「正在生成开场…」这样的行。
   * 现在它由 phase 算出来（status），回合一结束就不存在 —— 不是「写了再删」。
   */
  it('leaves no in-progress line in the story after the opening finishes', async () => {
    const g = useGame()
    fake = installFakeLlm(cardTurnReplies({ story: WAKE_REPLY }))
    await g.runTurnAction()
    fake.restore()
    fake = null

    expect(storyRows(g).map((row) => row.text)).not.toContain(t('app.generatingOpening'))
    expect(storyRows(g).map((row) => row.kind)).toEqual(['narration'])
  })
})

describe('loadAtStartup', () => {
  it('startup error is null when there is no save', () => {
    localStorage.removeItem(SAVE_KEY)
    expect(useGame().startupError).toBeNull()
  })
})

describe('the debug switch (dev hosts only, remembered choice)', () => {
  /** 与 store 里的 DEBUG_KEY 同名：写错了这里会当场变红 */
  const DEBUG_KEY = 'tavernGame.debug'

  it('defaults to "not chosen" so the caller can fall back to the host', () => {
    localStorage.removeItem(DEBUG_KEY)
    expect(readStoredDebug()).toBeNull()
  })

  it('remembers an explicit choice', () => {
    storeDebug(false)
    expect(localStorage.getItem(DEBUG_KEY)).toBe('off')
    expect(readStoredDebug()).toBe(false)

    storeDebug(true)
    expect(readStoredDebug()).toBe(true)
  })

  it('ignores a value it does not understand (hand-edited storage)', () => {
    localStorage.setItem(DEBUG_KEY, 'maybe')
    expect(readStoredDebug()).toBeNull()
  })

  it('survives a storage that throws (private mode): no choice read, no crash on write', () => {
    const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readStoredDebug()).toBeNull()
    read.mockRestore()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => storeDebug(true)).not.toThrow()
    write.mockRestore()
    warn.mockRestore()
  })

  it('devHost is off until the browser entry says otherwise', () => {
    // store 不认识 location：纯逻辑测试里它必须是关的
    expect(useGame().devHost.value).toBe(false)
  })

  it('the explicit choice wins over the host default', () => {
    expect(resolveDebug(null, true)).toBe(true)
    expect(resolveDebug(null, false)).toBe(false)
    expect(resolveDebug(false, true)).toBe(false)
    expect(resolveDebug(true, false)).toBe(true)
  })
})

describe('isDevHost', () => {
  /** 本机地址才自动开调试：开发时模型输入输出直接可见，线上不受影响 */
  it('matches loopback hosts only', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(isDevHost(host), host).toBe(true)
    }
    for (const host of ['me-aqua.github.io', 'example.com', 'localhost.example.com', '']) {
      expect(isDevHost(host), host).toBe(false)
    }
  })
})
