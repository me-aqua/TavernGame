/**
 * 逐条读取判据（阶段 2 第一项：非法卡 / 非法存档在首页逐项标记）。
 *
 * 盯四件事：
 *   · **逐条读**：一条坏的不挡合法的，坏的那条自己带中文原因（`error`），顺序不变；
 *   · **按 id 取单条**：只校验目标项（旁边的坏项与它无关），目标是坏的 / 不存在就报错；
 *   · **宽松写**：`saveCardsLoose` / `saveSavesLoose` 原样保留坏项（不迁移、不丢项、不改字段）；
 *   · **整表坏掉仍然出声**：坏 JSON / 顶层不是数组 —— 这一票不改那条口径。
 *
 * 为什么现在就该红：`storage` 还没有这一组 API（第 3 关的活）。每条用例各自红一条，
 * 红的位置直接点名「哪个能力缺」，而不是整个文件在收集阶段就炸掉。
 */
import { describe, expect, it } from 'vitest'
import { fakeBackend, makeCard, makeSave, OPENING_PROMPT } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const CJK = /[\u4e00-\u9fff]/
const CODES = ['E_PROVIDER', 'E_VALIDATION', 'E_CHAIN', 'E_UNKNOWN', 'E_ABORTED']
const loadStorage = () => loadModule('core/storage.ts', () => import('../src/core/storage.ts'))

/**
 * 一张「形状像卡、但过不了 `validateCard`」的卡：缺 `opening` 提示词块（契约 §6.1 ⇒ E_VALIDATION）。
 * `extra` 是**只有坏项才有的字段** —— 宽松写那条判据靠它证明「没有顺手把字段洗掉」。
 */
function brokenCard() {
  const card = makeCard()
  return {
    ...card,
    id: 'c-bad',
    name: 'BAD_CARD',
    prompts: card.prompts.filter((prompt) => prompt.id !== OPENING_PROMPT.id),
    extra: 'KEEP_ME_VERBATIM',
  }
}

/** 一份「形状像存档、但 `tree['0']` 不是 `{day,hour}`」的存档（契约 §6.1 ⇒ E_VALIDATION） */
function brokenSave(card) {
  return {
    ...makeSave(card),
    id: 's-bad',
    name: 'BAD_SAVE',
    tree: { ...makeSave(card).tree, 0: 'day 1 hour 8' },
    extra: 'KEEP_ME_VERBATIM',
  }
}

/** 建一份后端已经种好数据的 storage（每个用例一份，别跨用例共享 Map） */
async function storageWith(seed) {
  const { createStorage } = await loadStorage()
  const backend = fakeBackend(seed)
  return { storage: createStorage(backend), backend }
}

/** 一条 error 的公共断言：是 Error、码在闭集里、正文与下一步都是中文 */
function expectChineseError(error, code) {
  expect(error).toBeInstanceOf(Error)
  expect(CODES).toContain(error.code)
  if (code) expect(error.code).toBe(code)
  expect(error.message).toMatch(CJK)
  expect(error.nextStep).toMatch(CJK)
}

