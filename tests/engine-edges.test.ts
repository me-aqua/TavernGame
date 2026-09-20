/**
 * 卡格式与动作表的**边界分支** —— 每个反例只改夹具的一处。
 *
 * 为什么单独一份：这些分支是「卡写错了会怎样」与「参数契约从 schema 推导的每一格」，
 * 按模块拆开需要五套几乎相同的夹具；这里共用 tests/support/card-fixtures.ts 的最小卡，
 * 一处一处改坏，于是「被拒」能归因到那一处。
 */
import { describe, expect, it, vi } from 'vitest'
import { validateCard, type CardData } from '../src/game/card'
import { requireArray } from '../src/game/card-read'
import { instantiate, validateValue, type StateTree } from '../src/game/card-state'
import { checkCalendar, checkTime } from '../src/game/card-calendar'
import { runAction, toolSchemas } from '../src/game/card-actions'
import { narrationOf } from '../src/agent/card-graph'
import { fixture, loadCard, EXAMPLE_CARD } from './support/card-fixtures'

/** 夹具的可变副本（每个反例只改一处，改完就 validateCard） */
function broken(change: (card: any) => void): () => CardData {
  return () => {
    const card = fixture()
    change(card)
    return validateCard(card)
  }
}

describe('card.ts - the shapes that must be rejected', () => {
  it('an action that is not an object', () => {
    expect(broken((card) => (card.actions.set_place = 'nope'))).toThrow(/actions\.set_place/)
  })

  it('a node that is not an object', () => {
    expect(broken((card) => (card.graph.nodes.first = 'nope'))).toThrow(/graph\.nodes\.first/)
  })

  it('a sidebar block that is not an object', () => {
    // 下标 = 夹具里声明的条数（它现在是四条：区域表 / 当前所在 / 角色 / 背包）
    expect(broken((card) => card.display.sidebar.push('nope'))).toThrow(/display\.sidebar\[4\]/)
  })
})

describe('card.ts - a node without a tools whitelist may use every action', () => {
  it('accepts a node that does not declare tools at all', () => {
    const card = broken((raw) => delete raw.graph.nodes.first.tools)()
    expect(card.graph.nodes.first.tools).toBeUndefined()
  })
})

describe('card-state.ts - the value shapes the schema rejects', () => {
  it('an enum whose values are not all non-empty strings', () => {
    expect(broken((card) => (card.state.roles.of.fields.tier.values = ['major', 7]))).toThrow(
      /must be an array of non-empty strings/,
    )
  })

  it('an integer that is not an integer, and one outside its range', () => {
    const schema = { type: 'integer' as const, range: [0, 1] as [number, number] }
    expect(validateValue(schema, 'x', 'score')).toContain('must be an integer')
    expect(validateValue(schema, 5, 'score')).toContain('must be within [0, 1]')
    expect(validateValue(schema, 0, 'score')).toBeNull()
  })
})

describe('card-read.ts - requireArray on a non-array', () => {
  it('reports the field path instead of returning a non-array', () => {
    // 拿真在跑的那一处当样本（display.ts 的侧栏声明）；键名换成卡格式里已经没有的，这条就没在测东西
    expect(() => requireArray({ sidebar: 7 }, 'sidebar', 'display')).toThrow(/display\.sidebar/)
  })
})

describe('card-calendar.ts - a custom calendar whose parts are malformed', () => {
  /** 《夜班》那张卡的自定义历法（现读，不手抄一份） */
  const custom = () => loadCard('cards/night-watch.json').time.calendar as Record<string, any>

  it('rejects segments that are not non-empty strings', () => {
    expect(() => checkCalendar({ ...custom(), segments: ['dusk', ''] }, 'time.calendar')).toThrow(
      /time\.calendar\.segments/,
    )
  })

  it('rejects weekdays that are not non-empty strings', () => {
    expect(() => checkCalendar({ ...custom(), weekdays: ['mon', 3] }, 'time.calendar')).toThrow(
      /time\.calendar\.weekdays/,
    )
  })

  it('rejects a moment whose minute is outside the card day', () => {
    const calendar = checkCalendar(custom(), 'time.calendar')
    expect(() =>
      checkTime(calendar, { year: 1, month: 4, day: 12, hour: 21, minute: 60 }, 'time.initial'),
    ).toThrow(/time\.initial\.minute/)
  })
})

