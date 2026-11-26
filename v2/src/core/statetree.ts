/**
 * 状态树（阶段 2.1）：形状规则、扁平值、公历时间、增删节点、整卡问题清单。
 *
 * 形状一句话（`CONTRACT §2.1`）：**键是完整 code 的扁平表**。一个节点可以同时有自己的值和孩子 ——
 * 自身值住在**隐式**的 `<code>.0`（不进 `state[]`），可见孩子从 `<code>.1` 起连续编号；
 * `object` 没有自身值；深度（`.0` 不计）最大 5。`type` 描述的是自身值，所以标量节点可以有孩子、
 * 不会因此变成 `object`。
 *
 * 这一份住三样东西：
 *   · **派生**：`initialTreeOf` 把卡的初始值展开成扁平树，`pathsOf` 说一个 code 覆盖哪些值路径；
 *   · **时间**：真公历六格，`advanceTime` 按单位推进（月末没有那一天就取月末），`formatTime` 出中文格式；
 *   · **校验**：`cardIssues` 给出整卡的问题清单（状态树 + 链的规矩），保存按钮与 `validateCard` 共用它。
 *
 * 谁也别在这里加数组 / 字典：2.1 明确整块推迟（那会是另一套形状）。
 */
import { t } from '../i18n'
import { AppError } from './errors'
import type { ErrorCode } from './errors'
import type { Card, StateElement, TimeUnit, TimeValue, Tree } from './types'

/** 时间单位，粗 → 细；`week` 不存，按日期算（周一 = 1） */
export const TIME_UNITS: TimeUnit[] = ['year', 'month', 'week', 'day', 'hour', 'minute', 'second']

/** 可见深度上限（`.0` 不计）：`1.1.1.1.1` 合法，第 6 段不合法 */
const MAX_DEPTH = 5

const CODE = /^\d+(\.\d+)*$/

/**
 * 一条卡问题。`code` = 出问题的状态元素 code（卡级问题给 `''`），`path` = 更细的路径
 * （如 `1.1.0`）或 `''`，`message` = 中文。
 *
 * `errorCode` 是 `validateCard` 抛第一条时用的错误码（CONTRACT §6：结构错 `E_VALIDATION`、
 * 链的规矩错 `E_CHAIN`）—— 一张清单一个真源，别让保存按钮和引擎各判一套。
 */
export interface CardIssue {
  code: string
  path: string
  message: string
  errorCode: ErrorCode
}

/** 可见深度：`.0` 段不计；`0` 自己是第 1 层 */
export function codeDepth(code: string): number {
  return Math.max(1, code.split('.').filter((segment) => segment !== '0').length)
}

/** 父 code；顶层（没有点）返回 `undefined` */
function parentOfCode(code: string): string | undefined {
  const at = code.lastIndexOf('.')
  return at > 0 ? code.slice(0, at) : undefined
}

/** 按 code 找元素；找不到就是卡坏了（调用方拿到的 code 都来自卡或校验过的树） */
function elementAt(state: StateElement[], code: string): StateElement {
  const element = state.find((item) => item.code === code)
  if (!element) {
    throw new AppError('E_VALIDATION', {
      message: t('issue.elementMissing', { code }),
      nextStep: t('next.editor'),
      detail: { code },
    })
  }
  return element
}

/** 直接孩子（按最后一段升序）；只认 `code.` 前缀且后面再没有点的那种 */
function childrenOf(state: StateElement[], code: string): StateElement[] {
  const prefix = `${code}.`
  return state
    .filter((item) => item.code.startsWith(prefix) && !item.code.slice(prefix.length).includes('.'))
    .sort((a, b) => Number(a.code.slice(prefix.length)) - Number(b.code.slice(prefix.length)))
}