describe('存储：逐条读 —— 一条坏的不挡合法的', () => {
  it('空后端：卡 / 存档都读成空表（不是 undefined）', async () => {
    const { storage, backend } = await storageWith({})
    expect(storage.loadCardEntries()).toEqual([])
    expect(storage.loadSaveEntries()).toEqual([])
    expect(backend.writes, '读盘不许写盘').toEqual([])
  })

  it('卡：一条合法 + 一条非法 ⇒ 两条都回来（顺序不变），合法项带 card、非法项带中文 error', async () => {
    const card = makeCard()
    const bad = brokenCard()
    const { storage } = await storageWith({ 'tg2.cards': JSON.stringify([card, bad]) })

    const entries = storage.loadCardEntries()
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.raw.id)).toEqual(['c1', 'c-bad'])

    expect(entries[0].card).toEqual(card)
    expect(entries[0].error).toBeUndefined()

    expect(entries[1].card).toBeUndefined()
    expectChineseError(entries[1].error, 'E_VALIDATION')
    // raw 是盘上那个元素的解析值：多出来的字段也在
    expect(entries[1].raw).toEqual(bad)
    expect(entries[1].raw.extra).toBe('KEEP_ME_VERBATIM')
  })

  it('存档：一条合法 + 一条非法 ⇒ 两条都回来，非法项带中文 error', async () => {
    const card = makeCard()
    const save = makeSave(card)
    const bad = brokenSave(card)
    const { storage } = await storageWith({ 'tg2.saves': JSON.stringify([save, bad]) })

    const entries = storage.loadSaveEntries()
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.raw.id)).toEqual(['s1', 's-bad'])
    expect(entries[0].save).toEqual(save)
    expect(entries[1].save).toBeUndefined()
    expectChineseError(entries[1].error, 'E_VALIDATION')
    expect(entries[1].raw).toEqual(bad)
  })

  it('全部合法：每条都带 card，没有一条带 error', async () => {
    const one = makeCard()
    const two = makeCard({ id: 'c2', name: 'card two' })
    const { storage } = await storageWith({ 'tg2.cards': JSON.stringify([one, two]) })

    const entries = storage.loadCardEntries()
    expect(entries.map((entry) => entry.card.id)).toEqual(['c1', 'c2'])
    expect(entries.filter((entry) => entry.error !== undefined)).toEqual([])
  })
})

describe('存储：按 id 取单条 —— 只校验目标项', () => {
  it('合法卡挨着一个坏项：loadCardById 照样返回那张卡', async () => {
    const card = makeCard()
    const { storage } = await storageWith({ 'tg2.cards': JSON.stringify([brokenCard(), card]) })
    expect(storage.loadCardById('c1')).toEqual(card)
  })

  it('loadCardById：目标是坏项 ⇒ 中文 E_VALIDATION（不许把坏卡当卡返回）', async () => {
    const { storage } = await storageWith({ 'tg2.cards': JSON.stringify([brokenCard()]) })
    try {
      storage.loadCardById('c-bad')
      throw new Error('坏卡被当合法卡返回了 —— 「按 id 只校验目标项」变成了「什么都放行」')
    } catch (error) {
      expectChineseError(error, 'E_VALIDATION')
    }
  })

  it('loadCardById：id 不存在 ⇒ 中文 E_VALIDATION（不是 undefined / null）', async () => {
    const { storage } = await storageWith({ 'tg2.cards': JSON.stringify([makeCard()]) })
    expect(() => storage.loadCardById('no-such-card')).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' }),
    )
  })

  it('空后端按 id 取卡 ⇒ 中文 E_VALIDATION', async () => {
    const { storage } = await storageWith({})
    try {
      storage.loadCardById('c1')
      throw new Error('空盘上取到了一张卡')
    } catch (error) {
      expectChineseError(error, 'E_VALIDATION')
    }
  })

  it('合法存档挨着一个坏项：loadSaveById 照样返回那份存档', async () => {
    const card = makeCard()
    const save = makeSave(card)
    const { storage } = await storageWith({ 'tg2.saves': JSON.stringify([brokenSave(card), save]) })
    expect(storage.loadSaveById('s1')).toEqual(save)
  })

  it('loadSaveById：目标是坏项 / id 不存在 ⇒ 中文 E_VALIDATION', async () => {
    const card = makeCard()
    const { storage } = await storageWith({
      'tg2.saves': JSON.stringify([brokenSave(card), makeSave(card)]),
    })
    expect(() => storage.loadSaveById('s-bad')).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' }),
    )
    expect(() => storage.loadSaveById('no-such-save')).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' }),
    )
  })
})

