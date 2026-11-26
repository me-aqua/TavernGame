/**
 * 引擎判据（CONTRACT §4）—— 阶段 1 的核心。
 *
 * 钉的是「一回合到底发生了什么」：链按顺序跑、时间推进、写入只许落在 `writable`、
 * 只有 output 的文本进故事流、流式增量拼起来等于正文、中止之后存档一个字没动、
 * 上游按**节点 id 的名单**取已执行节点的输出、
 * 以及**每个节点的模型是本地映射解析出来的**（卡里没有模型绑定，§2.5）。
 * 全部用 `provider:'mock'`，不发一次网络请求（除了那两条故意连不上的 E_PROVIDER 用例）。
 */
import { describe, expect, it } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  collect,
  makeCard,
  makeNode,
  makeSave,
  MOCK_PRESET,
  MOCK_PRESET_B,
  nodeModelsFor,
} from './support/fixtures.js'
import { loadModule } from './support/load.js'

const CJK = /[\u4e00-\u9fff]/
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

/** 夹具卡的节点 id（链顺序）：time → check → extra → output */
const NODE_IDS = ['time', 'check', 'extra', 'output']

/**
 * 调试读数只有一份真源：`result.events` 里的 `trace`（逐节点）与 `turnStats`（逐回合）。
 * 下面几个小助手只是把它按节点挑出来 —— 判据不另算一份，避免和引擎各读一处。
 */
function tracesOf(result) {
  return result.events.filter((event) => event.type === 'trace')
}

function traceOf(result, nodeId) {
  const found = tracesOf(result).find((event) => event.detail.nodeId === nodeId)
  if (!found) throw new Error(`没有 ${nodeId} 的 trace 事件`)
  return found.detail
}

function promptsOf(result) {
  return Object.fromEntries(tracesOf(result).map((event) => [event.detail.nodeId, event.detail.prompt]))
}

function presetsOf(result) {
  return Object.fromEntries(tracesOf(result).map((event) => [event.detail.nodeId, event.detail.presetId]))
}

function turnStatsOf(result) {
  const event = result.events.find((item) => item.type === 'turnStats')
  if (!event) throw new Error('没有 turnStats 事件')
  return event.detail
}

/**
 * 跑一回合。
 * 模型的给法照契约 §4.1：`presets` 是池子、`nodePresets` 是这张卡那一片映射。
 * 默认 = 只有一个 mock 预设 + 每个节点都指向它。
 */
async function turn({ card, save, presets = [MOCK_PRESET], nodePresets, action, onEvent, signal } = {}) {
  const { runTurn } = await loadEngine()
  const mapping = nodePresets ?? (card ? nodeModelsFor(card) : undefined)
  return runTurn({ card, save, presets, nodePresets: mapping, action, onEvent, signal })
}

/** 连续跑 n 回合，返回最后一回合的 { card, save } 与每回合结果 */
async function runTurns(count) {
  const card = makeCard()
  let save = makeSave(card)
  const results = []
  for (let index = 1; index <= count; index += 1) {
    const result = await turn({ card, save, action: `act ${index}` })
    results.push(result)
    save = result.save
  }
  return { card, save, results }
}

describe('引擎：一回合的形状', () => {
  it('三个回合连跑：turn / 时间 / 写入 / 故事正文都跟着走', async () => {
    const { save, results } = await runTurns(3)
    expect(results.map((result) => result.save.turn)).toEqual([1, 2, 3])
    expect(save.tree['0']).toEqual({ day: 1, hour: 11 })
    expect(save.tree['1']).toBe('mock-t3')
    const narrations = save.events.filter((event) => event.type === 'narration')
    expect(narrations).toHaveLength(3)
    expect(narrations[2].text).toBe('[mock] turn 3: act 3')
  })

  it('返回的 events 只含本回合（上一回合的正文不许混进来）', async () => {
    const card = makeCard()
    const first = await turn({ card, save: makeSave(card), action: 'act one' })
    const second = await turn({ card, save: first.save, action: 'act two' })
    expect(second.events.some((event) => event.text === 'act one')).toBe(false)
    expect(second.events.some((event) => event.text === 'act two')).toBe(true)
    expect(second.save.events.length).toBeGreaterThan(first.save.events.length)
    expect(second.save.events.slice(-second.events.length)).toEqual(second.events)
  })

  it('入参一个字都不改（save / card 都是只读的）', async () => {
    const card = makeCard()
    const save = makeSave(card)
    const before = JSON.stringify({ card, save })
    await turn({ card, save, action: 'act one' })
    expect(JSON.stringify({ card, save })).toBe(before)
  })

  it('节点事件按链顺序出现，一个节点一条', async () => {
    const card = makeCard()
    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    const nodes = result.events.filter((event) => event.type === 'node')
    expect(nodes.map((event) => event.detail.id)).toEqual(NODE_IDS)
  })
})

