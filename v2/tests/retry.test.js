/**
 * 节点工具重试（阶段 2.4 第 2 关）—— 契约见
 * `.team/test/2026-11-28/契约-阶段2.4-节点重试次数.md`。
 *
 * 本文件只钉引擎行为：`retryCount` 是**第一次之外的额外尝试次数**；一次尝试里的
 * 多个工具调用要么全生效、要么全丢弃；耗尽的最后一次错误原样抛出，不返回存档。
 *
 * 🔴 模型的回复由 `vi.mock('../src/core/mock.ts')` 按队列脚本化 —— 真 mock 是确定性的，
 *    永远失败同一条，造不出「第一次失败、第二次成功」。这个替身只替换**模型回复**，
 *    引擎、提示词、工具执行、存档校验都走产品原路。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../src/i18n.ts'
import { makeCard, makeNode, makeSave, MOCK_PRESET, nodeModelsFor } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const model = vi.hoisted(() => ({ calls: [], queue: [] }))

vi.mock('../src/core/mock.ts', () => ({
  mockReply: async ({ node, prompt, action }) => {
    model.calls.push({ nodeId: node.id, prompt })
    if (node.id === 'output') {
      return { text: `[retry] ${action}`, reasoning: '', toolCalls: [], usage: null }
    }
    const next = model.queue.shift()
    if (!next) throw new Error(`模型调用超出脚本：${node.id}`)
    return next
  },
}))

const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

/** 一条脚本化的模型回复：只带工具调用，没有正文（普通节点本来就不产故事） */
function reply(toolCalls = []) {
  return { text: '', reasoning: '', toolCalls, usage: null }
}

/** `write_state` 的一次调用 */
function write(path, value) {
  return { name: 'write_state', args: { path, value } }
}

/**
 * 本票的测试卡：worker（普通，可写 1 文本 / 3 整数）→ output。
 * 没有时间节点也不推进时间；时间元素只为了满足卡的形状（`state[0]` 必须是 time）。
 */
function retryCard({ retryCount, outputRetryCount } = {}) {
  const base = makeCard()
  const worker = makeNode('worker', 'normal', {
    writable: ['1', '3'],
    prompt: 'NODE_WORKER',
    ...(retryCount === undefined ? {} : { retryCount }),
  })
  const output = makeNode('output', 'output', {
    readsUpstream: ['worker'],
    historyTurns: 0,
    prompt: 'NODE_OUT',
    ...(outputRetryCount === undefined ? {} : { retryCount: outputRetryCount }),
  })
  return {
    ...base,
    state: [
      ...base.state,
      {
        code: '3',
        name: 'score',
        note: '',
        type: 'integer',
        min: 0,
        max: 10,
        stepMin: 0,
        stepMax: 10,
        initial: { 3: 5 },
      },
    ],
    chain: [worker, output],
  }
}

/** 模拟旧卡：把夹具可能自带的 `retryCount` 摘掉，确保「缺省 = 0」真的被测到 */
function withoutRetryCount(card) {
  return {
    ...card,
    chain: card.chain.map((node) => {
      const copy = { ...node }
      delete copy.retryCount
      return copy
    }),
  }
}

async function turn(card, save = makeSave(card)) {
  const { runTurn } = await loadEngine()
  return runTurn({
    card,
    save,
    presets: [MOCK_PRESET],
    nodePresets: nodeModelsFor(card),
    action: 'act one',
  })
}

function traceOf(result, nodeId) {
  const event = result.events.find((item) => item.type === 'trace' && item.detail.nodeId === nodeId)
  if (!event) throw new Error(`没有 ${nodeId} 的 trace 事件`)
  return event.detail
}

function blockOf(prompt) {
  const start = prompt.indexOf('<工具执行失败>')
  if (start === -1) throw new Error('提示词里没有 <工具执行失败> 块')
  const end = prompt.indexOf('</工具执行失败>', start)
  if (end === -1) throw new Error('<工具执行失败> 没有收尾标记')
  return prompt.slice(start, end + '</工具执行失败>'.length)
}

const valueNotFit = (path) => t('error.valueNotFit', { path })

beforeEach(() => {
  model.calls.length = 0
  model.queue.length = 0
})

