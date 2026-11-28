/**
 * 「这一行能换成哪些类型」这一格（中栏类型下拉的唯一真源）。
 *
 * 老板口径：**`object` 不是可选类型** —— 它就是「有孩子」；时间行是模式选择器，不在这一列。
 *
 * 引用（`ref`）**可以住在任何标量位置**（顶层、数组字段、嵌套数组的字段、对象字段的子孙都行）——
 * 它是「一个值」而已，位置不改变它的形状；**能当源**的数组仍然只有顶层数组（见 `sourceOptionsOf`）。
 */
import { isInsideArray } from '../core/statetree'
import type { StateElement, StateType } from '../core/types'

/** 作者能选的类型（不含时间：时间只住在根 `0`，它的模式选择器不走这一列） */
const AUTHOR_TYPES: StateType[] = ['text', 'integer', 'enum', 'array', 'ref']

/**
 * 类型下拉的每一档：
 *   · 数组（任何行）⇒ 作者选项；
 *   · 对象（数组子树之外，导入的卡）⇒ 不列 `object`（结构体是内部形态），只列作者选项（含 `array`）；
 *   · 数组子树里的标量字段 ⇒ 作者选项（时间不能当字段）；
 *   · 数组子树里的对象字段 ⇒ 只有 `object`（容器字段不换类型，数据层也拒）；
 *   · 其它元素 ⇒ 作者选项（时间行是模式选择器，不走这一列）。
 */
export function typeOptionsAt(state: StateElement[], element: StateElement): StateType[] {
  const field = isInsideArray(state, element.code)
  if (element.type === 'object') return field ? ['object'] : [...AUTHOR_TYPES]
  return [...AUTHOR_TYPES]
}