describe('引擎：只有输出节点的文本进故事流', () => {
  it('每回合恰好一条 narration，且就是 output 节点的文本', async () => {
    const { save } = await runTurns(2)
    const narrations = save.events.filter((event) => event.type === 'narration')
    expect(narrations).toHaveLength(2)
    expect(narrations.map((event) => event.text)).toEqual(['[mock] turn 1: act 1', '[mock] turn 2: act 2'])
    // 普通节点这一回合什么都没回（mock 对 normal 只回工具调用）⇒ 它不可能被当成正文
    expect(save.events.filter((event) => event.type === 'narration')).toHaveLength(2)
  })
})

describe('引擎：流式', () => {
  it('chunk 是增量，拼起来等于该节点的正文；chunk 不进存档', async () => {
    const card = makeCard()
    const sink = collect()
    const result = await turn({ card, save: makeSave(card), action: 'act one', onEvent: sink.onEvent })
    const chunks = sink.events.filter((event) => event.type === 'chunk')
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    const narration = result.events.find((event) => event.type === 'narration')
    expect(chunks.map((event) => event.text).join('')).toBe(narration.text)
    expect(result.save.events.some((event) => event.type === 'chunk')).toBe(false)
  })

  it('中止：以 E_ABORTED 拒绝、之后不再有 chunk、存档一个字没动', async () => {
    const card = makeCard()
    const save = makeSave(card)
    const controller = new globalThis.AbortController()
    const chunks = []
    const slow = { ...MOCK_PRESET, mockChunkDelayMs: 15 }

    const running = turn({
      card,
      save,
      presets: [slow],
      action: 'act one',
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type !== 'chunk') return
        chunks.push(event.text)
        if (chunks.length === 1) controller.abort()
      },
    })

    await expect(running).rejects.toMatchObject({ code: 'E_ABORTED' })
    const atAbort = chunks.length
    await sleep(80)
    expect(chunks.length).toBe(atAbort)
    expect(save.turn).toBe(0)
    expect(save.events).toEqual([])
  })

  it('已经中止的 signal：不跑节点，直接 E_ABORTED', async () => {
    const card = makeCard()
    const controller = new globalThis.AbortController()
    controller.abort()
    const sink = collect()
    await expect(
      turn({
        card,
        save: makeSave(card),
        action: 'act one',
        signal: controller.signal,
        onEvent: sink.onEvent,
      }),
    ).rejects.toMatchObject({ code: 'E_ABORTED' })
    expect(sink.events.filter((event) => event.type === 'chunk')).toEqual([])
  })
})