describe('引擎重试：次数语义', () => {
  it('缺省 retryCount = 0：工具失败一次就抛，模型只调一次（负控）', async () => {
    const card = withoutRetryCount(retryCard())
    const save = makeSave(card)
    const before = JSON.stringify(save)
    model.queue.push(reply([write('1', 42)]))

    await expect(turn(card, save)).rejects.toMatchObject({ code: 'E_VALIDATION' })
    expect(model.calls.map((call) => call.nodeId)).toEqual(['worker'])
    expect(JSON.stringify(save), '失败之后存档一个字都不许动').toBe(before)
  })

  it('retryCount=0：失败即抛，不写盘、没有 write 事件（负控）', async () => {
    const card = retryCard({ retryCount: 0 })
    const save = makeSave(card)
    const before = JSON.stringify(save)
    model.queue.push(reply([write('1', 42)]))

    let error = null
    try {
      await turn(card, save)
    } catch (cause) {
      error = cause
    }
    expect(error, '工具失败必须抛错').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toBe(valueNotFit('1'))
    expect(model.calls.map((call) => call.nodeId)).toEqual(['worker'])
    expect(JSON.stringify(save)).toBe(before)
  })

  it('retryCount=1：第一次失败、第二次成功 ⇒ 最终值落盘，模型调两次', async () => {
    const card = retryCard({ retryCount: 1 })
    model.queue.push(reply([write('1', 42)]), reply([write('1', 'FIXED')]))

    const result = await turn(card)
    expect(result.save.tree['1']).toBe('FIXED')
    expect(result.save.tree['3']).toBe(5)
    expect(model.calls.map((call) => call.nodeId)).toEqual(['worker', 'worker', 'output'])
    expect(model.calls[1].prompt, '重试时模型必须真的收到错误块').toContain('<工具执行失败>')
    expect(model.calls[0].prompt, '第一次尝试不该带错误块').not.toContain('<工具执行失败>')
    expect(result.events.filter((event) => event.type === 'write').map((event) => event.detail)).toEqual([
      { path: '1', value: 'FIXED' },
    ])
  })

  it('尝试耗尽：retryCount=2 ⇒ 模型调三次，抛最后一次错误，存档不动', async () => {
    const card = retryCard({ retryCount: 2 })
    const save = makeSave(card)
    const before = JSON.stringify(save)
    model.queue.push(
      reply([write('1', 42)]), // E_VALIDATION
      reply([write('3', 'oops')]), // E_VALIDATION
      reply([write('99', 'x')]), // E_CHAIN：路径不存在
    )

    let error = null
    try {
      await turn(card, save)
    } catch (cause) {
      error = cause
    }
    expect(error, '三次都失败必须抛错').not.toBeNull()
    expect(error.code, '抛的是最后一次错误，不是第一次').toBe('E_CHAIN')
    expect(error.message).toContain('99')
    expect(model.calls.map((call) => call.nodeId)).toEqual(['worker', 'worker', 'worker'])
    expect(model.calls[0].prompt).not.toContain('<工具执行失败>')
    expect(model.calls[1].prompt).toContain('路径：1')
    expect(model.calls[2].prompt, '第三次尝试带的是第二次的错误').toContain('路径：3')
    expect(JSON.stringify(save), '耗尽之后不许留下任何一次尝试的写入').toBe(before)
  })
})

describe('引擎重试：一次尝试是原子的', () => {
  it('前一条工具成功、后一条失败 ⇒ 前一条也丢弃；重试只提交第二次尝试', async () => {
    const card = retryCard({ retryCount: 1 })
    model.queue.push(
      reply([write('1', 'ATTEMPT1'), write('3', 'oops')]), // 第二条失败
      reply([write('3', 7)]),
    )

    const result = await turn(card)
    expect(result.save.tree['1'], '第一次尝试里已经成功的写入也必须丢弃').toBe('VAL_PLACE_A1')
    expect(result.save.tree['3']).toBe(7)
    expect(result.events.filter((event) => event.type === 'write').map((event) => event.detail)).toEqual([
      { path: '3', value: 7 },
    ])
    expect(
      result.events.filter((event) => event.type === 'tool').map((event) => event.detail),
      '失败尝试里的 tool 事件也不许漏进本回合',
    ).toEqual([{ name: 'write_state', args: { path: '3', value: 7 } }])

    const worker = traceOf(result, 'worker')
    expect(worker.attempts).toHaveLength(2)
    expect(worker.attempts[0].toolCalls, '失败尝试里成功执行的那一条只用于排障').toEqual([
      { name: 'write_state', args: { path: '1', value: 'ATTEMPT1' }, result: 'ATTEMPT1' },
    ])
    expect(worker.attempts[0].error).toMatchObject({
      tool: 'write_state',
      path: '3',
      code: 'E_VALIDATION',
    })
    expect(worker.attempts[1].error).toBeNull()
    expect(worker.toolCalls).toEqual([{ name: 'write_state', args: { path: '3', value: 7 }, result: '7' }])
  })
})

