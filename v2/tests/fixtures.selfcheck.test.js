/**
 * 夹具自检（**今天就该绿**）。
 *
 * 这一份不碰产品代码 —— 它量的是「别的用例红，不是因为夹具自己坏了」。
 * 判据：`v2/tests/support/fixtures.js` 造出来的东西必须满足契约 §2 的结构不变量；
 * 夹具错了，后面每一条红都不可信（红也要红得对）。
 */
import { describe, expect, it } from 'vitest'
import {
  MOCK_PRESET,
  MOCK_PRESET_B,
  collect,
  fakeBackend,
  freshCard,
  makeCard,
  makeSave,
  nodeModelsFor,
  turnEvents,
} from './support/fixtures.js'

describe('夹具自检', () => {
  it('makeCard 的链满足 SPEC §2 的四条链约束', () => {
    const chain = makeCard().chain
    expect(chain.filter((node) => node.type === 'output')).toHaveLength(1)
    expect(chain.filter((node) => node.type === 'proof').length).toBeLessThanOrEqual(1)
    expect(chain.filter((node) => node.type === 'time').length).toBeLessThanOrEqual(1)
    expect(chain[0].readsUpstream).toBe(false)
    expect(new Set(chain.map((node) => node.id)).size).toBe(chain.length)
  })

  it('makeCard / freshCard 里的引用都能解析（reads 指向存在的提示词或元素）', () => {
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

  it('freshCard 就是契约 §2.1 的默认值（固定四节点 + 只有一个时间元素）', () => {
    const card = freshCard()
    expect(card.chain.map((node) => node.id)).toEqual(['time', 'check', 'output', 'proof'])
    expect(card.chain.map((node) => node.type)).toEqual(['time', 'normal', 'output', 'proof'])
    expect(card.state.map((element) => element.code)).toEqual(['0'])
    expect(card.prompts).toEqual([])
    expect(card.chain[2].historyTurns).toBe(3)
  })

  it('makeSave 的 tree 覆盖全部 code，且与卡初值**不共享引用**', () => {
    const card = makeCard()
    const save = makeSave(card)
    expect(Object.keys(save.tree).sort()).toEqual(card.state.map((element) => element.code).sort())
    expect(save.tree['1']).toBe('VAL_PLACE_A1')
    expect(save.tree['0']).toEqual({ day: 1, hour: 8 })
    card.state[0].initial.hour = 23
    card.state[1].initial = 'MUTATED'
    expect(save.tree['0']).toEqual({ day: 1, hour: 8 })
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
    const marks = ['VAL_PLACE_A1', 'VAL_MOOD_B2', 'BODY_ONE', 'BODY_TWO', 'NODE_OUT', 'NODE_PROOF']
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
