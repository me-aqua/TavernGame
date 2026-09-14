/**
 * store 测试 —— 界面与游戏之间唯一的桥梁，此前 0% 覆盖。
 *
 * 只通过公开 API 驱动：store 的实例是模块级的，
 * 所以每个用例开头都「resetGame」清空（数据、事件流、历史、通知一起清）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { watchEffect } from 'vue'
import { isDevHost, readStoredDebug, resolveDebug, storeDebug, useGame } from '../src/stores/game'
import { initialState, hydrateFromSave, turn } from '../src/game/state'
import { SAVE_KEY } from '../src/utils/storage'
import { hourToSegment, SEGMENTS } from '../src/utils/calendar'
import { t } from '../src/i18n'
import { configureFakeProvider } from './support/game-fixtures'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

/** 测试自造的 fixture（模型回复与玩家行动），不是产品文案 */
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
const SAVED_SYSTEM = 'system line that must not be replayed'
const SAVED_ACTION = 'action from the save'
const BROKEN_SAVE = '{broken'
const RAW_REPLY = 'raw output sample'
const PLAIN_REPLY = 'plain output'
const LOOK_ACTION = 'look around'

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
  useGame().resetGame()
})

/** 界面上的故事行（rows 里 debug=false 的那些） */
const storyRows = (g: ReturnType<typeof useGame>) => g.rows.value.filter((row) => !row.debug)

/** 界面上的调试行（只有打开调试模式才会出现） */
const debugRows = (g: ReturnType<typeof useGame>) => g.rows.value.filter((row) => row.debug)

/** 造一个已写完一回合的 store */
async function runOneTurn(draft = WAKE_REPLY) {
  fake = installFakeLlm([draft])
  const g = useGame()
  await g.runTurnAction(OPEN_EYES)
  fake.restore()
  fake = null
  return g
}

describe('derived state (what the sidebar reads)', () => {
  it('starts with a calendar timestamp, turn 0, and a named scene', () => {
    const g = useGame()
    // 时间标签是产品文案：期望值用 locale 里的历法片段按存档时刻拼出来
    const at = new Date((JSON.parse(g.exportSave()) as { time: { iso: string } }).time.iso)
    const label =
      t('calendar.yearMonthDay', { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate() }) +
      t('calendar.dateSeparator') +
      t(`calendar.weekday.${at.getDay()}`) +
      t('calendar.dateSeparator') +
      t(`calendar.segment.${SEGMENTS[hourToSegment(at.getHours())]}`)
    expect(g.timeLabel.value).toBe(label)
    expect(g.turn.value).toBe(0)
    expect(g.scene.value.name).toBe(t('scene.unknownPlace'))
    expect(g.timeline.value).toEqual([])
  })

  it('after one turn: turn +1 and both the action and the narration are in the story', async () => {
    const g = await runOneTurn()
    expect(g.turn.value).toBe(1)
    const kinds = storyRows(g).map((l) => l.kind)
    expect(kinds).toContain('action')
    expect(kinds).toContain('narration')
    expect(storyRows(g).find((l) => l.kind === 'action')?.text).toBe(OPEN_EYES)
    expect(storyRows(g).find((l) => l.kind === 'narration')?.text).toContain(WAKE_REPLY)
  })
})

describe('runTurnAction', () => {
  it('refuses re-entrant calls while a turn is running (re-entrancy guard)', async () => {
    fake = installFakeLlm(RACE_DRAFTS)
    const g = useGame()
    await Promise.all([g.runTurnAction(RACE_ACTIONS[0]), g.runTurnAction(RACE_ACTIONS[1])])
    // 只有第一个回合的请求发出去了
    expect(fake.calls).toHaveLength(1)
    fake.restore()
    fake = null
  })

  it('resets the busy flag (otherwise every later turn would be blocked)', async () => {
    fake = installFakeLlm([DONE_REPLY])
    const g = useGame()
    expect(g.busy.value).toBe(false)
    await g.runTurnAction(NUDGE_ACTION)
    expect(g.busy.value).toBe(false)
    fake.restore()
    fake = null
  })

  it('resets the flag after a failed turn (otherwise the UI stays stuck thinking)', async () => {
    // 说明：store 的取消是内部行为（abortRunningTurn），
    // 从公开 API 无法注入 signal —— 取消路径由 agent.test.ts 直接测 runTurn。
    fake = installFakeLlm([UNREACHED_REPLY])
    fake.failNextWith(new Error(NETWORK_ERROR))
    const g = useGame()

    await expect(g.runTurnAction(RETRY_ACTION)).rejects.toThrow(NETWORK_ERROR)
    expect(g.busy.value).toBe(false)
    fake.restore()
    fake = null
  })
})

