/**
 * src/game/card-state.ts —— 卡声明的状态：schema 的类型、实例化、参数校验与渲染。
 *
 * 只有 6 种类型（string / integer / enum / list / map / object）：够表达卡里的一切，也让
 * 「校验」与「推导工具参数」有唯一的依据。每个字段可选 initial（初值；不写 = 初始状态里没有
 * 这个字段）、note（给模型的一句话规则，进动作的 tool description）。
 *
 * 三件事：
 *   · instantiate(card)：只取有 initial 的字段建一棵**新**树（两次开局不共享数组）；
 *     没有 initial 的 object 由它的字段拼出来，一个字段都没有 initial 就整块缺席。
 *   · validateValue(schema, value, base, partial)：类型 / 枚举 / 区间 / 未知字段。
 *     通过返回 null，失败返回**一句带路径的话**（不抛错）—— 动作层要把它当工具结果回传。
 *   · renderState(state, { reads })：把状态渲染成给模型看的文本，按节点的 reads 裁顶层分支。
 *
 * ⚠️ 纯函数、不 import Vue（i18n 会把 Vue 拉进来），所以这里没有一句面向玩家的文案。
 * ⚠️ 写状态不在这里：动作的 mode / key 逻辑在 card-actions.ts。
 */

import { at, checkOptionalKeys, fail, isRecord, requireText } from './card-read'
import type { CardData } from './card'

/** 状态树的六种类型 */
export type SchemaType = 'string' | 'integer' | 'enum' | 'list' | 'map' | 'object'

/** 一个 schema 节点：完整写法；标量也可以缩写成 "string" 这样的字符串 */
export interface SchemaNode {
  type: SchemaType
  initial?: unknown
  note?: string
  /** integer 的闭区间 */
  range?: [number, number]
  /** enum 的取值白名单 */
  values?: string[]
  /** list / map 的元素 schema */
  of?: Schema
  /** object 的固定字段 */
  fields?: Record<string, Schema>
  /**
   * 这一格是**受保护的容器**：卡里不许有动作对它 `set` 整枝（那一次写入会把整个容器换成另一套），
   * 只许 `merge` 或逐字段写。只许写在 object / map / list 上、只许写 `true`
   * （写 `false` 是一句什么都没说的话）；**不写这个键 = 不受保护** —— 旧卡逐字照旧。
   */
  protected?: true
}

/** schema：完整对象，或标量类型的字符串缩写 */
export type Schema = string | SchemaNode

/** 卡的状态树（实例化之后的数据） */
export type StateTree = Record<string, unknown>

/** 卡声明的状态 schema：顶层键就是状态树的分支名 */
export type StateSchema = Record<string, Schema>

/** 类型表（checkSchema 报错时按它列已知值） */
const SCHEMA_TYPES: SchemaType[] = ['string', 'integer', 'enum', 'list', 'map', 'object']

/** 允许写成裸字符串的类型 —— enum / list / map / object 还需要别的字段，缩写不了 */
const SHORTHAND = ['string', 'integer']

/** 容器类型 —— 「受保护」只许写在它们上面（「整枝替换」说的就是这三样） */
const CONTAINER_TYPES: SchemaType[] = ['object', 'map', 'list']

/** 每个类型额外的键（键集严判：range 写在 string 上会被当成未知键拦下） */
const TYPE_KEYS: Record<SchemaType, string[]> = {
  string: [],
  integer: ['range'],
  enum: ['values'],
  list: ['of'],
  map: ['of'],
  object: ['fields'],
}

/**
 * 所有类型都认识的键。
 *
 * ⚠️ `protected` 进这个名单只是为了让**键集**放行它 —— 「只许写在容器上」那一条报在
 *    `checkProtected` 里：写错了要听见「只能保护容器」，而不是「未知键」（两者都被拒，但差着一条线索）。
 */
const SHARED_KEYS = ['type', 'initial', 'note', 'protected']

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
  checkProtected(value, kind, where)

  if (Object.hasOwn(value, 'note')) requireText(value, 'note', where)
  if (kind === 'integer') checkRange(value, where)
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

