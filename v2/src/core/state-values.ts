/**
 * 值这一层：标量（数字 / 下拉 / 时间）的范围与白名单，外加数组（阶段 3）的 item 形状与默认值。
 *
 * 「这个值能不能放进这个元素」只有一份判据 —— 卡校验、存档校验、写入执行、编辑器默认值都从这里取。
 * 数组的 item 是**同构普通对象**：键集合恰好等于字段定义全集（缺键 / 多键 / 多出 id 都是坏值）。
 *
 * **数组字段与普通节点同权**（老板 2026-11-28 口径）：字段可以**同时有自己的标量值和子字段**。
 * 这种字段在 item 里的值是一层对象：自身的值住**完整值路径** `<code>.0`（与扁平树同一套口径），
 * 子字段用它们的完整 code 做键 —— `{ "2.4.1.0": 自己, "2.4.1.1": 子值, … }`。
 * 没有子字段时仍就是一个裸标量（不凭空多一层对象）。对象字段没有自身值（只有孩子），
 * 数组字段的值是嵌套 item 列表。
 */
import { INTEGER_LIMIT, childrenOf, isRecord } from './state-codes'
import { isTimeValue } from './timevalue'
import type { ArrayValue, ItemObject, ItemValue, StateElement } from './types'

/**
 * 数字的四个格与缺省值（契约 §2.1）：缺省只在这里写一次。
 * 校验（`integerValueFits` / `integerStepFits`）与编辑器的 `min~max` 小字（`StateForm` 的
 * `[data-initial-range]`、数组 item 的 `[data-array-range]`）都读这一份。
 */
export function integerRangeOf(element: StateElement): {
  min: number
  max: number
  stepMin: number
  stepMax: number
} {
  return {
    min: element.min ?? -INTEGER_LIMIT,
    max: element.max ?? INTEGER_LIMIT,
    stepMin: element.stepMin ?? 0,
    stepMax: element.stepMax ?? INTEGER_LIMIT,
  }
}

/**
 * 一个值能不能放进这个数字元素：安全整数、`abs ≤ 1e9`、在 `[min, max]` 内。
 * **不看步幅** —— 初值与存档树只受上下限约束（步幅只管单次写入）。
 * 卡校验 / 存档校验 / 写入执行 / 数组 item 四处共用这一份（契约 §2.1 / §4.3）。
 */
export function integerValueFits(element: StateElement, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > INTEGER_LIMIT)
    return false
  const { min, max } = integerRangeOf(element)
  return value >= min && value <= max
}

/** 单次写入的步幅 `|new − old|` 要在 `[stepMin, stepMax]` 内；旧值不是数字时按 0 算 */
export function integerStepFits(element: StateElement, value: number, before: unknown): boolean {
  const { stepMin, stepMax } = integerRangeOf(element)
  const step = typeof before === 'number' ? Math.abs(value - before) : 0
  return step >= stepMin && step <= stepMax
}

/** enum 的值必须是白名单里的字符串（卡校验 / 存档校验 / 写入执行共用） */
export function enumValueFits(element: StateElement, value: unknown): value is string {
  return typeof value === 'string' && (element.values ?? []).includes(value)
}

/**
 * 一个**值路径**上的值是不是这个元素认的形状（初始值 / 存档树 / 写入执行共用）。
 * 这里走的是扁平树口径：标量节点的自身值住在 `<code>.0`，所以带孩子的标量**不在这一层**收成对象；
 * 数组走 `arrayValueFits`（要整棵字段定义才判得了 item 形状）。
 */
export function valueFits(state: StateElement[], element: StateElement, value: unknown): boolean {
  switch (element.type) {
    case 'time':
      return isTimeValue(value, element.timeMode)
    case 'text':
      return typeof value === 'string'
    case 'integer':
      return integerValueFits(element, value)
    case 'enum':
      return enumValueFits(element, value)
    case 'array':
      return arrayValueFits(state, element.code, value)
    default:
      return true
  }
}

