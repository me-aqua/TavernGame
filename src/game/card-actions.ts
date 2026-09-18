/**
 * src/game/card-actions.ts —— 把卡的 actions 推导成原生工具，并执行它们。
 *
 * 作者只写两件事：这个动作叫什么、它写到哪（path / mode / key）或它是哪个内置效果
 * （effect）。**参数契约由引擎从 state schema 推导**，作者不写参数：
 *   · `path` 指向 object → 摊平它的字段（set 全部必给，merge 只必给标了 required 的）；
 *   · `path` 指向 list（push）或 map（必须给 key）→ 摊平**元素** schema，再看看 key 是不是
 *     元素自己的字段；元素不是 object 时参数只有一个 `value`；
 *   · `effect: "time"` → 引擎给的 { minutes, reason }（minutes 是唯一的推进量）；
 *   · `effect: "redo"` → { from, why }，from 的 enum 是**调用者自己与它前面的节点**。
 *
 * schema 上的 note（给模型的规则）拼进对应动作的 tool description —— 规则与形状不分家，
 * 也不用每次调用都发一遍。
 *
 * 执行：**先按节点的 tools 白名单挡一次**（不在名单里的动作直接回结构化错误）→ 校验参数
 * → 按 mode 写进**工作副本** → 返回 { result, change }（change 给调试面板与
 * stateChange 事件用）。**参数不合法不抛错**：返回一句结构化错误，由调用方当工具结果回传给
 * 模型自己改 —— 这正是原生工具调用比解析文本强的地方。
 *
 * ⚠️ 纯函数、不 import Vue：所以工具说明里引擎自带的那几句是英文的（仓库纪律：源码 ASCII）。
 */

import type { Action, CardData } from './card'
import { isRecord } from './card-read'
import {
  isRequired,
  schemaAt,
  schemaElement,
  schemaFields,
  schemaType,
  validateValue,
  type Schema,
  type StateTree,
} from './card-state'

/** 工具参数（OpenAI 兼容的 JSON Schema 子集） */
export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  minimum?: number
  maximum?: number
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
  required?: string[]
  additionalProperties?: ToolParameter
}

/** 一个声明给模型的工具 */
export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, ToolParameter>
      required: string[]
    }
  }
}

/** 一次写入落在哪、写成了什么（调试面板与 stateChange 事件的原样数据） */
export interface ActionChange {
  path: string
  value: unknown
}

/**
 * 一次动作执行的结果。
 *
 * state = 已经写进工作副本；time / redo 是**引擎内置效果**，参数校验完交回调用方
 * （时间由引擎按历法推进，redo 由回合循环回滚重跑）；error = 回传给模型的结构化错误。
 */
export type ActionOutcome =
  | { ok: true; kind: 'state'; result: string; change: ActionChange }
  | { ok: true; kind: 'time'; minutes: number; reason: string }
  | { ok: true; kind: 'redo'; from: string; why: string }
  | { ok: false; error: string }

/** 写入模式 */
type Mode = 'set' | 'merge' | 'push'

/** map 的键参数（元素里没有同名字段时用它） */
const KEY_PARAM: ToolParameter = { type: 'string', description: 'the map key this entry is stored under' }

/** effect: "time" 的参数 —— 推进量只有一个数 */
const TIME_PARAMS = {
  properties: {
    minutes: {
      type: 'integer',
      minimum: 0,
      description: 'minutes elapsed in this card calendar; 0 means time stood still this turn',
    },
    reason: { type: 'string', description: 'why that much time passed (one line)' },
  },
  required: ['minutes'],
}

/** 这个节点能用的动作：节点声明了 tools 就只给那些，不写 = 卡里全部 */
export function availableActions(card: CardData, nodeId?: string): string[] {
  const all = Object.keys(card.actions)
  if (nodeId === undefined) return all
  return card.graph.nodes[nodeId].tools ?? all
}

/** 某个节点可以退回的节点：它自己，以及排在它前面的全部节点（拓扑前缀） */
function redoCandidates(card: CardData, nodeId?: string): string[] {
  const topology = card.graph.topology
  if (nodeId === undefined) return topology
  return topology.slice(0, topology.indexOf(nodeId) + 1)
}