describe('the story is a projection of the log (nothing to restore)', () => {
  it('shows narration and actions right after import, and hides system markers', async () => {
    const g = await runOneTurn()
    const save = JSON.parse(g.exportSave()) as { events: Array<{ kind: string; text: string; at: string }> }
    save.events = [
      { kind: 'narration', text: SAVED_NARRATION, at: new Date().toISOString() },
      { kind: 'system', text: SAVED_SYSTEM, at: new Date().toISOString() },
      { kind: 'action', text: SAVED_ACTION, at: new Date().toISOString() },
    ]

    // ⚠️ 没有 restoreLog 这一步：渲染的是日志本身，导入完就该是这三行里该显示的
    g.importSave(JSON.stringify(save))

    expect(storyRows(g).map((l) => l.kind)).toEqual(['narration', 'action'])
    expect(storyRows(g).map((l) => l.text)).toEqual([SAVED_NARRATION, SAVED_ACTION])
    expect(storyRows(g).map((l) => l.text)).not.toContain(SAVED_SYSTEM)
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
    // 导入的那份存档里有一回合的故事，所以故事区应当显示它（而不是空的）
    expect(storyRows(g).map((l) => l.kind)).toEqual(['action', 'narration'])
  })

  it('importing broken JSON throws (the UI reports it)', () => {
    const g = useGame()
    expect(() => g.importSave(BROKEN_SAVE)).toThrow()
  })
})

describe('debugMode', () => {
  it('when on, the model input and output land in the rows -- never in the story', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm([RAW_REPLY])
    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null

    const payloads = debugRows(g).filter((row) => row.detail !== undefined)
    // 一次调用两条：先请求体（模型输入），再响应体
    expect(payloads.map((row) => row.kind)).toEqual(['request', 'reply'])
    expect(payloads[0].detail).toContain('"messages"')
    expect(payloads[1].detail).toContain(RAW_REPLY)
    expect(storyRows(g).map((row) => row.text)).not.toContain(payloads[1].text)
    g.debugMode.value = false
  })

  it('when off, no debug event is written at all', async () => {
    const g = useGame()
    g.debugMode.value = false
    fake = installFakeLlm([PLAIN_REPLY])
    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null

    expect(debugRows(g)).toEqual([])
    // 源头上就没有：不是「写了但界面藏起来」
    const event = JSON.parse(g.exportSave()) as { events: Array<{ kind: string }> }
    expect(event.events.map((e) => e.kind)).toEqual(['action', 'narration'])
  })

  it('hides debug rows that are already in a save (player never sees agent info)', () => {
    const g = useGame()
    const save = JSON.parse(g.exportSave()) as { events: Array<{ kind: string; text: string }> }
    save.events = [
      { kind: 'narration', text: 'story line' },
      { kind: 'tool', text: 'tool call line' },
    ]
    g.importSave(JSON.stringify(save))

    expect(storyRows(g).map((row) => row.text)).toEqual(['story line'])
    expect(debugRows(g)).toEqual([])

    g.debugMode.value = true
    expect(debugRows(g).map((row) => row.text)).toEqual(['tool call line'])
    g.debugMode.value = false
  })
})

describe('loadAtStartup', () => {
  it('startup error is null when there is no save', () => {
    localStorage.removeItem(SAVE_KEY)
    expect(useGame().startupError).toBeNull()
  })
})

describe('reactivity: the UI updates when the domain mutates the data', () => {
  /**
   * ⚠️ 这是纯函数方案的**新风险**所在：领域函数原地改它拿到的对象，
   * 前提是那个对象是 `reactive()` 的**代理**。传原对象（toRaw）不会报错，
   * 但界面静默不更新 —— 没有任何类型能拦住它。
   *
   * 所以这里不测「函数改了数据」（那只证明函数对），而是测**读到 DOM 上**：
   * 挂一个真组件，跑一个回合（工具会推进时间），断言渲染出来的时间变了。
   */
  it('a turn that advances time updates what a component renders', async () => {
    fake = installFakeLlm([
      { content: WAKE_REPLY, toolCalls: [{ name: 'advance_time', arguments: '{"step":1,"unit":"day"}' }] },
      DONE_REPLY,
    ])
    const g = useGame()
    const seen: string[] = []
    // 组件读什么，就监视什么（computed 是它渲染时读的那个值）
    const stop = watchEffect(() => seen.push(g.timeLabel.value))

    const before = g.timeLabel.value
    await g.runTurnAction(OPEN_EYES)
    const after = g.timeLabel.value

    expect(after, 'the clock must actually move, or this test proves nothing').not.toBe(before)
    expect(
      seen,
      'the computed must recompute after the advance -- that is what the UI updating means',
    ).toContain(after)
    expect(seen.length, 'it must be evaluated more than once').toBeGreaterThan(1)
    stop()
  })

  it('the story the UI renders changes when the domain writes to the log', async () => {
    fake = installFakeLlm([WAKE_REPLY])
    const g = useGame()
    const counts: number[] = []
    const stop = watchEffect(() => counts.push(storyRows(g).length))

    expect(counts.length).toBe(1)
    await g.runTurnAction(OPEN_EYES)

    expect(counts.length, 'a log change must trigger a recompute').toBeGreaterThan(1)
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
    fake = installFakeLlm([WAKE_REPLY])
    const opening = g.runTurnAction()
    expect(g.status.value).toEqual({ kind: 'busy', text: t('app.generatingOpening') })

    await opening
    fake.restore()
    fake = null
    expect(g.busy.value).toBe(false)
    expect(g.status.value).toBeNull()
  })

  it('drops the previous notice when a new turn starts, and says it is thinking', async () => {
    const g = useGame()
    g.notify('exported')
    fake = installFakeLlm([WAKE_REPLY])
    const running = g.runTurnAction(OPEN_EYES)
    expect(g.status.value).toEqual({ kind: 'busy', text: t('story.thinking') })

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
    fake = installFakeLlm([WAKE_REPLY])
    await g.runTurnAction()
    fake.restore()
    fake = null

    expect(storyRows(g).map((row) => row.text)).not.toContain(t('app.generatingOpening'))
    expect(storyRows(g).map((row) => row.kind)).toEqual(['narration'])
  })
})