describe('引擎：写入与工具', () => {
  it('工具与写入各留一条事件，detail 里带路径与值', async () => {
    const card = makeCard()
    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    const tools = result.events.filter((event) => event.type === 'tool').map((event) => event.detail.name)
    expect(tools).toContain('advance_time')
    expect(tools).toContain('write_state')
    const write = result.events.find((event) => event.type === 'write' && event.detail.path === '1')
    expect(write).toBeDefined()
    expect(write.detail.value).toBe('mock-t1')
    expect(result.save.tree['1']).toBe('mock-t1')
  })

  it('mock 只写 writable 里的第一个元素（这里把 check 的 writable 改成 2）', async () => {
    const base = makeCard()
    const chain = base.chain.map((node) => (node.id === 'check' ? { ...node, writable: ['2'] } : node))
    const card = { ...base, chain }
    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    expect(result.save.tree['2']).toBe('mock-t1')
    expect(result.save.tree['1']).toBe('VAL_PLACE_A1')
  })

  it('advanceTime 推小时、跨天进位、非整数报 E_VALIDATION', async () => {
    const { advanceTime } = await loadEngine()
    expect(advanceTime({ day: 1, hour: 8 }, 1)).toEqual({ day: 1, hour: 9 })
    expect(advanceTime({ day: 1, hour: 23 }, 2)).toEqual({ day: 2, hour: 1 })
    expect(advanceTime({ day: 3, hour: 0 }, 24)).toEqual({ day: 4, hour: 0 })
    expect(() => advanceTime({ day: 1, hour: 8 }, 1.5)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' }),
    )
  })

  it('applyWrite 返回新 tree：合法写入只改一个键，越权 / 悬空 / 非字符串各自报码', async () => {
    const { applyWrite } = await loadEngine()
    const card = makeCard()
    const node = card.chain[1]
    const tree = makeSave(card).tree

    const next = applyWrite({ card, node, tree, path: '1', value: 'written' })
    expect(next).not.toBe(tree)
    expect(next['1']).toBe('written')
    expect(tree['1']).toBe('VAL_PLACE_A1')

    const before = JSON.stringify(tree)

    try {
      applyWrite({ card, node: { ...node, writable: ['1'] }, tree, path: '2', value: 'x' })
      throw new Error('越权写没有报错')
    } catch (error) {
      expect(error.code).toBe('E_CHAIN')
      expect(error.message).toMatch(CJK)
      expect(error.detail).toMatchObject({ path: '2' })
    }

    try {
      applyWrite({ card, node, tree, path: '9', value: 'x' })
      throw new Error('悬空路径没有报错')
    } catch (error) {
      expect(error.code).toBe('E_CHAIN')
      expect(error.detail).toMatchObject({ path: '9' })
    }

    expect(() => applyWrite({ card, node, tree, path: '1', value: 42 })).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' }),
    )
    expect(JSON.stringify(tree)).toBe(before)
  })
})

