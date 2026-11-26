/**
 * 链与结构校验判据（CONTRACT §6.1）。
 *
 * 阶段 1 的编辑器只能建出合法的三节点链，所以这一层**只能用单测钉**：
 * 「恰好一个输出」这类规则一旦松掉，界面照样能跑（跑错而已），没有别的地方看得见。
 *
 * 🔴 本票的重点是**旧数据不迁移**（老板 2026-11-25）：带校对节点 / 布尔上游 / 缺开场的卡
 *    一律在 `validateCard` 就报**中文 `E_VALIDATION`**，没有 `normalizeCard`、也没有任何自动补齐。
 *    这几条判据不是「兼容性测试」，是**拒绝**的判据。
 */
import { describe, expect, it } from 'vitest'
import { freshCard, makeCard, makeNode, makeSave, OPENING_PROMPT } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const CJK = /[\u4e00-\u9fff]/
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
const loadCards = () => loadModule('src/cards.ts', () => import('../src/cards.ts'))

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

/** 拿一张旧格式的卡（校对节点 + 布尔上游 + 缺开场），用来钉「不迁移」 */
function legacyCard() {
  const base = makeCard()
  const chain = base.chain.map((node) => ({
    ...node,
    // 旧字段：布尔上游
    readsUpstream: node.id === 'output' ? true : false,
  }))
  return {
    ...base,
    prompts: base.prompts.filter((prompt) => prompt.id !== OPENING_PROMPT.id),
    chain: [...chain, makeNode('proof', 'proof', { prompt: 'NODE_PROOF' })],
  }
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

describe('链校验：旧格式不迁移（这是拒绝的判据，不是兼容）', () => {
  it('带校对节点（type:"proof"）⇒ 中文 E_VALIDATION', async () => {
    const card = makeCard({ chain: [...makeCard().chain, makeNode('proof', 'proof')] })
    const error = await rejectionOf(card)
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(error.nextStep).toMatch(CJK)
  })

  it('readsUpstream 是布尔（旧字段）⇒ 中文 E_VALIDATION（不是 E_CHAIN）', async () => {
    const chain = makeCard().chain
    chain[3] = { ...chain[3], readsUpstream: true }
    const error = await rejectionOf(makeCard({ chain }))
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })

  it('节点缺 readsUpstream 字段 ⇒ 中文 E_VALIDATION（新字段是必填的）', async () => {
    const chain = makeCard().chain.map((node) => {
      const copy = { ...node }
      delete copy.readsUpstream
      return copy
    })
    const error = await rejectionOf(makeCard({ chain }))
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })

  it('缺 opening 提示词块 ⇒ 中文 E_VALIDATION，detail 点名这一块', async () => {
    const card = makeCard({ prompts: makeCard().prompts.filter((p) => p.id !== OPENING_PROMPT.id) })
    const error = await rejectionOf(card)
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
    expect(error.nextStep).toMatch(CJK)
    expect(JSON.stringify(error.detail)).toContain(OPENING_PROMPT.id)
  })

  it('整张旧卡（校对 + 布尔上游 + 缺开场）⇒ 中文 E_VALIDATION，一个节点都不跑', async () => {
    const error = await rejectionOf(legacyCard())
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })

  it('没有 normalizeCard 这一号迁移口：cards.ts 不导出它', async () => {
    const cards = await loadCards()
    expect(Object.keys(cards)).not.toContain('normalizeCard')
    expect('normalizeCard' in cards).toBe(false)
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
    const card = makeCard({ chain: [...chain, makeNode('output2', 'output')] })
    expect((await rejectionOf(card)).code).toBe('E_CHAIN')
  })

  it('空链 ⇒ E_CHAIN', async () => {
    expect((await rejectionOf(makeCard({ chain: [] }))).code).toBe('E_CHAIN')
  })
})

describe('链校验：时间的上限', () => {
  it('两个时间节点 ⇒ E_CHAIN', async () => {
    const chain = makeCard().chain
    const card = makeCard({ chain: [...chain, makeNode('time2', 'time', { writable: ['0'] })] })
    expect((await rejectionOf(card)).code).toBe('E_CHAIN')
  })
})

describe('链校验：上游只能是前面的节点', () => {
  it('首节点的 readsUpstream 非空 ⇒ E_CHAIN', async () => {
    const chain = makeCard().chain
    chain[0] = { ...chain[0], readsUpstream: ['check'] }
    expect((await rejectionOf(makeCard({ chain }))).code).toBe('E_CHAIN')
  })

  it('指向自己 ⇒ E_CHAIN，消息里点名节点与引用', async () => {
    const chain = makeCard().chain
    chain[1] = { ...chain[1], readsUpstream: ['check'] }
    const error = await rejectionOf(makeCard({ chain }))
    expect(error.code).toBe('E_CHAIN')
    expect(error.message).toContain('check')
  })

  it('指向下游节点 ⇒ E_CHAIN（下游还没跑，不能当上游）', async () => {
    const chain = makeCard().chain
    chain[1] = { ...chain[1], readsUpstream: ['output'] }
    expect((await rejectionOf(makeCard({ chain }))).code).toBe('E_CHAIN')
  })

  it('指向链上不存在的 id ⇒ E_CHAIN', async () => {
    const chain = makeCard().chain
    chain[3] = { ...chain[3], readsUpstream: ['nope_node'] }
    const error = await rejectionOf(makeCard({ chain }))
    expect(error.code).toBe('E_CHAIN')
    expect(error.message).toContain('nope_node')
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
    chain[3] = { ...chain[3], historyTurns: -1 }
    expect((await rejectionOf(makeCard({ chain }))).code).toBe('E_CHAIN')
  })

  it('reads 指向不存在的提示词 / 元素 ⇒ E_VALIDATION，且消息里点名那个引用', async () => {
    const chain = makeCard().chain
    chain[3] = { ...chain[3], reads: ['pr1', 'nope_pr'] }
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

describe('链校验：写权限不按节点类型收窄（工具由 writable 决定）', () => {
  it('时间节点也可以声明写普通元素（拿到 write_state）', async () => {
    const { validateCard } = await loadSchema()
    const chain = makeCard().chain
    chain[0] = { ...chain[0], writable: ['0', '1'] }
    expect(() => validateCard(makeCard({ chain }))).not.toThrow()
  })

  it('输出节点带任何 writable ⇒ E_CHAIN（输出节点什么也不写）', async () => {
    const chain = makeCard().chain
    chain[3] = { ...chain[3], writable: ['1'] }
    expect((await rejectionOf(makeCard({ chain }))).code).toBe('E_CHAIN')
  })

  it('输出节点带时间元素 0 也不行 ⇒ E_CHAIN（例外：输出节点的 writable 恒为空）', async () => {
    const chain = makeCard().chain
    chain[3] = { ...chain[3], writable: ['0'] }
    expect((await rejectionOf(makeCard({ chain }))).code).toBe('E_CHAIN')
  })

  it('普通节点声明写时间元素 0 合法（拿到 advance_time）', async () => {
    const { validateCard } = await loadSchema()
    const chain = makeCard().chain
    chain[1] = { ...chain[1], writable: ['0', '1'] }
    expect(() => validateCard(makeCard({ chain }))).not.toThrow()
  })

  it('正向控制：普通节点可以写多个**非时间**元素', async () => {
    const { validateCard } = await loadSchema()
    const chain = makeCard().chain
    chain[1] = { ...chain[1], writable: ['1', '2'] }
    expect(() => validateCard(makeCard({ chain }))).not.toThrow()
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

  it("tree['0'] 还是旧的 {day,hour}（v5 要求公历六格）⇒ E_VALIDATION", async () => {
    const card = makeCard()
    const save = makeSave(card, { tree: { ...makeSave(card).tree, 0: { day: 1, hour: 9 } } })
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
