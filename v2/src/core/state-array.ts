/**
 * 数组值的搬运：初始值表里的数组值怎么跟着「加字段 / 删字段 / 换类型」走。
 *
 * 数组的 item 是**纯 JSON 结构体**（键 = 字段 code），字段定义住在 `state[]`；所以这里只有两组活：
 *   · `structsAt`：按字段定义走一遍值树，找到某一层的每个对象；
 *   · `remapArrayValue`：按一张改名表重建数组值 —— 删字段与同层重排时用（键要跟着元素一起改名）。
 *
 * 所有函数都返回**新值**，不修改传进来的数组 / 对象（草稿是共享的，改到原卡就是「值悄悄丢了」）。
 */
import { childrenOf, elementAt, isRecord, parentOfCode } from './state-codes'
import type { ArrayValue, ItemObject, ItemValue, StateElement } from './types'

/** 深拷贝一条树值：数组与普通对象都逐层复制，标量原样 */
export function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T
  }
  return value
}

/**
 * 一个 code 所属的**最外层数组**（值路径就在它身上）：沿祖先往上找，最后一个 `type: 'array'` 的。
 * 不在数组里（含它自己不是数组）⇒ `undefined`。
 */
export function arrayRootOf(state: StateElement[], code: string): string | undefined {
  let found: string | undefined
  for (let at: string | undefined = code; at !== undefined; at = parentOfCode(at)) {
    const element = state.find((item) => item.code === at)
    if (element?.type === 'array') found = at
  }
  return found
}

/** code 这一层的对象：数组容器 ⇒ 它的每个 item；`object` 容器 ⇒ 它自己那一个值 */
function structsOf(state: StateElement[], code: string, value: unknown): Record<string, unknown>[] {
  if (elementAt(state, code).type !== 'array') return isRecord(value) ? [value] : []
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : []
}

/**
 * 值树里 `target` 这一层的全部对象（`target` 是 `ancestor` 自己或它的子孙）。
 * 每一层都可能有多个对象（数组的 item），所以沿字段定义逐层展开而不是只走一条。
 * 换类型要「逐格改值」时也从这里取（`2.4` 的每个 item / 嵌套字段的每一份）。
 */
export function structsAt(
  state: StateElement[],
  ancestor: string,
  value: unknown,
  target: string,
): Record<string, unknown>[] {
  if (ancestor === target) return structsOf(state, ancestor, value)
  const direct = childrenOf(state, ancestor).find(
    (field) => target === field.code || target.startsWith(`${field.code}.`),
  )
  if (!direct) return []
  return structsOf(state, ancestor, value).flatMap((object) =>
    structsAt(state, direct.code, object[direct.code], target),
  )
}

/**
 * 把数组值里 `parent` 那一层的每个对象的一个键换成给定值（加字段 / 换字段类型时用）。
 * **每个现存 item 都要写**：外层每个 item、内层每个嵌套 item 都算。
 */
export function withFieldValue(
  state: StateElement[],
  arrayCode: string,
  value: ArrayValue,
  parentCode: string,
  fieldCode: string,
  fieldValue: ItemValue,
): ArrayValue {
  const next = cloneValue(value)
  for (const object of structsAt(state, arrayCode, next, parentCode)) object[fieldCode] = fieldValue
  return next
}

/** 按字段定义重建一个结构体：删掉的字段不出现，改名的键跟着换，值递归处理 */
function remapStruct(
  state: StateElement[],
  code: string,
  value: unknown,
  mapping: Map<string, string>,
  removed: Set<string>,
): ItemObject {
  const source = isRecord(value) ? value : {}
  const out: ItemObject = {}
  for (const field of childrenOf(state, code)) {
    if (removed.has(field.code)) continue
    out[mapping.get(field.code) ?? field.code] = remapField(
      state,
      field,
      source[field.code],
      mapping,
      removed,
    )
  }
  return out
}

/** 一个字段的值在改名 / 删字段之后长什么样（对象与数组字段继续往下走） */
function remapField(
  state: StateElement[],
  field: StateElement,
  value: unknown,
  mapping: Map<string, string>,
  removed: Set<string>,
): ItemValue {
  if (field.type === 'object') return remapStruct(state, field.code, value, mapping, removed)
  if (field.type === 'array') {
    return Array.isArray(value)
      ? value.map((item) => remapStruct(state, field.code, item, mapping, removed))
      : []
  }
  return value as ItemValue
}

/**
 * 删字段 / 同层重排之后重建一整份数组值：
 * `mapping` 是旧 code → 新 code（元素重排那一张表），`removed` 是被删掉的元素 code。
 */
export function remapArrayValue(
  state: StateElement[],
  code: string,
  value: ArrayValue,
  mapping: Map<string, string>,
  removed: Set<string>,
): ArrayValue {
  return value.map((item) => remapStruct(state, code, item, mapping, removed))
}
