/**
 * card 测试 —— card/3 的形状与结构校验。
 *
 * 三条验收标准：仓库里的三张卡必须过、自造的最小卡必须过、每改坏一处都必须被拒
 * 而且错误信息要指到那一处的路径。反例都只在夹具上动一个地方，于是「被拒」这件事
 * 能归因到那一处 —— 不然测试自己就说不清是哪儿坏了。
 *
 * ⚠️ 源码与测试都必须 ASCII（.githooks/checks/ascii.mjs），所以断言只用路径与英文片段。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCard, validateCard } from '../src/game/card'
import {
  EXAMPLE_CARD,
  LONG_NIGHT_CARD,
  NIGHT_WATCH_CARD,
  NODE_A,
  NODE_B,
  fixture,
  minimalCard,
} from './support/card-fixtures'

/** 跑一次校验，把抛出的错误读成文本（通过了就返回空串） */
function errorOf(card: unknown): string {
  try {
    validateCard(card)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** 改坏一处 → 必须被拒，而且错误信息要指到那一处的路径 */
function expectRejected(card: unknown, path: string): void {
  expect(errorOf(card)).toContain(path)
}

const storyNodes = (card: ReturnType<typeof parseCard>) =>
  Object.entries(card.graph.nodes).filter(([, node]) => node.role === 'story')

describe('validateCard: the cards that must pass', () => {
  it('accepts the three cards in the repo', () => {
    const example = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
    expect(example.graph.topology).toHaveLength(9)
    const nightWatch = parseCard(readFileSync(NIGHT_WATCH_CARD, 'utf8'))
    expect(nightWatch.graph.topology).toEqual(['time', 'story'])
    const longNight = parseCard(readFileSync(LONG_NIGHT_CARD, 'utf8'))
    expect(longNight.graph.topology).toEqual(['time', 'story'])
  })

  it('gives every card exactly one story node', () => {
    for (const path of [EXAMPLE_CARD, NIGHT_WATCH_CARD, LONG_NIGHT_CARD]) {
      expect(storyNodes(parseCard(readFileSync(path, 'utf8')))).toHaveLength(1)
    }
  })

  it('accepts a minimal card built by hand', () => {
    expect(validateCard(minimalCard())).toEqual(minimalCard())
  })

  it('rejects text that is not JSON at all', () => {
    expect(() => parseCard('{ broken')).toThrow('not valid JSON')
  })

  it('rejects anything that is not an object', () => {
    for (const bad of [null, 42, 'card', []]) expectRejected(bad, 'must be a JSON object')
  })
})

describe('validateCard: top level and meta', () => {
  it('rejects a card that is missing any of the twelve keys', () => {
    for (const key of Object.keys(minimalCard())) {
      const card = fixture()
      delete card[key]
      expectRejected(card, key)
    }
  })

  it('rejects an unknown top-level key', () => {
    const card = fixture()
    card.extra = true
    expectRejected(card, 'unknown top-level key')
  })

  it('rejects an unknown card format', () => {
    const card = fixture()
    card.card.format = 'card/2'
    expectRejected(card, 'card.format')
  })

  it('rejects an id whose namespace is not the author, or a malformed id', () => {
    const other = fixture()
    other.card.id = 'someone-else.demo'
    expectRejected(other, 'card.id')
    const malformed = fixture()
    malformed.card.id = 'Tester.Demo'
    expectRejected(malformed, 'card.id')
  })

  it('rejects a version that is not semver, an empty meta field, or a stray meta key', () => {
    const version = fixture()
    version.card.version = 'v1'
    expectRejected(version, 'card.version')
    const empty = fixture()
    empty.card.language = ''
    expectRejected(empty, 'card.language')
    const extra = fixture()
    extra.card.extra = 'x'
    expectRejected(extra, 'card.extra')
  })
})

describe('validateCard: settings / script / convention', () => {
  it('rejects a settings block that is missing, unknown, or empty', () => {
    const missing = fixture()
    delete missing.settings.common
    expectRejected(missing, 'settings')
    const unknown = fixture()
    unknown.settings.extra = ['x']
    expectRejected(unknown, 'settings.extra')
    const empty = fixture()
    empty.settings.world = []
    expectRejected(empty, 'settings.world')
    const wrong = fixture()
    wrong.settings.world = ['ok', 7]
    expectRejected(wrong, 'settings.world')
  })

  it('rejects an empty script or an empty convention', () => {
    const script = fixture()
    script.script = {}
    expectRejected(script, 'script')
    const convention = fixture()
    convention.convention = []
    expectRejected(convention, 'convention')
  })
})

describe('validateCard: graph', () => {
  const nodesOf = (card: any) => card.graph.nodes
  const nodePath = (id: string) => 'graph.nodes.' + id

  it('rejects an empty topology, a duplicate id, or a bad entry', () => {
    const empty = fixture()
    empty.graph.topology = []
    expectRejected(empty, 'graph.topology')
    const duplicate = fixture()
    duplicate.graph.topology = [NODE_A, NODE_A]
    expectRejected(duplicate, 'graph.topology[1]')
    const bad = fixture()
    bad.graph.topology = [NODE_A, '']
    expectRejected(bad, 'graph.topology[1]')
  })

  it('rejects a topology id without a node, or a node outside the topology', () => {
    const missing = fixture()
    delete nodesOf(missing)[NODE_B]
    expectRejected(missing, 'graph.nodes')
    const extra = fixture()
    nodesOf(extra).extra = { name: 'x', duty: 'y', prompt: ['p'] }
    expectRejected(extra, nodePath('extra'))
  })

  it('rejects a node that is missing a key or carries an unknown one', () => {
    for (const key of ['name', 'duty', 'prompt']) {
      const card = fixture()
      delete nodesOf(card)[NODE_A][key]
      expectRejected(card, nodePath(NODE_A))
    }
    const unknown = fixture()
    nodesOf(unknown)[NODE_A].extra = true
    expectRejected(unknown, nodePath(NODE_A) + '.extra')
    const order = fixture()
    nodesOf(order)[NODE_A].order = 0
    expectRejected(order, nodePath(NODE_A) + '.order')
  })

  it('rejects two nodes that share a display name', () => {
    const card = fixture()
    nodesOf(card)[NODE_B].name = nodesOf(card)[NODE_A].name
    expectRejected(card, nodePath(NODE_B) + '.name')
  })

  it('rejects an empty name, duty or prompt', () => {
    const name = fixture()
    nodesOf(name)[NODE_A].name = ''
    expectRejected(name, nodePath(NODE_A) + '.name')
    const duty = fixture()
    nodesOf(duty)[NODE_A].duty = ''
    expectRejected(duty, nodePath(NODE_A) + '.duty')
    const prompt = fixture()
    nodesOf(prompt)[NODE_A].prompt = []
    expectRejected(prompt, nodePath(NODE_A) + '.prompt')
  })

  it('rejects a role the engine does not know', () => {
    const card = fixture()
    nodesOf(card)[NODE_A].role = 'gate'
    expectRejected(card, nodePath(NODE_A) + '.role')
  })

  it('rejects zero story nodes and two story nodes', () => {
    const none = fixture()
    delete nodesOf(none)[NODE_B].role
    expectRejected(none, 'graph.nodes')
    const two = fixture()
    nodesOf(two)[NODE_A].role = 'story'
    expectRejected(two, 'graph.nodes')
  })

  it('rejects a tools list that names an action the card does not declare', () => {
    const card = fixture()
    nodesOf(card)[NODE_A].tools = ['nope']
    expectRejected(card, nodePath(NODE_A) + '.tools[0]')
  })

  it('rejects a reads list that names something that is not a state branch', () => {
    const card = fixture()
    nodesOf(card)[NODE_A].reads = ['nope']
    expectRejected(card, nodePath(NODE_A) + '.reads[0]')
  })

  it('rejects a uses list that names a generator the card does not declare', () => {
    const card = fixture()
    nodesOf(card)[NODE_A].uses = ['nope']
    expectRejected(card, nodePath(NODE_A) + '.uses[0]')
  })
})

describe('validateCard: actions', () => {
  const path = (name: string) => 'actions.' + name

  it('rejects an action that has neither path nor effect, or both', () => {
    const neither = fixture()
    neither.actions.set_place = { what: 'x' }
    expectRejected(neither, path('set_place'))
    const both = fixture()
    both.actions.set_place.effect = 'time'
    expectRejected(both, path('set_place'))
  })

  it('rejects an unknown effect, or mode / key on an effect action', () => {
    const effect = fixture()
    effect.actions.advance_time.effect = 'sleep'
    expectRejected(effect, path('advance_time') + '.effect')
    const mode = fixture()
    mode.actions.advance_time.mode = 'set'
    expectRejected(mode, path('advance_time') + '.mode')
    const key = fixture()
    key.actions.advance_time.key = 'name'
    expectRejected(key, path('advance_time') + '.key')
  })

  it('rejects an action path that does not exist in state', () => {
    const card = fixture()
    card.actions.set_place.path = 'world.nope'
    expectRejected(card, path('set_place') + '.path')
  })

  it('rejects an unknown mode, a push on a non-list, and a merge on a non-object', () => {
    const mode = fixture()
    mode.actions.set_place.mode = 'patch'
    expectRejected(mode, path('set_place') + '.mode')
    const push = fixture()
    push.actions.set_place.mode = 'push'
    expectRejected(push, path('set_place') + '.mode')
    const merge = fixture()
    merge.actions.move_lead.path = 'player.profile'
    expectRejected(merge, path('move_lead') + '.mode')
    const inMap = fixture()
    inMap.actions.set_where.mode = 'merge'
    expectRejected(inMap, path('set_where') + '.mode')
  })

  it('rejects a key on a non-map, and a map without a key', () => {
    const stray = fixture()
    stray.actions.set_place.key = 'name'
    expectRejected(stray, path('set_place') + '.key')
    const missing = fixture()
    delete missing.actions.add_role.key
    expectRejected(missing, path('add_role') + '.key')
  })

  it('rejects a missing what, an unknown action key, or a name that is not a tool name', () => {
    const what = fixture()
    delete what.actions.set_place.what
    expectRejected(what, path('set_place'))
    const extra = fixture()
    extra.actions.set_place.params = {}
    expectRejected(extra, path('set_place') + '.params')
    const name = fixture()
    name.actions['bad name!'] = { what: 'x', effect: 'time' }
    expectRejected(name, 'actions.bad name!')
  })
})

describe('validateCard: state schema', () => {
  const lead = (card: any) => card.state.lead.fields
  const path = 'state.lead.fields.name'

  it('rejects a schema that is not a known shorthand or a schema object', () => {
    const card = fixture()
    lead(card).name = 'text'
    expectRejected(card, path)
    const wrong = fixture()
    lead(wrong).name = 7
    expectRejected(wrong, path)
  })

  it('rejects an unknown type, or a key that belongs to another type', () => {
    const type = fixture()
    lead(type).name = { type: 'prose' }
    expectRejected(type, path + '.type')
    const range = fixture()
    lead(range).name = { type: 'string', range: [1, 2] }
    expectRejected(range, path + '.range')
    const values = fixture()
    lead(values).name = { type: 'string', values: ['a'] }
    expectRejected(values, path + '.values')
    const of = fixture()
    lead(of).name = { type: 'string', of: 'string' }
    expectRejected(of, path + '.of')
    const fields = fixture()
    lead(fields).name = { type: 'string', fields: { a: 'string' } }
    expectRejected(fields, path + '.fields')
  })

  it('rejects an empty fields map, an empty enum, and a range that is not [min, max]', () => {
    const fields = fixture()
    lead(fields).name = { type: 'object', fields: {} }
    expectRejected(fields, path + '.fields')
    const values = fixture()
    lead(values).name = { type: 'enum', values: [] }
    expectRejected(values, path + '.values')
    const range = fixture()
    lead(range).name = { type: 'integer', range: [3] }
    expectRejected(range, path + '.range')
    const order = fixture()
    lead(order).name = { type: 'integer', range: [9, 1] }
    expectRejected(order, path + '.range')
    const repeat = fixture()
    lead(repeat).name = { type: 'enum', values: ['a', 'a'] }
    expectRejected(repeat, path + '.values')
  })

  it('rejects an initial value that does not match its schema', () => {
    const type = fixture()
    lead(type).name = { type: 'string', initial: 7 }
    expectRejected(type, path + '.initial')
    const range = fixture()
    lead(range).name = { type: 'integer', initial: 99, range: [1, 10] }
    expectRejected(range, path + '.initial')
    const values = fixture()
    lead(values).name = { type: 'enum', initial: 'huge', values: ['major', 'minor'] }
    expectRejected(values, path + '.initial')
    const unknown = fixture()
    lead(unknown).name = { type: 'object', initial: { nope: 1 }, fields: { ok: 'string' } }
    expectRejected(unknown, path + '.initial.nope')
    const required = fixture()
    lead(required).name = {
      type: 'object',
      initial: {},
      fields: { ok: { type: 'string', required: true } },
    }
    expectRejected(required, path + '.initial.ok')
  })

  it('rejects a required flag that is not a boolean, or an empty note', () => {
    const required = fixture()
    lead(required).name = { type: 'string', required: 'yes' }
    expectRejected(required, path + '.required')
    const note = fixture()
    lead(note).name = { type: 'string', note: '' }
    expectRejected(note, path + '.note')
  })
})

describe('validateCard: time and calendar', () => {
  it('rejects an unknown calendar preset', () => {
    const card = fixture()
    card.time.calendar = 'lunar'
    expectRejected(card, 'time.calendar')
  })

  it('rejects a custom calendar that is missing a required key', () => {
    for (const key of ['segments', 'weekdays', 'day', 'month', 'year', 'display']) {
      const card = fixture()
      const calendar = { ...customCalendar() } as Record<string, unknown>
      delete calendar[key]
      card.time.calendar = calendar
      card.time.initial = { year: 1, month: 4, day: 12, hour: 21, minute: 40 }
      expectRejected(card, 'time.calendar')
    }
  })

  it('rejects a custom calendar with an unknown key, a bad count, or a bad day start', () => {
    const unknown = fixture()
    unknown.time.calendar = { ...customCalendar(), extra: 1 }
    expectRejected(unknown, 'time.calendar.extra')
    const days = fixture()
    days.time.calendar = { ...customCalendar(), month: { days: 0 } }
    expectRejected(days, 'time.calendar.month.days')
    const start = fixture()
    start.time.calendar = { ...customCalendar(), day: { hours: 24, minutesPerHour: 60, start: '25:00' } }
    expectRejected(start, 'time.calendar.day.start')
    const outside = fixture()
    outside.time.calendar = { ...customCalendar(), day: { hours: 12, minutesPerHour: 60, start: '18:00' } }
    expectRejected(outside, 'time.calendar.day.start')
  })

  it('rejects a display template with an unknown placeholder', () => {
    const card = fixture()
    card.time.calendar = { ...customCalendar(), display: '{year} {weakday}' }
    expectRejected(card, 'time.calendar.display')
  })

  it('rejects an initial instant outside the calendar units', () => {
    const month = fixture()
    month.time.calendar = customCalendar()
    month.time.initial = { year: 1, month: 13, day: 1, hour: 0, minute: 0 }
    expectRejected(month, 'time.initial.month')
    const day = fixture()
    day.time.calendar = customCalendar()
    day.time.initial = { year: 1, month: 4, day: 31, hour: 0, minute: 0 }
    expectRejected(day, 'time.initial.day')
    const hour = fixture()
    hour.time.initial = { year: 2026, month: 9, day: 14, hour: 24, minute: 0 }
    expectRejected(hour, 'time.initial.hour')
    const leap = fixture()
    leap.time.initial = { year: 2026, month: 2, day: 30, hour: 0, minute: 0 }
    expectRejected(leap, 'time.initial.day')
  })

  it('rejects a time block with a missing or unknown key', () => {
    const missing = fixture()
    delete missing.time.initial
    expectRejected(missing, 'time')
    const extra = fixture()
    extra.time.zone = 'UTC'
    expectRejected(extra, 'time.zone')
  })
})

/** 一份最小的自定义历法（用例在它的副本上改一处） */
function customCalendar(): Record<string, unknown> {
  return {
    segments: ['night', 'dawn'],
    weekdays: ['one', 'two', 'three', 'four', 'five', 'six', 'seven'],
    day: { hours: 24, minutesPerHour: 60 },
    month: { days: 30 },
    year: { months: 12 },
    display: '{year}-{month}-{day} {weekday} {segment}',
  }
}

describe('validateCard: generators / opening / display / notes', () => {
  it('rejects a generator that is missing a key or repeats a name', () => {
    const missing = fixture()
    delete missing.generators[0].applies
    expectRejected(missing, 'generators[0]')
    const repeat = fixture()
    repeat.generators.push({ name: 'places', applies: 'again', principles: ['x'] })
    expectRejected(repeat, 'generators[1].name')
    const empty = fixture()
    empty.generators[0].principles = []
    expectRejected(empty, 'generators[0].principles')
  })

  it('accepts a card with no generators at all', () => {
    const card = fixture()
    card.generators = []
    delete card.graph.nodes[NODE_A].uses
    expect(validateCard(card)).toBeDefined()
  })

  it('rejects an opening block that is missing a key or has the wrong type', () => {
    for (const key of ['canName', 'defaultName', 'requirements']) {
      const card = fixture()
      delete card.opening[key]
      expectRejected(card, 'opening')
    }
    const asked = fixture()
    asked.opening.canName = 'yes'
    expectRejected(asked, 'opening.canName')
    const named = fixture()
    named.opening.defaultName = 7
    expectRejected(named, 'opening.defaultName')
    const empty = fixture()
    empty.opening.requirements = []
    expectRejected(empty, 'opening.requirements')
  })

  it('accepts an empty default name (the caller falls back to the locale)', () => {
    const card = fixture()
    card.opening.defaultName = ''
    expect(validateCard(card)).toBeDefined()
  })

  it('rejects a topbar entry or a sidebar block the engine has no renderer for', () => {
    const topbar = fixture()
    topbar.display.topbar = ['time', 'weather']
    expectRejected(topbar, 'display.topbar[1]')
    const block = fixture()
    block.display.sidebar = [{ block: 'nope' }]
    expectRejected(block, 'display.sidebar[0].block')
  })

  it('rejects a duplicate sidebar block, an unknown block key, or a missing block path', () => {
    const repeat = fixture()
    repeat.display.sidebar = [{ block: 'cast' }, { block: 'cast' }]
    expectRejected(repeat, 'display.sidebar[1].block')
    const unknown = fixture()
    unknown.display.sidebar = [{ block: 'cast', extra: 1 }]
    expectRejected(unknown, 'display.sidebar[0].extra')
    const missing = fixture()
    delete missing.state.world.fields.map
    missing.display.sidebar = [{ block: 'map' }]
    expectRejected(missing, 'display.sidebar[0].block')
  })

  it('accepts an empty sidebar and a display without layout / time / scroll', () => {
    const card = fixture()
    card.display = { topbar: ['time'], sidebar: [] }
    expect(validateCard(card)).toBeDefined()
  })

  it('rejects a notes entry that is empty or not text', () => {
    for (const value of ['', [], 7, ['ok', 7]]) {
      const card = fixture()
      card.notes.bad = value
      expectRejected(card, 'notes.bad')
    }
    const emptyKey = fixture()
    emptyKey.notes[''] = 'x'
    expectRejected(emptyKey, 'notes')
  })

  it('accepts an empty notes block and free note keys', () => {
    const card = fixture()
    card.notes = {}
    expect(validateCard(card)).toBeDefined()
  })
})