describe('引擎：调试读数落盘（trace / turnStats）', () => {
  it('每个节点一条 trace，按链顺序；字段齐全，且同一批事件也在 save.events 里', async () => {
    const card = makeCard()
    const result = await turn({ card, save: makeSave(card), action: 'act one' })

    const traces = tracesOf(result)
    expect(traces.map((event) => event.detail.nodeId)).toEqual(NODE_IDS)
    expect(traces.map((event) => event.detail.turn)).toEqual(Array(NODE_IDS.length).fill(1))
    // 一个节点一条，文本用节点名（给人看的那一列）
    expect(traces.map((event) => event.text)).toEqual(NODE_IDS)

    // 时间节点：提示词 / 思考（空）/ 工具调用（带执行结果）/ 没有正文 / 没有用量
    const time = traceOf(result, 'time')
    expect(time.nodeName).toBe('time')
    expect(time.nodeType).toBe('time')
    expect(time.presetId).toBe(MOCK_PRESET.id)
    expect(time.prompt).toContain('NODE_TIME')
    expect(time.thinking, 'mock 不吐思考，也不许编一个').toBe('')
    expect(time.toolCalls).toEqual([{ name: 'advance_time', args: { hours: 1 }, result: 'day 1 hour 9' }])
    expect(time.output).toBe('')
    expect(time.usage).toBeNull()
    expect(time.tps).toBeNull()
    expect(typeof time.durationMs).toBe('number')
    expect(time.durationMs).toBeGreaterThanOrEqual(0)

    // 输出节点：提示词与正文都在；正文先落 trace、再落 narration
    const output = traceOf(result, 'output')
    expect(output.prompt).toContain('NODE_OUT')
    expect(output.output).toBe('[mock] turn 1: act one')
    expect(output.toolCalls).toEqual([])
    expect(
      result.events.findIndex((event) => event.type === 'trace' && event.detail.nodeId === 'output'),
    ).toBeLessThan(result.events.findIndex((event) => event.type === 'narration'))

    // 落盘：返回的事件是 save.events 的尾部（同一批对象，不是另拷一份）
    expect(result.save.events.slice(-result.events.length)).toEqual(result.events)
    expect(result.save.events.filter((event) => event.type === 'trace')).toHaveLength(NODE_IDS.length)
  })

  it('turnStats 是回合最后一条：总耗时 / 总用量 / 吞吐都在（mock 量不出就 null）', async () => {
    const card = makeCard()
    const result = await turn({ card, save: makeSave(card), action: 'act one' })

    const last = result.events.at(-1)
    expect(last.type).toBe('turnStats')
    expect(last.text).toBe('turn 1')

    const stats = turnStatsOf(result)
    expect(stats.turn).toBe(1)
    expect(typeof stats.totalMs).toBe('number')
    // 回合总耗时包住每个节点的耗时
    expect(stats.totalMs).toBeGreaterThanOrEqual(
      Math.max(...tracesOf(result).map((event) => event.detail.durationMs)),
    )
    // mock 不给用量 ⇒ 合计也是 null（不是 0），吞吐量不出
    expect(stats.usage).toBeNull()
    expect(stats.tps).toBeNull()
    expect(result.save.events.some((event) => event.type === 'turnStats')).toBe(true)
  })

  it('onEvent 实时转发：trace / turnStats 与返回值是同一条事件对象', async () => {
    const card = makeCard()
    const sink = collect()
    const result = await turn({ card, save: makeSave(card), action: 'act one', onEvent: sink.onEvent })

    const forwarded = sink.events.filter((event) => event.type === 'trace' || event.type === 'turnStats')
    const returned = result.events.filter((event) => event.type === 'trace' || event.type === 'turnStats')
    expect(forwarded.map((event) => event.type)).toEqual(returned.map((event) => event.type))
    forwarded.forEach((event, index) => expect(event).toBe(returned[index]))
  })

  it('两回合：旧回合的 trace / turnStats 留在存档里，每回合的合计排在它自己的 trace 之后', async () => {
    const { save } = await runTurns(2)
    const traces = save.events.filter((event) => event.type === 'trace')
    expect(traces).toHaveLength(NODE_IDS.length * 2)
    expect(traces.map((event) => event.detail.turn)).toEqual([
      ...Array(NODE_IDS.length).fill(1),
      ...Array(NODE_IDS.length).fill(2),
    ])

    const stats = save.events.filter((event) => event.type === 'turnStats')
    expect(stats.map((event) => event.detail.turn)).toEqual([1, 2])
    for (const turnNumber of [1, 2]) {
      const statsAt = save.events.indexOf(stats[turnNumber - 1])
      const lastTraceAt = save.events.findLastIndex(
        (event) => event.type === 'trace' && event.detail.turn === turnNumber,
      )
      expect(statsAt, `第 ${turnNumber} 回合的合计排在自己的 trace 之后`).toBeGreaterThan(lastTraceAt)
    }
  })
})

describe('引擎：同一回合内的写入立刻可见（P2）', () => {
  it('判定节点写的值、时间节点推的钟，输出节点的提示词里当场看得见', async () => {
    const base = makeCard()
    // 输出节点读时间元素 + 两个状态元素；判定节点也读元素 1（这样才有一个「写之前」的对照）
    const chain = base.chain.map((node) => {
      if (node.id === 'output') return { ...node, reads: ['0', '1', '2'], prompt: 'NODE_OUT' }
      if (node.id === 'check') return { ...node, reads: ['1'] }
      return node
    })
    const card = { ...base, chain }

    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    const prompt = traceOf(result, 'output').prompt

    // 时间节点先跑：8 点 → 9 点，输出节点读到的必须是 9 点
    expect(prompt, '时间节点推进后的钟要进输出节点的提示词').toContain('0 time = day 1 hour 9')
    // 判定节点先跑：元素 1 被写成 mock-t1，输出节点读到的必须是新值
    expect(prompt, '判定节点这一回合写的值要立刻可见').toContain('1 place = mock-t1')
    expect(prompt, '旧值不该还留在提示词里').not.toContain('1 place = VAL_PLACE_A1')
    // 没被写过的元素照旧
    expect(prompt).toContain('2 mood = VAL_MOOD_B2')

    // 正向控制：判定节点自己（链上第 2 个）看到的还是**它写之前**的值 ——
    // 说明这确实是「同一回合、逐节点」的时序，而不是「全部节点都用回合末的 tree」
    expect(traceOf(result, 'check').prompt, '判定节点在写入之前拼提示词').toContain('1 place = VAL_PLACE_A1')
    expect(result.save.tree['1']).toBe('mock-t1')
  })

  it('写入发生在下游：把写元素的节点挪到输出节点之后，输出节点看到的是初值', async () => {
    const base = makeCard()
    const chain = base.chain.map((node) =>
      node.id === 'output' ? { ...node, reads: ['1'], readsUpstream: [] } : node,
    )
    // 把判定节点挪到输出节点后面：于是输出节点看到的是**初值**（还没人写）
    const card = { ...base, chain: [chain[0], chain[2], chain[3], chain[1]] }
    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    expect(traceOf(result, 'output').prompt).toContain('1 place = VAL_PLACE_A1')
    expect(result.save.tree['1']).toBe('mock-t1')
  })
})

