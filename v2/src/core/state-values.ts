/**
 * 值这一层：标量（数字 / 下拉 / 时间）的范围与白名单，外加数组（阶段 3）的 item 形状与默认值。
 *
 * 「这个值能不能放进这个元素」只有一份判据 —— 卡校验、存档校验、写入执行、编辑器默认值都从这里取。
 * 数组的 item 是**同构普通对象**：键集合恰好等于字段定义全集（缺键 / 多键 / 多出 id 都是坏值）。
 */
import { INTEGER_LIMIT, childrenOf, isRecord } from './state-codes'
import { isTimeValue } from './timevalue'
import type { ArrayValue, ItemObject, ItemValue, StateElement } from './types'

/**
 * 数字的四个格与缺省值（契约 §2.1）：缺省只在这里写一次。
 * 校验（`integerValueFits` / `integerStepFits`）与编辑器的 `min~max` 小字（`StateForm` 的
 * `[data-initial-range]`）都读这一份，两边不会各写一套缺省值。
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
 * 一个值是不是这个元素认的形状（初始值校验、存档校验、存档编辑器、写入执行共用这一份）。
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

/** 一个「结构体容器」code 的对象值形状：数组容器看每个 item，`object` 容器看它自己 */
function objectFits(state: StateElement[], code: string, value: unknown): boolean {
  if (!isRecord(value)) return false
  const fields = childrenOf(state, code)
  if (Object.keys(value).length !== fields.length) return false
  return fields.every((field) => field.code in value && fieldValueFits(state, field, value[field.code]))
}

/** 一个字段的值：标量按类型收，对象 / 数组字段递归判（权限引用写一格、item 形状、提示词三处共用） */
export function fieldValueFits(state: StateElement[], field: StateElement, value: unknown): boolean {
  switch (field.type) {
    case 'text':
      return typeof value === 'string'
    case 'integer':
      return integerValueFits(field, value)
    case 'enum':
      return enumValueFits(field, value)
    case 'object':
      return objectFits(state, field.code, value)
    case 'array':
      return arrayValueFits(state, field.code, value)
    default:
      return false
  }
}

/**
 * 数组值是不是这个数组元素认的形状：必须是数组（`[]` 合法），
 * 每个 item 都是键集合恰好等于字段定义全集的普通对象，字段值按类型递归。
 * **不做数字字符串收编**：item 里的整数必须是 JSON 整数。
 */
export function arrayValueFits(state: StateElement[], code: string, value: unknown): value is ArrayValue {
  return Array.isArray(value) && value.every((item) => objectFits(state, code, item))
}

/** 一个新 item 里某个字段的默认值（`text` ⇒ `''`、`integer` ⇒ 夹进上下限的 0、`enum` ⇒ 白名单第一项） */
export function fieldDefaultOf(state: StateElement[], field: StateElement): ItemValue {
  switch (field.type) {
    case 'text':
      return ''
    case 'integer': {
      const { min, max } = integerRangeOf(field)
      return Math.min(Math.max(0, min), max)
    }
    case 'enum':
      return (field.values ?? [])[0] ?? ''
    case 'object':
      return Object.fromEntries(
        childrenOf(state, field.code).map((child) => [child.code, fieldDefaultOf(state, child)]),
      )
    case 'array':
      return []
    default:
      return ''
  }
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
