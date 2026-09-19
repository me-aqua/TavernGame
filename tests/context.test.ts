/**
 * 节点上下文的结构约束：reads（看得见哪几块状态）与 uses（读哪几条生成器）。
 *
 * 卡里「只有精神分析读得到玩家画像」「只有地图与大纲拿生成器」这两句话，
 * 在这里是**结构约束**：引擎按节点声明裁剪，不是提示词里的请求。
 */
import { describe, expect, it } from 'vitest'
import { buildNodeMessages } from '../src/agent/prompts'
import { renderState } from '../src/game/card-state'
import { format } from '../src/game/card-calendar'
import { createInitialState } from '../src/game/save'
import { advanceTime } from '../src/game/state'
import { currentCard } from '../src/game/current-card'
import { t } from '../src/i18n'
import { loadCard, NIGHT_WATCH_CARD } from './support/card-fixtures'
import type { CardData } from '../src/game/card'
import type { GameData } from '../src/types/state'

const card = currentCard
const topology = card.graph.topology
const PLAYER_WORDS = "the player's action"

function messagesFor(node: string, data: GameData = createInitialState(card), source: CardData = card) {
  return buildNodeMessages({
    card: source,
    node,
    state: data.state,
    time: data.time,
    events: data.events,
    memoryUpTo: data.events.length,
    playerWords: PLAYER_WORDS,
    upstream: [],
  })
}

function userOf(node: string, data: GameData = createInitialState(card), source: CardData = card): string {
  return messagesFor(node, data, source).at(-1)?.content as string
}

function systemOf(node: string, source: CardData = card): string {
  return messagesFor(node, createInitialState(source), source)[0].content
}

describe('reads - a node only sees the branches it declares', () => {
  it('the state text is exactly renderState(state, { reads })', () => {
    const data = createInitialState(card)
    for (const id of topology) {
      const reads = card.graph.nodes[id].reads
      expect(userOf(id, data), id).toContain(renderState(data.state, { reads }))
    }
  })

  it('exactly one node reads the player profile, and the others do not see it', () => {
    const readers = topology.filter((id) => (card.graph.nodes[id].reads ?? []).includes('player'))
    expect(readers).toHaveLength(1)

    const data = createInitialState(card)
    // ⚠️ 玩家画像那一栏的键名从卡里现取（段 3 之后是中文的「画像」，测试代码里写不了中文字面量）
    const [profileField] = Object.keys((card.state.player as { fields: Record<string, unknown> }).fields)
    const profile = (data.state.player as Record<string, unknown>)[profileField] as string
    expect(profile.length).toBeGreaterThan(0)

    const user = userOf(readers[0], data)
    expect(user).toContain('player:')
    expect(user).toContain(profile)

    for (const other of topology.filter((id) => id !== readers[0])) {
      expect(userOf(other, data), other).not.toContain(profile)
      expect(userOf(other, data), other).not.toContain('player:')
    }
  })

  it('a node that declares no reads sees every branch', () => {
    const source = loadCard(NIGHT_WATCH_CARD)
    const data = createInitialState(source)
    // 这张卡的两个节点都没写 reads（不写 = 全部）
    for (const id of source.graph.topology) {
      expect(source.graph.nodes[id].reads).toBeUndefined()
      expect(userOf(id, data, source)).toContain(renderState(data.state))
    }
  })
})

describe('uses - generators go only to the nodes that name them', () => {
  it('a node sees exactly the generators it declares', () => {
    for (const id of topology) {
      const uses = card.graph.nodes[id].uses ?? []
      const system = systemOf(id)
      for (const generator of card.generators) {
        if (uses.includes(generator.name)) {
          expect(system, id + ' must carry ' + generator.name).toContain(generator.name)
          expect(system).toContain(generator.principles[0])
        } else {
          expect(system, id + ' must not carry ' + generator.name).not.toContain(generator.name)
        }
      }
    }
  })

  it('a card whose nodes name no generators never gets one', () => {
    const source = loadCard(NIGHT_WATCH_CARD)
    expect(source.generators.length).toBeGreaterThan(0)
    for (const id of source.graph.topology) {
      expect(systemOf(id, source)).not.toContain(source.generators[0].name)
    }
  })
})

describe('the snapshot is rendered per request (tools move the clock)', () => {
  it('a node asked after the time advance sees the new moment', () => {
    const data = createInitialState(card)
    const story = topology.find((id) => card.graph.nodes[id].role === 'story') as string

    const before = userOf(story, data)
    advanceTime(data, card.time.calendar, 480, 'waited')
    const after = userOf(story, data)

    expect(after).not.toBe(before)
    expect(after).toContain(t('prompts.timeLine', { time: format(card.time.calendar, data.time) }))
    expect(before).not.toContain(t('prompts.timeLine', { time: format(card.time.calendar, data.time) }))
  })
})