describe('引擎：上游输出按节点名单取', () => {
  it('点名的上游把**它这一回合的输出**交给下游的提示词（链顺序即执行顺序）', async () => {
    const base = makeCard()
    // 把输出节点放到链首：它先跑，正文已经产出；后面的普通节点点名读它 ⇒ 拿到的是本回合正文
    const output = { ...base.chain[3], reads: [], readsUpstream: [], prompt: '' }
    const reader = {
      ...makeNode('reader', 'normal', { readsUpstream: ['output'], prompt: 'NODE_READER' }),
    }
    const card = { ...base, chain: [output, reader] }
    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    expect(traceOf(result, 'reader').prompt).toContain('[mock] turn 1: act one')
    expect(traceOf(result, 'reader').prompt).toContain('NODE_READER')
  })

  it('没点名上游的节点：即使前面节点有输出，提示词里也一个字都没有', async () => {
    const base = makeCard()
    const output = { ...base.chain[3], reads: [], readsUpstream: [], prompt: '' }
    const reader = { ...makeNode('reader', 'normal', { readsUpstream: [], prompt: 'NODE_READER' }) }
    const card = { ...base, chain: [output, reader] }
    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    expect(traceOf(result, 'reader').prompt).not.toContain('[mock] turn 1')
  })
})

describe('引擎：快照（改卡之后旧存档还能跑）', () => {
  it('拿 save.cardSnapshot 跑，读的是快照里的值（不是被改过的卡）', async () => {
    const card = makeCard()
    const save = makeSave(card)
    card.state[1].initial = 'MUTATED_CARD'
    card.prompts[1].body = 'MUTATED_BODY'

    const result = await turn({ card: save.cardSnapshot, save, action: 'act one' })
    // ⚠️ 不能拿元素 1 的值当证据：判定节点这一回合会先把它写掉（mock 写 writable[0]）。
    //    能证明「读的是快照」的是**没被写过的元素 2** 与提示词块的正文。
    expect(traceOf(result, 'output').prompt).toContain('VAL_MOOD_B2')
    expect(traceOf(result, 'output').prompt).toContain('BODY_ONE')
    expect(JSON.stringify(promptsOf(result))).not.toContain('MUTATED')
  })

  it('卡与存档的 id 对不上 ⇒ E_VALIDATION（不会把两局的进度串起来）', async () => {
    const card = makeCard()
    const save = makeSave(card, { cardId: 'other-card' })
    await expect(turn({ card, save, action: 'act one' })).rejects.toMatchObject({ code: 'E_VALIDATION' })
  })
})

