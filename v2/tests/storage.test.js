/**
 * 存储层判据（CONTRACT §3）。
 *
 * 盯五件事：**只写五个键**、**不种数据**、**删空之后机制照常**、**坏数据必须出声**、
 * **模型映射单独一个键**（它不进卡：卡与存档要能原样带走）。
 * 其中「坏数据必须出声」是本票的重点：坏 JSON 静默变空列表，用户看到的是「卡没了」，我们看不到任何红。
 */
import { describe, expect, it } from 'vitest'
import { fakeBackend, makeCard, makeSave, MOCK_PRESET, nodeModelsFor } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const CJK = /[\u4e00-\u9fff]/
const loadStorage = () => loadModule('core/storage.ts', () => import('../src/core/storage.ts'))

/** 建一个空后端上的 storage（每个用例一份，别跨用例共享 Map） */
async function emptyStorage() {
  const { createStorage } = await loadStorage()
  const backend = fakeBackend()
  return { storage: createStorage(backend), backend }
}

describe('存储：键与默认值', () => {
  it('五个键就是 tg2.cards / saves / presets / settings / nodeModels', async () => {
    const { STORAGE_KEYS } = await loadStorage()
    expect(STORAGE_KEYS).toEqual({
      cards: 'tg2.cards',
      saves: 'tg2.saves',
      presets: 'tg2.presets',
      settings: 'tg2.settings',
      nodeModels: 'tg2.nodeModels',
    })
  })

  it('空后端：卡 / 存档 / 预设 / 模型映射都是空的，设置是默认值（不种任何示例数据）', async () => {
    const { storage, backend } = await emptyStorage()
    expect(storage.loadCards()).toEqual([])
    expect(storage.loadSaves()).toEqual([])
    expect(storage.loadPresets()).toEqual([])
    expect(storage.loadNodeModels()).toEqual({})
    expect(storage.loadSettings()).toEqual({
      schemaVersion: 1,
      theme: 'light',
      editorColumns: { left: 280, right: 320 },
    })
    expect(backend.writes, '读一遍不许写盘').toEqual([])
    expect(backend.keys()).toEqual([])
  })

  it('读旧站键（tg.*）的事一律不做：写盘只落在 tg2.* 五个键上', async () => {
    const { storage, backend } = await emptyStorage()
    const card = makeCard()
    storage.saveCards([card])
    storage.saveSaves([makeSave(card)])
    storage.savePresets([MOCK_PRESET])
    storage.saveNodeModels({ [card.id]: nodeModelsFor(card) })
    storage.saveSettings({ schemaVersion: 1, theme: 'dark', editorColumns: { left: 300, right: 340 } })
    expect([...new Set(backend.writes)].sort()).toEqual([
      'tg2.cards',
      'tg2.nodeModels',
      'tg2.presets',
      'tg2.saves',
      'tg2.settings',
    ])
    expect(backend.keys().filter((key) => key.startsWith('tg.'))).toEqual([])
  })

  it('设置深合并：缺字段补默认，给了的字段与未知字段都留着', async () => {
    const { createStorage } = await loadStorage()
    const backend = fakeBackend({
      'tg2.settings': JSON.stringify({ theme: 'dark', editorColumns: { left: 333 } }),
    })
    const settings = createStorage(backend).loadSettings()
    expect(settings.theme).toBe('dark')
    expect(settings.editorColumns).toEqual({ left: 333, right: 320 })
    expect(settings.schemaVersion).toBe(1)
  })
})

