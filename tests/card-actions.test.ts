/**
 * card-actions 测试 —— 从卡的 actions 推导工具、执行写入。
 *
 * 两条判据：**参数契约是推导出来的**（set 全字段必给、merge 只必给标了 required 的、
 * push / key 摊平元素 schema、effect 走引擎给的形状），**执行只写工作副本** ——
 * 参数不合法返回一句结构化错误（不抛错、不改状态），写成功返回 { result, change }。
 *
 * ⚠️ 参数不合法**不许改状态**：模型下一轮还会拿同一份状态重试，改了一半比不改更糟。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CardData } from '../src/game/card'
import { availableActions, runAction, toolSchemas, type ToolParameter } from '../src/game/card-actions'
import { instantiate } from '../src/game/card-state'
import { EXAMPLE_CARD, NIGHT_WATCH_CARD, minimalCard } from './support/card-fixtures'

const card = () => minimalCard() as unknown as CardData
const nightWatch = () => JSON.parse(readFileSync(NIGHT_WATCH_CARD, 'utf8')) as CardData
const example = () => JSON.parse(readFileSync(EXAMPLE_CARD, 'utf8')) as CardData

/** 某个动作推导出来的工具参数 */
function paramsOf(
  source: CardData,
  name: string,
  nodeId?: string,
): { properties: Record<string, ToolParameter>; required: string[] } {
  const tool = toolSchemas(source, nodeId).find((item) => item.function.name === name)
  if (tool === undefined) throw new Error('no such tool: ' + name)
  return tool.function.parameters
}

/** 某个动作推导出来的说明 */
function descriptionOf(source: CardData, name: string): string {
  const tool = toolSchemas(source).find((item) => item.function.name === name)
  if (tool === undefined) throw new Error('no such tool: ' + name)
  return tool.function.description
}

/** 跑一次动作；失败时把错误读成文本 */
function errorOf(source: CardData, name: string, args: unknown, nodeId?: string): string {
  const outcome = runAction(source, instantiate(source), name, args, nodeId)
  return outcome.ok ? '' : outcome.error
}

describe('toolSchemas: the parameters are derived from the state schema', () => {
  it('flattens an object target and requires every field for a set write', () => {
    const params = paramsOf(card(), 'set_place')
    expect(Object.keys(params.properties)).toEqual(['area', 'spot', 'scene'])
    expect(params.required).toEqual(['area', 'spot', 'scene'])
  })

  it('makes the fields optional for a merge write', () => {
    const params = paramsOf(card(), 'move_lead')
    expect(Object.keys(params.properties)).toEqual(['mood', 'injuries'])
    expect(params.required).toEqual([])
  })

  it('flattens the element schema of a keyed map and requires the key', () => {
    const params = paramsOf(card(), 'add_role')
    expect(Object.keys(params.properties)).toEqual(['name', 'tier', 'mood'])
    expect(params.required).toEqual(['name'])
    expect(params.properties.tier.enum).toEqual(['major', 'minor'])
  })

  it('has one value parameter when the map element is a scalar', () => {
    const params = paramsOf(card(), 'set_where')
    expect(Object.keys(params.properties)).toEqual(['who', 'value'])
    expect(params.required).toEqual(['who', 'value'])
  })

  it('takes the element schema for a push', () => {
    expect(paramsOf(card(), 'grow')).toEqual({
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    })
    const log = paramsOf(nightWatch(), 'write_log')
    expect(Object.keys(log.properties)).toEqual(['what', 'when'])
    expect(log.required).toEqual(['what', 'when'])
  })

  it('has a single value parameter when the target is a scalar', () => {
    const params = paramsOf(example(), 'set_profile')
    expect(Object.keys(params.properties)).toEqual(['value'])
    expect(params.properties.value.type).toBe('string')
  })

  it('gives the engine-defined shape to the two effects', () => {
    const time = paramsOf(card(), 'advance_time')
    expect(Object.keys(time.properties)).toEqual(['minutes', 'reason'])
    expect(time.required).toEqual(['minutes'])
    expect(time.properties.minutes.minimum).toBe(0)
    expect(time.properties.minutes.type).toBe('integer')
    const redo = paramsOf(card(), 'redo')
    expect(redo.required).toEqual(['from', 'why'])
    expect(redo.properties.from.enum).toEqual(['first', 'second'])
  })

  it('limits redo candidates to the caller and the nodes before it', () => {
    // 夹具的节点只声明了 set_place；给它们加上 redo 才能看到按节点裁剪的 enum
    const withRedo = card()
    withRedo.graph.nodes.first.tools = ['redo']
    withRedo.graph.nodes.second.tools = ['redo']
    expect(paramsOf(withRedo, 'redo', 'first').properties.from.enum).toEqual(['first'])
    expect(paramsOf(withRedo, 'redo', 'second').properties.from.enum).toEqual(['first', 'second'])
  })

  it('only hands a node the tools it declares', () => {
    expect(availableActions(card(), 'first')).toEqual(['set_place'])
    expect(availableActions(card(), 'second')).toEqual([])
    expect(toolSchemas(card(), 'second')).toEqual([])
    expect(availableActions(card())).toHaveLength(7)
  })

  it('hangs the schema notes on the tool description', () => {
    expect(descriptionOf(card(), 'set_place')).toContain('[world.location] where the lead is')
    expect(descriptionOf(card(), 'add_role')).toContain('[roles.*.tier] major gets four segments')
    // 没有 path 的效果动作只有作者写的 what
    expect(descriptionOf(card(), 'advance_time')).toBe('pass time')
  })
})