describe('存储：宽松写 —— 坏项原样留在盘上', () => {
  it('saveCardsLoose：合法卡 + 坏项一起写，坏项深度相等、字节逐字不变', async () => {
    const card = makeCard()
    const bad = brokenCard()
    const { storage, backend } = await storageWith({})

    storage.saveCardsLoose([card, bad])

    const written = JSON.parse(backend.getItem('tg2.cards'))
    expect(written).toEqual([card, bad])
    // 键序 / 值 / 类型都没被重写：坏项的序列化字符串与种下去的那份逐字相同
    expect(JSON.stringify(written[1])).toBe(JSON.stringify(bad))
    expect(JSON.stringify(written[1])).toContain('KEEP_ME_VERBATIM')

    const entries = storage.loadCardEntries()
    expect(entries.map((entry) => entry.card !== undefined)).toEqual([true, false])
    expectChineseError(entries[1].error, 'E_VALIDATION')
  })

  it('saveCardsLoose：只写 tg2.cards 一个键（不碰别的键、不写 tg2.*）', async () => {
    const { storage, backend } = await storageWith({})
    storage.saveCardsLoose([makeCard()])
    expect(backend.writes).toEqual(['tg2.cards'])
    expect(backend.keys().filter((key) => key.startsWith('tg.'))).toEqual([])
  })

  it('saveSavesLoose：合法存档 + 坏项一起写，坏项逐字不变', async () => {
    const card = makeCard()
    const save = makeSave(card)
    const bad = brokenSave(card)
    const { storage, backend } = await storageWith({})

    storage.saveSavesLoose([save, bad])

    const written = JSON.parse(backend.getItem('tg2.saves'))
    expect(written).toEqual([save, bad])
    expect(JSON.stringify(written[1])).toBe(JSON.stringify(bad))
    expect(backend.writes).toEqual(['tg2.saves'])
  })

  it('新建之后：坏项还在原位、字节不变；新建的那条排在末尾', async () => {
    const card = makeCard()
    const bad = brokenCard()
    const { storage } = await storageWith({})
    storage.saveCardsLoose([card, bad])

    const next = makeCard({ id: 'c2', name: 'card two' })
    storage.saveCardsLoose([...storage.loadCardEntries().map((entry) => entry.raw), next])

    const entries = storage.loadCardEntries()
    expect(entries.map((entry) => entry.raw.id)).toEqual(['c1', 'c-bad', 'c2'])
    expect(JSON.stringify(entries[1].raw)).toBe(JSON.stringify(bad))
  })

  it('宽松写之后整表读仍然出声（loadCards 的口径没被放宽）', async () => {
    const { storage } = await storageWith({})
    storage.saveCardsLoose([makeCard(), brokenCard()])
    expect(() => storage.loadCards()).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }))
  })

  it('saveCardsLoose([]) 之后逐条读是空的（删空后机制照常）', async () => {
    const { storage } = await storageWith({ 'tg2.cards': JSON.stringify([brokenCard()]) })
    storage.saveCardsLoose([])
    expect(storage.loadCardEntries()).toEqual([])
  })
})

describe('存储：整表坏掉仍然出声（这一票不改）', () => {
  it('坏 JSON / 顶层不是数组 ⇒ loadCardEntries / loadSaveEntries 抛中文 E_VALIDATION', async () => {
    for (const broken of ['{not json', JSON.stringify({ nope: true })]) {
      const { storage } = await storageWith({ 'tg2.cards': broken, 'tg2.saves': broken })
      expect(() => storage.loadCardEntries()).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }))
      expect(() => storage.loadSaveEntries()).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }))
      try {
        storage.loadCardEntries()
      } catch (error) {
        expect(error.message).toMatch(CJK)
      }
    }
  })

  it('坏 JSON 时按 id 取单条也照样抛（不许当「找不到」糊过去）', async () => {
    const { storage } = await storageWith({ 'tg2.cards': '{not json' })
    expect(() => storage.loadCardById('c1')).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }))
  })
})
