/**
 * 引用（阶段 4）的**定义与值**这一层：定义怎么算合法、值怎么算合法、读出来投影成什么。
 *
 * 这里只放与「引用」有关的那一小块；数组 item 隐藏 id 的生成 / 校验也在这里（两者同票）。
 * 值的口径（引用契约 §四）：单引用 `id | null`，多引用 t('issue.refMsg1')。
 * 定义的口径（§三）：源必须是数组、投影字段是源 item 的直接子字段（text / integer / enum）、
 * 可选单字段等值筛选、`0 <= min <= max`、`max >= 1`、`max <= 999`。
 */
import { t } from '../i18n'
import { AppError } from './errors'
import { childrenOf, isInsideArray, isRecord, parentOfCode } from './state-codes'
import type { CardIssue } from './state-issues'
import type { ItemValue, StateElement, Tree } from './types'

/** `max` 第一版上限（引用契约 §三） */
export const REF_MAX_LIMIT = 999

/** 源数组元素（不存在 / 不是数组 ⇒ undefined） */
export function refSourceOf(state: StateElement[], element: StateElement): StateElement | undefined {
  const source = state.find((item) => item.code === element.refSource)
  return source?.type === 'array' ? source : undefined
}

/** 引用投影字段（只保留源 item 的直接子字段） */
export function refFieldsOf(state: StateElement[], element: StateElement): StateElement[] {
  const source = refSourceOf(state, element)
  if (source === undefined) return []
  const fields = childrenOf(state, source.code)
  return (element.refFields ?? []).flatMap((code) => {
    const field = fields.find((item) => item.code === code)
    return field === undefined ? [] : [field]
  })
}

/** 引用的 min / max（缺省 0 / 1） */
export function refBoundsOf(element: StateElement): { min: number; max: number } {
  return { min: element.min ?? 0, max: element.max ?? 1 }
}

/** 一个引用元素是不是「多引用」（`max > 1`） */
export function isMultiRef(element: StateElement): boolean {
  return refBoundsOf(element).max > 1
}

/** 一个值是不是数组 item 的隐藏 id（`id_N`） */
export function isItemId(value: unknown): value is string {
  return typeof value === 'string' && /^id_\d+$/.test(value)
}

/** 一个数组值里现有的 id 列表（只收合法 id） */
export function itemIdsOf(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => (isRecord(item) && isItemId(item.id) ? [item.id] : []))
}

/** 下一个 id：本数组当前最大编号 + 1（删除后不回收；每个数组各自从 `id_1` 起） */
export function nextItemIdOf(items: unknown): string {
  const numbers = itemIdsOf(items).map((id) => Number(id.slice(3)))
  const max = numbers.length === 0 ? 0 : Math.max(...numbers)
  return `id_${max + 1}`
}

/**
 * 给一份数组值补 id：已有 id 原样保留，缺 id 的按下标顺序补（新 id 从当前最大编号 + 1 起）。
 * `known` 是导入时已经用掉的 id（默认就是这份值里已有的）；重复 / 未知 id 的拒绝留给
 * 写入那一条校验，这里只做「生成」。
 */
export function withItemIds(items: unknown, known: string[] = []): unknown[] {
  if (!Array.isArray(items)) return []
  const used = new Set([...itemIdsOf(items), ...known])
  let next = Number(nextItemIdOf([...used].map((id) => ({ id }))).slice(3))
  return items.map((item) => {
    if (!isRecord(item)) return item
    if (isItemId(item.id)) return item
    const id = `id_${next}`
    next += 1
    return { id, ...item }
  })
}

/** 引用值的**形状**（不查源 item / 筛选）：单引用 `id|null`，多引用 `null|id[]`（有序不重复） */
export function refShapeFits(element: StateElement, value: unknown): boolean {
  const { min, max } = refBoundsOf(element)
  if (value === null) return min === 0
  if (max === 1) return isItemId(value)
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length >= min &&
    value.length <= max &&
    value.every(isItemId) &&
    new Set(value).size === value.length
  )
}

/** 卡里有没有引用元素（id 校验、提示词带 id 只在含引用的卡里生效） */
export function hasRefs(state: StateElement[]): boolean {
  return state.some((element) => element.type === 'ref')
}
/** 一个 ref 值的**指针那一格**：有子元素时在 `<code>.0`，否则就是值本身 */
export function refPointerOf(state: StateElement[], element: StateElement, value: unknown): unknown {
  if (childrenOf(state, element.code).length === 0) return value
  return isRecord(value) ? value[`${element.code}.0`] : value
}