/**
 * 一个**引用**覆盖的所有值路径（引用 = 元素 code 或 `<code>.0` 自身值路径）：
 * 深度优先、自身值在前、同级按 code 升序。
 * 元素 code：叶子 ⇒ `[code]`；有孩子的标量 ⇒ `[code.0, …子树…]`；`object` ⇒ 只有子树。
 * `<code>.0`：只覆盖**这一个**自身值（它只对「有孩子的非结构体」成立；叶子 / 结构体 / 不存在的父 ⇒ `[]`）。
 * 认不出来 ⇒ `[]`（`reads` / `writable` 里手写的悬空引用靠这一条判，不抛异常）。
 */
export function pathsOf(state: StateElement[], ref: string): string[] {
  const element = state.find((item) => item.code === ref)
  if (!element) {
    // `<code>.0` 是自身值的路径：只有「有孩子的非结构体」才有这一格
    if (!ref.endsWith('.0')) return []
    const base = state.find((item) => item.code === ref.slice(0, -2))
    if (!base || base.type === 'object') return []
    return pathsOf(state, base.code)[0] === ref ? [ref] : []
  }
  const children = childrenOf(state, ref)
  const paths: string[] = []
  // 结构体没有自身值：它的 code 不是值路径，只有孩子是
  if (element.type !== 'object') paths.push(children.length > 0 ? `${ref}.0` : ref)
  for (const child of children) paths.push(...pathsOf(state, child.code))
  return paths
}

/** 元素自己的值路径：有孩子的住 `<code>.0`，没孩子的就是自己 */
function ownPathOf(state: StateElement[], element: StateElement): string {
  return childrenOf(state, element.code).length > 0 ? `${element.code}.0` : element.code
}

/**
 * 把每个元素的 `initial` 展开成**扁平完整 code 的树**：没孩子的用自身 code、有孩子的自身值放
 * `<code>.0`、`object` 一条键都不产出。时间值是深拷贝（不与卡共享引用）。
 */
export function initialTreeOf(card: Card): Tree {
  const tree: Tree = {}
  for (const element of card.state) {
    if (element.type === 'object') continue
    const value = element.initial
    if (value === undefined) {
      throw new AppError('E_VALIDATION', {
        message: t('issue.missingInitial', { code: element.code }),
        nextStep: t('next.editor'),
        detail: { code: element.code },
      })
    }
    tree[ownPathOf(card.state, element)] = typeof value === 'object' ? { ...value } : value
  }
  return tree
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month - 1]
}

/** 公历日期 → 距 1970-01-01 的天数（Howard Hinnant 的算法；年份 1..9999 都成立） */
function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year
  const era = Math.floor(shiftedYear / 400)
  const yearOfEra = shiftedYear - era * 400
  const shiftedMonth = (month + 9) % 12
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

/** 距 1970-01-01 的天数 → 公历日期 */
function civilFromDays(days: number): { year: number; month: number; day: number } {
  const shifted = days + 719468
  const era = Math.floor(shifted / 146097)
  const dayOfEra = shifted - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) /
      365,
  )
  const year = yearOfEra + era * 400
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9
  return { year: month <= 2 ? year + 1 : year, month, day }
}

/** 是不是合法公历六格（缺字段 / 多字段都算坏） */
function isValidClock(value: unknown): value is TimeValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value).sort().join(',')
  if (keys !== 'day,hour,minute,month,second,year') return false
  const time = value as TimeValue
  if (!Object.values(time).every((part) => Number.isInteger(part))) return false
  if (time.year < 1 || time.year > 9999) return false
  if (time.month < 1 || time.month > 12) return false
  if (time.day < 1 || time.day > daysInMonth(time.year, time.month)) return false
  if (time.hour < 0 || time.hour > 23) return false
  if (time.minute < 0 || time.minute > 59) return false
  if (time.second < 0 || time.second > 59) return false
  return true
}

