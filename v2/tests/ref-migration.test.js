/**
 * 阶段 4 · 旧卡 / 旧存档的 item id 迁移（引用契约 §2 末两条 · 2026-11-28 口径）。
 *
 * 契约口径（逐字）：
 *   · **旧卡 / 旧存档缺 id**：加载时按每个数组当前最大编号 + 1 补齐 id；不改任何用户可见值、
 *     不拒绝旧档；保存时把补齐后的 id 落盘。
 *   · 每个数组各自编号（`2.4` 与 `1.4` 的 `id_1` 是两条不同记录），嵌套数组各自编号；
 *     已有合法 id 原样保留，缺的按「本数组当前最大编号 + 1」补。
 *
 * 这一份钉的是**加载这条路**（`core/storage.ts` 的六个读函数）：编辑器 / 游玩 / 首页拿到的
 * 都是迁移后的数据；`validateCard` / `validateSave` 本身**不放宽**（新数据仍要求 id）。
 * ⚠️ 迁移是内存里做的：盘上的旧数据要等下一次 `saveCards` / `saveSaves` 才带上 id ——
 * 这一份也钉「保存时落盘」那一条。
 */
import { describe, expect, it } from 'vitest'
import { refCard } from './support/ref-fixtures.js'
import {
  holdCard,
  holdItems,
  holdSave,
  nestedCard,
  nestedItems,
  withInitialValue,
} from './support/array-fixtures.js'
import { fakeBackend, makeCard } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const loadStorage = () => loadModule('core/storage.ts', () => import('../src/core/storage.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

const CJK = /[\u4e00-\u9fff]/
const KEYS = { cards: 'tg2.cards', saves: 'tg2.saves' }

/** 去掉一条 item 的 `id`（造「阶段 3 的旧数据」） */
function withoutId(item) {
  const next = { ...item }
  delete next.id
  return next
}

/** 一层数组值去掉 id（嵌套数组递归） */
function withoutIds(value) {
  if (!Array.isArray(value)) return value
  return value.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
    const next = {}
    for (const [key, inner] of Object.entries(item)) {
      if (key === 'id') continue
      next[key] = withoutIds(inner)
    }
    return next
  })
}

/** 一张「阶段 3」卡：骨架与 `holdCard` 相同，`2.4` 的 item 全都没有 id */
function oldCard() {
  return withInitialValue(holdCard(), '2.4', withoutIds(holdItems()))
}

/** 一份「阶段 3」存档：快照与当前树都没有 id */
function oldSave(card = oldCard()) {
  const save = holdSave(card)
  return {
    ...save,
    cardSnapshot: JSON.parse(JSON.stringify(withInitialValue(card, '2.4', withoutIds(holdItems())))),
    tree: { ...save.tree, 2.4: withoutIds(holdItems()) },
  }
}

/** 只取 item 的可见字段（去掉 id）——「不改用户可见值」的比对用 */
function visible(items) {
  return items.map((item) => {
    const next = { ...item }
    delete next.id
    return next
  })
}

/** 用内存后端造一个 storage；`data` 直接按 `tg2.*` 键塞 JSON 字符串 */
async function storageWith(data) {
  const { createStorage } = await loadStorage()
  return createStorage(fakeBackend(data))
}

