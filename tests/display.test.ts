/**
 * 显示层：把卡的「显示 / 世界 / 主控初始」读成界面数据，以及块名到组件的映射。
 *
 * 期望值全部从 cards/morningwind.json 现读（卡是唯一事实来源）—— 不在这里抄一份内容；
 * 造坏数据时值用 ASCII，键用 card-keys 的常量。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { areasOf, castOf, displayOf, packOf, spotOf } from '../src/game/display'
import { topbar, topbarItems, world, worldBlocks } from '../src/components/display-blocks'
import * as K from '../src/game/card-keys'
import type { CardData } from '../src/game/card'
import { EXAMPLE_CARD } from './support/card-fixtures'

const card = JSON.parse(readFileSync(EXAMPLE_CARD, 'utf8')) as CardData
const decl = card[K.KEY_DECL] as Record<string, any>
const display = decl[K.KEY_DISPLAY] as Record<string, any>
const worldDecl = decl[K.KEY_WORLD] as Record<string, any>
const areasDecl = worldDecl[K.KEY_AREA] as Array<Record<string, any>>
const startDecl = decl[K.KEY_OPENING][K.KEY_START] as Record<string, string>

/** 一份只改「声明.显示」的卡副本：块名 / 条目名指向的内容不动 */
function withTopbar(value: unknown): CardData {
  return { ...card, [K.KEY_DECL]: { ...decl, [K.KEY_DISPLAY]: { ...display, [K.KEY_TOPBAR]: value } } }
}

/** 造一张只够读世界 / 开局的小卡（值用 ASCII，只有键是卡格式的） */
function smallCard(over: { areas?: unknown; opening?: Record<string, string> } = {}): CardData {
  return {
    [K.KEY_DECL]: {
      [K.KEY_WORLD]: { [K.KEY_AREA]: over.areas ?? [] },
      [K.KEY_OPENING]: {
        [K.KEY_START]: over.opening ?? { [K.KEY_AREA]: 'town', [K.KEY_PLACE]: 'inn', [K.KEY_SCENE]: 'hall' },
      },
    },
  } as CardData
}

describe('displayOf', () => {
  it('reads the topbar entries and the sidebar blocks in declared order', () => {
    const read = displayOf(card)
    expect(read.topbar).toEqual(display[K.KEY_TOPBAR])
    expect(read.sidebar).toEqual(
      (display[K.KEY_SIDEBAR] as Array<Record<string, string>>).map((block) => block[K.KEY_BLOCK]),
    )
  })

  it('rejects a topbar declaration it cannot render, instead of showing a short list', () => {
    expect(() => displayOf(withTopbar(undefined))).toThrow(K.KEY_TOPBAR)
    expect(() => displayOf(withTopbar([]))).toThrow('non-empty array')
    expect(() => displayOf(withTopbar([K.ITEM_TIME, 7]))).toThrow(K.KEY_TOPBAR + '[1]')
    expect(() => displayOf(withTopbar([K.ITEM_TIME, K.ITEM_TIME]))).toThrow('duplicate')
  })
})

describe('block names', () => {
  it('resolves the blocks and topbar entries the card declares', () => {
    const read = displayOf(card)
    expect(world.map((block) => block.name)).toEqual(read.sidebar)
    expect(topbar).toEqual(topbarItems(read))
    expect(world).toHaveLength(read.sidebar.length)
  })

  it('maps names to renderers in declared order', () => {
    expect(topbarItems({ topbar: [K.ITEM_TURN, K.ITEM_TIME], sidebar: [] })).toEqual(['turn', 'time'])
    expect(worldBlocks({ topbar: [], sidebar: [K.KEY_PACK, K.BLOCK_MAP] }).map((b) => b.name)).toEqual([
      K.KEY_PACK,
      K.BLOCK_MAP,
    ])
  })

  it('rejects a block name the app has no component for', () => {
    expect(() => worldBlocks({ topbar: [], sidebar: ['nope'] })).toThrow('nope')
  })

  it('rejects a topbar name the app has no renderer for', () => {
    expect(() => topbarItems({ topbar: ['nope'], sidebar: [] })).toThrow('nope')
  })

  it('gives every block the props it needs', () => {
    const blocks = new Map(world.map((block) => [block.name, block]))
    const scene = areasDecl[0][K.KEY_NODE_NAME] + ' / ' + areasDecl[0][K.KEY_PLACES][0]
    expect(Object.keys(blocks.get(K.BLOCK_MAP)?.props(scene) ?? {})).toEqual(['areas', 'spot'])
    expect(Object.keys(blocks.get(K.BLOCK_CAST)?.props('') ?? {})).toEqual(['cast'])
    expect(Object.keys(blocks.get(K.KEY_PACK)?.props('') ?? {})).toEqual(['items'])
  })
})

describe('areasOf', () => {
  it('reads every area with its named places, in card order', () => {
    const areas = areasOf(card)
    expect(areas.map((area) => area.name)).toEqual(areasDecl.map((area) => area[K.KEY_NODE_NAME]))
    expect(areas[0].places).toEqual(areasDecl[0][K.KEY_PLACES])
  })

  it('rejects an area without a name, a places list that is not a list, and a non-text place', () => {
    const bad = (areas: unknown) => () => areasOf(smallCard({ areas }))
    expect(bad([{ [K.KEY_PLACES]: [] }])).toThrow(K.KEY_AREA + '[0].' + K.KEY_NODE_NAME)
    expect(bad([{ [K.KEY_NODE_NAME]: 'a', [K.KEY_PLACES]: 'one' }])).toThrow(K.KEY_PLACES)
    expect(bad([{ [K.KEY_NODE_NAME]: 'a', [K.KEY_PLACES]: ['one', 2] }])).toThrow(K.KEY_PLACES + '[1]')
    expect(bad(['nope'])).toThrow(K.KEY_AREA + '[0]')
  })
})

