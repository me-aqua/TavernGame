/**
 * store 测试 —— 界面与游戏之间唯一的桥梁，此前 0% 覆盖。
 *
 * 只通过公开 API 驱动：store 的实例是模块级的，
 * 所以每个用例开头都「resetGame」清空（它同时清空消息流与历史）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { watchEffect } from 'vue'
import { useGame } from '../src/stores/game'
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

  it('after one turn: turn +1 and both the action and the narration are in the stream', async () => {
    const g = await runOneTurn()
    expect(g.turn.value).toBe(1)
    const kinds = g.messages.value.map((l) => l.kind)
    expect(kinds).toContain('action')
    expect(kinds).toContain('narration')
    expect(g.messages.value.find((l) => l.kind === 'action')?.text).toBe(OPEN_EYES)
    expect(g.messages.value.find((l) => l.kind === 'narration')?.text).toContain(WAKE_REPLY)
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

  it('resets the running flag (otherwise every later turn would be blocked)', async () => {
    fake = installFakeLlm([DONE_REPLY])
    const g = useGame()
    expect(g.running.value).toBe(false)
    await g.runTurnAction(NUDGE_ACTION)
    expect(g.running.value).toBe(false)
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
    expect(g.running.value).toBe(false)
    fake.restore()
    fake = null
  })
})

describe('log restore', () => {
  it('replays only narration and actions (system lines are not shown again)', async () => {
    const g = await runOneTurn()
    const save = JSON.parse(g.exportSave()) as { log: Array<{ kind: string; text: string; at: string }> }
    save.log = [
      { kind: 'narration', text: SAVED_NARRATION, at: new Date().toISOString() },
      { kind: 'system', text: SAVED_SYSTEM, at: new Date().toISOString() },
      { kind: 'action', text: SAVED_ACTION, at: new Date().toISOString() },
    ]
    g.importSave(JSON.stringify(save))
    expect(g.messages.value).toHaveLength(0)

    g.restoreLog()
    expect(g.messages.value.map((l) => l.kind)).toEqual(['narration', 'action'])
  })
})

describe('the three entry points that swap state', () => {
  it('resetGame: turn back to 0, message stream cleared, save overwritten', async () => {
    const g = await runOneTurn()
    expect(g.turn.value).toBe(1)
    g.resetGame()
    expect(g.turn.value).toBe(0)
    expect(g.messages.value).toHaveLength(0)
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
    expect(g.messages.value).toHaveLength(0)
  })

  it('importing broken JSON throws (the UI reports it)', () => {
    const g = useGame()
    expect(() => g.importSave(BROKEN_SAVE)).toThrow()
  })
})

describe('debugMode', () => {
  it('when on, the raw model output is appended to the message stream', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm([RAW_REPLY])
    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null
    const rawLines = g.messages.value.filter((l) => l.raw !== undefined)
    expect(rawLines).toHaveLength(1)
    expect(rawLines[0].raw).toContain(RAW_REPLY)
    g.debugMode.value = false
  })

  it('when off, nothing raw is appended', async () => {
    const g = useGame()
    g.debugMode.value = false
    fake = installFakeLlm([PLAIN_REPLY])
    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null
    expect(g.messages.value.filter((l) => l.raw !== undefined)).toHaveLength(0)
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
    expect(seen, 'the computed must recompute after the advance -- that is what the UI updating means').toContain(after)
    expect(seen.length, 'it must be evaluated more than once').toBeGreaterThan(1)
    stop()
  })

  it('the transcript the UI renders changes when the domain appends a line', async () => {
    fake = installFakeLlm([WAKE_REPLY])
    const g = useGame()
    const counts: number[] = []
    const stop = watchEffect(() => counts.push(g.messages.value.length))

    expect(counts.length).toBe(1)
    await g.runTurnAction(OPEN_EYES)

    expect(counts.length, 'a transcript change must trigger a recompute').toBeGreaterThan(1)
    expect(counts.at(-1)).toBe(g.messages.value.length)
    stop()
  })
})

describe('append: the one-line entry point components use', () => {
  /**
   * App.vue 通过它写系统提示（调试开关、开场失败、导入结果）。
   * 它是 store 暴露给组件的唯一「追加一行」入口，不能只靠别的路径间接覆盖。
   */
  it('adds a line of the requested kind to the transcript', () => {
    const g = useGame()
    g.append('system', 'a system line')
    g.append('error', 'an error line', { raw: 'raw payload' })

    const last = g.messages.value.slice(-2)
    expect(last.map((l) => l.kind)).toEqual(['system', 'error'])
    expect(last.map((l) => l.text)).toEqual(['a system line', 'an error line'])
    expect(last[1].raw).toBe('raw payload')
  })
})
