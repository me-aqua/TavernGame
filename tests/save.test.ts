/**
 * save 测试 —— 外部数据的**纯校验**：初始帧、卡的身份、字段规范化、状态树与 schema。
 *
 * localStorage 的读写与坏档备份在 tests/storage.test.ts 与 tests/state.test.ts。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState, identityOf, normalize, parseSave } from '../src/game/save'
import { currentCard } from '../src/game/current-card'
import { t } from '../src/i18n'
import { loadCard, NIGHT_WATCH_CARD } from './support/card-fixtures'
import type { GameData } from '../src/types/state'

/* ---- 测试自己编的 fixture（非产品文案） ---- */
const TRUNCATED_JSON = '{ broken'
const JSON_STRING = '"a string"'
const FILLER = 'filler'

/** 一份合法存档的一份深拷贝（每个反例只改一处） */
function savedGame(): GameData {
  return JSON.parse(JSON.stringify(createInitialState(currentCard))) as GameData
}

describe('createInitialState', () => {
  it('builds a fresh tree per call (two games never share their arrays)', () => {
    const a = createInitialState(currentCard)
    const b = createInitialState(currentCard)
    expect(a).not.toBe(b)
    expect(a.state).not.toBe(b.state)
    expect(a.time).not.toBe(b.time)
    const untouched = structuredClone(b.state.roles)
    ;(a.state.roles as Record<string, unknown>)['someone'] = { tier: 'major' }
    expect(b.state.roles).toEqual(untouched)
  })

  it('carries the card identity and the card clock', () => {
    const d = createInitialState(currentCard)
    expect(d.meta.card).toEqual(identityOf(currentCard))
    expect(d.meta.turn).toBe(0)
    expect(d.time).toEqual(currentCard.time.initial)
  })

  it('works for any card (the identity follows the card, not the engine)', () => {
    const card = loadCard(NIGHT_WATCH_CARD)
    expect(createInitialState(card).meta.card.id).toBe(card.card.id)
  })
})

describe('normalize - the card identity is a hard gate', () => {
  it('accepts a save written by the same card', () => {
    const d = normalize(savedGame(), currentCard)
    expect(d.meta.card).toEqual(identityOf(currentCard))
    expect(d.meta.turn).toBe(0)
  })

  it('refuses a save that records no card identity', () => {
    const save = savedGame()
    delete (save.meta as { card?: unknown }).card
    expect(() => normalize(save, currentCard)).toThrow(t('save.cardMissing'))
  })

  it('refuses a card identity whose fields are not strings', () => {
    const save = savedGame()
    ;(save.meta as { card: unknown }).card = { id: 42, version: '0.1.0', format: 'card/3' }
    expect(() => normalize(save, currentCard)).toThrow(t('save.cardMissing'))
  })

  it('refuses a save from another card (id differs)', () => {
    const other = createInitialState(loadCard(NIGHT_WATCH_CARD))
    expect(() => normalize(other, currentCard)).toThrow(other.meta.card.id)
  })

  it('refuses a save whose version differs (the schema may have moved)', () => {
    const save = savedGame()
    save.meta.card.version = '9.9.9'
    expect(() => normalize(save, currentCard)).toThrow(
      t('save.cardMismatch', { saved: '', current: '' }).slice(0, 8),
    )
  })

  it('refuses a save in another format', () => {
    const save = savedGame()
    save.meta.card.format = 'card/2'
    expect(() => normalize(save, currentCard)).toThrow('card/2')
  })

  it('refuses things that are not objects at all', () => {
    for (const bad of [null, undefined, [], 'x', 42, true]) {
      expect(() => normalize(bad, currentCard), String(bad)).toThrow(t('save.notValid'))
    }
  })
})

