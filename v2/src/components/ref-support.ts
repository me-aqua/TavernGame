/**
 * 引用（ref）在界面这一层的取数：谁能当源、源数组现在有哪些 item、一行引用显示什么、
 * 删掉一个 item 会让哪些引用失效。
 *
 * 只做「读」与纯计算：写回卡 / 存档的活仍归 `setInitial` / `save.tree` 的调用方。
 * 口径来自 `core/state-ref-type.ts`（源必须是**顶层数组**、投影只认直接标量字段、零条 = `null`）；
 * 这里不重复判一遍合法性 —— 那是 `refDefinitionIssues` / `refValueIssues` 的事。
 * 「嵌套数组不能当源」两层的口径一致：数据层在 `refDefinitionIssues` 里拒（`issue.refSourceNestedArray`），
 * 编辑器干脆不列（理由见 `sourceOptionsOf`）。
 */
import {
  arrayRootOf,
  childrenOf,
  isInsideArray,
  isItemId,
  isMultiRef,
  isRecord,
  parentOfCode,
  pathsOf,
  refBoundsOf,
  refFieldsOf,
  refPointerOf,
  rootCodeOf,
} from '../core/statetree'
import type { StateElement, Tree } from '../core/types'

/** 一个指向某个数组的引用：元素、它的值路径、它现在的值 */
export interface RefUse {
  element: StateElement
  path: string
  value: unknown
  /** 数组 item 里的引用（`2.6.1`）：值住在 item 里，没有扁平值路径 */
  item?: boolean
  /** item 级引用：把根数组里的指针清成 null / 去掉 id（级联写回用） */
  clear?: (id: string) => unknown
}

/** 引用源的一档：`selectable = false` 的是**包含自己的数组**（引用它会递归） */
export interface SourceOption {
  element: StateElement
  selectable: boolean
}

/** 一条要写回的引用值（删被引用 item 之后的新值） */
export interface RefChange {
  path: string
  value: unknown
}

/**
 * 能当引用源的数组：**只有顶层数组**，按状态树顺序。两种数组不当源 ——
 *   · 数组子树里的数组字段（`2.4.5` 这种，`isInsideArray`）：它的 item 列表散在每个外层 item 里，
 *     没有一条自己的值路径，取不到唯一的一份候选；数据层也拒它（`issue.refSourceNestedArray`）
 *     ⇒ **整档不列**（不提供作者一个保存时必被拦的选项）；
 *   · 包含自己的数组（引用会递归）⇒ 列出来但 `selectable = false`，让作者看得见它、也知道为什么不能选。
 */
export function sourceOptionsOf(state: StateElement[], own: StateElement): SourceOption[] {
  return state
    .filter((item) => item.type === 'array' && !isInsideArray(state, item.code))
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
  const uses: RefUse[] = []
  /** 递归穿过 item 里的对象字段 / 嵌套数组，找到目标 ref 字段并记下指针 */
  const findIn = (
    struct: Record<string, unknown>,
    container: string,
    element: StateElement,
    ownRoot: string,
    ownValue: unknown,
  ) => {
    for (const child of childrenOf(state, container)) {
      if (!(child.code in struct)) continue
      const value = struct[child.code]
      if (child.code === element.code) {
        uses.push({
          element,
          path: ownRoot,
          value: refPointerOf(state, element, value),
          item: true,
          /** 级联写回：复制整份根数组，把这一处的指针清成 null / 去掉 id */
          clear: (id) =>
            Array.isArray(ownValue)
              ? ownValue.map((item) =>
                  isRecord(item) ? clearStruct(state, ownRoot, item, element, id) : item,
                )
              : ownValue,
        })
        continue
      }
      if (child.type === 'array' && Array.isArray(value)) {
        for (const nested of value) {
          if (isRecord(nested)) findIn(nested, child.code, element, ownRoot, ownValue)
        }
        continue
      }
      if (isRecord(value) && (child.type === 'object' || childrenOf(state, child.code).length > 0)) {
        findIn(value, child.code, element, ownRoot, ownValue)
      }
    }
  }
  for (const element of state) {
    if (element.type !== 'ref' || element.refSource !== code) continue
    if (!isInsideArray(state, element.code)) {
      const [path] = pathsOf(state, element.code)
      if (path !== undefined) uses.push({ element, path, value: valueOf(path) })
      continue
    }
    const root = arrayRootOf(state, element.code)
    const items = root === undefined ? undefined : valueOf(root)
    if (!Array.isArray(items)) continue
    for (const item of items) if (isRecord(item)) findIn(item, root as string, element, root as string, items)
  }
  return uses
}

/** 在根数组里把某个 item 级引用的指针清掉（只清指针，不动子元素） */
function clearStruct(
  state: StateElement[],
  container: string,
  struct: Record<string, unknown>,
  element: StateElement,
  id: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...struct }
  for (const child of childrenOf(state, container)) {
    if (!(child.code in out)) continue
    const value = out[child.code]
    if (child.code === element.code) {
      out[child.code] = clearPointer(state, element, value, id)
      continue
    }
    if (child.type === 'array' && Array.isArray(value)) {
      out[child.code] = value.map((nested) =>
        isRecord(nested) ? clearStruct(state, child.code, nested, element, id) : nested,
      )
      continue
    }
    if (isRecord(value) && (child.type === 'object' || childrenOf(state, child.code).length > 0)) {
      out[child.code] = clearStruct(state, child.code, value, element, id)
    }
  }
  return out
}

/** 单个 ref 值的指针清空（多引用去掉 id，单引用清 null；有子元素时只改 `.0`） */
function clearPointer(state: StateElement[], element: StateElement, value: unknown, id: string): unknown {
  const children = childrenOf(state, element.code)
  const pointer = refPointerOf(state, element, value)
  const put = (next: unknown): unknown =>
    children.length === 0 ? next : { ...(isRecord(value) ? value : {}), [`${element.code}.0`]: next }
  if (isMultiRef(element)) {
    if (!Array.isArray(pointer) || !pointer.includes(id)) return value
    const next = pointer.filter((item) => item !== id)
    return put(next.length === 0 ? null : next)
  }
  return pointer === id ? put(null) : value
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
    if (use.item === true) {
      const affected = isMultiRef(use.element)
        ? Array.isArray(use.value) && use.value.includes(id)
        : use.value === id
      if (!affected) continue
      const next = isMultiRef(use.element)
        ? Array.isArray(use.value)
          ? use.value.filter((item) => item !== id)
          : []
        : []
      if ((isMultiRef(use.element) ? next.length : 0) < min) blocked.push(use)
      else changes.push({ path: use.path, value: use.clear?.(id) })
      continue
    }
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
