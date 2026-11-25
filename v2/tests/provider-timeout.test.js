/**
 * provider 的两条「收尾」判据（CONTRACT §4.4 / §4.5，第 1 轮评审第 3 条）：
 *
 *   ① **服务商挂住不回** ⇒ 60 秒后必须自己收尾成 `E_PROVIDER`（中文提示 + 下一步），
 *      不许永远挂着；也不许拖成 `E_UNKNOWN`。
 *   ② **玩家点「停止」** ⇒ 仍然是 `E_ABORTED`（不是超时，也不是 provider 错）。
 *
 * 🔴 这两条都不许真等 60 秒：用**假时钟**把时间推过去。
 *    ⇒ 推论（写给实现）：超时那一段必须能被假时钟推进（`setTimeout` 那一类），
 *      否则「60 秒后收尾」这件事在测试里要么等一分钟、要么根本测不到。
 * ⚠️ 这里把 `fetch` 打桩成「永不返回、但听 signal 的话」：不联外网，也不依赖服务商。
 *
 * 🔴 两个顺序都是判据的一部分（第 2 轮评审指出的坑）：
 *    · **模块先加载**：动态 `import()` 是真 I/O / 真微任务，在假时钟里跑会在导入阶段就卡住；
 *    · **拒绝处理先挂上**：`runTurn` 的 promise 要在推时钟**之前**接上 handler，
 *      否则超时那一刻会先报一个 unhandled rejection，而断言还停在后面。
 */
import { describe, expect, it, vi } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import { makeCard, makeSave, MOCK_PRESET, nodeModelsFor } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const CJK = /[\u4e00-\u9fff]/
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

/** 一个「永远不回」的 fetch：只有 signal 中止时才拒绝（模拟服务商挂着） */
function hangingFetch() {
  return vi.fn((_input, init) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return
      const onAbort = () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  })
}

/** 真 provider 预设（Key 填了，这样才会走到网络那一步） */
const REAL_PRESET = {
  ...MOCK_PRESET,
  id: 'p-real',
  provider: 'openai-compatible',
  baseUrl: 'https://mock.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
}

describe('provider 超时（60 秒，假时钟）', () => {
  it('服务商挂着不回 ⇒ 60 秒后 E_PROVIDER，中文提示 + 中文下一步', async () => {
    // ① 先打桩再加载：provider 那侧只要有一次在模块求值时就抓住了 `fetch`，
    //    晚打桩就抓不到（实测：光「先加载再打桩」时 fetch 一次都没被调用）。
    const fetchSpy = hangingFetch()
    vi.stubGlobal('fetch', fetchSpy)
    // ② 模块在**真时钟**下加载完（动态 import 是真 I/O，不能关在假时钟里）
    const { runTurn } = await loadEngine()
    const card = makeCard()
    vi.useFakeTimers()
    try {
      // ③ 起回合，并**立刻**接上拒绝处理器（推时钟之前）
      const settled = runTurn({
        card,
        save: makeSave(card),
        presets: [REAL_PRESET],
        nodePresets: nodeModelsFor(card, REAL_PRESET.id),
        action: 'act one',
      }).then(
        () => 'resolved',
        (error) => error,
      )

      // ④ 用**真实**的一小段时间让请求真的发出去（node:timers 不受假时钟管），
      //    然后推 60 秒假时钟 —— 不许真等 60 秒
      for (let tick = 0; tick < 40 && fetchSpy.mock.calls.length === 0; tick += 1) {
        await sleep(5)
        await vi.advanceTimersByTimeAsync(1)
      }
      expect(fetchSpy, '请求要先发出去，否则这条测的不是超时').toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(60_000)

      // ⑤ 再给一次真实的机会：超时若走真时钟，这里会落进 pending 而不是报断言失败
      const outcome = await Promise.race([settled, sleep(2_000).then(() => 'pending')])
      expect(
        outcome,
        '推了 60 秒假时钟还是挂着 —— 超时要么没实现，要么没走假时钟推得动的那种定时器',
      ).not.toBe('pending')
      expect(outcome).not.toBe('resolved')
      expect(outcome.code).toBe('E_PROVIDER')
      expect(outcome.message).toMatch(CJK)
      expect(outcome.nextStep).toMatch(CJK)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('玩家中止仍然是 E_ABORTED，不会被算成超时', async () => {
    // 同样先打桩、再加载（这条不用假时钟）
    const fetchSpy = hangingFetch()
    vi.stubGlobal('fetch', fetchSpy)
    const { runTurn } = await loadEngine()
    const card = makeCard()
    try {
      const controller = new globalThis.AbortController()
      const settled = runTurn({
        card,
        save: makeSave(card),
        presets: [REAL_PRESET],
        nodePresets: nodeModelsFor(card, REAL_PRESET.id),
        action: 'act one',
        signal: controller.signal,
      }).then(
        () => 'resolved',
        (error) => error,
      )

      // 等请求真的发出去再中止（否则测的是「还没开始就中止」）
      for (let tick = 0; tick < 100 && fetchSpy.mock.calls.length === 0; tick += 1) await sleep(5)
      expect(fetchSpy, '请求要先发出去').toHaveBeenCalled()

      controller.abort()
      const outcome = await Promise.race([settled, sleep(2_000).then(() => 'pending')])
      expect(outcome, '中止之后必须立刻收尾').not.toBe('pending')
      expect(outcome).not.toBe('resolved')
      expect(outcome.code, '玩家中止 ≠ 超时').toBe('E_ABORTED')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