/** 引用值里要解析的 id（单引用一个 / 多引用一串；null / 坏形状 ⇒ 空） */
export function refIdsOf(element: StateElement, value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return isMultiRef(element) ? [] : [value]
  if (Array.isArray(value)) return isMultiRef(element) ? value.filter(isItemId) : []
  return []
}

/** 引用投影出来的对象：t('issue.refMsg2')（投影字段顺序 = `refFields` 顺序） */
export function refProjectionOf(
  state: StateElement[],
  element: StateElement,
  item: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(refFieldsOf(state, element).map((field) => [field.name, item[field.code]]))
}

/**
 * 一个引用值的投影：`null` ⇒ `null`；单引用 ⇒ 对象；多引用 ⇒ 对象数组。
 * 源 item 找不到 / id 不合法时返回 `null`（校验那一条会先拦住；这里只做投影）。
 */
export function refValueOf(
  state: StateElement[],
  element: StateElement,
  value: unknown,
  sourceItems: unknown,
): unknown {
  if (value === null || value === undefined) return null
  const source = Array.isArray(sourceItems) ? sourceItems : []
  const itemOf = (id: string) =>
    source.find((item) => isRecord(item) && item.id === id) as Record<string, unknown> | undefined
  if (isMultiRef(element)) {
    if (!Array.isArray(value)) return null
    return value.flatMap((id) => {
      const item = itemOf(id)
      return item === undefined ? [] : [refProjectionOf(state, element, item)]
    })
  }
  if (typeof value !== 'string') return null
  const item = itemOf(value)
  return item === undefined ? null : refProjectionOf(state, element, item)
}

/** 定义层要报的问题（`cardIssues` 用；每条 message 都是中文） */
export function refDefinitionIssues(state: StateElement[], element: StateElement): CardIssue[] {
  const issues: CardIssue[] = []
  const push = (message: string): void => {
    issues.push({ code: element.code, path: element.code, message, errorCode: 'E_VALIDATION' })
  }
  const source = state.find((item) => item.code === element.refSource)
  if (element.refSource === undefined) {
    push(t('issue.refMsg3', { p1: element.code }))
    return issues
  }
  if (source === undefined) {
    push(t('issue.refMsg4', { p1: element.code, p2: element.refSource }))
    return issues
  }
  if (source.type !== 'array') {
    push(t('issue.refMsg5', { p1: element.code, p2: element.refSource }))
    return issues
  }
  if (isInsideArray(state, element.refSource)) {
    push(t('issue.refSourceNestedArray', { code: element.code, source: element.refSource }))
    return issues
  }
  if (childrenOf(state, element.code).length > 0 && refBoundsOf(element).max > 1) {
    push(t('issue.refMultiChild', { code: element.code, max: refBoundsOf(element).max }))
    return issues
  }
  if (element.refSource === element.code) push(t('issue.refMsg6', { p1: element.code }))
  const sourceRoot = element.refSource.split('.')[0]
  const ownRoot = element.code.split('.')[0]
  if (element.code.includes('.') && element.refSource.startsWith(`${ownRoot}.`) && ownRoot === sourceRoot) {
    // 源是它所在数组（或其子树）⇒ 递归
    if (childrenOf(state, element.refSource).some((field) => field.code === element.code)) {
      push(t('issue.refMsg7', { p1: element.code, p2: element.refSource }))
    }
  }
  const fields = childrenOf(state, element.refSource)
  const projection = element.refFields
  if (!Array.isArray(projection) || projection.length === 0) {
    push(t('issue.refMsg8', { p1: element.code }))
  } else {
    for (const code of projection) {
      const field = fields.find((item) => item.code === code)
      if (field === undefined) {
        push(t('issue.refMsg9', { p1: element.code, p2: code, p3: element.refSource }))
        continue
      }
      if (field.type !== 'text' && field.type !== 'integer' && field.type !== 'enum') {
        push(t('issue.refMsg10', { p1: element.code, p2: code }))
      }
    }
  }
  if (element.refFilter !== undefined) {
    const filter = element.refFilter
    if (!isRecord(filter) || typeof filter.field !== 'string' || !('value' in filter)) {
      push(t('issue.refMsg11', { p1: element.code }))
    } else {
      const field = fields.find((item) => item.code === filter.field)
      if (field === undefined) {
        push(t('issue.refMsg12', { p1: element.code, p2: String(filter.field), p3: element.refSource }))
      } else if (field.type !== 'text' && field.type !== 'integer' && field.type !== 'enum') {
        push(t('issue.refMsg13', { p1: element.code, p2: field.code }))
      } else if (!filterValueFits(field, filter.value)) {
        push(t('issue.refMsg14', { p1: element.code, p2: JSON.stringify(filter.value), p3: field.code }))
      }
    }
  }
  const { min, max } = refBoundsOf(element)
  if (!Number.isInteger(min)) push(t('issue.refMsg15', { p1: element.code }))
  if (!Number.isInteger(max)) push(t('issue.refMsg16', { p1: element.code }))
  if (Number.isInteger(min) && Number.isInteger(max)) {
    if (min < 0) push(t('issue.refMsg17', { p1: element.code }))
    if (max < 1) push(t('issue.refMsg18', { p1: element.code }))
    if (max > REF_MAX_LIMIT) push(t('issue.refMsg19', { p1: element.code, p2: REF_MAX_LIMIT }))
    if (min > max) push(t('issue.refMsg20', { p1: element.code }))
  }
  return issues
}

