/**
 * 夹具自检（**今天就该绿**）。
 *
 * 这一份量的是「别的用例红，不是因为夹具自己坏了」：夹具错了，后面每一条红都不可信。
 *
 * 🔴 2026-11-25 补的洞：上一版只做手写形状检查，**没调用 `validateCard`** —— 夹具已经非法
 *    （旧格式：校对节点 + 布尔上游），这一份还绿着。现在正控就是「产品校验器认它」。
 */
import { describe, expect, it } from 'vitest'
import {
  MOCK_PRESET,
  MOCK_PRESET_B,
  OPENING_PROMPT,
  collect,
  fakeBackend,
  freshCard,
  makeCard,
  makeSave,
  nodeModelsFor,
  turnEvents,
} from './support/fixtures.js'
import { loadModule } from './support/load.js'

const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

describe('夹具自检：产品校验器必须认它们', () => {
  it('makeCard / freshCard 都过得了 validateCard（正控：因为夹具过不了而产生的红不算红）', async () => {
    const { validateCard } = await loadSchema()
    expect(() => validateCard(makeCard())).not.toThrow()
    expect(() => validateCard(freshCard())).not.toThrow()
  })

  it('makeSave 过得了 validateSave（与它自己那张卡配对）', async () => {
    const { validateSave } = await loadSchema()
    const card = makeCard()
    expect(() => validateSave(makeSave(card), card)).not.toThrow()
  })
})

describe('夹具自检：链的形状是契约 §2.1 那一份', () => {
  it('makeCard 的链满足链约束（恰好 1 输出 / 至多 1 时间 / id 不重复）', () => {
    const chain = makeCard().chain
    expect(chain.filter((node) => node.type === 'output')).toHaveLength(1)
    expect(chain.filter((node) => node.type === 'time').length).toBeLessThanOrEqual(1)
    expect(new Set(chain.map((node) => node.id)).size).toBe(chain.length)
    // 上游只能是前面节点的 id：这里点名 check + extra，二者都排在 output 之前
    const output = chain.find((node) => node.id === 'output')
    expect(output.readsUpstream).toEqual(['check', 'extra'])
  })

  it('readsUpstream 是数组、只指向**前面**的节点（没有布尔、也不许指向自己）', () => {
    for (const card of [makeCard(), freshCard()]) {
      const at = new Map(card.chain.map((node, index) => [node.id, index]))
      for (const node of card.chain) {
        expect(Array.isArray(node.readsUpstream), `${card.id}/${node.id} 的 readsUpstream 不是数组`).toBe(
          true,
        )
        for (const ref of node.readsUpstream) {
          expect(at.has(ref), `${card.id}/${node.id} 读了不存在的上游 ${ref}`).toBe(true)
          expect(at.get(ref), `${card.id}/${node.id} 读了不在它前面的 ${ref}`).toBeLessThan(at.get(node.id))
        }
      }
    }
  })

  it('freshCard 就是契约的默认值（三节点 + 只有一个时间元素 + 自带开场）', () => {
    const card = freshCard()
    expect(card.chain.map((node) => node.id)).toEqual(['time', 'check', 'output'])
    expect(card.chain.map((node) => node.type)).toEqual(['time', 'normal', 'output'])
    expect(card.state.map((element) => element.code)).toEqual(['0'])
    // v5 状态元素：`0` 是 time（公历六格 + 颗粒度），不是阶段 1 的 type:'string'
    expect(card.state[0]).toMatchObject({
      type: 'time',
      granularityUpper: 'day',
      granularityLower: 'minute',
      initial: { year: 2024, month: 1, day: 1, hour: 8, minute: 5, second: 0 },
    })
    expect(card.prompts.map((prompt) => prompt.id)).toEqual([OPENING_PROMPT.id])
    expect(card.chain[2].historyTurns).toBe(3)
    expect(card.chain[2].readsUpstream).toEqual(['check'])
  })

  it('makeCard / freshCard 里的引用都能解析（reads 指向存在的提示词或元素；写权限在状态里）', () => {
    for (const card of [makeCard(), freshCard()]) {
      const ids = new Set([
        ...card.state.map((element) => element.code),
        ...card.prompts.map((prompt) => prompt.id),
      ])
      for (const node of card.chain) {
        for (const ref of node.reads)
          expect(ids.has(ref), `${card.id}/${node.id} 读了不存在的 ${ref}`).toBe(true)
      }
      const codes = new Set(card.state.map((element) => element.code))
      for (const node of card.chain) {
        for (const code of node.writable)
          expect(codes.has(code), `${node.id} 写了不存在的 ${code}`).toBe(true)
      }
    }
  })

  it('夹具里没有校对节点，也没有布尔上游（旧格式的一丝痕迹都不留）', () => {
    for (const card of [makeCard(), freshCard()]) {
      for (const node of card.chain) {
        expect(node.type, `${card.id}/${node.id} 还是旧类型`).not.toBe('proof')
        expect(typeof node.readsUpstream, `${card.id}/${node.id} 的 readsUpstream 是布尔`).not.toBe('boolean')
      }
    }
  })
})

