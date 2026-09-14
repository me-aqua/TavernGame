/**
 * store 的补充测试 —— 覆盖 tests/store.test.ts 未触及的分支。
 *
 * 重点：
 *   - abortRunningTurn 真正中止一个在飞的回合（重入保护的核心）
 *   - 取消路径（AbortError）与失败路径的区分
 *   - handleEvent 的 tool / toolResult / warn / raw 分支（调试痕迹，不是故事）
 *   - 回合没产出文字、存档写不进去时的通知分支
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGame } from '../src/stores/game'
import { t } from '../src/i18n'
import { configureFakeProvider } from './support/game-fixtures'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

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

let fake: FakeLlm | null = null

/** 界面上的故事行（rows 里 debug=false 的那些） */
const storyRows = (g: ReturnType<typeof useGame>) => g.rows.value.filter((row) => !row.debug)

/** 界面上的调试行（只有打开调试模式才会出现） */
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
    // 一步工具调用之后时间线就应有记录，不必等整个回合结束
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