/** 一个 state schema → 工具参数（嵌套对象一律要求全部字段：写的是整块值） */
function paramSchema(schema: Schema): ToolParameter {
  const type = schemaType(schema)
  const node = schema as Exclude<Schema, string>
  switch (type) {
    case 'string':
      return { type: 'string' }
    case 'integer':
      return withRange({ type: 'integer' }, node)
    case 'number':
      return withRange({ type: 'number' }, node)
    case 'boolean':
      return { type: 'boolean' }
    case 'enum':
      return { type: 'string', enum: [...(node.values ?? [])] }
    case 'list':
      return { type: 'array', items: paramSchema(node.of as Schema) }
    case 'map':
      return { type: 'object', additionalProperties: paramSchema(node.of as Schema) }
    case 'object': {
      const fields = node.fields ?? {}
      const properties: Record<string, ToolParameter> = {}
      for (const [name, sub] of Object.entries(fields)) properties[name] = paramSchema(sub)
      return { type: 'object', properties, required: Object.keys(fields) }
    }
  }
}

/** 数值参数的区间（可选） */
function withRange(param: ToolParameter, node: { range?: [number, number] }): ToolParameter {
  if (node.range === undefined) return param
  return { ...param, minimum: node.range[0], maximum: node.range[1] }
}

/** object schema 摊平成顶层参数：set 全部必给，merge 只必给标了 required 的 */
function fieldParams(
  schema: Schema,
  mode: Mode,
): { properties: Record<string, ToolParameter>; required: string[] } {
  const fields = schemaFields(schema) ?? {}
  const properties: Record<string, ToolParameter> = {}
  for (const [name, sub] of Object.entries(fields)) properties[name] = paramSchema(sub)
  const required =
    mode === 'merge'
      ? Object.entries(fields)
          .filter(([, sub]) => isRequired(sub))
          .map(([name]) => name)
      : Object.keys(fields)
  return { properties, required }
}

/** 一个动作的参数契约 */
function actionParams(
  card: CardData,
  action: Action,
  nodeId?: string,
): { properties: Record<string, ToolParameter>; required: string[] } {
  if (action.effect === 'time') return TIME_PARAMS
  if (action.effect === 'redo') {
    return {
      properties: {
        from: {
          type: 'string',
          enum: redoCandidates(card, nodeId),
          description: 'which step was wrong (yourself or an earlier node)',
        },
        why: { type: 'string', description: 'what is wrong (one line; the rerun sees it)' },
      },
      required: ['from', 'why'],
    }
  }

  const path = action.path as string
  const mode: Mode = action.mode ?? 'set'
  const target = schemaAt(card.state, path) as Schema

  if (mode === 'push') {
    const element = schemaElement(target) as Schema
    if (schemaType(element) === 'object') return fieldParams(element, 'set')
    return { properties: { value: paramSchema(element) }, required: ['value'] }
  }
  if (schemaType(target) === 'map') {
    const element = schemaElement(target) as Schema
    const key = action.key as string
    if (schemaType(element) === 'object') {
      const inner = fieldParams(element, mode)
      if (Object.hasOwn(inner.properties, key)) {
        return { properties: inner.properties, required: [...new Set([key, ...inner.required])] }
      }
      return { properties: { [key]: KEY_PARAM, ...inner.properties }, required: [key, ...inner.required] }
    }
    return { properties: { [key]: KEY_PARAM, value: paramSchema(element) }, required: [key, 'value'] }
  }
  if (schemaType(target) === 'object') return fieldParams(target, mode)
  return { properties: { value: paramSchema(target) }, required: ['value'] }
}

/** 一段 schema 子树的 note（含自己），路径按「写到哪」拼 */
function collectNotes(schema: Schema, prefix: string, out: string[]): void {
  const note = typeof schema === 'string' ? undefined : schema.note
  if (note !== undefined) out.push('[' + prefix + '] ' + note)
  for (const [name, sub] of Object.entries(schemaFields(schema) ?? {})) {
    collectNotes(sub, prefix + '.' + name, out)
  }
  const element = schemaElement(schema)
  if (element !== undefined) {
    collectNotes(element, prefix + (schemaType(schema) === 'map' ? '.*' : '[]'), out)
  }
}

