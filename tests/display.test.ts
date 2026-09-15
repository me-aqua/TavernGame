/**
 * display 测试 —— 卡声明的显示（顶栏条目 / 侧栏块）与界面要的面板数据。
 *
 * 两条纪律：
 *   · 词汇表只有一份（game/card.ts），这里只 re-export，不写第二份；
 *   · 面板数据读**状态树**，不读卡里的预设（面板画不出来不等于整页打不开）。
 */
import { describe, expect, it } from 'vitest'
import {
  castOf,
  checkRenderable,
  displayOf,
  KNOWN_BLOCKS,
  KNOWN_TOPBAR,
  mapOf,
  nodeLabel,
  packOf,
  spotOf,
} from '../src/game/display'
import { SIDEBAR_BLOCKS, TOPBAR_ITEMS } from '../src/game/card'
import { createInitialState } from '../src/game/save'
import { currentCard } from '../src/game/current-card'
import { loadCard, NIGHT_WATCH_CARD } from './support/card-fixtures'
import type { StateTree } from '../src/game/card-state'

/** 一张卡的初始状态树 */
function treeOf(card = currentCard): StateTree {
  return createInitialState(card).state
}

describe('the vocabulary lives in card.ts', () => {
  it('re-exports the engine word list instead of keeping a second copy', () => {
    expect(KNOWN_TOPBAR).toBe(TOPBAR_ITEMS)
    expect(KNOWN_BLOCKS).toBe(SIDEBAR_BLOCKS)
  })
})

describe('displayOf', () => {
  it('reads the declared order out of the card', () => {
    const decl = displayOf(currentCard)
    expect(decl.topbar).toEqual(currentCard.display.topbar)
    expect(decl.sidebar).toEqual(currentCard.display.sidebar.map((block) => block.block))
  })

  it('works for a card that declares only one block', () => {
    const card = loadCard(NIGHT_WATCH_CARD)
    expect(displayOf(card).sidebar).toEqual(card.display.sidebar.map((block) => block.block))
  })

  it('returns copies (callers cannot mutate the card)', () => {
    const decl = displayOf(currentCard)
    decl.topbar.push('nonsense')
    expect(currentCard.display.topbar).not.toContain('nonsense')
  })
})

describe('checkRenderable', () => {
  it('accepts the vocabulary this build can draw', () => {
    expect(() => checkRenderable({ topbar: [...KNOWN_TOPBAR], sidebar: [...KNOWN_BLOCKS] })).not.toThrow()
  })

  it('rejects a block no component draws', () => {
    expect(() => checkRenderable({ topbar: ['time'], sidebar: ['weather'] })).toThrow('weather')
  })

  it('rejects a topbar entry no component draws', () => {
    expect(() => checkRenderable({ topbar: ['weather'], sidebar: [] })).toThrow('weather')
  })
})

describe('nodeLabel', () => {
  it('reads the display name the card gave the node', () => {
    const id = currentCard.graph.topology[0]
    expect(nodeLabel(currentCard, id)).toBe(currentCard.graph.nodes[id].name)
  })

  it('throws for a node the card does not have (no silent fallback to the id)', () => {
    expect(() => nodeLabel(currentCard, 'no-such-node')).toThrow('no-such-node')
  })
})

describe('panel data reads the state tree', () => {
  it('map reads world.map and world.location', () => {
    const state = treeOf()
    const world = state.world as Record<string, unknown>
    expect(mapOf(state)).toEqual({ areas: world.map, location: world.location })
  })

  it('cast reads roles and pack reads lead.pack', () => {
    const state = treeOf()
    expect(castOf(state)).toBe(state.roles)
    expect(packOf(state)).toBe((state.lead as Record<string, unknown>).pack)
  })

  it('follows the state as tools write it (not a frozen card preset)', () => {
    const state = treeOf()
    const world = state.world as Record<string, unknown>
    world.location = { area: 'somewhere', spot: 'a spot', scene: 'a scene' }
    expect(spotOf(state)).toEqual({ area: 'somewhere', spot: 'a spot', scene: 'a scene' })
    expect(mapOf(state).location).toEqual({ area: 'somewhere', spot: 'a spot', scene: 'a scene' })
  })

  it('a card without those branches gives empty values, not a crash', () => {
    const state = treeOf(loadCard(NIGHT_WATCH_CARD))
    expect(mapOf(state)).toEqual({ areas: undefined, location: undefined })
    expect(castOf(state)).toBeUndefined()
    expect(spotOf(state)).toEqual({ area: '', spot: '', scene: '' })
    // 背包这一段这张卡有：面板照样画得出来
    expect(packOf(state)).toBe((state.lead as Record<string, unknown>).pack)
  })
})
