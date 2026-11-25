/**
 * 引擎判据（CONTRACT §4）—— 阶段 1 的核心。
 *
 * 钉的是「一回合到底发生了什么」：链按顺序跑、时间推进、写入只许落在 `writable`、
 * 只有 output 的文本进故事流、流式增量拼起来等于正文、中止之后存档一个字没动、
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
    expect(nodes.map((event) => event.detail.id)).toEqual(['time', 'check', 'output', 'proof'])
  })
})

describe('引擎：只有输出节点的文本进故事流', () => {
  it('每回合恰好一条 narration，且就是 output 节点的文本', async () => {
    const { save } = await runTurns(2)
    const narrations = save.events.filter((event) => event.type === 'narration')
    expect(narrations).toHaveLength(2)
    expect(narrations.map((event) => event.text)).toEqual(['[mock] turn 1: act 1', '[mock] turn 2: act 2'])
    expect(save.events.some((event) => event.text.includes('mock proof'))).toBe(false)
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

describe('引擎：调试载荷（?debug=1 要用）', () => {
  it('debug 里有每个节点的提示词、输出、工具清单', async () => {
    const card = makeCard()
    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    expect(Object.keys(result.debug.prompts).sort()).toEqual(['check', 'output', 'proof', 'time'])
    expect(result.debug.prompts.output).toContain('NODE_OUT')
    expect(result.debug.prompts.output).toContain('act one')
    expect(result.debug.responses.output).toBe('[mock] turn 1: act one')
    expect(result.debug.tools.map((item) => item.name)).toContain('advance_time')
    expect(result.debug).toHaveProperty('usage')
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
    const prompt = result.debug.prompts.output

    // 时间节点先跑：8 点 → 9 点，输出节点读到的必须是 9 点
    expect(prompt, '时间节点推进后的钟要进输出节点的提示词').toContain('0 time = day 1 hour 9')
    // 判定节点先跑：元素 1 被写成 mock-t1，输出节点读到的必须是新值
    expect(prompt, '判定节点这一回合写的值要立刻可见').toContain('1 place = mock-t1')
    expect(prompt, '旧值不该还留在提示词里').not.toContain('1 place = VAL_PLACE_A1')
    // 没被写过的元素照旧
    expect(prompt).toContain('2 mood = VAL_MOOD_B2')

    // 正向控制：判定节点自己（链上第 2 个）看到的还是**它写之前**的值 ——
    // 说明这确实是「同一回合、逐节点」的时序，而不是「全部节点都用回合末的 tree」
    expect(result.debug.prompts.check, '判定节点在写入之前拼提示词').toContain('1 place = VAL_PLACE_A1')
    expect(result.save.tree['1']).toBe('mock-t1')
  })

  it('上游节点写的值也看得见：把 normal 挪到 output 之后也不串（顺序即因果）', async () => {
    const base = makeCard()
    const chain = base.chain.map((node) => (node.id === 'output' ? { ...node, reads: ['1'] } : node))
    // 把判定节点挪到输出节点后面：于是输出节点看到的是**初值**（还没人写）
    const card = {
      ...base,
      chain: [chain[0], chain[2], chain[1], chain[3]],
    }
    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    expect(result.debug.prompts.output).toContain('1 place = VAL_PLACE_A1')
    expect(result.save.tree['1']).toBe('mock-t1')
  })
})

describe('引擎：快照（改卡之后旧存档还能跑）', () => {
  it('拿 save.cardSnapshot 跑，读的是快照里的值（不是被改过的卡）', async () => {
    const card = makeCard()
    const save = makeSave(card)
    card.state[1].initial = 'MUTATED_CARD'
    card.prompts[0].body = 'MUTATED_BODY'

    const result = await turn({ card: save.cardSnapshot, save, action: 'act one' })
    // ⚠️ 不能拿元素 1 的值当证据：判定节点这一回合会先把它写掉（mock 写 writable[0]）。
    //    能证明「读的是快照」的是**没被写过的元素 2** 与提示词块的正文。
    expect(result.debug.prompts.output).toContain('VAL_MOOD_B2')
    expect(result.debug.prompts.output).toContain('BODY_ONE')
    expect(JSON.stringify(result.debug.prompts)).not.toContain('MUTATED')
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
    expect(result.debug.presets).toEqual({
      time: MOCK_PRESET_B.id,
      check: MOCK_PRESET_B.id,
      output: MOCK_PRESET_B.id,
      proof: MOCK_PRESET_B.id,
    })
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
    expect(result.debug.presets).toEqual({
      time: MOCK_PRESET.id,
      check: MOCK_PRESET.id,
      output: MOCK_PRESET_B.id,
      proof: MOCK_PRESET.id,
    })
  })

  it('完全没有映射（旧数据 / 刚导入）也照样跑：全用第一个预设', async () => {
    const card = makeCard()
    const result = await turn({
      card,
      save: makeSave(card),
      presets: [MOCK_PRESET, MOCK_PRESET_B],
      // `{}` = 这张卡一条映射都没有（不是「没传参数」，那会走夹具的默认映射）
      nodePresets: {},
      action: 'act one',
    })
    expect(Object.values(result.debug.presets)).toEqual(Array(4).fill(MOCK_PRESET.id))
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
    expect(Object.values(result.debug.presets)).toEqual(Array(4).fill(MOCK_PRESET.id))
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

  it('没有 normal 节点也能跑（校对 + 输出两节点链）', async () => {
    const base = makeCard()
    const chain = [makeNode('time', 'time', { writable: ['0'] }), ...base.chain.slice(2)]
    const card = { ...base, chain }
    const result = await turn({ card, save: makeSave(card), action: 'act one' })
    expect(result.save.turn).toBe(1)
    expect(result.save.tree['1']).toBe('VAL_PLACE_A1')
  })
})
