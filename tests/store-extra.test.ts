/**
 * store 的补充测试 —— 覆盖 tests/store.test.ts 未触及的分支。
 *
 * 重点：
 *   - abortRunningTurn 真正中止一个在飞的回合（重入保护的核心）
 *   - 取消路径（AbortError）与失败路径的区分
 *   - handleEvent 的 tool / toolResult / warn / raw 分支
 *   - 回合没产出文字时的提示分支
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useGame } from '../src/stores/game'
import { saveConfig } from '../src/core/config'
import { t } from '../src/i18n'
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

beforeEach(() => {
  saveConfig({
    provider: 'custom',
    apiKey: 'k',
    apiBase: 'https://example.test/v1',
    model: 'm',
    maxAgentSteps: MAX_STEPS,
  })
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
  it('resetting while a turn is running takes the cancelled branch and clears running', async () => {
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
    expect(g.running.value).toBe(true)

    g.resetGame() // 内部 abortRunningTurn() → controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(g.running.value).toBe(false)

    globalThis.fetch = original
  })

  it('aborting with no turn running is a safe no-op', () => {
    const g = useGame()
    expect(() => g.resetGame()).not.toThrow()
    expect(g.running.value).toBe(false)
  })
})

describe('handleEvent - each event branch', () => {
  it('a tool call and its result each append one line (tool / toolResult branches)', async () => {
    fake = installFakeLlm([{ content: WAIT_REPLY, toolCalls: ADVANCE_STEP_REPLY.toolCalls }, DAWN_REPLY])
    const g = useGame()
    await g.runTurnAction(WAIT_ACTION)

    const texts = g.messages.value.map((l) => l.text)
    expect(texts).toContain(t('toolbar.toolCall', { tool: TOOL_NAME, args: TOOL_ARGS }))
    const resultPrefix = t('store.toolResultLine', { result: '' })
    const advanceHead = t('tools.advanceResult', { before: '', after: '' }).split('\n')[0].trim()
    expect(texts.some((line) => line.startsWith(resultPrefix) && line.includes(advanceHead))).toBe(true)
  })

  it('exhausting the step budget shows up as a warn line (warn branch)', async () => {
    fake = installFakeLlm([...STEP_LIMIT_REPLIES, PATCHED_REPLY])
    const g = useGame()
    await g.runTurnAction(KEEP_WAITING_ACTION)

    const warns = g.messages.value.filter((l) => l.kind === 'warn')
    expect(warns.length).toBeGreaterThan(0)
    const stepLimit = t('store.warnLine', { message: t('agent.stepLimit', { max: MAX_STEPS }) })
    expect(warns.map((w) => w.text)).toContain(stepLimit)
  })

  it('with debug mode on, the raw branch records the response JSON', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm([RAW_BODY_REPLY])

    await g.runTurnAction(LOOK_ACTION)
    fake.restore()
    fake = null

    const rawLines = g.messages.value.filter((l) => l.raw !== undefined)
    expect(rawLines).toHaveLength(1)
    // raw 里存的是协议响应（JSON 文本）
    expect(() => JSON.parse(rawLines[0].raw ?? '')).not.toThrow()
    g.debugMode.value = false
  })
})

describe('a notice when the turn produced nothing', () => {
  it('a system notice is appended when the model wrote nothing (!result.text branch)', async () => {
    // 五步全调工具、补写也空 → result.text 为空
    fake = installFakeLlm([...STEP_LIMIT_REPLIES, BLANK_REPLY])
    const g = useGame()
    await g.runTurnAction(IDLE_ACTION)

    const texts = g.messages.value.map((l) => l.text)
    expect(texts).toContain(t('store.noText'))
  })
})

describe('useGameState - the UI init entry point', () => {
  it('returns the same API as useGame (module-level singleton)', async () => {
    const mod = await import('../src/stores/game')
    const fromHook = mod.useGameState()
    const fromUseGame = mod.useGame()
    expect(fromHook.running).toBe(fromUseGame.running)
    expect(fromHook.messages).toBe(fromUseGame.messages)
  })
})