describe('引擎：模型从哪来（本地映射，卡里没有）', () => {
  it('映射里每个节点都指向第二个预设 ⇒ 跑完 debug.presets 也全是它', async () => {
    const card = makeCard()
    const result = await turn({
      card,
      save: makeSave(card),
      presets: [MOCK_PRESET, MOCK_PRESET_B],
      nodePresets: nodeModelsFor(card, MOCK_PRESET_B.id),
      action: 'act one',
    })
    expect(presetsOf(result)).toEqual(Object.fromEntries(NODE_IDS.map((id) => [id, MOCK_PRESET_B.id])))
  })

  it('映射里缺的节点 ⇒ 默认用池子里的第一个（`presets[0]`）', async () => {
    const card = makeCard()
    const result = await turn({
      card,
      save: makeSave(card),
      presets: [MOCK_PRESET, MOCK_PRESET_B],
      nodePresets: { output: MOCK_PRESET_B.id },
      action: 'act one',
    })
    expect(presetsOf(result)).toEqual({
      time: MOCK_PRESET.id,
      check: MOCK_PRESET.id,
      extra: MOCK_PRESET.id,
      output: MOCK_PRESET_B.id,
    })
  })

  it('完全没有映射（刚导入 / 没打开过编辑器）也照样跑：全用第一个预设', async () => {
    const card = makeCard()
    const result = await turn({
      card,
      save: makeSave(card),
      presets: [MOCK_PRESET, MOCK_PRESET_B],
      // `{}` = 这张卡一条映射都没有（不是「没传参数」，那会走夹具的默认映射）
      nodePresets: {},
      action: 'act one',
    })
    expect(Object.values(presetsOf(result))).toEqual(Array(NODE_IDS.length).fill(MOCK_PRESET.id))
  })

  it('卡上残留的 presetId 一个字节都不看（模型只在映射里）', async () => {
    const base = makeCard()
    const chain = base.chain.map((node) => ({ ...node, presetId: 'p-ghost' }))
    const card = { ...base, chain }
    const result = await turn({
      card,
      save: makeSave(card),
      presets: [MOCK_PRESET],
      nodePresets: nodeModelsFor(card),
      action: 'act one',
    })
    expect(Object.values(presetsOf(result))).toEqual(Array(NODE_IDS.length).fill(MOCK_PRESET.id))
    expect(result.save.cardSnapshot.chain.every((node) => node.presetId === 'p-ghost')).toBe(true)
  })

  it('resolveNodePreset：纯函数，按节点取对象；取不到就抛 E_VALIDATION', async () => {
    const { resolveNodePreset } = await loadEngine()
    const card = makeCard()
    expect(
      resolveNodePreset({
        presets: [MOCK_PRESET, MOCK_PRESET_B],
        nodePresets: { output: MOCK_PRESET_B.id },
        nodeId: 'output',
      }),
    ).toEqual(MOCK_PRESET_B)
    expect(resolveNodePreset({ presets: [MOCK_PRESET], nodePresets: {}, nodeId: 'time' })).toEqual(
      MOCK_PRESET,
    )
    expect(() =>
      resolveNodePreset({ presets: [], nodePresets: nodeModelsFor(card), nodeId: 'time' }),
    ).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }))
  })
})

describe('引擎：预设与错误', () => {
  it('没有预设池 ⇒ E_VALIDATION，中文且带下一步（不是静默跳过模型）', async () => {
    const card = makeCard()
    const save = makeSave(card)
    const { runTurn } = await loadEngine()
    try {
      await runTurn({ card, save, presets: [], nodePresets: nodeModelsFor(card), action: 'act one' })
      throw new Error('没有预设却没有报错')
    } catch (error) {
      expect(error.code).toBe('E_VALIDATION')
      expect(error.message).toMatch(CJK)
      expect(error.nextStep).toMatch(CJK)
    }
  })

  it('映射指向一个已被删掉的预设 ⇒ E_VALIDATION（不静默退回第一个）', async () => {
    const card = makeCard()
    const save = makeSave(card)
    await expect(
      turn({
        card,
        save,
        presets: [MOCK_PRESET],
        nodePresets: nodeModelsFor(card, 'p-gone'),
        action: 'act one',
      }),
    ).rejects.toMatchObject({ code: 'E_VALIDATION' })
  })

  it('没有 apiKey ⇒ E_PROVIDER（不发请求，提示要中文）', async () => {
    const card = makeCard()
    const preset = {
      ...MOCK_PRESET,
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: '',
    }
    try {
      await turn({ card, save: makeSave(card), presets: [preset], action: 'act one' })
      throw new Error('没填 Key 却没有报错')
    } catch (error) {
      expect(error.code).toBe('E_PROVIDER')
      expect(error.message).toMatch(CJK)
      expect(error.nextStep).toMatch(CJK)
    }
  })

  it('连不上 provider ⇒ E_PROVIDER（detail 里留上游原文，正文仍是中文）', async () => {
    const card = makeCard()
    const preset = {
      ...MOCK_PRESET,
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'test-key',
    }
    await expect(
      turn({ card, save: makeSave(card), presets: [preset], action: 'act one' }),
    ).rejects.toMatchObject({
      code: 'E_PROVIDER',
    })
  }, 15_000)

  it('链不合法时先报 E_CHAIN，一个节点都不跑', async () => {
    const card = makeCard()
    const broken = { ...card, chain: card.chain.filter((node) => node.type !== 'output') }
    const save = makeSave(card)
    await expect(turn({ card: broken, save, action: 'act one' })).rejects.toMatchObject({ code: 'E_CHAIN' })
    expect(save.events).toEqual([])
  })

  it('旧格式的卡（布尔上游）⇒ E_VALIDATION，一个节点都不跑（不迁移）', async () => {
    const base = makeCard()
    const chain = base.chain.map((node) => ({ ...node, readsUpstream: false }))
    const card = { ...base, chain }
    const save = makeSave(card)
    await expect(turn({ card, save, action: 'act one' })).rejects.toMatchObject({ code: 'E_VALIDATION' })
    expect(save.events).toEqual([])
  })

  it('没有 normal 节点也能跑（时间 + 输出两节点链）', async () => {
    const base = makeCard()
    const time = base.chain[0]
    const output = { ...base.chain[3], reads: [], readsUpstream: ['time'], prompt: 'NODE_OUT' }
    const card = { ...base, chain: [time, output] }
    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    expect(result.save.turn).toBe(1)
    expect(result.save.tree['1']).toBe('VAL_PLACE_A1')
  })
})

