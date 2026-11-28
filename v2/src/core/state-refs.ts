/**
 * **权限引用**（`reads` / `writable` 里那一格）与**值路径**是两套东西，这一份管前者。
 *
 * 值路径（`pathsOf` / `elementOfPath`）说的是「`tree` 里哪一格」：数组只有容器那一条（`2.4`），
 * 字段定义（`2.4.1`）**不是**值路径。权限引用可以更细：`2.4` = 整个数组（含增删项目），
 * `2.4.1` = 所有 item 里的「物品」这一格（整列替换，不增删项目）。两者都在这一份里解析。
 *
 * **写权限**：容器写 ⊇ 字段写（`fieldWriteCoveredBy`）；字段引用不授权整表 / 增删 item —— 见 `engine.ts`。
 * **眼睛**只有 all / none：父行只看自己的 ref，数组字段行由自己的 ref 或数组容器 ref 派生。
 */
import { elementAt, isInsideArray, parentOfCode } from './state-codes'
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

/** 一个引用覆盖的权限路径：数组字段 ⇒ 只有它自己；别的（元素 code / `.0`）走值路径 */
export function refPathsOf(state: StateElement[], ref: string): string[] {
  return isFieldRef(state, ref) ? [ref] : pathsOf(state, ref)
}

/**
 * **读**的覆盖（读投影 / 读眼睛用）：引用覆盖**自己 + 整棵子树**，所以任何祖先 code 都算
 * （`2` 覆盖 `2.4.1`、`2.4` 覆盖 `2.4.1`、`2.4.2` 覆盖 `2.4.2.1`）。
 * 非字段引用只认自身（它们由值路径那一套管，不在这里重复）。
 */
export function refCoveredBy(state: StateElement[], list: string[], ref: string): boolean {
  if (list.includes(ref)) return true
  if (!isFieldRef(state, ref)) return false
  for (let at = parentOfCode(ref); at !== undefined; at = parentOfCode(at)) {
    if (list.includes(at)) return true
  }
  return false
}

/**
 * **字段写**的授权（`applyWrite` / 写眼睛用）：`writable` 里有这一条，或者有祖先引用覆盖它 ——
 *   · **祖先字段**（`2.4.1` / `2.4.2` / `2.4.2.2`）：字段与普通节点同权，引用覆盖**自己的值 + 整棵子树**；
 *   · **祖先数组元素**（`2.4`）：数组容器覆盖它下面的所有字段写（容器写 ⊇ 字段写）。
 * 数组**元素**的整表写（`2.4`）仍只由它自己的引用授权；字段引用不授权整表替换 / 增删 item。
 */
export function fieldWriteCoveredBy(state: StateElement[], list: string[], ref: string): boolean {
  if (list.includes(ref)) return true
  if (!isFieldRef(state, ref)) return false
  for (let at = parentOfCode(ref); at !== undefined; at = parentOfCode(at)) {
    if (!list.includes(at)) continue
    if (isFieldRef(state, at) || elementAt(state, at).type === 'array') return true
  }
  return false
}
