/**
 * 错误判据（CONTRACT §6）。
 *
 * 一句人话比一个码重要：玩家看到的必须是**中文 + 下一步**，不是 `fetch failed` 或空白。
 * 五个码各来一遍（含 SPEC 没列、本契约补的 `E_ABORTED`），再验一条「引擎抛的确实是这个类」
 * —— 长得像 AppError 的对象不算数，`instanceof` 才算。
 */
import { describe, expect, it } from 'vitest'
import { makeCard, makeSave, MOCK_PRESET, nodeModelsFor } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const CJK = /[\u4e00-\u9fff]/
const CODES = ['E_PROVIDER', 'E_VALIDATION', 'E_CHAIN', 'E_UNKNOWN', 'E_ABORTED']
const loadErrors = () => loadModule('core/errors.ts', () => import('../src/core/errors.ts'))
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

describe('错误：五个码一个不少', () => {
  it('CODES 就是约定那五个', async () => {
    const { CODES: declared } = await loadErrors()
    expect([...declared].sort()).toEqual([...CODES].sort())
  })

  it('每个码都有默认中文 message 与中文 nextStep（不传文案也不许是空串）', async () => {
    const { AppError } = await loadErrors()
    for (const code of CODES) {
      const error = new AppError(code)
      expect(error.code).toBe(code)
      expect(error.message, `${code} 缺中文提示`).toMatch(CJK)
      expect(error.nextStep, `${code} 缺下一步`).toMatch(CJK)
      expect(error.message).not.toMatch(/undefined|null/)
    }
  })

  it('传了 message / nextStep 就覆盖默认值，detail 原样留着', async () => {
    const { AppError } = await loadErrors()
    const error = new AppError('E_CHAIN', {
      message: '链里没有输出节点',
      nextStep: '回编辑器加一个输出节点',
      detail: { nodeId: 'output' },
    })
    expect(error.message).toBe('链里没有输出节点')
    expect(error.nextStep).toBe('回编辑器加一个输出节点')
    expect(error.detail).toEqual({ nodeId: 'output' })
  })

  it('是 Error 的实例（栈、cause 这些还能用）', async () => {
    const { AppError } = await loadErrors()
    const error = new AppError('E_UNKNOWN', { cause: new Error('boom') })
    expect(error).toBeInstanceOf(Error)
    expect(error.cause).toBeInstanceOf(Error)
  })
})

describe('错误：引擎抛的确实是这个类', () => {
  it('链不合法时抛的是 AppError，且带中文', async () => {
    const { AppError } = await loadErrors()
    const { runTurn } = await loadEngine()
    const card = makeCard()
    const broken = { ...card, chain: card.chain.filter((node) => node.type !== 'output') }
    try {
      await runTurn({ card: broken, save: makeSave(card), presets: [MOCK_PRESET], action: 'act one' })
      throw new Error('坏链却没有报错')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect(error.code).toBe('E_CHAIN')
      expect(error.message).toMatch(CJK)
      expect(error.nextStep).toMatch(CJK)
    }
  })

  it('中止抛的是 AppError（E_ABORTED），不是普通 Error', async () => {
    const { AppError } = await loadErrors()
    const { runTurn } = await loadEngine()
    const card = makeCard()
    const controller = new globalThis.AbortController()
    controller.abort()
    try {
      await runTurn({
        card,
        save: makeSave(card),
        presets: [MOCK_PRESET],
        nodePresets: nodeModelsFor(card),
        action: 'act one',
        signal: controller.signal,
      })
      throw new Error('已中止的 signal 却没有报错')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect(error.code).toBe('E_ABORTED')
    }
  })
})
