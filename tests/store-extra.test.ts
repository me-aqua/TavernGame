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
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

let fake: FakeLlm | null = null

beforeEach(() => {
  saveConfig({
    provider: 'custom',
    apiKey: 'k',
    apiBase: 'https://example.test/v1',
    model: 'm',
    maxAgentSteps: 5,
  })
  useGame().resetGame()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

describe('中止在飞的回合（store 内部 abortRunningTurn）', () => {
  /**
   * abortRunningTurn 不是公开 API，但**取消路径是可测的**：
   * resetGame() 与 importSave() 都会先调它。回合在飞时调 resetGame 即可。
   */
  it('回合进行中触发中止 → 走「已取消本回合」分支，running 复位', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // 请求挂住不返回；只有被 abort 时才结束 —— 这才是真实的取消语义
        init?.signal?.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')))
      })) as typeof fetch

    const g = useGame()
    const pending = g.runTurnAction('等着')
    // 等 store 建好 controller 并进入 fetch
    await new Promise((r) => setTimeout(r, 20))
    expect(g.running.value).toBe(true)

    g.resetGame() // 内部 abortRunningTurn() → controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(g.running.value).toBe(false)

    globalThis.fetch = original
  })

  it('没有在跑的回合时触发中止是安全的空操作', () => {
    const g = useGame()
    expect(() => g.resetGame()).not.toThrow()
    expect(g.running.value).toBe(false)
  })
})

describe('handleEvent —— 各事件分支', () => {
  it('工具调用与工具结果各追加一行（tool / toolResult 分支）', async () => {
    fake = installFakeLlm([
      { content: '等了很久。', toolCalls: [{ name: 'advance_time', arguments: '{"step":1}' }] },
      '天亮了。',
    ])
    const g = useGame()
    await g.runTurnAction('等一等')

    const texts = g.messages.value.map((l) => l.text)
    expect(texts.some((t) => t.includes('⚙ 调用 advance_time'))).toBe(true)
    expect(texts.some((t) => t.includes('→') && t.includes('时间推进'))).toBe(true)
  })

  it('步数耗尽的警告会以 warn 行出现（warn 分支）', async () => {
    const invocation = { toolCalls: [{ name: 'advance_time', arguments: '{"step":1}' }] }
    fake = installFakeLlm([invocation, invocation, invocation, invocation, invocation, '补写的文字。'])
    const g = useGame()
    await g.runTurnAction('一直等')

    const warns = g.messages.value.filter((l) => l.kind === 'warn')
    expect(warns.length).toBeGreaterThan(0)
    expect(warns.some((w) => w.text.includes('步数上限'))).toBe(true)
  })

  it('调试模式打开时 raw 分支记录原始响应 JSON', async () => {
    const g = useGame()
    g.debugMode.value = true
    fake = installFakeLlm(['原始响应的正文'])

    await g.runTurnAction('看看')
    fake.restore()
    fake = null

    const rawLines = g.messages.value.filter((l) => l.raw !== undefined)
    expect(rawLines).toHaveLength(1)
    // raw 里存的是协议响应（JSON 文本）
    expect(() => JSON.parse(rawLines[0].raw ?? '')).not.toThrow()
    g.debugMode.value = false
  })
})

describe('回合产物为空时的提示', () => {
  it('模型一个字都没写时追加系统提示（!result.text 分支）', async () => {
    // 五步全调工具、补写也空 → result.text 为空
    const invocation = { toolCalls: [{ name: 'advance_time', arguments: '{"step":1}' }] }
    fake = installFakeLlm([invocation, invocation, invocation, invocation, invocation, '   '])
    const g = useGame()
    await g.runTurnAction('空转')

    const texts = g.messages.value.map((l) => l.text)
    expect(texts.some((t) => t.includes('没有返回文字'))).toBe(true)
  })
})

describe('useGameState —— 界面初始化入口', () => {
  it('返回与 useGame 同一套 API（模块级单例）', async () => {
    const mod = await import('../src/stores/game')
    const fromHook = mod.useGameState()
    const fromUseGame = mod.useGame()
    expect(fromHook.running).toBe(fromUseGame.running)
    expect(fromHook.messages).toBe(fromUseGame.messages)
  })
})