// ---------- 受保护那一档：那一格只许逐字段写 ----------

/** `protected` 只许写在容器上、只许写 `true`；不写这个键 = 不受保护 */
function checkProtected(value: Record<string, unknown>, kind: SchemaType, where: string): void {
  if (!Object.hasOwn(value, 'protected')) return
  if (value.protected !== true) {
    fail(at(where, 'protected'), 'must be true (leave the key out for an unprotected node)')
  }
  if (!CONTAINER_TYPES.includes(kind)) {
    fail(
      at(where, 'protected'),
      'only a container (' + CONTAINER_TYPES.join(' / ') + ') can be protected (got ' + kind + ')',
    )
  }
}

/** 一格 schema 被声明成受保护了吗（取值那一半已经在 `checkProtected` 里收成 `true`） */
function isProtected(schema: Schema | undefined): boolean {
  return schema !== undefined && typeof schema !== 'string' && schema.protected === true
}

/** 落点自己、或它任一级真祖（按 `.` 切的前缀）受保护 ⇒ 返回**最靠里**的那一格 */
function protectedOwnerOf(root: StateSchema, path: string): string | undefined {
  let owner: string | undefined
  const segments = path.split('.')
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const prefix = segments.slice(0, depth).join('.')
    if (isProtected(schemaAt(root, prefix))) owner = prefix
  }
  return owner
}

/**
 * 「受保护」那一档：这次写入的落点**是容器**、而它自己或它的某一级真祖受保护 ⇒ 返回那一格的路径；
 * 不受管辖时返回 `undefined`（照旧放行）。
 *
 * ⚠️ **落点**：`path` 指向 map 时是它的一条条目（`path` + `.` + `key`），其余就是 `path` 自己 ——
 *    条目是 object 时 `set` 一次换掉整条记录，那是同一个洞差一级。
 * ⚠️ **只管 `set`**（整枝替换）：落点是标量时 `set` 写的就是那一个字段 —— 那正是「逐字段写」；
 *    `merge` / `push` 由调用方按契约放行。这条规矩只写这一份（`card.ts` 是唯一的调用点）。
 */
export function protectedSetOwner(
  root: StateSchema,
  path: string,
  key: string | undefined,
): string | undefined {
  const target = schemaAt(root, path)
  if (target === undefined) return undefined
  const entry = schemaType(target) === 'map'
  const landingSchema = entry ? schemaElement(target) : target
  if (landingSchema === undefined) return undefined
  if (!CONTAINER_TYPES.includes(schemaType(landingSchema))) return undefined
  return protectedOwnerOf(root, entry && key !== undefined ? at(path, key) : path)
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

/**
 * 校验一个值是否符合 schema。通过返回 null，失败返回一句带路径的话（ASCII，给模型看）。
 *
 * partial = 允许只写一部分字段（动作的 merge 写入用，也可以只写一部分初值）。它只作用于**这一层**：
 * 顶层对象在整体替换（set / push）时字段一个不能少，嵌套的对象值一律允许只写一部分
 * —— 与「merge 是浅合并」同一套语义。
 *
 * ⚠️ schema 语言里**没有「必填」这个键**（2026-09-19 删）：写了它当未知键拦下。
 *    所以 partial 那一层不看的字段**一律算「可以不给」**，没有第二个开关。
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
          if (partial) continue
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

/**
 * 一条记录里那些**文字**栏（按形状取、空串丢掉，顺序即字段顺序）—— 一行摘要（场景行那种）用它。
 *
 * ⚠️ 判类型这件事留在**状态层**（这个文件）：值来自状态树 —— 卡声明的 schema + 存档 + 模型给的参数，
 *    三者都是外部数据，形状检查正是这一层的事（`.githooks/pre-commit` 检查 5 的放行理由逐字如此）。
 *    `game/display.ts` 那种显示层拿到的必须是**已经认过形状**的文字，它自己不再判类型。
 */
export function textValuesOf(value: unknown): string[] {
  if (!isRecord(value)) return []
  return Object.values(value).filter((item): item is string => typeof item === 'string' && item !== '')
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
