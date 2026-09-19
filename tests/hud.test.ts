/**
 * HUD 数据投影的纯逻辑测试：主角牌 / 人物牌 / 故事链 / 行动牌都只认状态树的形状，
 * 不写死晨风镇的内容。
 */
import { describe, expect, it } from 'vitest'
import { actionOptions, peopleHud, questsHud, selfHud } from '../src/components/hud'
import { ITEM_NAME, scalarText } from '../src/components/state-view'
import { displayOf, hudData, type HudData } from '../src/game/display'
import { createInitialState } from '../src/game/save'
import { currentCard } from '../src/game/current-card'

const state = createInitialState(currentCard).state
const data: HudData = hudData(displayOf(currentCard), state)
const lead = state.lead as Record<string, any>
const world = state.world as Record<string, any>

describe('selfHud', () => {
  it('reads the protagonist name, numeric stats and short condition badges', () => {
    const hud = selfHud(state.lead)

    expect(hud.name).toBe(scalarText(lead[ITEM_NAME]))
    const strength = hud.stats.find((stat) => stat.key.endsWith('.strength'))
    expect(strength?.value).toBe(String(lead.traits.strength))
    expect(strength?.ratio).toBeGreaterThan(0)
    expect(hud.stats.length).toBeGreaterThanOrEqual(4)

    expect(hud.badges.some((badge) => badge.value === lead.now.mood)).toBe(true)
    expect(hud.badges.some((badge) => badge.value === lead.traits.race)).toBe(true)
    // 长生平/性格不进 HUD，那是手札里读的
    expect(hud.badges.some((badge) => badge.value === lead.traits.personality)).toBe(false)
  })

  it('splits lists into relations and pack, and sums stack counts', () => {
    const hud = selfHud(state.lead)

    expect(hud.pack).toHaveLength(lead.pack.length)
    expect(hud.pack.some((item) => item.includes(String(lead.pack[0].name)))).toBe(true)
    expect(hud.packCount).toBeGreaterThan(lead.pack.length)
    expect(hud.relations).toHaveLength(lead.relations.length)
  })

  it('treats a list of people-shaped objects as relations', () => {
    const hud = selfHud({
      name: 'A',
      relations: [{ who: 'B', kind: 'friend', story: 'met at the inn' }],
    })

    expect(hud.relations[0]).toEqual({ name: 'B', detail: 'friend \u00b7 met at the inn' })
    expect(hud.pack).toHaveLength(0)
  })

  it('returns an empty card for a missing or malformed lead', () => {
    expect(selfHud(null)).toEqual({ name: '', stats: [], badges: [], relations: [], pack: [], packCount: 0 })
    expect(selfHud(['not', 'a', 'person']).name).toBe('')
  })
})

describe('peopleHud', () => {
  it('reads names, notes, tags and where the known people are', () => {
    const here = {
      area: '\u6668\u98ce\u9547',
      spot: '\u9189\u732b\u65c5\u5e97',
      scene: '\u65c5\u5e97\u5927\u5802',
    }
    const hud = peopleHud(state.roles, world.whoIsWhere, here)
    const name = Object.keys(state.roles as Record<string, unknown>)[0]

    const person = hud.find((entry) => entry.name === name)
    expect(person?.note).toBeTruthy()
    expect(person?.tags.length).toBeGreaterThan(0)
    expect(person?.where).toContain('\u6668\u98ce\u9547')
    expect(person?.present).toBe(false)
  })

  it('marks someone whose recorded place is the current spot as present', () => {
    const hud = peopleHud(
      { Salen: { role: 'smith', note: 'red hair' } },
      { Salen: 'Town \u00b7 Inn' },
      { area: 'Town', spot: 'Inn', scene: 'Common room' },
    )

    expect(hud[0].present).toBe(true)
    expect(hud[0].tags).toContain('smith')
    expect(hud[0].note).toBe('red hair')
  })

  it('stays empty when the card declares no roles', () => {
    expect(peopleHud({}, {}, { area: '', spot: '', scene: '' })).toEqual([])
  })
})

describe('questsHud', () => {
  it('stays empty for a card without story chains', () => {
    expect(questsHud({})).toEqual([])
    expect(questsHud(null)).toEqual([])
  })

  it('reads a subtitle, numeric progress, stages and revealed clues by shape', () => {
    const hud = questsHud({
      Docks: {
        bound: 'Town',
        surface: 'Three ships came back empty.',
        stage: 2,
        stages: ['one', 'two', 'three', 'four'],
        revealed: ['a wet boot'],
        ending: '',
      },
    })

    expect(hud).toEqual([
      {
        name: 'Docks',
        subtitle: 'Three ships came back empty.',
        stage: 2,
        total: 4,
        stageName: 'two',
        revealed: ['a wet boot'],
      },
    ])
  })
})

describe('actionOptions', () => {
  it('offers full-name people, non-current places, pack items and verbs', () => {
    const options = actionOptions(data)
    const personName = Object.keys(state.roles as Record<string, unknown>)[0]
    const itemName = lead.pack[0].name

    expect(options.find((item) => item.kind === 'person')?.labelArgs.name).toBe(personName)
    expect(options.find((item) => item.kind === 'item')?.labelArgs.item).toBe(String(itemName))
    expect(options.some((item) => item.kind === 'verb' && item.labelKey === 'hud.actionLook')).toBe(true)

    const here = data.location
    for (const place of options.filter((item) => item.kind === 'place')) {
      expect(place.labelArgs.place).not.toBe(here.spot)
      expect(place.labelArgs.place).not.toBe(here.scene)
    }
    expect(options.length).toBeLessThanOrEqual(6)
  })

  it('falls back to verbs when the card has no places, people or pack', () => {
    const empty: HudData = {
      lead: { name: 'A' },
      cast: {},
      where: {},
      chains: {},
      map: {},
      location: { area: 'Nowhere', spot: 'Here', scene: 'Room' },
      pack: undefined,
    }

    const options = actionOptions(empty)
    expect(options.length).toBeGreaterThan(0)
    expect(options.every((item) => item.kind === 'verb')).toBe(true)
  })
})