describe('runAction: writes go into the working copy', () => {
  it('sets an object and reports the change', () => {
    const source = card()
    const state = instantiate(source)
    const outcome = runAction(source, state, 'set_place', { area: 'x', spot: 'y', scene: 'z' })
    expect(outcome).toEqual({
      ok: true,
      kind: 'state',
      result: 'wrote world.location = {"area":"x","spot":"y","scene":"z"}',
      change: { path: 'world.location', value: { area: 'x', spot: 'y', scene: 'z' } },
    })
    expect((state.world as any).location).toEqual({ area: 'x', spot: 'y', scene: 'z' })
  })

  it('merges into an object that the initial state does not have yet', () => {
    const source = card()
    const state = instantiate(source)
    expect((state.lead as any).now).toBeUndefined()
    const outcome = runAction(source, state, 'move_lead', { mood: 'calm' })
    expect(outcome.ok).toBe(true)
    expect((state.lead as any).now).toEqual({ mood: 'calm' })
    // 第二次合并保留上一次写进去的字段
    runAction(source, state, 'move_lead', { injuries: ['bruise'] })
    expect((state.lead as any).now).toEqual({ mood: 'calm', injuries: ['bruise'] })
  })

  it('merges into one entry of a keyed map', () => {
    const source = card()
    const state = instantiate(source)
    const first = runAction(source, state, 'add_role', { name: 'Salen', tier: 'major' })
    expect(first).toEqual({
      ok: true,
      kind: 'state',
      result: 'merged roles.Salen = {"tier":"major"}',
      change: { path: 'roles.Salen', value: { tier: 'major' } },
    })
    runAction(source, state, 'add_role', { name: 'Salen', mood: 'tired' })
    expect((state.roles as any).Salen).toEqual({ tier: 'major', mood: 'tired' })
  })

  it('writes one entry of a map whose values are scalars', () => {
    const source = card()
    const state = instantiate(source)
    const outcome = runAction(source, state, 'set_where', { who: 'Salen', value: 'the forge' })
    expect(outcome).toEqual({
      ok: true,
      kind: 'state',
      result: 'wrote world.whoIsWhere.Salen = "the forge"',
      change: { path: 'world.whoIsWhere.Salen', value: 'the forge' },
    })
    expect((state.world as any).whoIsWhere).toEqual({ Salen: 'the forge' })
  })

  it('pushes a scalar and an object element', () => {
    const source = card()
    const state = instantiate(source)
    runAction(source, state, 'grow', { value: 'lamp' })
    expect((state.lead as any).pack).toEqual(['rope', 'lamp'])

    const night = nightWatch()
    const nightState = instantiate(night)
    const outcome = runAction(night, nightState, 'write_log', { what: 'fog', when: 'late' })
    expect(outcome).toEqual({
      ok: true,
      kind: 'state',
      result: 'pushed to log: {"what":"fog","when":"late"}',
      change: { path: 'log', value: { what: 'fog', when: 'late' } },
    })
    expect(nightState.log).toEqual([{ what: 'fog', when: 'late' }])
  })

  it('writes into a real card the same way', () => {
    const source = example()
    const state = instantiate(source)
    // 枚举值从卡里读：测试代码必须 ASCII，而卡的内容不是
    const tier = (source.state.roles as any).of.fields.tier.values[1]
    const outcome = runAction(source, state, 'update_role', {
      name: 'Tester',
      tier,
      now: { mood: 'wary' },
    })
    expect(outcome.ok).toBe(true)
    expect((state.roles as any).Tester).toEqual({ tier, now: { mood: 'wary' } })
  })
})

