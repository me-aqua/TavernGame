/**
 * **权限引用**（`reads` / `writable` 里那一格）与**值路径**是两套东西，这一份管前者。
 *
 * 值路径（`pathsOf` / `elementOfPath`）说的是「`tree` 里哪一格」：数组只有容器那一条（`2.4`），
 * 字段定义（`2.4.1`）**不是**值路径。权限引用可以更细：`2.4` = 整个数组（含增删项目），
 * `2.4.1` = 所有 item 里的「物品」这一格（整列替换，不增删项目）。两者都在这一份里解析。
 *
 * 覆盖规则：一个引用覆盖它自己；**数组容器 / 数组字段**那类祖先引用覆盖它下面的字段引用
 * （`2.4` 覆盖 `2.4.1`、`2.4.2` 覆盖 `2.4.2.1`），所以「整表可写」自然也允许写其中一格。
 */
import { elementAt, isInsideArray, parentOfCode } from './state-codes'
import { pathsOf, elementOfPath } from './state-data'
import { arrayRootOf } from './state-array'
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

/** 一个 code 连同它下面的所有元素（数组行 / 字段行的三态用：容器 + 字段，字段 + 子字段） */
export function refsUnder(state: StateElement[], code: string): string[] {
  const prefix = `${code}.`
  return state.filter((item) => item.code === code || item.code.startsWith(prefix)).map((item) => item.code)
}

/**
 * `list` 里有没有哪个引用覆盖 `ref`：引用覆盖**自己 + 整棵子树**，所以祖先 code 也算
 * （`2.4` 覆盖 `2.4.1`、`2` 也覆盖 `2.4.1`）。
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
 * 这个字段引用从所属数组根走到它自己，中间有没有穿过**数组字段**（`2.4.2.2.1` 要穿 `2.4.2.2`）。
 * 穿过的写没法表达成「每个顶层 item 一格」（那一格是嵌套数组里的第几项），引擎按 `E_VALIDATION` 拒。
 */
export function crossesArrayField(state: StateElement[], ref: string): boolean {
  const root = arrayRootOf(state, ref)
  if (root === undefined) return false
  for (let at = parentOfCode(ref); at !== undefined && at !== root; at = parentOfCode(at)) {
    if (elementAt(state, at).type === 'array') return true
  }
  return false
}