/** 读一个键在盘上的 JSON（验证「保存后落盘」） */
function storedJson(backend, key) {
  const raw = backend.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

/** 一张卡里的数组值（按 code 从根的 initial 里取） */
function initialOf(card, path) {
  return card.state.find((item) => item.code === path.split('.')[0]).initial[path]
}

describe('旧卡迁移 · loadCards / loadCardById / loadCardEntries', () => {
  it('旧卡（2.4 的 item 没有 id）加载不抛，补齐 id_1…id_3，可见值一个字都不改', async () => {
    const card = oldCard()
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([card]) })
    const [loaded] = storage.loadCards()
    expect(loaded, '旧档不许被拒绝').toBeDefined()
    expect(
      initialOf(loaded, '2.4').map((item) => item.id),
      '按数组顺序补 id_1…id_3',
    ).toEqual(['id_1', 'id_2', 'id_3'])
    expect(visible(initialOf(loaded, '2.4')), '可见字段 / 顺序 / 项数都不许动').toEqual(
      holdItems().map(withoutId),
    )
  })

  it('补齐后的卡过得了 validateCard（迁移发生在加载这一步，不是校验放宽）', async () => {
    const { validateCard } = await loadSchema()
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([oldCard()]) })
    const [loaded] = storage.loadCards()
    expect(() => validateCard(loaded), '迁移后的卡应当合法').not.toThrow()
  })

  it('loadCardById / loadCardEntries 走同一条迁移（按 id 取 / 逐条读也一样）', async () => {
    const card = oldCard()
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([card]) })
    expect(initialOf(storage.loadCardById(card.id), '2.4').map((item) => item.id)).toEqual([
      'id_1',
      'id_2',
      'id_3',
    ])
    const [entry] = storage.loadCardEntries()
    expect(entry.error, '逐条读：旧卡不该带 error').toBeUndefined()
    expect(initialOf(entry.card, '2.4').map((item) => item.id)).toEqual(['id_1', 'id_2', 'id_3'])
  })

  it('已有 id 的数组原样：id_5 / id_2 保留，缺的那条补「当前最大 + 1」= id_6', async () => {
    const items = holdItems()
    const partial = [{ ...items[0], id: 'id_5' }, withoutId(items[1]), { ...items[2], id: 'id_2' }]
    const card = withInitialValue(holdCard(), '2.4', partial)
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([card]) })
    const [loaded] = storage.loadCards()
    expect(initialOf(loaded, '2.4').map((item) => item.id)).toEqual(['id_5', 'id_6', 'id_2'])
    expect(visible(initialOf(loaded, '2.4'))).toEqual(visible(partial))
  })

  it('全部 item 都已带 id 的卡：加载后逐字节等于盘上（不重排、不改名、不重编号）', async () => {
    const card = holdCard()
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([card]) })
    expect(storage.loadCards()).toEqual([card])
  })

  it('每个数组各自编号：2.4 / 1.4 / 1.5 / 2.6 都从 id_1 起；引用值一个字不动', async () => {
    const base = refCard()
    const stripped = (initial) =>
      Object.fromEntries(Object.entries(initial).map(([path, value]) => [path, withoutIds(value)]))
    const old = {
      ...base,
      state: base.state.map((item) =>
        item.code === '1' || item.code === '2' ? { ...item, initial: stripped(item.initial) } : item,
      ),
    }
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([old]) })
    const [loaded] = storage.loadCards()
    expect(
      initialOf(loaded, '2.4').map((item) => item.id),
      '2.4 从 id_1 起',
    ).toEqual(['id_1', 'id_2', 'id_3'])
    expect(
      initialOf(loaded, '1.4').map((item) => item.id),
      '另一个数组也从 id_1 起',
    ).toEqual(['id_1', 'id_2'])
    expect(initialOf(loaded, '1.5').map((item) => item.id)).toEqual(['id_1', 'id_2', 'id_3'])
    expect(initialOf(loaded, '2.6').map((item) => item.id)).toEqual(['id_1', 'id_2'])
    expect(initialOf(loaded, '2.5'), '引用值（指针）不参与迁移').toBe('id_1')
  })
  it('嵌套数组各自编号：2.4 补 id_1… 的同时，内层 2.4.2.2 也按自己的最大 + 1 补', async () => {
    const nested = nestedCard()
    const oldNested = withoutIds(nestedItems())
    const card = withInitialValue(nested, '2.4', oldNested)
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([card]) })
    const [loaded] = storage.loadCards()
    const outer = initialOf(loaded, '2.4')
    expect(outer.map((item) => item.id)).toEqual(['id_1'])
    expect(
      outer[0]['2.4.2']['2.4.2.2'].map((item) => item.id),
      '内层数组从 id_1 起',
    ).toEqual(['id_1'])
    expect(visible(outer), '可见值不动').toEqual(visible(oldNested))
  })

  it('空数组保持 []（没有 item 可补，也不许因此报错）', async () => {
    const card = withInitialValue(holdCard(), '2.4', [])
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([card]) })
    const [loaded] = storage.loadCards()
    expect(initialOf(loaded, '2.4')).toEqual([])
  })

  it('幂等：连读两次结果一样；保存后再读 id 不变（且盘上真的带上了 id）', async () => {
    const card = oldCard()
    const backend = fakeBackend({ [KEYS.cards]: JSON.stringify([card]) })
    const { createStorage } = await loadStorage()
    const storage = createStorage(backend)
    const first = storage.loadCards()
    const second = storage.loadCards()
    expect(second, '同一份旧数据读两次结果一样').toEqual(first)

    storage.saveCards(first)
    const saved = storedJson(backend, KEYS.cards)
    expect(
      saved[0].state.find((item) => item.code === '2').initial['2.4'].map((item) => item.id),
      '保存时落盘',
    ).toEqual(['id_1', 'id_2', 'id_3'])
    expect(storage.loadCards(), '落盘后再读，id 不再变').toEqual(first)
  })

  it('不碰卡里别的格子：chain / prompts / 非数组值逐字保留', async () => {
    const card = oldCard()
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([card]) })
    const [loaded] = storage.loadCards()
    expect(loaded.chain).toEqual(card.chain)
    expect(loaded.prompts).toEqual(card.prompts)
    expect(loaded.name).toBe(card.name)
    expect(initialOf(loaded, '2.1')).toBe(card.state.find((item) => item.code === '2').initial['2.1'])
    expect(initialOf(loaded, '2.3')).toBe('正常')
  })
})