/** 这个动作会写到的那几段 schema 上的 note —— 拼进它的 tool description */
function notesFor(card: CardData, action: Action): string[] {
  const path = action.path as string
  const lines: string[] = []
  let scope: Record<string, Schema> | undefined = card.state
  let walked = ''
  for (const segment of path.split('.')) {
    if (scope === undefined || !Object.hasOwn(scope, segment)) break
    const node = scope[segment]
    walked = walked ? walked + '.' + segment : segment
    const note = typeof node === 'string' ? undefined : node.note
    if (note !== undefined) lines.push('[' + walked + '] ' + note)
    scope = schemaFields(node)
  }
  const target = schemaAt(card.state, path) as Schema
  const mode: Mode = action.mode ?? 'set'
  const keyed = schemaType(target) === 'map'
  const written = mode === 'push' || keyed ? (schemaElement(target) as Schema) : target
  if (written === target) {
    for (const [name, sub] of Object.entries(schemaFields(target) ?? {})) {
      collectNotes(sub, path + '.' + name, lines)
    }
  } else {
    collectNotes(written, path + (keyed ? '.*' : '[]'), lines)
  }
  return lines
}

/** 动作的 tool description：作者写的 what + 写到那几段 schema 上的 note */
function descriptionOf(card: CardData, action: Action): string {
  const lines = [action.what]
  if (action.path !== undefined) {
    for (const note of notesFor(card, action)) lines.push('- ' + note)
  }
  return lines.join('\n')
}

/** 某个节点能用的全部工具（不传 nodeId = 卡里全部动作） */
export function toolSchemas(card: CardData, nodeId?: string): ToolSchema[] {
  return availableActions(card, nodeId).map((name) => {
    const action = card.actions[name]
    const { properties, required } = actionParams(card, action, nodeId)
    return {
      type: 'function',
      function: {
        name,
        description: descriptionOf(card, action),
        parameters: { type: 'object', properties, required },
      },
    }
  })
}

/** 路径的父级对象；中间缺的字段按需建出来（不写 initial 的字段就是这样出现的） */
function parentOf(state: StateTree, segments: string[]): Record<string, unknown> {
  let scope: Record<string, unknown> = state
  for (const segment of segments.slice(0, -1)) {
    const next = scope[segment]
    if (isRecord(next)) {
      scope = next
      continue
    }
    const created: Record<string, unknown> = {}
    scope[segment] = created
    scope = created
  }
  return scope
}

/** 非对象元素的参数只有一个 value：多给的参数直接拒（契约里没有它） */
function soleValue(name: string, args: Record<string, unknown>): { value: unknown } | { error: string } {
  for (const argName of Object.keys(args)) {
    if (argName !== 'value') return { error: name + ': unknown argument "' + argName + '"' }
  }
  return { value: args.value }
}

/** 参数里的键：map 的条目名必须是一个非空字符串 */
function entryKeyOf(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 元素对象不含这个键字段时，把键从参数里摘掉（它只当 map 的键用） */
function withoutKey(args: Record<string, unknown>, key: string, element: Schema): Record<string, unknown> {
  if (Object.hasOwn(schemaFields(element) ?? {}, key)) return args
  const rest: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(args)) {
    if (name !== key) rest[name] = value
  }
  return rest
}

/**
 * 执行一次工具调用。
 *
 * 校验不过返回 { ok: false, error }（调用方原样当工具结果回传，让模型自己改）；
 * path 型写进 state（工作副本）并返回 { result, change }；time / redo 交回调用方。
 */