/** 这一天是周几（0 = 周日，1 = 周一 … 6 = 周六） */
function weekdayOf(time: TimeValue): number {
  const days = daysFromCivil(time.year, time.month, time.day)
  return (((days + 4) % 7) + 7) % 7
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/** 时间渲染成 `YYYY-MM-DD HH:mm:ss（周X）`（全角括号；提示词与编辑器共用这一份） */
export function formatTime(value: TimeValue): string {
  return t('time.formatted', {
    date: `${pad(value.year, 4)}-${pad(value.month, 2)}-${pad(value.day, 2)}`,
    clock: `${pad(value.hour, 2)}:${pad(value.minute, 2)}:${pad(value.second, 2)}`,
    weekday: t(`time.weekday.${weekdayOf(value)}`),
  })
}

function invalid(message: string, detail: unknown): AppError {
  return new AppError('E_VALIDATION', { message, nextStep: t('next.editor'), detail })
}

/**
 * 推进时间。`amount` 是正整数；`unit` 在 `bounds` 里（`upper` 是单次能推的最粗单位、`lower` 是最细的）。
 *
 * 年 / 月按公历走，**目标月没有那一天就取当月最后一天**（`2024-01-31 +1 月 = 2024-02-29`）；
 * `week` = 7 × amount 天，不存周字段；结果越过 1..9999 年 ⇒ `E_VALIDATION`。
 */
export function advanceTime(
  value: TimeValue,
  amount: number,
  unit: TimeUnit,
  bounds: { upper?: TimeUnit; lower?: TimeUnit } = {},
): TimeValue {
  if (!isValidClock(value)) throw invalid(t('error.timeSourceInvalid'), { value })
  if (!Number.isInteger(amount) || amount <= 0) throw invalid(t('error.amountInvalid'), { amount })
  const at = TIME_UNITS.indexOf(unit)
  if (at < 0) throw invalid(t('error.unitUnknown', { unit: String(unit) }), { unit })
  if (bounds.upper !== undefined && TIME_UNITS.indexOf(bounds.upper) > at) {
    throw invalid(t('error.unitOutOfBounds', { unit, upper: bounds.upper }), { unit, bounds })
  }
  if (bounds.lower !== undefined && at > TIME_UNITS.indexOf(bounds.lower)) {
    throw invalid(t('error.unitOutOfBounds', { unit, lower: bounds.lower }), { unit, bounds })
  }

  const clock = { hour: value.hour, minute: value.minute, second: value.second }
  if (unit === 'year' || unit === 'month') {
    // 月 / 年不按天数换算：月长会变，只做「年月进位 + 日夹到月末」
    let year = value.year
    let month = value.month
    if (unit === 'year') year += amount
    else {
      const months = year * 12 + (month - 1) + amount
      year = Math.floor(months / 12)
      month = (months % 12) + 1
    }
    if (year < 1 || year > 9999) throw invalid(t('error.timeOverflow'), { value, amount, unit })
    return { year, month, day: Math.min(value.day, daysInMonth(year, month)), ...clock }
  }

  const unitSeconds: Record<string, number> = {
    week: 7 * 86400,
    day: 86400,
    hour: 3600,
    minute: 60,
    second: 1,
  }
  const days = daysFromCivil(value.year, value.month, value.day)
  const total =
    days * 86400 + value.hour * 3600 + value.minute * 60 + value.second + unitSeconds[unit] * amount
  const nextDays = Math.floor(total / 86400)
  let rest = total - nextDays * 86400
  const civil = civilFromDays(nextDays)
  if (civil.year < 1 || civil.year > 9999) throw invalid(t('error.timeOverflow'), { value, amount, unit })
  const hour = Math.floor(rest / 3600)
  rest -= hour * 3600
  const minute = Math.floor(rest / 60)
  return { ...civil, hour, minute, second: rest - minute * 60 }
}

/**
 * 给一个节点加孩子：孩子是文字、初值空串、编号取下一个空位。
 * 标量节点**不转换类型**：它原来的自身值搬到 `<code>.0`，新孩子用 `<code>.1`。
 * 时间不能有孩子；不存在的 code 也是错（都 `E_VALIDATION`）。
 */
export function addChild(card: Card, tree: Tree, code: string): { card: Card; tree: Tree } {
  const element = elementAt(card.state, code)
  if (element.type === 'time') throw invalid(t('issue.timeChild', { code }), { code })
  const children = childrenOf(card.state, code)
  const lastSegment = children.length === 0 ? 0 : Number(children[children.length - 1].code.split('.').at(-1))
  const childCode = `${code}.${lastSegment + 1}`
  const child: StateElement = {
    code: childCode,
    name: t('editor.newChildName', { code: childCode }),
    note: '',
    type: 'text',
    initial: '',
  }
  const nextTree: Tree = { ...tree }
  if (children.length === 0 && element.type !== 'object') {
    nextTree[`${code}.0`] = nextTree[code]
    delete nextTree[code]
  }
  nextTree[childCode] = ''
  return { card: { ...card, state: [...card.state, child] }, tree: nextTree }
}

/** 一个 code 连同它的整棵子树 */
function subtreeCodes(state: StateElement[], code: string): string[] {
  const prefix = `${code}.`
  return state.filter((item) => item.code === code || item.code.startsWith(prefix)).map((item) => item.code)
}

/**
 * 删一个节点：自身值 + 整棵子树一起走；同层兄弟按顺序重排为 `1..n`（`.0` 自身值不动），
 * 树值的键与链上的 `reads` / `writable` 跟着映射。删光孩子的标量节点，自身值从 `.0` 搬回 `<code>`。
 * 时间元素删不得（`E_VALIDATION`）。
 */
export function removeNode(card: Card, tree: Tree, code: string): { card: Card; tree: Tree } {
  const element = elementAt(card.state, code)
  if (element.type === 'time') throw invalid(t('error.timeNotRemovable'), { code })

  const removed = new Set(subtreeCodes(card.state, code))
  const parent = parentOfCode(code)
  const siblings =
    parent === undefined
      ? card.state.filter((item) => !item.code.includes('.'))
      : childrenOf(card.state, parent)
  const at = siblings.findIndex((item) => item.code === code)

  // 旧 code → 新 code：被删节点后面的兄弟各自前移一位（连同整棵子树）
  const mapping = new Map<string, string>()
  for (const later of siblings.slice(at + 1)) {
    const segment = Number(later.code.split('.').at(-1))
    const renamed = `${later.code.slice(0, later.code.lastIndexOf('.'))}.${segment - 1}`
    for (const oldCode of subtreeCodes(card.state, later.code)) {
      mapping.set(oldCode, renamed + oldCode.slice(later.code.length))
    }
  }

  const state = card.state
    .filter((item) => !removed.has(item.code))
    .map((item) => (mapping.has(item.code) ? { ...item, code: mapping.get(item.code) as string } : item))

  // 值路径与元素 code 同构（`.0` 只是多一段），所以同一张 mapping 对两者都成立
  const mapCode = (path: string): string | undefined => {
    if (removed.has(path) || [...removed].some((gone) => path.startsWith(`${gone}.`))) return undefined
    return mapping.get(path) ?? path
  }

  const nextTree: Tree = {}
  for (const [path, value] of Object.entries(tree)) {
    const mapped = mapCode(path)
    if (mapped !== undefined) nextTree[mapped] = value
  }

  // 删光了孩子：自身值从 .0 搬回父 code（与 addChild 的搬运对称）
  if (parent !== undefined) {
    const parentElement = state.find((item) => item.code === parent)
    if (parentElement && parentElement.type !== 'object' && childrenOf(state, parent).length === 0) {
      nextTree[parent] = nextTree[`${parent}.0`]
      delete nextTree[`${parent}.0`]
    }
  }

  const chain = card.chain.map((node) => ({
    ...node,
    reads: node.reads.flatMap((ref) => {
      const mapped = mapCode(ref)
      return mapped === undefined ? [] : [mapped]
    }),
    writable: node.writable.flatMap((ref) => {
      const mapped = mapCode(ref)
      return mapped === undefined ? [] : [mapped]
    }),
  }))

  return { card: { ...card, state, chain }, tree: nextTree }
}

function stateIssues(card: Card): CardIssue[] {
  const issues: CardIssue[] = []
  const add = (code: string, path: string, message: string) =>
    issues.push({ code, path, message, errorCode: 'E_VALIDATION' })
  const state = card.state
  if (!Array.isArray(state) || state.length === 0) {
    add('', '', t('issue.stateEmpty'))
    return issues
  }
  const codes = new Set(state.map((item) => item.code))

  for (const element of state) {
    const badCode = !CODE.test(element.code)
    if (badCode) add(element.code, element.code, t('issue.badCode', { code: element.code }))
    if (!badCode && element.code !== '0' && element.code.split('.').includes('0')) {
      add(element.code, element.code, t('issue.ownSlot', { code: element.code }))
    }
    if (codeDepth(element.code) > MAX_DEPTH) {
      add(element.code, element.code, t('issue.depth', { code: element.code, max: MAX_DEPTH }))
    }
    if (!['time', 'text', 'integer', 'enum', 'object'].includes(element.type)) {
      add(element.code, element.code, t('issue.badType', { code: element.code, type: String(element.type) }))
    }
    const parent = parentOfCode(element.code)
    if (parent !== undefined && !codes.has(parent)) {
      add(element.code, element.code, t('issue.parentMissing', { code: element.code, parent }))
    }
  }
  const seen = new Set<string>()
  const duplicate = state.map((element) => element.code).find((code) => seen.has(code) || !seen.add(code))
  if (duplicate !== undefined) add(duplicate, duplicate, t('issue.duplicateCode', { code: duplicate }))

  const first = state[0]
  if (first.code !== '0' || first.type !== 'time') add(first.code, '', t('issue.timeFirst'))
  const timeElements = state.filter((element) => element.type === 'time')
  if (timeElements.length > 1) add(timeElements[1].code, '', t('issue.timeUnique'))
  for (const time of timeElements) {
    if (childrenOf(state, time.code).length > 0) add(time.code, '', t('issue.timeChild', { code: time.code }))
  }

  for (const element of state) {
    const children = childrenOf(state, element.code)
    // 同级孩子从 1 起连续编号（编号铁律）
    const segments = children.map((child) => Number(child.code.split('.').at(-1)))
    if (segments.some((segment, index) => segment !== index + 1)) {
      add(element.code, '', t('issue.childNumbering', { code: element.code }))
    }
    if (element.type === 'object') {
      if (children.length === 0) add(element.code, '', t('issue.emptyObject', { code: element.code }))
      if ('initial' in element) add(element.code, '', t('issue.objectInitial', { code: element.code }))
      continue
    }
    if (!('initial' in element)) {
      add(element.code, '', t('issue.missingInitial', { code: element.code }))
    } else if (element.type === 'text') {
      if (typeof element.initial !== 'string')
        add(element.code, '', t('issue.textInitial', { code: element.code }))
    } else if (element.type === 'integer') {
      issues.push(...integerIssues(element))
    } else if (element.type === 'enum') {
      issues.push(...enumIssues(element))
    }
    if (element.type === 'time') {
      const upper = element.granularityUpper
      const lower = element.granularityLower
      const known = (unit: TimeUnit | undefined) => unit !== undefined && TIME_UNITS.includes(unit)
      if (
        !known(upper) ||
        !known(lower) ||
        TIME_UNITS.indexOf(upper as TimeUnit) > TIME_UNITS.indexOf(lower as TimeUnit)
      ) {
        add(element.code, '', t('issue.granularity', { code: element.code }))
      }
      if ('initial' in element && !isValidClock(element.initial)) {
        add(element.code, '', t('issue.timeValue', { code: element.code }))
      }
    }
  }
  return issues
}

function integerIssues(element: StateElement): CardIssue[] {
  const issues: CardIssue[] = []
  const add = (message: string) =>
    issues.push({ code: element.code, path: '', message, errorCode: 'E_VALIDATION' })
  const numbers = [element.min, element.max, element.stepMin, element.stepMax].filter(
    (value) => value !== undefined,
  )
  if (!numbers.every((value) => Number.isInteger(value) && Math.abs(value as number) <= 1e9)) {
    add(t('issue.integerBounds', { code: element.code }))
    return issues
  }
  const min = element.min ?? -1e9
  const max = element.max ?? 1e9
  const stepMin = element.stepMin ?? 0
  const stepMax = element.stepMax ?? 1e9
  if (min > max || stepMin > stepMax || stepMin < 0) {
    add(t('issue.integerBounds', { code: element.code }))
    return issues
  }
  const initial = element.initial
  if (typeof initial !== 'number' || !Number.isSafeInteger(initial) || Math.abs(initial) > 1e9) {
    add(t('issue.integerInitial', { code: element.code }))
    return issues
  }
  if (initial < min || initial > max) add(t('issue.integerInitial', { code: element.code }))
  return issues
}

function enumIssues(element: StateElement): CardIssue[] {
  const values = element.values
  const okValues =
    Array.isArray(values) &&
    values.length > 0 &&
    values.every((value) => typeof value === 'string') &&
    new Set(values).size === values.length
  if (!okValues) {
    return [
      {
        code: element.code,
        path: '',
        message: t('issue.enumValues', { code: element.code }),
        errorCode: 'E_VALIDATION',
      },
    ]
  }
  if (typeof element.initial !== 'string' || !(values as string[]).includes(element.initial)) {
    return [
      {
        code: element.code,
        path: '',
        message: t('issue.enumInitial', { code: element.code }),
        errorCode: 'E_VALIDATION',
      },
    ]
  }
  return []
}

function chainIssues(card: Card): CardIssue[] {
  const issues: CardIssue[] = []
  const add = (message: string, errorCode: ErrorCode) =>
    issues.push({ code: '', path: '', message, errorCode })
  const chain = Array.isArray(card.chain) ? card.chain : []
  if (chain.length === 0) {
    add(t('error.chainEmpty'), 'E_CHAIN')
    return issues
  }
  const ids = chain.map((node) => node.id)
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate !== undefined) add(t('error.chainDuplicate', { node: duplicate }), 'E_CHAIN')
  const outputs = chain.filter((node) => node.type === 'output').length
  if (outputs !== 1) add(t('error.chainOutput', { count: outputs }), 'E_CHAIN')
  if (chain.filter((node) => node.type === 'time').length > 1) add(t('error.chainTime'), 'E_CHAIN')

  const promptIds = new Set((Array.isArray(card.prompts) ? card.prompts : []).map((prompt) => prompt.id))
  const codes = new Set(card.state.map((element) => element.code))
  // 引用可以是一个元素 code，也可以是 `<code>.0`（只取自身值）；认不出来的两者都不算
  const known = (ref: string) => codes.has(ref) || pathsOf(card.state, ref).length > 0
  const positions = new Map(chain.map((node, index) => [node.id, index]))
  chain.forEach((node, index) => {
    for (const ref of node.readsUpstream) {
      const at = positions.get(ref)
      if (at === undefined || at >= index)
        add(t('error.upstreamNotBefore', { node: node.id, ref }), 'E_CHAIN')
    }
    // 输出节点只产故事：`writable` 必须是空的（它就住在别人的卡里也得守这一条）
    if (node.type === 'output' && node.writable.length > 0)
      add(t('error.outputWritable', { node: node.id }), 'E_CHAIN')
    for (const ref of node.reads) {
      if (!promptIds.has(ref) && !known(ref))
        add(t('error.readsMissing', { node: node.id, ref }), 'E_VALIDATION')
    }
    for (const ref of node.writable) {
      if (!known(ref)) add(t('error.writesMissing', { node: node.id, ref }), 'E_VALIDATION')
    }
  })
  return issues
}

/**
 * 整卡的问题清单：状态树 + 链的规矩，一条一个 `{ code, path, message, errorCode }`；干净卡 ⇒ `[]`。
 * 保存按钮拿它当「能不能写盘」的判据，`validateCard` 拿它抛第一条 —— 两边不会各判一套。
 */
export function cardIssues(card: Card): CardIssue[] {
  return [...stateIssues(card), ...chainIssues(card)]
}
