/**
 * src/game/card-state.ts —— 卡声明的状态：schema 的类型、实例化、参数校验与渲染。
 *
 * 只有 7 种类型（string / integer / number / boolean / enum / list / map / object ——
 * integer 与 number 是同一族的两个写法）：够表达卡里的一切，也让「校验」与「推导工具参数」
 * 有唯一的依据。每个字段可选 initial（初值；不写 = 初始状态里没有这个字段）、required
 * （写入时必给）、note（给模型的一句话规则，进动作的 tool description）。
 *
 * 三件事：
 *   · instantiate(card)：只取有 initial 的字段建一棵**新**树（两次开局不共享数组）；
 *     没有 initial 的 object 由它的字段拼出来，一个字段都没有 initial 就整块缺席。
 *   · validateValue(schema, value, base, partial)：类型 / 枚举 / 区间 / 必填 / 未知字段。
 *     通过返回 null，失败返回**一句带路径的话**（不抛错）—— 动作层要把它当工具结果回传。
 *   · renderState(state, { reads })：把状态渲染成给模型看的文本，按节点的 reads 裁顶层分支。
 *
 * ⚠️ 纯函数、不 import Vue（i18n 会把 Vue 拉进来），所以这里没有一句面向玩家的文案。
 * ⚠️ 写状态不在这里：动作的 mode / key 逻辑在 card-actions.ts。
 */

import { at, checkOptionalKeys, fail, isRecord, requireText } from './card-read'
import type { CardData } from './card'

/** 状态树的七种类型 */
export type SchemaType = 'string' | 'integer' | 'number' | 'boolean' | 'enum' | 'list' | 'map' | 'object'

/** 一个 schema 节点：完整写法；标量也可以缩写成 "string" 这样的字符串 */
export interface SchemaNode {
  type: SchemaType
  initial?: unknown
  required?: boolean
  note?: string
  /** integer / number 的闭区间 */
  range?: [number, number]
  /** enum 的取值白名单 */
  values?: string[]
  /** list / map 的元素 schema */
  of?: Schema
  /** object 的固定字段 */
  fields?: Record<string, Schema>
}

/** schema：完整对象，或标量类型的字符串缩写 */
export type Schema = string | SchemaNode

/** 卡的状态树（实例化之后的数据） */
export type StateTree = Record<string, unknown>

/** 卡声明的状态 schema：顶层键就是状态树的分支名 */
export type StateSchema = Record<string, Schema>

/** 类型表（checkSchema 报错时按它列已知值） */
const SCHEMA_TYPES: SchemaType[] = ['string', 'integer', 'number', 'boolean', 'enum', 'list', 'map', 'object']

/** 允许写成裸字符串的类型 —— enum / list / map / object 还需要别的字段，缩写不了 */
const SHORTHAND = ['string', 'integer', 'number', 'boolean']

/** 每个类型额外的键（键集严判：range 写在 string 上会被当成未知键拦下） */
const TYPE_KEYS: Record<SchemaType, string[]> = {
  string: [],
  integer: ['range'],
  number: ['range'],
  boolean: [],
  enum: ['values'],
  list: ['of'],
  map: ['of'],
  object: ['fields'],
}

/** 所有类型都认识的键 */
const SHARED_KEYS = ['type', 'initial', 'required', 'note']

/** 一个 schema 的类型（字符串缩写就是它自己） */
export function schemaType(schema: Schema): SchemaType {
  return typeof schema === 'string' ? (schema as SchemaType) : schema.type
}

/** object 的字段表；别的类型返回 undefined */
export function schemaFields(schema: Schema): Record<string, Schema> | undefined {
  if (typeof schema === 'string' || schema.type !== 'object') return undefined
  return schema.fields
}

/** list / map 的元素 schema；别的类型返回 undefined */
export function schemaElement(schema: Schema): Schema | undefined {
  if (typeof schema === 'string') return undefined
  return schema.of
}

/** 点号路径 → schema；路径不存在返回 undefined（调用方负责报错并带上卡里的路径） */
export function schemaAt(root: StateSchema, path: string): Schema | undefined {
  let current: Schema | undefined
  let scope: Record<string, Schema> | undefined = root
  for (const segment of path.split('.')) {
    if (scope === undefined || !Object.hasOwn(scope, segment)) return undefined
    current = scope[segment]
    scope = schemaFields(current)
  }
  return current
}