describe('one event stream: debug rows are interleaved where they happened', () => {
  /** 一步调工具、一步写叙事 —— 痕迹会落在两段叙事之间 */
  const TOOL_STEP = {
    content: WAKE_REPLY,
    toolCalls: [{ name: 'advance_time', arguments: '{"step":1,"unit":"day"}' }],
  }

  it('keeps the story in order and puts the traces between the story lines', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm([TOOL_STEP, DONE_REPLY])
    await g.runTurnAction(OPEN_EYES)
    fake.restore()
    fake = null

    // 形状就是「谁在什么时候发生」：行动 → 第 1 步的输入/输出 → 叙事 → 工具调用与结果
    // → 第 2 步的输入/输出 → 叙事
    const shape = g.rows.value.map((row) => (row.debug ? row.kind : 'story:' + row.kind))
    g.debugMode.value = false
    expect(shape).toEqual([
      'story:action',
      'request',
      'reply',
      'story:narration',
      'tool',
      'toolResult',
      'request',
      'reply',
      'story:narration',
    ])
  })

  it('with debug off the same events are still there -- only the projection changes', async () => {
    const g = useGame()
    g.debugMode.value = false
    fake = installFakeLlm([TOOL_STEP, DONE_REPLY])
    await g.runTurnAction(OPEN_EYES)
    fake.restore()
    fake = null

    expect(g.rows.value.map((row) => row.kind)).toEqual(['action', 'narration', 'narration'])
    const saved = JSON.parse(g.exportSave()) as { events: Array<{ kind: string }> }
    expect(saved.events.map((e) => e.kind)).toEqual(['action', 'narration', 'narration'])
  })
})

describe('the event stream is the store: it survives a reload', () => {
  /** 跑一个带调试痕迹的回合（调试开 → 有模型请求与响应） */
  async function runWithDebug() {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm([RAW_REPLY])
    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null
    g.debugMode.value = false
    return g
  }

  it('saves debug events next to the story (one array, one key)', async () => {
    const g = await runWithDebug()

    const saved = JSON.parse(g.exportSave()) as { events: Array<{ kind: string; detail?: string }> }
    expect(saved.events.map((e) => e.kind)).toEqual(['action', 'request', 'reply', 'narration'])
    expect(saved.events.some((e) => e.detail?.includes(RAW_REPLY))).toBe(true)
  })

  it('loads them back on the next startup (module reload = F5)', async () => {
    await runWithDebug()

    vi.resetModules()
    const reloaded = await import('../src/stores/game')
    const g = reloaded.useGame()

    expect(g.debugMode.value).toBe(false)
    expect(g.rows.value.every((row) => !row.debug)).toBe(true)
    g.debugMode.value = true
    expect(g.rows.value.filter((row) => row.debug).map((row) => row.kind)).toEqual(['request', 'reply'])
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

    fake = installFakeLlm([WAKE_REPLY])
    await g.runTurnAction(OPEN_EYES)
    fake.restore()
    fake = null

    expect(g.hasStory.value).toBe(true)
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

  it('devHost is off until the browser entry says otherwise', () => {
    // store 不认识 location：纯逻辑测试里它必须是关的
    expect(useGame().devHost.value).toBe(false)
  })

  it('the explicit choice wins over the host default', () => {
    // 没选过 → 按域名（本机开发默认开，线上默认关）
    expect(resolveDebug(null, true)).toBe(true)
    expect(resolveDebug(null, false)).toBe(false)
    // 选过 → 听玩家的（线上用控制台打开过也算）
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