describe('夹具自检：值', () => {
  it('makeSave 的 tree 覆盖全部 code，且与卡初值**不共享引用**', () => {
    const card = makeCard()
    const save = makeSave(card)
    expect(Object.keys(save.tree).sort()).toEqual(card.state.map((element) => element.code).sort())
    expect(save.tree['1']).toBe('VAL_PLACE_A1')
    expect(save.tree['0']).toEqual({ year: 2024, month: 1, day: 1, hour: 8, minute: 5, second: 0 })
    card.state[0].initial.hour = 23
    card.state[1].initial = 'MUTATED'
    expect(save.tree['0']).toEqual({ year: 2024, month: 1, day: 1, hour: 8, minute: 5, second: 0 })
    expect(save.tree['1']).toBe('VAL_PLACE_A1')
    expect(save.cardSnapshot.state[1].initial).toBe('VAL_PLACE_A1')
  })

  it('fakeBackend 与 localStorage 同形（空键读回 null，写入会被记下）', () => {
    const backend = fakeBackend({ 'tg2.cards': '[]' })
    expect(backend.getItem('tg2.cards')).toBe('[]')
    expect(backend.getItem('tg2.saves')).toBeNull()
    backend.setItem('tg2.saves', '{}')
    backend.removeItem('tg2.cards')
    expect(backend.keys()).toEqual(['tg2.saves'])
    expect(backend.writes).toEqual(['tg2.saves'])
  })

  it('夹具里的记号不会互相串（眼睛断言要能无歧义地找）', () => {
    const marks = [
      'VAL_PLACE_A1',
      'VAL_MOOD_B2',
      'BODY_ONE',
      'BODY_TWO',
      'NODE_OUT',
      'NODE_EXTRA',
      'UP_CHECK',
    ]
    for (const mark of marks) {
      const others = marks.filter((other) => other !== mark)
      for (const other of others) expect(mark.includes(other), `${mark} 里含 ${other}`).toBe(false)
    }
    const events = turnEvents(1, 'act one', 'NARR_ONE')
    expect(events.map((event) => event.type)).toEqual(['action', 'narration'])
  })

  it('收集器按调用顺序留事件；mock 预设是 provider:"mock"', () => {
    const sink = collect()
    sink.onEvent({ type: 'chunk', text: 'a' })
    sink.onEvent({ type: 'chunk', text: 'b' })
    expect(sink.events.map((event) => event.text)).toEqual(['a', 'b'])
    expect(MOCK_PRESET.provider).toBe('mock')
  })

  it('卡里的节点**没有** presetId（模型住在 tg2.nodeModels，§2.5）', () => {
    for (const card of [makeCard(), freshCard()]) {
      for (const node of card.chain) {
        expect(Object.keys(node), `${card.id}/${node.id} 带着模型绑定`).not.toContain('presetId')
      }
    }
  })

  it('nodeModelsFor 覆盖全部节点，且两个 mock 预设的 id 不撞', () => {
    const card = makeCard()
    const mapping = nodeModelsFor(card, MOCK_PRESET_B.id)
    expect(Object.keys(mapping).sort()).toEqual(card.chain.map((node) => node.id).sort())
    expect(Object.values(mapping)).toEqual(Array(card.chain.length).fill(MOCK_PRESET_B.id))
    expect(MOCK_PRESET.id).not.toBe(MOCK_PRESET_B.id)
  })
})
