/**
 * 链与结构校验判据（CONTRACT §6.1）。
 *
 * 阶段 1 的编辑器只能建出合法的四节点链，所以这一层**只能用单测钉**：
 * 「恰好一个输出」这类规则一旦松掉，界面照样能跑（跑错而已），没有别的地方看得见。
 */
import { describe, expect, it } from 'vitest'
import { freshCard, makeCard, makeNode, makeSave } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const CJK = /[\u4e00-\u9fff]/
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

/** 拿到一个必抛的校验错误（顺便断言它是 AppError 形状、带中文与下一步） */
async function rejectionOf(card) {
  const { validateCard } = await loadSchema()
  try {
    validateCard(card)
  } catch (error) {
    return error
  }
  throw new Error('validateCard 没抛错 —— 这条判据想钉的东西没被钉住')
}

describe('链校验：正向控制', () => {
  it('夹具里的两种卡都算合法（不然下面每一条红都不可信）', async () => {
    const { validateCard } = await loadSchema()
    expect(() => validateCard(makeCard())).not.toThrow()
    expect(() => validateCard(freshCard())).not.toThrow()
  })

  it('卡里多出别的字段（例如旧的 presetId）不拦：模型绑定已经不在卡里了，宽容读取', async () => {
    const { validateCard } = await loadSchema()
    const base = makeCard()
    const chain = base.chain.map((node) => ({ ...node, presetId: 'p-legacy' }))
    expect(() => validateCard({ ...base, chain })).not.toThrow()
  })
})

describe('链校验：输出的个数', () => {
  it('没有输出节点 ⇒ E_CHAIN', async () => {
    const card = makeCard({ chain: makeCard().chain.filter((node) => node.type !== 'output') })
    const error = await rejectionOf(card)
    expect(error.code).toBe('E_CHAIN')
    expect(error.message).toMatch(CJK)
    expect(error.nextStep).toMatch(CJK)
  })

  it('两个输出节点 ⇒ E_CHAIN', async () => {
    const chain = makeCard().chain
    const card = makeCard({ chain: [...chain, makeNode('output2', 'output', { readsUpstream: true })] })
    expect((await rejectionOf(card)).code).toBe('E_CHAIN')
  })

  it('空链 ⇒ E_CHAIN', async () => {
    expect((await rejectionOf(makeCard({ chain: [] }))).code).toBe('E_CHAIN')
  })
})

describe('链校验：校对与时间的上限', () => {
  it('两个校对节点 ⇒ E_CHAIN', async () => {
    const chain = makeCard().chain
    const card = makeCard({ chain: [...chain, makeNode('proof2', 'proof', { readsUpstream: true })] })
    expect((await rejectionOf(card)).code).toBe('E_CHAIN')
  })

  it('两个时间节点 ⇒ E_CHAIN', async () => {
    const chain = makeCard().chain
    const card = makeCard({ chain: [...chain, makeNode('time2', 'time')] })
    expect((await rejectionOf(card)).code).toBe('E_CHAIN')
  })

  it('首节点 readsUpstream=true ⇒ E_CHAIN', async () => {
    const chain = makeCard().chain
    chain[0] = { ...chain[0], readsUpstream: true }
    expect((await rejectionOf(makeCard({ chain }))).code).toBe('E_CHAIN')
  })
})

describe('链校验：节点自身', () => {
  it('节点 id 重复 ⇒ E_CHAIN', async () => {
    const chain = makeCard().chain
    chain[1] = { ...chain[1], id: chain[0].id }
    expect((await rejectionOf(makeCard({ chain }))).code).toBe('E_CHAIN')
  })

  it('historyTurns 是 -1 ⇒ E_CHAIN', async () => {
    const chain = makeCard().chain
    chain[2] = { ...chain[2], historyTurns: -1 }
    expect((await rejectionOf(makeCard({ chain }))).code).toBe('E_CHAIN')
  })

  it('reads 指向不存在的提示词 / 元素 ⇒ E_VALIDATION，且消息里点名那个引用', async () => {
    const chain = makeCard().chain
    chain[2] = { ...chain[2], reads: ['pr1', 'nope_pr'] }
    const error = await rejectionOf(makeCard({ chain }))
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toContain('nope_pr')
  })

  it('writable 指向不存在的元素 ⇒ E_VALIDATION', async () => {
    const chain = makeCard().chain
    chain[1] = { ...chain[1], writable: ['9'] }
    const error = await rejectionOf(makeCard({ chain }))
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toContain('9')
  })
})

describe('存档校验', () => {
  async function saveRejectionOf(save, card) {
    const { validateSave } = await loadSchema()
    try {
      validateSave(save, card)
    } catch (error) {
      return error
    }
    throw new Error('validateSave 没抛错')
  }

  it('正向控制：夹具存档合法', async () => {
    const { validateSave } = await loadSchema()
    const card = makeCard()
    expect(() => validateSave(makeSave(card), card)).not.toThrow()
  })

  it('schemaVersion 不是 1 ⇒ E_VALIDATION', async () => {
    const card = makeCard()
    const error = await saveRejectionOf(makeSave(card, { schemaVersion: 2 }), card)
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })

  it('turn 是 -1 ⇒ E_VALIDATION', async () => {
    const card = makeCard()
    expect((await saveRejectionOf(makeSave(card, { turn: -1 }), card)).code).toBe('E_VALIDATION')
  })

  it('tree 缺卡的某个 code ⇒ E_VALIDATION', async () => {
    const card = makeCard()
    const save = makeSave(card)
    delete save.tree['2']
    expect((await saveRejectionOf(save, card)).code).toBe('E_VALIDATION')
  })

  it("tree['0'] 不是 {day,hour} ⇒ E_VALIDATION", async () => {
    const card = makeCard()
    const save = makeSave(card, { tree: { ...makeSave(card).tree, 0: 'day 1 hour 8' } })
    expect((await saveRejectionOf(save, card)).code).toBe('E_VALIDATION')
  })

  it('events 不是数组 ⇒ E_VALIDATION', async () => {
    const card = makeCard()
    expect((await saveRejectionOf(makeSave(card, { events: {} }), card)).code).toBe('E_VALIDATION')
  })

  it('存档与卡的 id 对不上 ⇒ E_VALIDATION', async () => {
    const card = makeCard()
    expect((await saveRejectionOf(makeSave(card, { cardId: 'other' }), card)).code).toBe('E_VALIDATION')
  })
})
