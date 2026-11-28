/**
 * **权限引用**（`reads` / `writable` 里那一格）与**值路径**是两套东西，这一份管前者。
 *
 * 值路径（`pathsOf` / `elementOfPath`）说的是「`tree` 里哪一格」：数组只有容器那一条（`2.4`），
 * 字段定义（`2.4.1`）**不是**值路径。权限引用可以更细：`2.4` = 整个数组（含增删项目），
 * `2.4.1` = 所有 item 里的「物品」这一格（整列替换，不增删项目）。两者都在这一份里解析。
 *
 * **覆盖规则（读 / 写同一套容器口径）**：只有 **object / array 容器**的引用覆盖后代；
 * 标量元素（哪怕有自己的值和子字段）只覆盖它自己。写权限里字段引用不授权整表 / 增删 item —— 见 `engine.ts`。
 * **眼睛**只有 all / none：父行只看自己的 ref；子行由自己的 ref 或 object / array 祖先 ref 派生。
 */
import { childrenOf, elementAt, isInsideArray, parentOfCode } from './state-codes'
import { pathsOf, elementOfPath } from './state-data'
import type { StateElement } from './types'

/**
 * 这个引用是不是**数组字段**引用（`2.4.1` / `2.4.2.2`）：它指向一个字段定义，
 * 不是值路径。字段只在数组子树里存在。
 */
export function isFieldRef(state: StateElement[], ref: string): boolean {
  return state.some((item) => item.code === ref) && isInsideArray(state, ref)
}

/** 引用指向的元素：值路径元素 / `<code>.0` 的基元素 / 数组字段定义；认不出 ⇒ `undefined` */
export function refElementOf(state: StateElement[], ref: string): StateElement | undefined {
  return elementOfPath(state, ref) ?? (isFieldRef(state, ref) ? elementAt(state, ref) : undefined)
}

/**
 * 一个引用覆盖的**权限路径**（可写段 / 工具可见性用）：
 *   · 数组字段 ⇒ 只有它自己那一列；
 *   · 标量元素（哪怕有孩子）⇒ 只有自己的值路径（`<code>.0`，叶子就是 `<code>`）；
 *   · object 元素 ⇒ 它的孩子值路径；array 元素 ⇒ 容器那一条（整表）；
 *   · `<code>.0` ⇒ 那个值路径本身。
 */
export function refPathsOf(state: StateElement[], ref: string): string[] {
  if (isFieldRef(state, ref)) return [ref]
  const element = state.find((item) => item.code === ref)
  if (element && element.type !== 'object' && element.type !== 'array' && childrenOf(state, ref).length > 0) {
    return [`${ref}.0`]
  }
  return pathsOf(state, ref)
}

/** 这个 code 的元素是不是**容器**（object / array）—— 只有容器引用才覆盖后代 */
function isContainer(state: StateElement[], code: string): boolean {
  const element = state.find((item) => item.code === code)
  return element?.type === 'object' || element?.type === 'array'
}

/**
 * **读**的覆盖（读投影 / 读眼睛用）：自己那条 ref 在清单里，或**object / array 祖先**的 ref 在。
 * 标量元素（哪怕有自己的值和子字段）只覆盖它自己 —— 读 `1.1` 不会把 `1.1.1` 也读出来；
 * 数组容器（`2.4`）覆盖 item 字段（`2.4.1`），object 容器（`2` / `2.4.2`）覆盖它的孩子。
 */
export function refCoveredBy(state: StateElement[], list: string[], ref: string): boolean {
  if (list.includes(ref)) return true
  for (let at = parentOfCode(ref); at !== undefined; at = parentOfCode(at)) {
    if (list.includes(at) && isContainer(state, at)) return true
  }
  return false
}

/**
 * **字段写**的授权（`applyWrite` / 写眼睛用）—— 与读同一套容器口径：
 *   · 自己那条字段引用在清单里；
 *   · 或者**object / array 祖先**的引用在清单里（`2.4` 容器覆盖所有 `2.4.x`；`2.4.2` 对象字段覆盖孩子）；
 *   · **标量祖先**（哪怕有孩子，如 `2.4.1`）不覆盖孩子写 —— 写 `2.4.1.1` 要它自己的引用或容器祖先。
 * 数组**元素**的整表写（`2.4`）仍只由它自己的引用授权；字段引用不授权整表替换 / 增删 item。
 */
export function fieldWriteCoveredBy(state: StateElement[], list: string[], ref: string): boolean {
  if (list.includes(ref)) return true
  if (!isFieldRef(state, ref)) return false
  for (let at = parentOfCode(ref); at !== undefined; at = parentOfCode(at)) {
    if (list.includes(at) && isContainer(state, at)) return true
  }
  return false
}