describe('引擎重试：trace 与错误块', () => {
  it('trace.attempts 记每一轮：index / 成功调用 / error；toolCalls 只含提交那次', async () => {
    const card = retryCard({ retryCount: 2 })
    model.queue.push(reply([write('1', 42)]), reply([write('3', 'oops')]), reply([write('1', 'OK')]))

    const result = await turn(card)
    const worker = traceOf(result, 'worker')
    expect(worker.attempts.map((attempt) => attempt.index)).toEqual([0, 1, 2])
    expect(worker.attempts.map((attempt) => attempt.error?.code ?? null)).toEqual([
      'E_VALIDATION',
      'E_VALIDATION',
      null,
    ])
    expect(worker.attempts.map((attempt) => attempt.error?.path ?? null)).toEqual(['1', '3', null])
    expect(worker.attempts.at(-1).toolCalls).toEqual(worker.toolCalls)
    expect(worker.toolCalls).toEqual([
      { name: 'write_state', args: { path: '1', value: 'OK' }, result: 'OK' },
    ])

    // 最后一次尝试的提示词里，只带**上一轮**（第二次）的错误
    expect(worker.prompt, 'trace.prompt 必须是模型真正收到的那一份').toBe(model.calls[2].prompt)
    expect(model.calls[1].prompt).toContain('路径：1')
    const block = blockOf(worker.prompt)
    expect(block).toContain('路径：3')
    expect(worker.prompt.match(/<工具执行失败>/g), '一个块只写一条错误').toHaveLength(1)
    expect(worker.prompt.trimEnd().endsWith('</工具执行失败>'), '错误块必须是提示词最后一块').toBe(true)
  })

  it('错误块内容：工具 / 路径 / 错误码 / 原因 / 文本值形状', async () => {
    const card = retryCard({ retryCount: 1 })
    model.queue.push(reply([write('1', 42)]), reply([write('1', 'FIXED')]))

    const result = await turn(card)
    const trace = traceOf(result, 'worker')
    const block = blockOf(model.calls[1].prompt)
    expect(trace.prompt, 'trace.prompt 与真正喂给模型的是同一份').toBe(model.calls[1].prompt)
    expect(block).toContain('工具：write_state')
    expect(block).toContain('路径：1')
    expect(block).toContain('错误码：E_VALIDATION')
    expect(block).toContain(`原因：${valueNotFit('1')}`)
    expect(block).toMatch(/正确值形状：[^\n]*JSON 字符串/)
  })

  it('错误块形状按类型派生：整数写错 ⇒ JSON 整数 + 该元素的上下限', async () => {
    const card = retryCard({ retryCount: 1 })
    model.queue.push(reply([write('3', 'oops')]), reply([write('3', 7)]))

    const result = await turn(card)
    const block = blockOf(model.calls[1].prompt)
    expect(block).toContain('工具：write_state')
    expect(block).toContain('路径：3')
    expect(block).toContain('错误码：E_VALIDATION')
    expect(block).toMatch(/正确值形状：[^\n]*JSON 整数/)
    expect(block, '整数形状要带该元素的上下限').toMatch(/0\s*\.\.\s*10/)
    expect(result.save.tree['3']).toBe(7)
  })
})

describe('引擎重试：输出节点没有工具', () => {
  it('output 节点 retryCount=5 也只调一次模型（没有工具可失败）', async () => {
    const card = retryCard({ retryCount: 0, outputRetryCount: 5 })
    model.queue.push(reply([write('1', 'OK')]))

    const result = await turn(card)
    expect(model.calls.map((call) => call.nodeId)).toEqual(['worker', 'output'])
    const output = traceOf(result, 'output')
    expect(output.attempts, 'output 也要有 attempts 读数，但只有一次').toHaveLength(1)
    expect(output.attempts[0]).toEqual({ index: 0, toolCalls: [], error: null })
    expect(output.toolCalls).toEqual([])
  })
})