describe('runAction: invalid arguments come back as a message, not an exception', () => {
  it('reports the wrong type with its path', () => {
    expect(errorOf(card(), 'set_place', { area: 3, spot: 'y', scene: 'z' })).toBe(
      'set_place: world.location.area: must be a string (got number)',
    )
  })

  it('reports an unknown field and a missing field', () => {
    expect(errorOf(card(), 'set_place', { area: 'x', spot: 'y', scene: 'z', extra: 1 })).toContain(
      'world.location.extra: unknown field',
    )
    expect(errorOf(card(), 'set_place', { area: 'x' })).toBe('set_place: world.location.spot: is required')
    expect(errorOf(card(), 'add_role', { name: 'x', tier: 'boss' })).toContain('must be one of')
  })

  it('rejects a map write without a usable key', () => {
    expect(errorOf(card(), 'add_role', { tier: 'major' })).toBe(
      'add_role: name must be a non-empty string (the map key)',
    )
    expect(errorOf(card(), 'add_role', { name: '', tier: 'major' })).toContain('must be a non-empty string')
  })

  it('rejects an unknown argument on a scalar target', () => {
    expect(errorOf(card(), 'grow', { value: 'x', extra: 1 })).toBe('grow: unknown argument "extra"')
  })

  it('checks the time effect arguments', () => {
    expect(errorOf(card(), 'advance_time', { minutes: -3 })).toContain('minutes must be an integer >= 0')
    expect(errorOf(card(), 'advance_time', { minutes: 1.5 })).toContain('minutes must be an integer >= 0')
    expect(errorOf(card(), 'advance_time', {})).toContain('minutes must be an integer >= 0')
    expect(errorOf(card(), 'advance_time', { minutes: 5, reason: 7 })).toContain('reason must be a string')
    expect(runAction(card(), instantiate(card()), 'advance_time', { minutes: 5, reason: 'walking' })).toEqual(
      {
        ok: true,
        kind: 'time',
        minutes: 5,
        reason: 'walking',
      },
    )
  })

  it('checks the redo effect against the caller', () => {
    const outcome = runAction(card(), instantiate(card()), 'redo', { from: 'first', why: 'wrong' }, 'second')
    expect(outcome).toEqual({ ok: true, kind: 'redo', from: 'first', why: 'wrong' })
    expect(errorOf(card(), 'redo', { from: 'second', why: 'wrong' }, 'first')).toContain(
      'from must be one of',
    )
    expect(errorOf(card(), 'redo', { from: 'nope', why: 'wrong' })).toContain('from must be one of')
    expect(errorOf(card(), 'redo', { from: 'first', why: '' })).toContain('why must be a non-empty string')
  })

  it('rejects an unknown action and arguments that are not an object', () => {
    expect(runAction(card(), instantiate(card()), 'nope', {})).toEqual({
      ok: false,
      error: 'unknown action "nope"',
    })
    expect(errorOf(card(), 'grow', 'rope')).toBe('grow: arguments must be a JSON object')
  })

  it('leaves the working copy untouched when the arguments do not pass', () => {
    const source = card()
    const state = instantiate(source)
    const before = JSON.stringify(state)
    for (const [name, args] of [
      ['set_place', { area: 3, spot: 'y', scene: 'z' }],
      ['add_role', { tier: 'major' }],
      ['grow', { value: 'x', extra: 1 }],
      ['advance_time', { minutes: -1 }],
      ['redo', { from: 'nope', why: 'x' }],
    ] as const) {
      expect(runAction(source, state, name, args).ok).toBe(false)
    }
    expect(JSON.stringify(state)).toBe(before)
  })
})