/** 校验一份 schema（外部数据），返回它；每个类型只认自己那几个键 */
export function checkSchema(value: unknown, where: string): Schema {
  if (typeof value === 'string') {
    if (!SHORTHAND.includes(value)) {
      fail(where, 'must be a schema object or one of ' + SHORTHAND.join(' / '))
    }
    return value
  }
  if (!isRecord(value)) fail(where, 'must be a schema object')
  const type = value.type
  if (typeof type !== 'string' || !(SCHEMA_TYPES as string[]).includes(type)) {
    fail(at(where, 'type'), 'must be one of ' + SCHEMA_TYPES.join(' / '))
  }
  const kind = type as SchemaType
  checkOptionalKeys(value, [...SHARED_KEYS, ...TYPE_KEYS[kind]], ['type'], where)

  if (Object.hasOwn(value, 'required') && typeof value.required !== 'boolean') {
    fail(at(where, 'required'), 'must be a boolean')
  }
  if (Object.hasOwn(value, 'note')) requireText(value, 'note', where)
  if (kind === 'integer' || kind === 'number') checkRange(value, where)
  if (kind === 'enum') checkValues(value, where)
  if (kind === 'list' || kind === 'map') checkSchema(value.of, at(where, 'of'))
  if (kind === 'object') {
    const fields = value.fields
    if (!isRecord(fields)) fail(at(where, 'fields'), 'must be an object')
    if (Object.keys(fields).length === 0) fail(at(where, 'fields'), 'must not be empty')
    for (const [name, sub] of Object.entries(fields)) checkSchema(sub, at(at(where, 'fields'), name))
  }

  const schema = value as unknown as SchemaNode
  if (Object.hasOwn(value, 'initial')) {
    // 初值也过同一套校验（未知字段、类型、区间、枚举都拦）—— partial：初值可以只写一部分
    const problem = validateValue(schema, value.initial, at(where, 'initial'), true)
    if (problem) fail('', problem)
  }
  return schema
}

/** range 必须是 [min, max]（min <= max） */
function checkRange(value: Record<string, unknown>, where: string): void {
  if (!Object.hasOwn(value, 'range')) return
  const range = value.range
  const ok = Array.isArray(range) && range.length === 2 && range.every((n) => typeof n === 'number')
  if (!ok) fail(at(where, 'range'), 'must be [min, max]')
  if ((range as number[])[0] > (range as number[])[1]) fail(at(where, 'range'), 'min must not exceed max')
}

/** values 必须是非空的字符串数组（枚举值可以重复出现吗？不能 —— 那多半是写错了） */
function checkValues(value: Record<string, unknown>, where: string): void {
  const values = value.values
  if (!Array.isArray(values) || values.length === 0) fail(at(where, 'values'), 'must not be empty')
  if (!values.every((item) => typeof item === 'string' && item.length > 0)) {
    fail(at(where, 'values'), 'must be an array of non-empty strings')
  }
  if (new Set(values).size !== values.length) fail(at(where, 'values'), 'must not repeat a value')
}

/** JSON 值的深拷贝 —— 初值要被每一局各拿一份（共享数组会让两局互相串） */
function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = cloneValue(item)
    return out
  }
  return value
}

/** 单个 schema 的初值；没有初值（也没有可拼的字段）返回 undefined = 初始状态里没有它 */
function instantiateSchema(schema: Schema): unknown {
  if (typeof schema !== 'string' && Object.hasOwn(schema, 'initial')) return cloneValue(schema.initial)
  const fields = schemaFields(schema)
  if (fields === undefined) return undefined
  const out: Record<string, unknown> = {}
  let any = false
  for (const [name, sub] of Object.entries(fields)) {
    const value = instantiateSchema(sub)
    if (value === undefined) continue
    out[name] = value
    any = true
  }
  return any ? out : undefined
}

/** 按卡的 state 建一棵初始状态树 */
export function instantiate(card: CardData): StateTree {
  const out: StateTree = {}
  for (const [branch, schema] of Object.entries(card.state)) {
    const value = instantiateSchema(schema)
    if (value !== undefined) out[branch] = value
  }
  return out
}

/** 值的类型名（错误信息里说「收到 number」用） */
function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** 把「路径 + 原因」拼成一句话；路径为空时只有原因 */
function problem(base: string, reason: string): string {
  return base ? base + ': ' + reason : reason
}

/** 区间检查（range 是闭区间，与卡里的写法一致） */
function rangeProblem(node: SchemaNode, value: number, base: string): string | null {
  if (node.range === undefined) return null
  const [min, max] = node.range
  if (value < min || value > max) return problem(base, 'must be within [' + min + ', ' + max + ']')
  return null
}

/** 这个字段标了 required 吗（写入时必给）—— card-actions 推导工具参数时也读它 */
export function isRequired(sub: Schema): boolean {
  return typeof sub !== 'string' && sub.required === true
}

/**
 * 校验一个值是否符合 schema。通过返回 null，失败返回一句带路径的话（ASCII，给模型看）。
 *
 * partial = 允许只写一部分字段（动作的 merge 写入用）。它只作用于**这一层**：
 * 顶层对象在整体替换（set / push）时字段一个不能少，嵌套的对象值一律允许只写一部分
 * —— 与「merge 是浅合并」同一套语义。
 */
