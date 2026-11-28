/**
 * 引用（ref）在界面这一层的取数：谁能当源、源数组现在有哪些 item、一行引用显示什么、
 * 删掉一个 item 会让哪些引用失效。
 *
 * 只做「读」与纯计算：写回卡 / 存档的活仍归 `setInitial` / `save.tree` 的调用方。
 * 口径全部来自 `core/state-ref-type.ts`（源必须是数组、投影只认直接标量字段、零条 = `null`）；
 * 这里不重复判一遍合法性 —— 那是 `refDefinitionIssues` / `refValueIssues` 的事。
 */
import {
  childrenOf,
  isItemId,
  isMultiRef,
  isRecord,
  parentOfCode,
  pathsOf,
  refBoundsOf,
  refFieldsOf,
  rootCodeOf,
} from '../core/statetree'
import type { StateElement, Tree } from '../core/types'

/** 一个指向某个数组的引用：元素、它的值路径、它现在的值 */
export interface RefUse {
  element: StateElement
  path: string
  value: unknown
}

/** 引用源的一档：`selectable = false` 的是包含自己的数组（引用它会递归） */
export interface SourceOption {
  element: StateElement
  selectable: boolean
}

/** 一条要写回的引用值（删被引用 item 之后的新值） */
export interface RefChange {
  path: string
  value: unknown
}

/** 能当引用源的数组（含嵌套数组字段），按状态树顺序；自己所在的数组不可选 */
export function sourceOptionsOf(state: StateElement[], own: StateElement): SourceOption[] {
  return state
    .filter((item) => item.type === 'array')
    .map((element) => ({ element, selectable: !containsCode(element.code, own.code) }))
}

/** `code` 是不是 `own` 自己或它的祖先（引用它会引到自己身上） */
function containsCode(code: string, own: string): boolean {
  return own === code || own.startsWith(`${code}.`)
}

/** 源数组的直接标量字段：投影与筛选都只认文字 / 数字 / 下拉 */
export function scalarFieldsOf(state: StateElement[], sourceCode: string | undefined): StateElement[] {
  if (sourceCode === undefined) return []
  return childrenOf(state, sourceCode).filter(
    (field) => field.type === 'text' || field.type === 'integer' || field.type === 'enum',
  )
}

/** 卡里某个源数组现在的 item 列表：按 code 找它所属根那张初始值表；找不到 ⇒ undefined */
export function initialItemsOf(state: StateElement[], sourceCode: string | undefined): unknown {
  if (sourceCode === undefined) return undefined
  const root = state.find((item) => item.code === rootCodeOf(sourceCode))
  const initial = root?.initial
  if (!isRecord(initial)) return undefined
  return initial[sourceCode]
}

/** 一条 item 满足筛选条件吗（没筛选取恒真；筛选只做单字段等值） */
export function passesFilter(item: Record<string, unknown>, filter: StateElement['refFilter']): boolean {
  if (filter === undefined) return true
  return item[filter.field] === filter.value
}

/** 源数组里能当候选的 item：有隐藏 id、满足筛选、不在 `taken` 里 */
export function candidatesOf(
  element: StateElement,
  items: unknown,
  taken: string[],
): Record<string, unknown>[] {
  if (!Array.isArray(items)) return []
  return items.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) &&
      isItemId(item.id) &&
      !taken.includes(item.id) &&
      passesFilter(item, element.refFilter),
  )
}

/** 按隐藏 id 找源 item（找不到 ⇒ undefined：那张卡的值已经悬空） */
export function itemOf(items: unknown, id: string): Record<string, unknown> | undefined {
  if (!Array.isArray(items)) return undefined
  return items.find((item) => isRecord(item) && item.id === id) as Record<string, unknown> | undefined
}

/** 一行引用的文字：按 `refFields` 顺序拼投影字段的值（界面上永远不出现裸 id） */
export function rowTextOf(
  state: StateElement[],
  element: StateElement,
  item: Record<string, unknown>,
): string {
  return refFieldsOf(state, element)
    .map((field) => String(item[field.code] ?? ''))
    .filter((text) => text !== '')
    .join(' / ')
}

/** 所有**直接**指向 `code` 这个数组的引用（`valueOf` 给它们现在的值） */
export function refUsesOf(state: StateElement[], code: string, valueOf: (path: string) => unknown): RefUse[] {
  return state
    .filter((item) => item.type === 'ref' && item.refSource === code)
    .flatMap((element) => {
      const [path] = pathsOf(state, element.code)
      return path === undefined ? [] : [{ element, path, value: valueOf(path) }]
    })
}

/**
 * 这条值路径算不算「ref 还没有目标」的关系子元素：祖先里有 `ref`、它的自身值为 `null` / 缺失，
 * 且这条路径不是那条 ref 自己的值（自己的值那一行永远在）。是 ⇒ 整行不渲染（引用契约 §4.3）。
 */
export function blockedByRef(
  state: StateElement[],
  path: string,
  valueOf: (key: string) => unknown,
): boolean {
  for (let at = parentOfCode(path); at !== undefined; at = parentOfCode(at)) {
    if (state.find((item) => item.code === at)?.type !== 'ref') continue
    const [own] = pathsOf(state, at)
    if (own === path) continue
    const value = own === undefined ? undefined : valueOf(own)
    if (value === null || value === undefined) return true
  }
  return false
}

/** 引用值编辑器的候选来源：给了 `tree`（存档当前值）就读它，否则读卡里的初始值（跨根按 code 找） */
export function refItemsOf(state: StateElement[], element: StateElement, tree?: Tree): unknown {
  if (element.refSource === undefined) return undefined
  return tree === undefined ? initialItemsOf(state, element.refSource) : tree[element.refSource]
}

/**
 * 从一个数组里移除 `id` 之后，这些引用该变成什么：
 *   · `changes` —— 要写回的新值（单引用清成 `null`，多引用去掉那一条）；
 *   · `blocked` —— 删完会低于 `min` 的引用（整笔删除要被拒绝并点名它们）。
 * 值里没有这个 id 的引用原样不动（它的值不因这次删除变短）。
 */
export function cascadeOf(uses: RefUse[], id: string): { changes: RefChange[]; blocked: RefUse[] } {
  const changes: RefChange[] = []
  const blocked: RefUse[] = []
  for (const use of uses) {
    const { min } = refBoundsOf(use.element)
    if (isMultiRef(use.element)) {
      const ids = Array.isArray(use.value) ? use.value.filter(isItemId) : []
      if (!ids.includes(id)) continue
      const next = ids.filter((item) => item !== id)
      if (next.length < min) blocked.push(use)
      else changes.push({ path: use.path, value: next.length === 0 ? null : next })
      continue
    }
    if (use.value !== id) continue
    if (min > 0) blocked.push(use)
    else changes.push({ path: use.path, value: null })
  }
  return { changes, blocked }
}