export function runAction(
  card: CardData,
  state: StateTree,
  name: string,
  args: unknown,
  nodeId?: string,
): ActionOutcome {
  if (!Object.hasOwn(card.actions, name)) return { ok: false, error: 'unknown action "' + name + '"' }
  // 节点的 tools 白名单是**机制**，不是给模型看的广告：请求里的 tools 表只说明「有哪些牌」，
  // 而模型的输出是外部输入 —— 它报一个没给它的动作时，在这里挡下，照旧回结构化错误
  if (nodeId !== undefined) {
    const allowed = availableActions(card, nodeId)
    if (!allowed.includes(name)) {
      return { ok: false, error: name + ': this node may only use ' + JSON.stringify(allowed) }
    }
  }
  const action = card.actions[name]
  if (!isRecord(args)) return { ok: false, error: name + ': arguments must be a JSON object' }

  if (action.effect === 'time') {
    const minutes = args.minutes
    if (!Number.isInteger(minutes) || (minutes as number) < 0) {
      return {
        ok: false,
        error: name + ': minutes must be an integer >= 0 (got ' + JSON.stringify(minutes) + ')',
      }
    }
    if (args.reason !== undefined && typeof args.reason !== 'string') {
      return { ok: false, error: name + ': reason must be a string' }
    }
    return { ok: true, kind: 'time', minutes: minutes as number, reason: (args.reason as string) ?? '' }
  }

  if (action.effect === 'redo') {
    const candidates = redoCandidates(card, nodeId)
    if (typeof args.from !== 'string' || !candidates.includes(args.from)) {
      const allowed = JSON.stringify(candidates)
      return {
        ok: false,
        error: name + ': from must be one of ' + allowed + ' (got ' + JSON.stringify(args.from) + ')',
      }
    }
    if (typeof args.why !== 'string' || args.why.length === 0) {
      return { ok: false, error: name + ': why must be a non-empty string' }
    }
    return { ok: true, kind: 'redo', from: args.from, why: args.why }
  }

  const path = action.path as string
  const mode: Mode = action.mode ?? 'set'
  const target = schemaAt(card.state, path) as Schema
  const targetType = schemaType(target)

  // 参数 → 要写的值（顶层整体替换时字段一个不能少，merge 可以只写一部分）
  let value: unknown
  let key: string | undefined
  if (mode === 'push') {
    const element = schemaElement(target) as Schema
    if (schemaType(element) === 'object') {
      value = args
    } else {
      const only = soleValue(name, args)
      if ('error' in only) return { ok: false, error: only.error }
      value = only.value
    }
    const problem = validateValue(element, value, path, false)
    if (problem !== null) return { ok: false, error: name + ': ' + problem }
  } else if (targetType === 'map') {
    const keyName = action.key as string
    key = entryKeyOf(args, keyName)
    if (key === undefined) {
      return { ok: false, error: name + ': ' + keyName + ' must be a non-empty string (the map key)' }
    }
    const element = schemaElement(target) as Schema
    value = schemaType(element) === 'object' ? withoutKey(args, keyName, element) : args.value
    const problem = validateValue(element, value, path + '.' + key, mode === 'merge')
    if (problem !== null) return { ok: false, error: name + ': ' + problem }
  } else if (targetType === 'object') {
    value = args
    const problem = validateValue(target, value, path, mode === 'merge')
    if (problem !== null) return { ok: false, error: name + ': ' + problem }
  } else {
    const only = soleValue(name, args)
    if ('error' in only) return { ok: false, error: only.error }
    value = only.value
    const problem = validateValue(target, value, path, false)
    if (problem !== null) return { ok: false, error: name + ': ' + problem }
  }

  // 写进工作副本
  const segments = path.split('.')
  const parent = parentOf(state, segments)
  const leaf = segments[segments.length - 1]
  let change: ActionChange
  let result: string
  if (key !== undefined) {
    const scope = isRecord(parent[leaf]) ? (parent[leaf] as Record<string, unknown>) : {}
    parent[leaf] = scope
    const before = scope[key]
    const next =
      mode === 'merge' && isRecord(before) ? { ...before, ...(value as Record<string, unknown>) } : value
    scope[key] = next
    change = { path: path + '.' + key, value: next }
    result = (mode === 'merge' ? 'merged ' : 'wrote ') + change.path + ' = ' + JSON.stringify(next)
  } else if (mode === 'push') {
    const list = parent[leaf]
    if (Array.isArray(list)) list.push(value)
    else parent[leaf] = [value]
    change = { path, value }
    result = 'pushed to ' + path + ': ' + JSON.stringify(value)
  } else if (mode === 'merge') {
    const before = parent[leaf]
    const next = isRecord(before) ? Object.assign(before, value) : value
    parent[leaf] = next
    change = { path, value: next }
    result = 'merged ' + path + ' = ' + JSON.stringify(next)
  } else {
    parent[leaf] = value
    change = { path, value }
    result = 'wrote ' + path + ' = ' + JSON.stringify(value)
  }
  return { ok: true, kind: 'state', result, change }
}