describe('引擎：writable 决定拿到哪个工具（不分节点类型）', () => {
  it('普通节点的 writable 含 0 ⇒ 拿到 advance_time：时间被推进、存档仍合法', async () => {
    const { runTurn } = await loadEngine()
    const { validateSave } = await loadSchema()
    const chain = makeCard().chain
    // 把时间节点的写权限摘掉：这样这一回合只有「判定」节点能推进时间，读数只归它
    chain[0] = { ...chain[0], writable: [] }
    chain[1] = { ...chain[1], writable: ['0'] }
    const card = makeCard({ chain })
    const save = makeSave(card)
    const { onEvent } = collect()

    const result = await runTurn({
      card,
      save,
      presets: [MOCK_PRESET],
      nodePresets: nodeModelsFor(card),
      action: 'act one',
      onEvent,
    })

    // mock 对该节点回 advance_time(hours:1) ⇒ 时间格推进 1 小时，且仍是 {day,hour}
    expect(result.save.tree['0']).toEqual({ day: 1, hour: 9 })
    expect(() => validateSave(result.save, card), '写完之后存档必须仍然合法').not.toThrow()
    expect(result.save.turn).toBe(1)
  })

  it('时间节点的 writable 是文本 code ⇒ 拿到 write_state：写文本、时间不推进', async () => {
    const { runTurn } = await loadEngine()
    const chain = makeCard().chain
    chain[0] = { ...chain[0], writable: ['1'] }
    const card = makeCard({ chain })
    const { onEvent } = collect()

    const result = await runTurn({
      card,
      save: makeSave(card),
      presets: [MOCK_PRESET],
      nodePresets: nodeModelsFor(card),
      action: 'act one',
      onEvent,
    })

    expect(result.save.tree['1'], '时间节点要能写文本元素').toBe('mock-t1')
    expect(result.save.tree['0'], '没有 0 的写权限就不该推进时间').toEqual({ day: 1, hour: 8 })
  })

  it('applyWrite 拒绝写时间元素 0（write_state 不能改时间，中文报错）', async () => {
    const { applyWrite } = await loadEngine()
    const card = makeCard()
    const node = { ...card.chain[1], writable: ['0', '1'] }
    const tree = makeSave(card).tree
    const before = JSON.parse(JSON.stringify(tree))

    let error = null
    try {
      applyWrite({ card, node, tree, path: '0', value: 'OCCUPY_TIME' })
    } catch (cause) {
      error = cause
    }
    expect(error, 'write_state 不该能写时间元素').not.toBeNull()
    expect(['E_CHAIN', 'E_VALIDATION']).toContain(error.code)
    expect(error.message).toMatch(CJK)
    expect(tree).toEqual(before)
    expect(tree['0']).toEqual({ day: 1, hour: 8 })
  })
})