/** 一个**结构体容器**（数组元素 / 数组字段 / 对象字段）的对象形状：键集合恰好等于它的字段定义 */
function structFits(state: StateElement[], code: string, value: unknown): boolean {
  if (!isRecord(value)) return false
  const fields = childrenOf(state, code)
  if (Object.keys(value).length !== fields.length) return false
  return fields.every((field) => field.code in value && fieldValueFits(state, field, value[field.code]))
}

/** 一个标量字段自己的值（不管有没有孩子，值本身按类型收） */
function scalarFits(field: StateElement, value: unknown): boolean {
  if (field.type === 'text') return typeof value === 'string'
  if (field.type === 'integer') return integerValueFits(field, value)
  if (field.type === 'enum') return enumValueFits(field, value)
  return false
}

/**
 * 一个 **item 里字段的值**（权限引用写一格、item 形状、提示词投影三处共用）：
 *   · 标量字段没有孩子 ⇒ 裸标量；
 *   · 标量字段有孩子 ⇒ `{ "<code>.0": 自己的值, 子字段 code: 子值, … }`（键集合恰好是自身值路径 + 孩子）；
 *   · 对象字段 ⇒ 只有孩子 code 的对象；数组字段 ⇒ 嵌套 item 列表；
 *   · 时间不能做字段（坏卡）。
 */
export function fieldValueFits(state: StateElement[], field: StateElement, value: unknown): boolean {
  if (field.type === 'object') return structFits(state, field.code, value)
  if (field.type === 'array') return arrayValueFits(state, field.code, value)
  const children = childrenOf(state, field.code)
  if (children.length === 0) return scalarFits(field, value)
  if (!isRecord(value)) return false
  if (Object.keys(value).length !== children.length + 1) return false
  const ownKey = `${field.code}.0`
  if (!(ownKey in value) || !scalarFits(field, value[ownKey])) return false
  return children.every((child) => child.code in value && fieldValueFits(state, child, value[child.code]))
}

/**
 * 数组值是不是这个数组元素认的形状：必须是数组（`[]` 合法），
 * 每个 item 都是键集合恰好等于字段定义全集的普通对象，字段值按类型递归。
 * **不做数字字符串收编**：item 里的整数必须是 JSON 整数。
 */
export function arrayValueFits(state: StateElement[], code: string, value: unknown): value is ArrayValue {
  return Array.isArray(value) && value.every((item) => structFits(state, code, item))
}

/** 一个标量字段自己的默认值（text `''` / integer 夹进上下限的 0 / enum 白名单第一项） */
function scalarDefaultOf(field: StateElement): ItemValue {
  if (field.type === 'integer') {
    const { min, max } = integerRangeOf(field)
    return Math.min(Math.max(0, min), max)
  }
  if (field.type === 'enum') return (field.values ?? [])[0] ?? ''
  return ''
}

/**
 * 一个 item 里字段的默认值（加字段 / 新 item / 换类型共用）：
 * 有孩子的标量字段 ⇒ `{ "<code>.0": 自己默认, 子字段 code: 子默认, … }`；对象字段 ⇒ 孩子默认；数组字段 ⇒ `[]`。
 */
export function fieldDefaultOf(state: StateElement[], field: StateElement): ItemValue {
  if (field.type === 'object') {
    return Object.fromEntries(
      childrenOf(state, field.code).map((child) => [child.code, fieldDefaultOf(state, child)]),
    )
  }
  if (field.type === 'array') return []
  const children = childrenOf(state, field.code)
  const own = scalarDefaultOf(field)
  if (children.length === 0) return own
  return Object.fromEntries([
    [`${field.code}.0`, own],
    ...children.map((child) => [child.code, fieldDefaultOf(state, child)]),
  ])
}

/**
 * 新建一个 item 的默认值（编辑器「加一项」与「加字段」共用，唯一来源）：
 * 键 = 字段的完整 code，值 = 该字段的默认值。
 */
export function arrayItemOf(state: StateElement[], code: string): ItemObject {
  return Object.fromEntries(
    childrenOf(state, code).map((field) => [field.code, fieldDefaultOf(state, field)]),
  )
}