describe('castOf', () => {
  it('reads the named NPCs with the four fields the panel shows', () => {
    const cast = castOf(card)
    const declared = worldDecl[K.KEY_NAMED_NPCS] as Array<Record<string, string>>
    expect(cast.map((person) => person.name)).toEqual(declared.map((person) => person[K.KEY_NODE_NAME]))
    expect(cast[0].role).toBe(declared[0][K.KEY_IDENTITY])
    expect(cast[0].race).toBe(declared[0][K.KEY_RACE])
    expect(cast[0].bio).toBe(declared[0][K.KEY_SETTING])
  })

  it('rejects a cast list that is not a list, and a person missing a field', () => {
    const withCast = (cast: unknown): CardData =>
      ({
        [K.KEY_DECL]: { [K.KEY_WORLD]: { [K.KEY_NAMED_NPCS]: cast } },
      }) as CardData
    expect(() => castOf(withCast('nope'))).toThrow(K.KEY_NAMED_NPCS)
    expect(() => castOf(withCast(['nope']))).toThrow(K.KEY_NAMED_NPCS + '[0]')
    expect(() =>
      castOf(withCast([{ [K.KEY_NODE_NAME]: 'a', [K.KEY_IDENTITY]: 'b', [K.KEY_RACE]: 'c' }])),
    ).toThrow(K.KEY_SETTING)
  })
})

describe('packOf', () => {
  const packDecl = decl[K.KEY_STATE][K.KEY_PLAYER_START][K.KEY_CARRY][K.KEY_PACK] as Array<
    Record<string, any>
  >

  it('reads the starting pack: name / count / note, and no count stays no count', () => {
    const items = packOf(card)
    expect(items).toHaveLength(packDecl.length)
    items.forEach((item, index) => {
      expect(item.name).toBe(packDecl[index][K.KEY_NAME])
      expect(item.note).toBe(packDecl[index][K.KEY_REMARK])
      expect(item.count).toBe(packDecl[index][K.KEY_COUNT])
    })
    // 卡里「写了数量」和「没写数量」两种都有 —— 否则上面那两行等于只测了一支
    expect(packDecl.some((item) => Object.hasOwn(item, K.KEY_COUNT))).toBe(true)
    expect(packDecl.some((item) => !Object.hasOwn(item, K.KEY_COUNT))).toBe(true)
  })

  it('rejects a pack that is not a list, an item without a name, and a wrong-typed field', () => {
    /** 一张只带「背包」的卡副本 */
    const withPack = (pack: unknown): CardData =>
      ({
        [K.KEY_DECL]: {
          [K.KEY_STATE]: { [K.KEY_PLAYER_START]: { [K.KEY_CARRY]: { [K.KEY_PACK]: pack } } },
        },
      }) as CardData
    expect(() => packOf(withPack('nope'))).toThrow(K.KEY_PACK)
    expect(() => packOf(withPack([{ [K.KEY_COUNT]: 1 }]))).toThrow(K.KEY_NAME)
    expect(() => packOf(withPack([{ [K.KEY_NAME]: 'a', [K.KEY_COUNT]: 'three' }]))).toThrow(K.KEY_COUNT)
    expect(() => packOf(withPack([{ [K.KEY_NAME]: 'a', [K.KEY_REMARK]: '' }]))).toThrow(K.KEY_REMARK)
    expect(() => packOf(withPack([{ [K.KEY_NAME]: 'a', [K.KEY_REMARK]: 5 }]))).toThrow(K.KEY_REMARK)
  })
})

describe('spotOf', () => {
  it('falls back to the card opening position when the scene name names nothing', () => {
    expect(spotOf(card, '')).toEqual({ area: startDecl[K.KEY_AREA], place: startDecl[K.KEY_PLACE] })
    expect(spotOf(card, 'nowhere')).toEqual({ area: startDecl[K.KEY_AREA], place: startDecl[K.KEY_PLACE] })
  })

  it('recognises the area and place named in the runtime scene name', () => {
    const area = areasDecl[0]
    const place = area[K.KEY_PLACES][0]
    expect(spotOf(card, area[K.KEY_NODE_NAME] + ' / ' + place)).toEqual({
      area: area[K.KEY_NODE_NAME],
      place,
    })
  })

  it('knows the area when only the area is named, and prefers the longer place name', () => {
    const areas = [
      { [K.KEY_NODE_NAME]: 'town', [K.KEY_PLACES]: ['dock', 'dock-north'] },
      { [K.KEY_NODE_NAME]: 'wilds', [K.KEY_PLACES]: [] },
    ]
    expect(spotOf(smallCard({ areas }), 'somewhere in town')).toEqual({ area: 'town', place: '' })
    expect(spotOf(smallCard({ areas }), 'at the dock-north gate')).toEqual({
      area: 'town',
      place: 'dock-north',
    })
  })
})