export function validateValue(schema: Schema, value: unknown, base: string, partial = false): string | null {
  const type = schemaType(schema)
  const node = schema as SchemaNode

  switch (type) {
    case 'string':
      return typeof value === 'string'
        ? null
        : problem(base, 'must be a string (got ' + typeName(value) + ')')
    case 'integer':
      if (!Number.isInteger(value)) {
        return problem(base, 'must be an integer (got ' + typeName(value) + ')')
      }
      return rangeProblem(node, value as number, base)
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return problem(base, 'must be a number (got ' + typeName(value) + ')')
      }
      return rangeProblem(node, value, base)
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : problem(base, 'must be a boolean (got ' + typeName(value) + ')')
    case 'enum': {
      const values = node.values ?? []
      if (typeof value === 'string' && values.includes(value)) return null
      return problem(
        base,
        'must be one of ' + JSON.stringify(values) + ' (got ' + JSON.stringify(value) + ')',
      )
    }
    case 'list': {
      if (!Array.isArray(value)) return problem(base, 'must be a list (got ' + typeName(value) + ')')
      for (const [index, item] of value.entries()) {
        const found = validateValue(node.of as Schema, item, base + '[' + index + ']', true)
        if (found) return found
      }
      return null
    }
    case 'map': {
      if (!isRecord(value)) return problem(base, 'must be a map (got ' + typeName(value) + ')')
      for (const [key, item] of Object.entries(value)) {
        const found = validateValue(node.of as Schema, item, at(base, key), true)
        if (found) return found
      }
      return null
    }
    case 'object': {
      if (!isRecord(value)) return problem(base, 'must be an object (got ' + typeName(value) + ')')
      const fields = node.fields ?? {}
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(fields, key)) return problem(at(base, key), 'unknown field')
      }
      for (const [key, sub] of Object.entries(fields)) {
        if (!Object.hasOwn(value, key)) {
          if (partial && !isRequired(sub)) continue
          return problem(at(base, key), 'is required')
        }
        const found = validateValue(sub, value[key], at(base, key), true)
        if (found) return found
      }
      return null
    }
  }
}

/** 渲染选项：reads = 这个节点看得见哪几个顶层分支（不写 = 全部） */
export interface RenderOptions {
  reads?: string[]
}

/** 标量写法：短文本原样，带换行的与其余类型走 JSON 写法（不然缩进会被折断） */
function renderScalar(value: unknown): string {
  if (typeof value === 'string' && !value.includes('\n')) return value
  return JSON.stringify(value)
}

/** 一个列表渲染成若干行：一行一条；对象项的第一行跟在 "- " 后面，其余行缩进对齐 */
function renderList(items: unknown[], indent: string): string[] {
  const lines: string[] = []
  for (const item of items) {
    if (isRecord(item)) {
      const sub = renderBlock(item, indent + '  ')
      sub[0] = indent + '- ' + sub[0].slice(indent.length + 2)
      lines.push(...sub)
      continue
    }
    lines.push(indent + '- ' + renderScalar(item))
  }
  return lines
}

/** 一块数据渲染成若干行（键：值；对象缩进、列表一行一条、空容器写 (empty)） */
function renderBlock(scope: Record<string, unknown>, indent: string): string[] {
  const lines: string[] = []
  for (const [key, value] of Object.entries(scope)) {
    const head = indent + key + ':'
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(head + ' (empty)')
        continue
      }
      lines.push(head, ...renderList(value, indent + '  '))
      continue
    }
    if (isRecord(value)) {
      if (Object.keys(value).length === 0) {
        lines.push(head + ' (empty)')
        continue
      }
      lines.push(head, ...renderBlock(value, indent + '  '))
      continue
    }
    lines.push(head + ' ' + renderScalar(value))
  }
  return lines
}

/**
 * 把状态树渲染成给模型看的文本。reads 给出时只渲染它列出的顶层分支
 * （顺序照状态树自己的声明顺序，不照 reads 的顺序 —— 快照的顺序应当只由卡决定）。
 */
export function renderState(state: StateTree, opts: RenderOptions = {}): string {
  const names = Object.keys(state).filter((name) => opts.reads === undefined || opts.reads.includes(name))
  const lines: string[] = []
  for (const name of names) {
    const value = state[name]
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(name + ': (empty)')
      else lines.push(name + ':', ...renderList(value, '  '))
      continue
    }
    if (isRecord(value)) {
      if (Object.keys(value).length === 0) lines.push(name + ': (empty)')
      else lines.push(name + ':', ...renderBlock(value, '  '))
      continue
    }
    lines.push(name + ': ' + renderScalar(value))
  }
  return lines.join('\n')
}
