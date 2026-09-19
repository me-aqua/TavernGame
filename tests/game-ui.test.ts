// @vitest-environment jsdom
/**
 * 游戏舞台组件的契约：HUD 显示什么、行动牌 emit 哪句话、历史按钮打开哪一层。
 * 样式与布局在 Storybook/整页矩阵里看；这里只测可断言的行为。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ActionDeck from '../src/components/ActionDeck.vue'
import CastHud from '../src/components/CastHud.vue'
import GameStage from '../src/components/GameStage.vue'
import HistoryModal from '../src/components/HistoryModal.vue'
import NarrativePanel from '../src/components/NarrativePanel.vue'
import QuestHud from '../src/components/QuestHud.vue'
import SelfHud from '../src/components/SelfHud.vue'
import { displayOf, hudData } from '../src/game/display'
import { peopleHud } from '../src/components/hud'
import { createInitialState } from '../src/game/save'
import { currentCard } from '../src/game/current-card'
import CharacterSigil from '../src/components/world/CharacterSigil.vue'
import SceneSigil from '../src/components/world/SceneSigil.vue'
import WorldQuests from '../src/components/world/WorldQuests.vue'
import WorldWhere from '../src/components/world/WorldWhere.vue'
import type { Row } from '../src/stores/game'
import { i18n, t } from '../src/i18n'

i18n.global.locale.value = 'zh-CN'

const state = createInitialState(currentCard).state
const data = hudData(displayOf(currentCard), state)
const lead = state.lead as Record<string, any>
const roles = state.roles as Record<string, unknown>
const spot = {
  area: String((state.world as any).location.area),
  spot: String((state.world as any).location.spot),
  scene: String((state.world as any).location.scene),
}

function render<C>(component: C, props: Record<string, unknown>) {
  return mount(component as Parameters<typeof mount>[0], {
    props,
    global: { plugins: [i18n] },
  })
}

function line(kind: 'action' | 'narration', text: string, id = 0): Row {
  return { id, kind, text, debug: false }
}

const PANEL = {
  rows: [line('action', 'Open the door.', 1), line('narration', 'The door was old.', 2)],
  turn: 1,
  busy: false,
  status: null,
  sceneLabel: 'Inn',
  timeLabel: 'Morning',
  cardName: 'Demo',
}

describe('SelfHud', () => {
  it('shows the full protagonist name and a numeric stat row', () => {
    const w = render(SelfHud, { lead: data.lead })

    expect(w.find('[data-self-name]').text()).toBe(String(lead.name))
    expect(w.findAll('.hud-stat-value').length).toBeGreaterThan(0)
    expect(w.text()).toContain(String(lead.now.mood))
  })

  it('falls back to the localized "you" when the card has no name', () => {
    const w = render(SelfHud, { lead: undefined })
    expect(w.find('[data-self-name]').text()).toBe(t('hud.self'))
  })

  it('carries a compact party strip for phones, with full names', () => {
    const w = render(SelfHud, {
      lead: data.lead,
      people: peopleHud(data.cast, data.where, spot),
    })

    expect(w.findAll('[data-self-party-name]')).toHaveLength(1)
    expect(w.find('[data-self-party-name]').attributes('data-self-party-name')).toBe(Object.keys(roles)[0])
  })
})

describe('CastHud', () => {
  it('lists every known person with their full name, not a chopped initial', () => {
    const w = render(CastHud, { roles: data.cast, where: data.where, here: spot })
    const names = Object.keys(roles)

    expect(w.findAll('[data-person-card]')).toHaveLength(names.length)
    expect(w.find('[data-person-name]').text()).toBe(names[0])
    expect(w.find('[data-person-card]').text()).toContain(
      t('hud.away', {
        where: String((data.where as Record<string, unknown>)[names[0]]),
      }),
    )
  })

  it('marks a person whose recorded place is the current spot and emits open', async () => {
    const w = render(CastHud, {
      roles: { Salen: { role: 'smith', note: 'red hair' } },
      where: { Salen: 'Town \u00b7 Inn' },
      here: { area: 'Town', spot: 'Inn', scene: 'Room' },
    })

    expect(w.find('[data-person-card]').classes()).toContain('person-present')
    expect(w.find('[data-person-card]').text()).toContain('smith')
    expect(w.find('[data-person-name]').text()).toBe('Salen')

    await w.find('[data-open-world]').trigger('click')
    expect(w.emitted('open')).toHaveLength(1)
  })
})

describe('QuestHud', () => {
  it('shows the hint when the card declares no chains', () => {
    const w = render(QuestHud, { chains: {} })
    expect(w.text()).toContain(t('hud.questHint'))
  })

  it('draws a chain with progress pips and its current stage', () => {
    const w = render(QuestHud, {
      chains: {
        Docks: {
          bound: 'Town',
          surface: 'Three ships came back empty.',
          stage: 2,
          stages: ['one', 'two', 'three', 'four'],
          revealed: ['a wet boot'],
        },
      },
    })

    expect(w.findAll('[data-quest-card]')).toHaveLength(1)
    expect(w.text()).toContain('Docks')
    expect(w.text()).toContain('two')
    expect(w.findAll('.quest-pip-on')).toHaveLength(2)
    expect(w.text()).toContain('a wet boot')
  })
})

describe('NarrativePanel', () => {
  it('prints the player action and the model answer as .line rows with ink writing', () => {
    const w = render(NarrativePanel, PANEL)

    expect(w.find('.line.action').text()).toBe('Open the door.')
    expect(w.find('.line.narration').text()).toContain('The door was old.')
    expect(w.find('[data-panel-narration]').classes()).toContain('writing')
    expect(w.findAll('.ink-para')).toHaveLength(1)
  })

  it('splits the answer into animated paragraphs', () => {
    const w = render(NarrativePanel, {
      ...PANEL,
      rows: [line('action', 'A', 1), line('narration', 'One.\n\nTwo.', 2)],
    })

    expect(w.findAll('.ink-para')).toHaveLength(2)
  })

  it('shows busy ink while the model writes, and an error note when it fails', () => {
    const writing = render(NarrativePanel, {
      ...PANEL,
      rows: [line('action', 'A', 1)],
      busy: true,
      status: { kind: 'busy', text: 'Writing' },
    })
    expect(writing.find('[data-status="busy"]').text()).toContain('Writing')

    const failed = render(NarrativePanel, {
      ...PANEL,
      rows: [line('action', 'A', 1)],
      status: { kind: 'error', text: 'Boom' },
    })
    expect(failed.find('[data-status="error"]').text()).toContain('Boom')
  })

  it('emits history from the header button', async () => {
    const w = render(NarrativePanel, PANEL)
    await w.find('[data-history-open]').trigger('click')
    expect(w.emitted('history')).toHaveLength(1)
  })
})

describe('ActionDeck', () => {
  it('offers state-derived cards and only fills the input (emits the sentence)', async () => {
    const w = render(ActionDeck, { hud: data })
    const cards = w.findAll('[data-action]')

    expect(cards.length).toBeGreaterThan(0)
    expect(cards.length).toBeLessThanOrEqual(6)
    expect(w.find('[data-action="person"]').text()).toContain(Object.keys(roles)[0])
    expect(w.find('[data-action="item"]').text()).toContain(String(lead.pack[0].name))

    const look = w.findAll('[data-action="verb"]')[0]
    expect(look.text()).toContain(t('hud.actionLook'))
    await look.trigger('click')
    expect(w.emitted('pick')?.[0]).toEqual([t('hud.actionLookText')])
  })
})

describe('GameStage', () => {
  it('wires the HUD surfaces and forwards history/world', async () => {
    const w = render(GameStage, {
      rows: PANEL.rows,
      turn: 6,
      busy: false,
      status: null,
      scene: spot,
      timeLabel: 'Morning',
      cardName: 'Demo',
      hud: data,
    })

    expect(w.find('[data-game-stage]').exists()).toBe(true)
    expect(w.find('[data-self-hud]').exists()).toBe(true)
    expect(w.find('[data-cast-hud]').exists()).toBe(true)
    expect(w.find('[data-narrative]').exists()).toBe(true)

    await w.find('[data-history-open]').trigger('click')
    expect(w.emitted('history')).toHaveLength(1)
    await w.find('[data-open-world]').trigger('click')
    expect(w.emitted('world')).toHaveLength(1)
  })
})

describe('HistoryModal', () => {
  it('opens the book and closes itself', async () => {
    const w = render(HistoryModal, { ...PANEL, scene: spot })

    expect(w.find('[data-history]').exists()).toBe(true)
    expect(w.find('[data-book-page="right"]').exists()).toBe(true)
    await w.find('[data-history-close]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})

describe('procedural art', () => {
  it('renders a character sigil as an accessible image, with a you variant', () => {
    const plain = render(CharacterSigil, { name: 'Salen' })
    expect(plain.find('.sigil svg').exists()).toBe(true)
    expect(plain.find('.sigil').attributes('aria-label')).toBe('Salen')
    expect(plain.find('.sigil').classes()).not.toContain('sigil-you')

    const you = render(CharacterSigil, { name: 'Salen', you: true })
    expect(you.find('.sigil').classes()).toContain('sigil-you')
    expect(you.find('.sigil-crown').exists()).toBe(true)
  })

  it('renders a scene landmark silhouette', () => {
    const w = render(SceneSigil, { seed: '\u6668\u98ce\u9547\u9189\u732b\u65c5\u5e97' })
    expect(w.find('svg.scene-sigil').exists()).toBe(true)
    expect(w.findAll('.scene-mark').length).toBeGreaterThan(0)
  })
})

describe('world blocks for HUD data', () => {
  it('WorldWhere lists full names and places, with an empty hint', () => {
    const w = render(WorldWhere, { where: { Salen: 'Town \u00b7 Smithy' } })
    expect(w.find('[data-where]').text()).toContain('Salen')
    expect(w.find('[data-where]').text()).toContain('Town \u00b7 Smithy')
    expect(render(WorldWhere, { where: {} }).text()).toContain(t('world.whereEmpty'))
  })

  it('WorldQuests draws a chain card and an empty hint', () => {
    const w = render(WorldQuests, {
      chains: {
        Docks: {
          surface: 'Three ships came back empty.',
          stage: 1,
          stages: ['one', 'two'],
          revealed: [],
        },
      },
    })
    expect(w.find('[data-quest]').text()).toContain('Docks')
    expect(render(WorldQuests, { chains: {} }).text()).toContain(t('hud.questHint'))
  })
})
