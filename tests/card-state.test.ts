/**
 * card-state 测试 —— 状态 schema 的三件事：校验 schema、按初值实例化、把值验进 schema。
 *
 * 这三件事都是纯函数，判据全部可以**用具体值对答案**：初值只取写了 initial 的字段、
 * 未知字段与必填字段在同一层拦下、渲染出来的文本能按 reads 裁剪。实例化出来的树必须
 * 每次都是新的（两局共享一个数组 = 上一局的背包漏进下一局）。
 */
import { describe, expect, it } from 'vitest'
import type { CardData } from '../src/game/card'
import {
  checkSchema,
  instantiate,
  renderState,
  schemaAt,
  schemaElement,
  schemaFields,
  schemaType,
  validateValue,
  type Schema,
} from '../src/game/card-state'
import { minimalCard } from './support/card-fixtures'

const card = () => minimalCard() as unknown as CardData

/** 跑一次校验，把抛出的错误读成文本（通过了就返回空串） */
function errorOf(run: () => unknown): string {
  try {
    run()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('checkSchema', () => {
  it('accepts a shorthand and a full node of every type', () => {
    // 六个类型里能缩写的只有两个（enum / list / map / object 还需要别的字段）
    for (const shorthand of ['string', 'integer']) {
      expect(checkSchema(shorthand, 'state.x')).toBe(shorthand)
    }
    const nodes: Schema[] = [
      { type: 'enum', values: ['a', 'b'] },
      { type: 'list', of: 'string' },
      { type: 'map', of: { type: 'object', fields: { a: 'string' } } },
      { type: 'object', fields: { a: 'string' } },
      { type: 'integer', range: [1, 3], initial: 2, note: 'a rule' },
    ]
    for (const node of nodes) expect(checkSchema(node, 'state.x')).toBe(node)
  })

  it('rejects an unknown shorthand or type', () => {
    expect(errorOf(() => checkSchema('prose', 'state.x'))).toContain('state.x: must be a schema object')
    expect(errorOf(() => checkSchema({ type: 'prose' }, 'state.x'))).toContain('state.x.type')
  })

  it('rejects a key that belongs to another type', () => {
    expect(errorOf(() => checkSchema({ type: 'string', range: [1, 2] }, 'state.x'))).toContain(
      'state.x.range',
    )
    expect(errorOf(() => checkSchema({ type: 'enum', values: ['a'], of: 'string' }, 'state.x'))).toContain(
      'state.x.of',
    )
    expect(errorOf(() => checkSchema({ type: 'list' }, 'state.x'))).toContain('state.x.of')
  })

  it('rejects a malformed range, values, fields, required, note or initial', () => {
    expect(errorOf(() => checkSchema({ type: 'integer', range: [3] }, 'state.x'))).toContain(
      'must be [min, max]',
    )
    expect(errorOf(() => checkSchema({ type: 'integer', range: [9, 1] }, 'state.x'))).toContain(
      'min must not exceed',
    )
    expect(errorOf(() => checkSchema({ type: 'enum', values: [] }, 'state.x'))).toContain('must not be empty')
    expect(errorOf(() => checkSchema({ type: 'enum', values: ['a', 'a'] }, 'state.x'))).toContain(
      'must not repeat',
    )
    expect(errorOf(() => checkSchema({ type: 'object', fields: {} }, 'state.x'))).toContain(
      'must not be empty',
    )
    expect(errorOf(() => checkSchema({ type: 'string', required: 'yes' }, 'state.x'))).toContain(
      'unknown key',
    )
    expect(errorOf(() => checkSchema({ type: 'string', note: '' }, 'state.x'))).toContain(
      'must be a non-empty string',
    )
    expect(errorOf(() => checkSchema({ type: 'integer', initial: 9, range: [1, 3] }, 'state.x'))).toContain(
      'state.x.initial: must be within [1, 3]',
    )
  })
})

describe('schemaAt / schemaFields / schemaElement', () => {
  const root: Record<string, Schema> = {
    lead: { type: 'object', fields: { name: 'string', now: { type: 'object', fields: { mood: 'string' } } } },
    log: { type: 'list', of: 'string' },
  }

  it('walks a dotted path through object fields only', () => {
    expect(schemaType(schemaAt(root, 'lead.now') as Schema)).toBe('object')
    expect(schemaType(schemaAt(root, 'lead.now.mood') as Schema)).toBe('string')
    expect(schemaAt(root, 'lead.missing')).toBeUndefined()
    expect(schemaAt(root, 'nope.now')).toBeUndefined()
    expect(schemaAt(root, 'log.0')).toBeUndefined()
    expect(schemaElement(root.log as Schema)).toBe('string')
    expect(schemaFields(root.lead as Schema)).toEqual({
      name: 'string',
      now: { type: 'object', fields: { mood: 'string' } },
    })
    expect(schemaFields('string')).toBeUndefined()
  })
})

describe('instantiate', () => {
  it('takes only the fields that declare an initial', () => {
    expect(instantiate(card())).toEqual({
      lead: { name: 'nobody', pack: ['rope'] },
      roles: {},
      world: { location: { area: 'a', spot: 'b', scene: 'c' }, map: {}, whoIsWhere: {} },
      player: { profile: 'a tester' },
    })
  })

  it('builds an object from its fields when it has no initial of its own', () => {
    const withNested = {
      ...minimalCard(),
      state: {
        box: {
          type: 'object',
          fields: { a: { type: 'string', initial: 'x' }, b: { type: 'list', of: 'string' } },
        },
        empty: { type: 'object', fields: { a: 'string' } },
      },
    } as unknown as CardData
    expect(instantiate(withNested)).toEqual({ box: { a: 'x' } })
  })

  it('gives every game its own copy of the initial values', () => {
    const first = instantiate(card())
    const second = instantiate(card())
    ;(first.lead as any).pack.push('extra')
    ;((first.world as any).map as Record<string, unknown>).town = { kind: 'made up' }
    expect((second.lead as any).pack).toEqual(['rope'])
    expect((second.world as any).map).toEqual({})
  })
})

describe('validateValue', () => {
  it('accepts the matching scalars and reports the type it got', () => {
    expect(validateValue('string', 'x', 'p')).toBeNull()
    expect(validateValue('integer', 3, 'p')).toBeNull()
    expect(validateValue('string', 7, 'p')).toBe('p: must be a string (got number)')
    expect(validateValue('integer', 3.5, 'p')).toBe('p: must be an integer (got number)')
    expect(validateValue('string', null, 'p')).toBe('p: must be a string (got null)')
    expect(validateValue('string', ['a'], 'p')).toBe('p: must be a string (got array)')
  })

  it('checks a closed range and an enum', () => {
    const ranged: Schema = { type: 'integer', range: [1, 3] }
    expect(validateValue(ranged, 1, 'p')).toBeNull()
    expect(validateValue(ranged, 3, 'p')).toBeNull()
    expect(validateValue(ranged, 4, 'p')).toBe('p: must be within [1, 3]')
    const typed: Schema = { type: 'enum', values: ['a', 'b'] }
    expect(validateValue(typed, 'a', 'p')).toBeNull()
    expect(validateValue(typed, 'c', 'p')).toBe('p: must be one of ["a","b"] (got "c")')
  })

  it('walks lists and maps with an indexed path', () => {
    const list: Schema = { type: 'list', of: 'integer' }
    expect(validateValue(list, [1, 2], 'p')).toBeNull()
    expect(validateValue(list, [1, 'x'], 'p')).toBe('p[1]: must be an integer (got string)')
    expect(validateValue(list, 'x', 'p')).toBe('p: must be a list (got string)')
    const map: Schema = { type: 'map', of: 'string' }
    expect(validateValue(map, { a: 'x' }, 'p')).toBeNull()
    expect(validateValue(map, { a: 1 }, 'p')).toBe('p.a: must be a string (got number)')
    expect(validateValue(map, [], 'p')).toBe('p: must be a map (got array)')
  })

  it('rejects an unknown field and a missing field', () => {
    const object: Schema = { type: 'object', fields: { a: 'string', b: 'string' } }
    expect(validateValue(object, { a: 'x', b: 'y' }, 'p')).toBeNull()
    expect(validateValue(object, { a: 'x', b: 'y', c: 1 }, 'p')).toBe('p.c: unknown field')
    expect(validateValue(object, { a: 'x' }, 'p')).toBe('p.b: is required')
    expect(validateValue(object, { a: 'x' }, 'p', true)).toBeNull()
  })

  it('treats nested objects as partial in both directions', () => {
    const object: Schema = {
      type: 'object',
      fields: { now: { type: 'object', fields: { a: 'string', b: 'string' } } },
    }
    expect(validateValue(object, { now: { a: 'x' } }, 'p', true)).toBeNull()
    expect(validateValue(object, { now: { a: 'x' } }, 'p')).toBeNull()
    expect(validateValue(object, { now: { a: 'x', c: 1 } }, 'p')).toBe('p.now.c: unknown field')
  })
})

describe('renderState', () => {
  it('renders nesting, one list item per line, and empty containers', () => {
    const state = {
      lead: { name: 'nobody', pack: ['rope', 'lamp'] },
      roles: {},
      log: [],
    }
    expect(renderState(state)).toBe(
      [
        'lead:',
        '  name: nobody',
        '  pack:',
        '    - rope',
        '    - lamp',
        'roles: (empty)',
        'log: (empty)',
      ].join('\n'),
    )
  })

  it('renders an object inside a list under the dash', () => {
    const state = { log: [{ what: 'x', when: 'y' }], world: { map: { 'a b': { kind: 'k' } } } }
    expect(renderState(state)).toBe(
      ['log:', '  - what: x', '    when: y', 'world:', '  map:', '    a b:', '      kind: k'].join('\n'),
    )
  })

  it('renders numbers and booleans as JSON and keeps multi-line strings on one line', () => {
    const state = { a: 3, b: true, c: null, note: 'one\ntwo' }
    expect(renderState(state)).toBe(['a: 3', 'b: true', 'c: null', 'note: "one\\ntwo"'].join('\n'))
  })

  it('cuts the top-level branches by reads, in the order the state declares them', () => {
    const state = { lead: { name: 'n' }, roles: {}, world: { map: {} }, player: { profile: 'p' } }
    expect(renderState(state, { reads: ['player', 'world'] })).toBe(
      ['world:', '  map: (empty)', 'player:', '  profile: p'].join('\n'),
    )
    expect(renderState(state, { reads: [] })).toBe('')
    expect(renderState({})).toBe('')
  })
})