describe('旧存档迁移 · loadSaves / loadSaveById / loadSaveEntries', () => {
  it('旧存档加载不抛：当前树与卡快照的数组都补 id，可见值不改', async () => {
    const save = oldSave()
    const storage = await storageWith({ [KEYS.saves]: JSON.stringify([save]) })
    const [loaded] = storage.loadSaves()
    expect(loaded, '旧存档不许被拒绝').toBeDefined()
    expect(
      loaded.tree['2.4'].map((item) => item.id),
      '当前树补 id',
    ).toEqual(['id_1', 'id_2', 'id_3'])
    const snapshotItems = loaded.cardSnapshot.state.find((item) => item.code === '2').initial['2.4']
    expect(
      snapshotItems.map((item) => item.id),
      '卡快照也补 id',
    ).toEqual(['id_1', 'id_2', 'id_3'])
    expect(visible(loaded.tree['2.4']), '当前树的可见值不动').toEqual(withoutIds(holdItems()))
  })

  it('迁移后的存档过得了 validateSave（带卡）', async () => {
    const { validateSave } = await loadSchema()
    const save = oldSave()
    const storage = await storageWith({ [KEYS.saves]: JSON.stringify([save]) })
    const [loaded] = storage.loadSaves()
    expect(() => validateSave(loaded, loaded.cardSnapshot), '迁移后的存档应当合法').not.toThrow()
  })

  it('loadSaveById / loadSaveEntries 也走同一条迁移', async () => {
    const save = oldSave()
    const storage = await storageWith({ [KEYS.saves]: JSON.stringify([save]) })
    expect(storage.loadSaveById(save.id).tree['2.4'].map((item) => item.id)).toEqual(['id_1', 'id_2', 'id_3'])
    const [entry] = storage.loadSaveEntries()
    expect(entry.error, '逐条读：旧存档不该带 error').toBeUndefined()
    expect(entry.save.tree['2.4'].map((item) => item.id)).toEqual(['id_1', 'id_2', 'id_3'])
  })

  it('快照已带 id、当前树缺 id（半迁移存档）：当前树沿用快照同位置的 id（引用不会因为迁移而悬空）', async () => {
    const card = holdCard()
    const save = {
      ...holdSave(card),
      tree: { ...holdSave(card).tree, 2.4: withoutIds(holdItems()) },
    }
    const storage = await storageWith({ [KEYS.saves]: JSON.stringify([save]) })
    const [loaded] = storage.loadSaves()
    const snapshotItems = loaded.cardSnapshot.state.find((item) => item.code === '2').initial['2.4']
    expect(
      loaded.tree['2.4'].map((item) => item.id),
      '当前树 id 与快照逐位一致',
    ).toEqual(snapshotItems.map((item) => item.id))
  })

  it('幂等 + 保存落盘：连续读两次一样；saveSaves 之后盘上的树带 id', async () => {
    const save = oldSave()
    const backend = fakeBackend({ [KEYS.saves]: JSON.stringify([save]) })
    const { createStorage } = await loadStorage()
    const storage = createStorage(backend)
    const first = storage.loadSaves()
    expect(storage.loadSaves()).toEqual(first)
    storage.saveSaves(first)
    const saved = storedJson(backend, KEYS.saves)
    expect(
      saved[0].tree['2.4'].map((item) => item.id),
      '保存时落盘',
    ).toEqual(['id_1', 'id_2', 'id_3'])
    expect(storage.loadSaves()).toEqual(first)
  })

  it('非数组的树值 / 事件流原样：迁移只碰数组 item 的 id 这一格', async () => {
    const save = oldSave()
    const storage = await storageWith({ [KEYS.saves]: JSON.stringify([save]) })
    const [loaded] = storage.loadSaves()
    expect(loaded.tree['2.1']).toBe(save.tree['2.1'])
    expect(loaded.tree['2.2']).toBe(save.tree['2.2'])
    expect(loaded.events).toEqual(save.events)
    expect(loaded.turn).toBe(save.turn)
    expect(loaded.name).toBe(save.name)
  })
})

describe('迁移不越界 · 别的卡 / 别的数据不受影响', () => {
  it('一张旧卡 + 一张新卡同盘：新的那张逐字节不变，旧的那张补 id（互不影响）', async () => {
    const fresh = makeCard()
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([oldCard(), fresh]) })
    const loaded = storage.loadCards()
    expect(loaded[1], '已带 id 的卡逐字节不变').toEqual(fresh)
    expect(initialOf(loaded[0], '2.4').map((item) => item.id)).toEqual(['id_1', 'id_2', 'id_3'])
  })

  it('迁移只在内存里：只读不写盘（loadCards 不碰后端）', async () => {
    const raw = JSON.stringify([oldCard()])
    const backend = fakeBackend({ [KEYS.cards]: raw })
    const { createStorage } = await loadStorage()
    const storage = createStorage(backend)
    storage.loadCards()
    expect(backend.getItem(KEYS.cards), '读盘不落盘（等下一次保存才带 id）').toBe(raw)
    expect(backend.writes, '读路径一次写都不许有').toEqual([])
  })

  it('坏数据仍要出声（迁移不吞错）：缺 initial / 形状坏掉的卡照旧被校验器拒', async () => {
    const broken = {
      ...oldCard(),
      state: oldCard().state.map((item) => (item.code === '2' ? { ...item, initial: undefined } : item)),
    }
    const storage = await storageWith({ [KEYS.cards]: JSON.stringify([broken]) })
    let error = null
    try {
      storage.loadCards()
    } catch (cause) {
      error = cause
    }
    expect(error, '坏卡不许被迁移悄悄修好').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)
  })
})