describe('normalize - field-level sanitation', () => {
  it('coerces the turn count to a number (a string would make endTurn concatenate "51")', () => {
    const save = savedGame()
    save.meta.turn = '7' as unknown as number
    expect(normalize(save, currentCard).meta.turn).toBe(7)

    const bad = savedGame()
    bad.meta.turn = -5
    expect(normalize(bad, currentCard).meta.turn).toBe(0)
  })

  it('fills missing events and timeline with empty arrays', () => {
    const save = savedGame() as unknown as Record<string, unknown>
    delete save.events
    delete save.timeline
    const d = normalize(save, currentCard)
    expect(d.events).toEqual([])
    expect(d.timeline).toEqual([])
  })

  it('drops events with an unknown kind and keeps the detail of the known ones', () => {
    const save = savedGame()
    save.events = [
      { kind: 'narration', text: 'story', at: '' },
      { kind: 'nonsense', text: 'not a thing', at: '' },
      { kind: 'tool', text: 'tool call', detail: '{"a":1}', at: '' },
      { kind: 'toolResult', text: 'result', detail: 42, at: '' },
    ] as GameData['events']
    const d = normalize(save, currentCard)
    expect(d.events.map((event) => event.kind)).toEqual(['narration', 'tool', 'toolResult'])
    expect(d.events[1].detail).toBe('{"a":1}')
    // detail 不是字符串就当没有，不让渲染层拿到数字
    expect(d.events[2].detail).toBeUndefined()
  })

  it('keeps the structured debug fields (node / tool / path) but value only on stateChange', () => {
    const save = savedGame()
    save.events = [
      {
        kind: 'stateChange',
        text: 'wrote world.location',
        node: 'map-node',
        tool: 'move_to',
        path: 'world.location',
        value: { area: 'x' },
        at: '',
      },
      // 手改过的存档什么都可能有：非字符串的结构化字段一律当没有
      { kind: 'tool', text: 'call', node: 7, tool: null, path: 'ignored', value: 1, at: '' },
    ] as unknown as GameData['events']
    const d = normalize(save, currentCard)
    expect(d.events[0].node).toBe('map-node')
    expect(d.events[0].tool).toBe('move_to')
    expect(d.events[0].path).toBe('world.location')
    expect(d.events[0].value).toEqual({ area: 'x' })
    expect(d.events[1].node).toBeUndefined()
    expect(d.events[1].tool).toBeUndefined()
    expect(d.events[1].path).toBe('ignored')
    expect(d.events[1].value).toBeUndefined()
  })

  it('keeps every story event in the stream (no cap on the model memory)', () => {
    const save = savedGame()
    save.events = Array.from({ length: 200 }, (_, i) => ({
      kind: 'narration',
      text: FILLER + i,
      at: '',
    })) as GameData['events']
    const d = normalize(save, currentCard)
    expect(d.events, 'reloading must not drop story events').toHaveLength(200)
    expect(d.events[0].text, 'the earliest story event survives the reload').toBe(FILLER + '0')
    expect(d.events.at(-1)?.text).toBe(FILLER + '199')
  })

  it('sanitizes timeline entries and caps them', () => {
    const save = savedGame()
    save.timeline = [
      { from: 'a', to: 'b', reason: 'r', minutes: '15', at: '' },
      { from: 'c' },
    ] as unknown as GameData['timeline']
    const d = normalize(save, currentCard)
    expect(d.timeline[0].minutes).toBe(15)
    expect(d.timeline[1].reason).toBe('')
    expect(d.timeline[1].minutes).toBe(0)

    const many = savedGame()
    many.timeline = Array.from({ length: 60 }, (_, i) => ({
      from: 'a' + i,
      to: 'b' + i,
      reason: '',
      minutes: 60,
      at: '',
    }))
    expect(normalize(many, currentCard).timeline).toHaveLength(40)
  })

  it('fills a missing clock with the card starting moment', () => {
    const save = savedGame() as unknown as Record<string, unknown>
    delete save.time
    expect(normalize(save, currentCard).time).toEqual(currentCard.time.initial)
  })
})

describe('normalize - the state tree must match the card schema', () => {
  it('refuses a branch the card does not declare', () => {
    const save = savedGame()
    save.state = { ...save.state, nowhere: {} }
    expect(() => normalize(save, currentCard)).toThrow('state.nowhere')
  })

  it('refuses a value that does not fit the schema', () => {
    const save = savedGame()
    const lead = save.state.lead as Record<string, unknown>
    // ⚠️ 段 3 之后作者起的键名是中文（测试代码必须 ASCII）⇒ 那两个名字从卡的 schema 里现取：
    //    「里面还有一层 fields 的那一段」+「它下面类型是 integer 的那一栏」
    const leadFields = (currentCard.state as unknown as { lead: { fields: Record<string, any> } }).lead.fields
    const traitsKey = Object.keys(leadFields).find((key) => leadFields[key].fields !== undefined) as string
    const numberKey = Object.keys(leadFields[traitsKey].fields).find(
      (key) => leadFields[traitsKey].fields[key].type === 'integer',
    ) as string
    const traits = lead[traitsKey] as Record<string, unknown>
    traits[numberKey] = 'strong'
    expect(() => normalize(save, currentCard)).toThrow('state.lead.' + traitsKey + '.' + numberKey)
  })

  it('refuses a state that is not an object', () => {
    const save = savedGame() as unknown as Record<string, unknown>
    save.state = 'nope'
    expect(() => normalize(save, currentCard)).toThrow(t('save.badState', { message: '' }).slice(0, 6))
  })

  it('refuses a clock outside the card calendar', () => {
    const save = savedGame()
    save.time = { ...save.time, month: 13 }
    expect(() => normalize(save, currentCard)).toThrow('time.month')
  })
})

describe('parseSave (the import-file path)', () => {
  it('accepts a valid save', () => {
    const json = JSON.stringify(createInitialState(currentCard))
    expect(parseSave(json, currentCard).meta.card).toEqual(identityOf(currentCard))
  })

  it('rejects non-objects and arrays', () => {
    for (const bad of ['[]', JSON_STRING, '{"player": 1}', '{}']) {
      expect(() => parseSave(bad, currentCard), bad).toThrow()
    }
  })

  it('throws a parse error on broken JSON', () => {
    expect(() => parseSave(TRUNCATED_JSON, currentCard)).toThrow()
  })
})