describe('card-actions.ts - every parameter shape is derived from the state schema', () => {
  /** 一张把所有参数形状都摆出来的卡：每个动作写到一种 schema 上 */
  const shapes = (): CardData => {
    const card = fixture()
    // 参数形状：带区间的 integer / 不带区间的 integer / 嵌套 map
    card.state.lead.fields.rank = { type: 'integer', initial: 1, range: [1, 5] }
    card.state.lead.fields.level = { type: 'integer', initial: 1 }
    card.state.lead.fields.tags = { type: 'map', initial: {}, of: 'string' }
    card.actions.patch_lead = {
      whenToUse: 'when the engine edge is needed',
      principles: 'keep it minimal',
      what: 'patch the lead',
      path: 'lead',
      mode: 'merge',
    }
    // map 的元素自己声明了键字段
    card.state.people = {
      type: 'map',
      initial: {},
      of: { type: 'object', fields: { name: 'string', note: 'string' } },
    }
    card.actions.upsert_person = {
      whenToUse: 'when the engine edge is needed',
      principles: 'keep it minimal',
      what: 'upsert a person',
      path: 'people',
      key: 'name',
      mode: 'merge',
    }
    // 中间缺一段的路径（父对象按需建出来）
    card.state.deep = { type: 'object', fields: { inner: { type: 'object', fields: { value: 'string' } } } }
    card.actions.set_deep = {
      whenToUse: 'when the engine edge is needed',
      principles: 'keep it minimal',
      what: 'set deep',
      path: 'deep.inner',
    }
    // push 到一个还没有初值的列表
    card.state.log = { type: 'list', of: { type: 'object', fields: { what: 'string' } } }
    card.actions.write_log = {
      whenToUse: 'when the engine edge is needed',
      principles: 'keep it minimal',
      what: 'append',
      path: 'log',
      mode: 'push',
    }
    // 标量目标：参数只有一个 value
    card.actions.set_profile = {
      whenToUse: 'when the engine edge is needed',
      principles: 'keep it minimal',
      what: 'set the profile',
      path: 'player.profile',
    }
    return validateCard(card)
  }

  /** 取某个动作推导出来的参数契约（工具表里的那一条） */
  const schemaOf = (card: CardData, name: string) => {
    const schema = toolSchemas(card).find((entry) => entry.function.name === name)
    if (!schema) throw new Error('no such tool: ' + name)
    return schema.function.parameters
  }

  it('maps each state type to the matching tool parameter', () => {
    const params = schemaOf(shapes(), 'patch_lead')
    expect(params.properties.rank).toEqual({ type: 'integer', minimum: 1, maximum: 5 })
    expect(params.properties.level).toEqual({ type: 'integer' })
    expect(params.properties.tags).toEqual({ type: 'object', additionalProperties: { type: 'string' } })
    // merge 一个字段都不必给（schema 里没有「必填」这个键了）
    expect(params.required).toEqual([])
  })

  it('takes the key from the map element when the element declares that field', () => {
    const params = schemaOf(shapes(), 'upsert_person')
    expect(Object.keys(params.properties).sort()).toEqual(['name', 'note'])
    expect(params.required).toEqual(['name'])
  })

  it('creates the missing middle object on the way to the leaf', () => {
    const card = shapes()
    const state: StateTree = {}
    const outcome = runAction(card, state, 'set_deep', { value: 'x' })
    expect(outcome.ok && outcome.kind === 'state' && outcome.change.path).toBe('deep.inner')
    expect(state).toEqual({ deep: { inner: { value: 'x' } } })
  })

  it('creates the list when a push action writes into a list that is not there yet', () => {
    const state: StateTree = {}
    const outcome = runAction(shapes(), state, 'write_log', { what: 'first' })
    expect(outcome.ok).toBe(true)
    expect(state).toEqual({ log: [{ what: 'first' }] })
  })

  it('writes a scalar path through the single value parameter, and refuses extra arguments', () => {
    const card = shapes()
    const state = instantiate(card)
    const outcome = runAction(card, state, 'set_profile', { value: 'a profile' })
    expect(outcome.ok && outcome.kind === 'state' && outcome.change.path).toBe('player.profile')
    expect(state.player).toEqual({ profile: 'a profile' })

    // 契约里没有的参数直接拒（模型可以照着错误自己改）
    expect(runAction(card, state, 'set_profile', { value: 'x', patch: 'y' })).toEqual({
      ok: false,
      error: 'set_profile: unknown argument "patch"',
    })
    expect(runAction(card, state, 'set_profile', { value: 7 }).ok).toBe(false)
  })
})

describe('prompts.ts - a prompt module that is not base64', () => {
  it('refuses to decode it instead of sending garbage to the model', async () => {
    // 虚拟模块的内容是构建期产物：坏掉时必须在装配层就炸，而不是把乱码发给模型
    vi.doMock('virtual:prompt/zh-CN/opening', () => ({ default: '!!! not base64 !!!' }))
    vi.resetModules()
    // ⚠️ 重置模块图会重来一份 i18n（它的初始 locale 是 en）：先把它钉住，断言才稳定
    const fresh = await import('../src/i18n')
    ;(fresh.i18n.global.locale as unknown as { value: string }).value = 'zh-CN'
    await expect(import('../src/agent/prompts')).rejects.toThrow(fresh.t('prompts.badBase64'))
    vi.doUnmock('virtual:prompt/zh-CN/opening')
  })
})

describe('card-graph.ts - narrationOf on a short output list', () => {
  it('throws (there is no text to take) instead of returning undefined', () => {
    const card = loadCard(EXAMPLE_CARD)
    expect(() => narrationOf(card, [])).toThrow()
  })
})