/** 筛选值是否与字段类型一致（enum 还要在白名单里） */
function filterValueFits(field: StateElement, value: unknown): boolean {
  if (field.type === 'text') return typeof value === 'string'
  if (field.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (field.type === 'enum') return typeof value === 'string' && (field.values ?? []).includes(value)
  return false
}

/** 一个引用值要报的问题（卡初始值 / 存档树 / 写入三处共用；`items` 是源数组的当前值） */
export function refValueIssues(
  state: StateElement[],
  element: StateElement,
  value: unknown,
  sourceItems: unknown,
): string[] {
  const issues: string[] = []
  const source = state.find((item) => item.code === element.refSource)
  if (source === undefined || source.type !== 'array') return [t('issue.refMsg21', { p1: element.code })]
  const { min, max } = refBoundsOf(element)
  const children = childrenOf(state, element.code)
  const pointer = children.length === 0 ? value : isRecord(value) ? value[`${element.code}.0`] : value
  const items = Array.isArray(sourceItems) ? sourceItems : []
  const sourceId = (id: string): Record<string, unknown> | undefined =>
    items.find((item) => isRecord(item) && item.id === id) as Record<string, unknown> | undefined
  const filter = element.refFilter
  /** 这条 item 满足筛选条件吗（没筛选恒真） */
  const filterPass = (item: Record<string, unknown>): boolean => {
    if (filter === undefined) return true
    const field = childrenOf(state, source.code).find((field) => field.code === filter.field)
    if (field === undefined) return false
    return item[field.code] === filter.value
  }
  /** 判一条 id：形状、存在、筛选 */
  const checkOne = (id: unknown): void => {
    if (!isItemId(id)) {
      issues.push(t('issue.refMsg22', { p1: element.code, p2: JSON.stringify(id) }))
      return
    }
    const item = sourceId(id)
    if (item === undefined) {
      issues.push(t('issue.refMsg23', { p1: element.code, p2: id, p3: source.code }))
      return
    }
    if (!filterPass(item)) {
      issues.push(
        t('issue.refMsg24', {
          p1: element.code,
          p2: id,
          p3: String(filter?.field),
          p4: JSON.stringify(filter?.value),
        }),
      )
    }
  }
  if (pointer === null) {
    if (min > 0) issues.push(t('issue.refMsg25', { p1: element.code, p2: min }))
    return issues
  }
  if (isMultiRef(element)) {
    if (!Array.isArray(pointer)) {
      issues.push(t('issue.refMsg26', { p1: element.code }))
      return issues
    }
    const seen = new Set<string>()
    for (const id of pointer) {
      if (typeof id === 'string' && seen.has(id))
        issues.push(t('issue.refMsg27', { p1: element.code, p2: id }))
      if (typeof id === 'string') seen.add(id)
      checkOne(id)
    }
    if (pointer.length < min)
      issues.push(t('issue.refMsg28', { p1: element.code, p2: min, p3: pointer.length }))
    if (pointer.length > max)
      issues.push(t('issue.refMsg29', { p1: element.code, p2: max, p3: pointer.length }))
    return issues
  }
  if (Array.isArray(pointer) || isRecord(pointer)) {
    issues.push(t('issue.refMsg30', { p1: element.code }))
    return issues
  }
  if (typeof pointer !== 'string') {
    issues.push(t('issue.refMsg30', { p1: element.code }))
    return issues
  }
  checkOne(pointer)
  return issues
}

/** 一个字段的入参补 id：数组按旧值 max+1 生成，嵌套对象 / 数组递归（旧值只用来定编号） */
export function assignIdsDeep(
  state: StateElement[],
  field: StateElement,
  value: unknown,
  oldValue: unknown,
): unknown {
  if (field.type === 'array') {
    if (!Array.isArray(value)) return value
    const oldItems = Array.isArray(oldValue) ? oldValue : []
    const oldIds = new Set(itemIdsOf(oldItems))
    const supplied = itemIdsOf(value)
    if (new Set(supplied).size !== supplied.length) {
      throw new AppError('E_VALIDATION', {
        message: t('issue.itemIdDuplicate', { code: field.code, id: supplied.join(', ') }),
        nextStep: t('next.editor'),
        detail: { code: field.code, id: supplied },
      })
    }

    let next = Number(nextItemIdOf([...oldIds, ...supplied].map((id) => ({ id }))).slice(3))
    const fixed = value.map((item, index) => {
      if (!isRecord(item)) return item
      if ('id' in item && !isItemId(item.id)) {
        throw new AppError('E_VALIDATION', {
          message: t('issue.itemIdInvalid', { code: field.code, id: String(item.id) }),
          nextStep: t('next.editor'),
          detail: { code: field.code, id: item.id },
        })
      }
      const oldItem = Array.isArray(oldValue) && isRecord(oldValue[index]) ? oldValue[index] : {}
      const withId = isItemId(item.id) ? item : { ...item, id: `id_${next++}` }
      for (const child of childrenOf(state, field.code)) {
        if (child.code in withId) {
          withId[child.code] = assignIdsDeep(
            state,
            child,
            withId[child.code],
            oldItem[child.code],
          ) as ItemValue
        }
      }
      return withId
    })
    return fixed
  }
  if (field.type === 'object' || childrenOf(state, field.code).length > 0) {
    if (!isRecord(value)) return value
    const out = { ...value }
    const old = isRecord(oldValue) ? oldValue : {}
    for (const child of childrenOf(state, field.code)) {
      if (child.code in out)
        out[child.code] = assignIdsDeep(state, child, out[child.code], old[child.code]) as ItemValue
    }
    return out
  }
  return value
}

/**
 * 写关系子元素之前，看它的 ref 祖先里有没有「自身值 null」的：有 ⇒ 返回那个 ref 的 code。
 * 覆盖顶层 ref、数组 item 里的 ref、嵌套数组 / 更深对象字段里的 ref（任意深度）。
 */
export function refChildOwnerBlocked(state: StateElement[], tree: Tree, path: string): string | undefined {
  const refs = state.filter(
    (element) =>
      element.type === 'ref' &&
      childrenOf(state, element.code).length > 0 &&
      path.startsWith(`${element.code}.`) &&
      path !== `${element.code}.0`,
  )
  for (const element of refs) {
    if (!isInsideArray(state, element.code)) {
      if ((tree[`${element.code}.0`] ?? null) === null) return element.code
      continue
    }
    const root = outerArrayOf(state, element.code)
    const items = root === undefined ? undefined : tree[root]
    const pointers = root === undefined ? [] : pointersIn(state, root, items, element.code)
    if (pointers.some((value) => (value ?? null) === null)) return element.code
  }
  return undefined
}

/** 最外层数组祖先 */
function outerArrayOf(state: StateElement[], code: string): string | undefined {
  let found: string | undefined
  for (let at: string | undefined = code; at !== undefined; at = parentOfCode(at)) {
    if (state.find((item) => item.code === at)?.type === 'array') found = at
  }
  return found
}

/** 在根数组值里递归找某个 ref 字段的指针（找不到 ⇒ 空） */
function pointersIn(state: StateElement[], container: string, value: unknown, target: string): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (isRecord(item) ? pointersIn(state, container, item, target) : []))
  }
  if (!isRecord(value)) return []
  const out: unknown[] = []
  for (const child of childrenOf(state, container)) {
    if (!(child.code in value)) continue
    const fieldValue = value[child.code]
    if (child.code === target) {
      const element = state.find((item) => item.code === target) as StateElement
      out.push(refPointerOf(state, element, fieldValue))
      continue
    }
    if (child.type === 'array') out.push(...pointersIn(state, child.code, fieldValue, target))
    else if (isRecord(fieldValue) && (child.type === 'object' || childrenOf(state, child.code).length > 0)) {
      out.push(...pointersIn(state, child.code, fieldValue, target))
    }
  }
  return out
}