describe('存储：往返', () => {
  it('卡 / 存档 / 预设 / 设置写进去再读回来逐字段相同', async () => {
    const { storage } = await emptyStorage()
    const card = makeCard()
    const save = makeSave(card)
    storage.saveCards([card])
    storage.saveSaves([save])
    storage.savePresets([MOCK_PRESET])
    storage.saveSettings({ schemaVersion: 1, theme: 'dark', editorColumns: { left: 260, right: 360 } })
    expect(storage.loadCards()).toEqual([card])
    expect(storage.loadSaves()).toEqual([save])
    expect(storage.loadPresets()).toEqual([MOCK_PRESET])
    expect(storage.loadSettings()).toEqual({
      schemaVersion: 1,
      theme: 'dark',
      editorColumns: { left: 260, right: 360 },
    })
  })

  it('存档快照跟着存档一起存（改动入参不影响盘上的那份）', async () => {
    const { storage } = await emptyStorage()
    const card = makeCard()
    const save = makeSave(card)
    storage.saveSaves([save])
    save.cardSnapshot.name = 'mutated later'
    expect(storage.loadSaves()[0].cardSnapshot.name).toBe('card one')
  })

  it('模型映射单独一个键：写进去读回来逐节点相同，且卡里没有它', async () => {
    const { storage } = await emptyStorage()
    const card = makeCard()
    const mapping = nodeModelsFor(card, 'p-mock-b')
    storage.saveCards([card])
    storage.saveNodeModels({ [card.id]: mapping })
    expect(storage.loadNodeModels()).toEqual({ [card.id]: mapping })
    // 卡里不许有模型绑定（§2.1 / §2.5）
    for (const node of storage.loadCards()[0].chain) {
      expect(Object.keys(node)).not.toContain('presetId')
    }
  })
})

describe('存储：删空之后机制照常', () => {
  it('把卡和存档都删光之后再新建，一切正常', async () => {
    const { storage } = await emptyStorage()
    const card = makeCard()
    storage.saveCards([card])
    storage.saveSaves([makeSave(card)])

    storage.saveCards([])
    storage.saveSaves([])
    expect(storage.loadCards()).toEqual([])
    expect(storage.loadSaves()).toEqual([])

    const next = makeCard({ id: 'c2', name: 'card two' })
    storage.saveCards([next])
    storage.saveSaves([makeSave(next, { id: 's2', cardId: 'c2' })])
    expect(storage.loadCards().map((item) => item.id)).toEqual(['c2'])
    expect(storage.loadSaves().map((item) => item.id)).toEqual(['s2'])
  })
})

describe('存储：坏数据必须出声（不许静默变空列表）', () => {
  it('坏 JSON ⇒ E_VALIDATION，中文 message 且带下一步', async () => {
    const { createStorage } = await loadStorage()
    const backend = fakeBackend({ 'tg2.cards': '{not json' })
    expect(() => createStorage(backend).loadCards()).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' }),
    )
    try {
      createStorage(backend).loadCards()
    } catch (error) {
      expect(error.message).toMatch(CJK)
      expect(error.nextStep).toMatch(CJK)
      expect(error.nextStep.length).toBeGreaterThan(0)
    }
  })

  it('schemaVersion 不认（2）⇒ E_VALIDATION，且不许把盘上的数据改掉', async () => {
    const { createStorage } = await loadStorage()
    const raw = JSON.stringify([{ schemaVersion: 2, id: 'c9', name: 'x', state: [], chain: [], prompts: [] }])
    const backend = fakeBackend({ 'tg2.cards': raw })
    const storage = createStorage(backend)
    expect(() => storage.loadCards()).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }))
    expect(backend.getItem('tg2.cards')).toBe(raw)
  })

  it('存档不是数组 / 卡缺字段 ⇒ E_VALIDATION（不是悄悄返回 [])', async () => {
    const { createStorage } = await loadStorage()
    const shape = fakeBackend({ 'tg2.saves': JSON.stringify({ nope: true }) })
    expect(() => createStorage(shape).loadSaves()).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' }),
    )

    const broken = fakeBackend({ 'tg2.cards': JSON.stringify([{ schemaVersion: 1, id: 'c1' }]) })
    expect(() => createStorage(broken).loadCards()).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' }),
    )
  })

  it('模型映射坏了（不是对象 / 值不是字符串 / 坏 JSON）⇒ E_VALIDATION，不许静默当空', async () => {
    const { createStorage } = await loadStorage()
    const brokenValues = [JSON.stringify(['nope']), JSON.stringify({ c1: { output: 42 } }), '{not json']
    for (const broken of brokenValues) {
      const backend = fakeBackend({ 'tg2.nodeModels': broken })
      expect(() => createStorage(backend).loadNodeModels()).toThrowError(
        expect.objectContaining({ code: 'E_VALIDATION' }),
      )
    }
  })
})
