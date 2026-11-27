/**
 * 状态树（阶段 2.2）：形状规则、扁平值、初始值归根、增删改、整卡问题清单。
 *
 * 形状一句话（`CONTRACT §2.1`）：**键是完整 code 的扁平表**。一个节点可以同时有自己的值和孩子 ——
 * 自身值住在**隐式**的 `<code>.0`（不进 `state[]`），可见孩子从 `<code>.1` 起连续编号；
 * `object` 没有自身值；深度（`.0` 不计）最大 5。`type` 描述的是自身值，所以标量节点可以有孩子、
 * 不会因此变成 `object`。
 *
 * 初始值一句话（`CONTRACT §2.2` · A）：**只有根元素（`code` 不含 `.`）存初始值**，而且它不是
 * 「元素自己的值」，是**整棵子树的扁平值表**（键是完整 code，与存档 `tree` 同一套口径）。
 * 时间根是唯一例外：它就是时间值本身。子元素存 `initial` 就是坏卡（`E_VALIDATION`）。
 *
 * 这一份住四样东西：
 *   · **派生**：`initialTreeOf` 把根初始值摊平成新建存档的树，`pathsOf` 说一个 code 覆盖哪些值路径；
 *   · **同步**：`addChild` / `removeNode` / `setElementType` / `setInitial` / `setTimeMode` ——
 *     改结构或改类型时，所属根的那张表要跟着搬（搬错一格就是「值悄悄丢了」）；
 *   · **时间**：真公历的三种模式住在 `timevalue.ts`，这里原样转出（调用方按 `core/statetree` 取）；
 *   · **校验**：`cardIssues` 给出整卡的问题清单（状态树 + 链的规矩），保存按钮与 `validateCard` 共用它。
 *
 * 谁也别在这里加数组 / 字典：2.2 明确整块推迟（那会是另一套形状）。
 */
import { t } from '../i18n'
import { AppError } from './errors'
import type { ErrorCode } from './errors'
import { TIME_MODES, TIME_UNITS, defaultTimeOf, isTimeValue, unitsOfMode } from './timevalue'
import type {
  Card,
  Holidays,
  InitialTable,
  StateElement,
  StateType,
  StateValue,
  TimeMode,
  TimeUnit,
  TimeValue,
  Tree,
} from './types'

// 时间那半住在 `timevalue.ts`：调用方一直从 `statetree` 取，这里原样转出
export {
  YEAR_MIN,
  YEAR_MAX,
  TIME_MODES,
  TIME_UNITS,
  cellsOfMode,
  unitsOfMode,
  defaultTimeOf,
  isTimeValue,
  formatTime,
  advanceTime,
} from './timevalue'

/** 可见深度上限（`.0` 不计）：`1.1.1.1.1` 合法，第 6 段不合法 */
export const MAX_DEPTH = 5

/** 数字元素的绝对值上限（值、初始值、上下限与步幅都用这一条） */
export const INTEGER_LIMIT = 1e9

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

/** 根元素的 code（`1.1.1` ⇒ `1`）—— 初始值只挂在它身上 */
export function rootCodeOf(code: string): string {
  return code.split('.')[0]
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
export function childrenOf(state: StateElement[], code: string): StateElement[] {
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

/**
 * 一条**值路径**属于哪个元素：叶子就是自己的 code，有孩子的节点是 `<code>.0`。
 * `object` 的自身 code / 它的 `.0` 都不返回值路径，所以这里也返回 `undefined`
 * （引擎据此把「写结构体自身」与「路径不存在」都判成链的错）。
 */
export function elementOfPath(state: StateElement[], path: string): StateElement | undefined {
  const own = state.find((element) => element.code === path)
  if (own) return own
  if (!path.endsWith('.0')) return undefined
  const base = state.find((element) => element.code === path.slice(0, -2))
  if (!base) return undefined
  return pathsOf(state, base.code).includes(path) ? base : undefined
}

/** 元素自己的值路径：有孩子的住 `<code>.0`，没孩子的就是自己 */
function ownPathOf(state: StateElement[], element: StateElement): string {
  return childrenOf(state, element.code).length > 0 ? `${element.code}.0` : element.code
}

/** 换类型时新类型给什么默认值（`object` 没有自身值 ⇒ `undefined`） */
function defaultInitialOf(type: StateType): StateValue | undefined {
  if (type === 'object') return undefined
  if (type === 'integer') return 0
  return ''
}

function invalid(message: string, detail: unknown): AppError {
  return new AppError('E_VALIDATION', { message, nextStep: t('next.editor'), detail })
}

const isTable = (value: unknown): value is InitialTable =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 某个 code 所属根元素的 `initial` 表（**拷贝**，调用方拿它算新卡）。
 * 时间根不走这里（它的 `initial` 就是时间值）；表坏了 ⇒ `E_VALIDATION`。
 */
function initialTableOf(state: StateElement[], code: string): InitialTable {
  const root = elementAt(state, rootCodeOf(code))
  if (!isTable(root.initial)) throw invalid(t('issue.initialTable', { code: root.code }), { code: root.code })
  return { ...root.initial }
}

/** 把一个根元素的初始值换成新的那张表（只换这一格，别的元素原样） */
function withInitialTable(card: Card, rootCode: string, table: InitialTable): Card {
  return {
    ...card,
    state: card.state.map((item) => (item.code === rootCode ? { ...item, initial: table } : item)),
  }
}

/**
 * 把**根元素的初始值**摊平成扁平树：非时间根摊平它那张表，时间根就是时间值本身
 * （深拷贝，不与卡共享引用）。根元素缺 `initial` ⇒ `E_VALIDATION`。
 *
 * 覆盖不全 / 多键 / 类型不符**不在这里判** —— 那是 `cardIssues` 的清单。
 */
export function initialTreeOf(card: Card): Tree {
  const tree: Tree = {}
  for (const element of card.state) {
    if (element.code.includes('.')) continue
    const value = element.initial
    if (value === undefined || value === null) {
      throw invalid(t('issue.missingInitial', { code: element.code }), { code: element.code })
    }
    if (element.type === 'time') {
      // 时间根的 initial 就是时间值本身（深拷贝，不与卡共享引用）
      tree[element.code] = { ...(value as TimeValue) }
      continue
    }
    for (const [path, item] of Object.entries(value as InitialTable)) {
      // 子树里的对象值只有一种：值路径指向一个时间值 —— 也深拷贝，别让树和卡共享引用
      tree[path] = isTable(item) ? { ...(item as TimeValue) } : item
    }
  }
  return tree
}

/**
 * 给一个元素加孩子：孩子是文字、没有 `initial`，编号取下一个空位。
 * 标量元素**不转换类型**：它原来的自身值在所属根的初始值表里从 `<code>` 搬到 `<code>.0`，
 * 新孩子的值路径补一条空串。时间不能有孩子；不存在的 code 也是错（都 `E_VALIDATION`）。
 */
export function addChild(card: Card, code: string): Card {
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
  }
  const table = initialTableOf(card.state, code)
  if (children.length === 0 && element.type !== 'object') {
    table[`${code}.0`] = table[code]
    delete table[code]
  }
  table[childCode] = ''
  // 新孩子插在父的整棵子树之后（左栏按 `state[]` 顺序渲染，追加到末尾就会掉到整棵树最底下）
  const state = [...card.state]
  const subtree = new Set(subtreeCodes(card.state, code))
  let insertAt = state.findIndex((item) => item.code === code) + 1
  state.forEach((item, index) => {
    if (subtree.has(item.code)) insertAt = index + 1
  })
  state.splice(insertAt, 0, child)
  return withInitialTable({ ...card, state }, rootCodeOf(code), table)
}

/** 一个 code 连同它的整棵子树 */
function subtreeCodes(state: StateElement[], code: string): string[] {
  const prefix = `${code}.`
  return state.filter((item) => item.code === code || item.code.startsWith(prefix)).map((item) => item.code)
}

/**
 * 删一个元素：自身值 + 整棵子树一起走；同层兄弟按顺序重排为 `1..n`（`.0` 自身值不动），
 * 链上的 `reads` / `writable` 跟着映射；**每个根元素的初始值表也按同一张映射表搬** ——
 * 被删子树的键整批消失、重排的兄弟（含 `<code>.0`）改名、删光孩子的标量把 `parent.0` 搬回 `parent`。
 * 时间元素删不得（`E_VALIDATION`）。
 */
export function removeNode(card: Card, code: string): Card {
  const element = elementAt(card.state, code)
  if (element.type === 'time') throw invalid(t('error.timeNotRemovable'), { code })

  const removed = new Set(subtreeCodes(card.state, code))
  const parent = parentOfCode(code)
  // 根 = `parentOfCode` 返回 undefined（全模块唯一的根判据）
  const siblings =
    parent === undefined
      ? card.state.filter((item) => parentOfCode(item.code) === undefined)
      : childrenOf(card.state, parent)
  const at = siblings.findIndex((item) => item.code === code)

  // 旧 code → 新 code：被删节点后面的兄弟各自前移一位（连同整棵子树）。
  // 顶层（`parent === undefined`）没有前缀点，新 code 就是纯数字：`2` 前移成 `1`，不是 `.1`。
  const mapping = new Map<string, string>()
  for (const later of siblings.slice(at + 1)) {
    // 坏 code 不参与重排；时间 `0` 永远不改名（否则会拼出 `-1` 或撞掉 `0`）
    if (!CODE.test(later.code) || later.type === 'time') continue
    const segment = Number(later.code.split('.').at(-1))
    const renamed = parent === undefined ? String(segment - 1) : `${parent}.${segment - 1}`
    for (const oldCode of subtreeCodes(card.state, later.code)) {
      const newCode = renamed + oldCode.slice(later.code.length)
      mapping.set(oldCode, newCode)
      // 元素自己的值住在隐式 `.0`：它也是值路径，初始值表与链引用要一起搬
      mapping.set(`${oldCode}.0`, `${newCode}.0`)
    }
  }

  const state = card.state
    .filter((item) => !removed.has(item.code))
    .map((item) => (mapping.has(item.code) ? { ...item, code: mapping.get(item.code) as string } : item))

  // 删光了孩子：自身值从 `.0` 搬回父 code（与 addChild 的搬运对称）；
  // 初始值表的键与链引用的 `<parent>.0` 也一起收成父 code —— 那个值路径已经不存在了。
  const parentElement = parent === undefined ? undefined : state.find((item) => item.code === parent)
  if (
    parent !== undefined &&
    parentElement &&
    parentElement.type !== 'object' &&
    childrenOf(state, parent).length === 0
  ) {
    mapping.set(`${parent}.0`, parent)
  }

  // 值路径 = 元素 code（`.0` 那一格也在 mapping 里），所以初始值表键与链引用走同一张表
  const mapCode = (path: string): string | undefined => {
    if (removed.has(path) || [...removed].some((gone) => path.startsWith(`${gone}.`))) return undefined
    return mapping.get(path) ?? path
  }

  // 根元素的旧表按「新 code」索引：删完后元素可能已经改名，先记下来再套用
  const tables = new Map<string, InitialTable>()
  for (const old of card.state) {
    if (old.code.includes('.') || old.type === 'time' || removed.has(old.code)) continue
    if (!isTable(old.initial)) continue
    tables.set(mapping.get(old.code) ?? old.code, old.initial)
  }

  const nextState = state.map((item) => {
    if (item.code.includes('.') || item.type === 'time') return item
    const old = tables.get(item.code)
    if (old === undefined) return item
    const table: InitialTable = {}
    for (const [path, value] of Object.entries(old)) {
      const moved = mapCode(path)
      if (moved !== undefined) table[moved] = value
    }
    return { ...item, initial: table }
  })

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

  return { ...card, state: nextState, chain }
}

/**
 * 换一个元素的类型：清掉旧类型的专属格子（values / 上下限 / 步幅 / 颗粒度 / 模式 / 节日），
 * **所属根的初始值表不整张删**（它还要装新值）—— 只改这一格，并按新类型补默认值：
 *   · 新类型 `object` ⇒ 自己那条值路径从表里删掉（结构体没有自身值）；
 *   · 有孩子 ⇒ 默认值写在 `<code>.0`；没孩子 ⇒ 写在 `<code>`；
 *   · 旧类型 `object`、新类型是标量 ⇒ 补一条自己的值路径。
 * 孩子不动（换类型不搬孩子）。非 `time` 元素换成 `time` ⇒ `E_VALIDATION`。
 */
export function setElementType(card: Card, code: string, type: StateType): Card {
  const element = elementAt(card.state, code)
  if (type === 'time' && element.type !== 'time') {
    throw invalid(t('issue.typeToTime', { code }), { code, type })
  }
  const next: StateElement = { ...element, type }
  delete next.values
  delete next.min
  delete next.max
  delete next.stepMin
  delete next.stepMax
  delete next.timeMode
  delete next.holidays
  delete next.granularityUpper
  delete next.granularityLower
  if (type === 'enum') next.values = []
  const table = initialTableOf(card.state, code)
  const ownPath = ownPathOf(card.state, element)
  delete table[ownPath]
  const initial = defaultInitialOf(type)
  if (initial !== undefined) table[ownPath] = initial
  const isRoot = !code.includes('.')
  const state = card.state.map((item) => {
    if (item.code === code) return isRoot ? { ...next, initial: table } : next
    if (item.code === rootCodeOf(code)) return { ...item, initial: table }
    return item
  })
  return { ...card, state }
}

/**
 * 编辑器改初始值走这一条：把 `value` 写进「拥有这条值路径的根元素的初始值表」。
 * 时间根的路径就是它自己的 code（值就是时间值本身）。
 * `path` 不属于任何根的初始值 ⇒ `E_VALIDATION`（点名 path）。不校验值得类型（那是 `cardIssues`）。
 */
export function setInitial(card: Card, path: string, value: StateValue): Card {
  const rootCode = rootCodeOf(path)
  const root = elementAt(card.state, rootCode)
  if (root.type === 'time') {
    if (path !== rootCode) throw invalid(t('issue.initialPath', { path }), { path })
    return {
      ...card,
      state: card.state.map((item) => (item.code === rootCode ? { ...item, initial: value } : item)),
    }
  }
  const table = initialTableOf(card.state, path)
  if (!(path in table)) throw invalid(t('issue.initialPath', { path }), { path })
  table[path] = value
  return withInitialTable(card, rootCode, table)
}

/**
 * 换时间模式：时间初始值重置成新模式的默认值；颗粒度两格若不在新模式的单位表里就回落到 `day`；
 * `days-minute` 删掉节日那一格，从天数模式切回年份模式则补一份三个都是 `false` 的节日勾选。
 */
export function setTimeMode(card: Card, mode: TimeMode): Card {
  const units = unitsOfMode(mode)
  const fallback = (unit: TimeUnit | undefined): TimeUnit =>
    unit !== undefined && units.includes(unit) ? unit : 'day'
  const state = card.state.map((element) => {
    if (element.type !== 'time') return element
    const next: StateElement = {
      ...element,
      timeMode: mode,
      initial: defaultTimeOf(mode),
      granularityUpper: fallback(element.granularityUpper),
      granularityLower: fallback(element.granularityLower),
    }
    if (mode === 'days-minute') {
      delete next.holidays
      return next
    }
    next.holidays = { international: false, china: false, traditional: false, ...element.holidays }
    return next
  })
  return { ...card, state }
}

/** 树里的一条值是不是这个元素认的形状（初始值校验、存档校验、存档编辑器共用这一份） */
export function valueFits(element: StateElement, value: unknown): boolean {
  switch (element.type) {
    case 'time':
      return isTimeValue(value, element.timeMode)
    case 'text':
      return typeof value === 'string'
    case 'integer':
      return integerValueFits(element, value)
    case 'enum':
      return enumValueFits(element, value)
    default:
      return true
  }
}

/** 三个节日勾选齐全且都是布尔 */
function holidaysFit(holidays: Holidays | undefined): boolean {
  if (holidays === undefined) return false
  return [holidays.international, holidays.china, holidays.traditional].every(
    (flag) => typeof flag === 'boolean',
  )
}

/** 一个根元素的初始值表要覆盖哪些值路径：`pathsOf` 就是口径 */
function initialIssues(card: Card): CardIssue[] {
  const issues: CardIssue[] = []
  const add = (code: string, path: string, message: string) =>
    issues.push({ code, path, message, errorCode: 'E_VALIDATION' })
  for (const element of card.state) {
    // 初始值只许住在根元素身上：子元素带这一格（哪怕是 undefined）就是坏卡
    if (element.code.includes('.')) {
      if ('initial' in element) add(element.code, '', t('issue.childInitial', { code: element.code }))
      continue
    }
    // 时间根的初始值是时间值本身，归时间那一族判（模式 / 六格旧形状）
    if (element.type === 'time') continue
    if (!('initial' in element)) {
      add(element.code, '', t('issue.missingInitial', { code: element.code }))
      continue
    }
    if (!isTable(element.initial)) {
      add(element.code, '', t('issue.initialTable', { code: element.code }))
      continue
    }
    const table = element.initial
    const paths = pathsOf(card.state, element.code)
    const known = new Set(paths)
    for (const path of paths) {
      if (!(path in table)) add(element.code, path, t('issue.initialMissingPath', { path }))
    }
    for (const path of Object.keys(table)) {
      if (!known.has(path)) add('', path, t('issue.initialExtraPath', { path }))
    }
    for (const path of paths) {
      if (!(path in table)) continue
      const owner = elementOfPath(card.state, path)
      if (owner === undefined || !valueFits(owner, table[path])) {
        add(owner?.code ?? '', path, t('issue.initialValue', { path }))
      }
    }
  }
  return issues
}

function stateIssues(card: Card, checkInitial: boolean): CardIssue[] {
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

  // 根层也要 1..n（`0` 是时间，占第一格）：删顶层元素后的重排由这一条兜住
  const roots = state
    .filter((item) => CODE.test(item.code) && parentOfCode(item.code) === undefined && item.code !== '0')
    .map((item) => Number(item.code))
    .sort((left, right) => left - right)
  const badRoot = roots.find((segment, index) => segment !== index + 1)
  if (badRoot !== undefined) add(String(badRoot), '', t('issue.rootNumbering', { code: String(badRoot) }))

  for (const element of state) {
    const children = childrenOf(state, element.code)
    // 同级孩子从 1 起连续编号（编号铁律）
    const segments = children.map((child) => Number(child.code.split('.').at(-1)))
    if (segments.some((segment, index) => segment !== index + 1)) {
      add(element.code, '', t('issue.childNumbering', { code: element.code }))
    }
    if (element.type === 'object') {
      if (children.length === 0) add(element.code, '', t('issue.emptyObject', { code: element.code }))
      continue
    }
    // 数字 / 下拉的专属格子：上下限与白名单本身坏没坏（与初始值无关，永远判）
    if (element.type === 'integer') issues.push(...integerIssues(element))
    else if (element.type === 'enum') issues.push(...enumIssues(element))
    if (element.type !== 'time') continue
    // 时间元素：模式、节日格子、颗粒度、时间值本身（存量）：四条各自独立，缺一条就说一条
    const mode = element.timeMode
    if (mode === undefined || !TIME_MODES.includes(mode)) {
      add(element.code, '', t('issue.timeMode', { code: element.code }))
    } else {
      const units = unitsOfMode(mode)
      const known = (unit: TimeUnit | undefined) => unit !== undefined && units.includes(unit)
      const upper = element.granularityUpper
      const lower = element.granularityLower
      if (
        !known(upper) ||
        !known(lower) ||
        TIME_UNITS.indexOf(upper as TimeUnit) > TIME_UNITS.indexOf(lower as TimeUnit)
      ) {
        add(element.code, '', t('issue.granularity', { code: element.code }))
      }
      if (mode === 'days-minute') {
        if ('holidays' in element) add(element.code, '', t('issue.holidaysInDays', { code: element.code }))
      } else if (!holidaysFit(element.holidays)) {
        add(element.code, '', t('issue.holidays', { code: element.code }))
      }
      if (checkInitial) {
        if (!('initial' in element)) add(element.code, '', t('issue.missingInitial', { code: element.code }))
        else if (!isTimeValue(element.initial, mode)) {
          add(element.code, '', t('issue.timeValue', { code: element.code }))
        }
      }
    }
  }
  if (checkInitial) issues.push(...initialIssues(card))
  return issues
}

/** 数字的四个格与缺省值（契约 §2.1）：缺省只在这里写一次 */
function integerRangeOf(element: StateElement): {
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
 * 卡校验 / 存档校验 / 写入执行三处共用这一份（契约 §2.1 / §4.3）。
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

function integerIssues(element: StateElement): CardIssue[] {
  const issue = (message: string): CardIssue[] => [
    { code: element.code, path: '', message, errorCode: 'E_VALIDATION' },
  ]
  const numbers = [element.min, element.max, element.stepMin, element.stepMax].filter(
    (value) => value !== undefined,
  )
  if (!numbers.every((value) => Number.isInteger(value) && Math.abs(value as number) <= INTEGER_LIMIT)) {
    return issue(t('issue.integerBounds', { code: element.code }))
  }
  const { min, max, stepMin, stepMax } = integerRangeOf(element)
  if (min > max || stepMin > stepMax || stepMin < 0) {
    return issue(t('issue.integerBounds', { code: element.code }))
  }
  return []
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
 *
 * `initial: false` ⇒ **初始值这一族整块不判**（缺根 / 少路径 / 多键 / 值不符 / 子元素带 initial 都不报）：
 * 存档编辑器改的是卡快照的非初始字段，卡快照里的初始值早就展开成 `save.tree`，存档模式也不显示它。
 */
export function cardIssues(card: Card, options: { initial?: boolean } = {}): CardIssue[] {
  return [...stateIssues(card, options.initial !== false), ...chainIssues(card)]
}

/**
 * 存档编辑器保存前的兼容性清单：**新的卡快照必须容得下这一份存档的当前树** ——
 * 每条值路径都还在、没有多出来的键、每个值仍符合元素的类型与上下限（时间按模式判）。
 * **不看初始值**：初始值是卡的种子，这一局的当前值住在 `save.tree`（契约 §6.2）。
 */
export function saveTreeIssues(card: Card, tree: Tree): CardIssue[] {
  const issues: CardIssue[] = []
  const paths = new Set(card.state.flatMap((element) => pathsOf(card.state, element.code)))
  for (const path of paths) {
    if (!(path in tree)) {
      issues.push({
        code: codeOfPath(card.state, path),
        path,
        message: t('issue.saveTreeMissing', { path }),
        errorCode: 'E_VALIDATION',
      })
    }
  }
  for (const path of Object.keys(tree)) {
    if (!paths.has(path)) {
      issues.push({ code: '', path, message: t('issue.saveTreeExtra', { path }), errorCode: 'E_VALIDATION' })
    }
  }
  for (const element of card.state) {
    if (element.type === 'object') continue
    const [path] = pathsOf(card.state, element.code)
    if (path === undefined || !(path in tree)) continue
    if (!valueFits(element, tree[path])) {
      issues.push({
        code: element.code,
        path,
        message: t('issue.saveTreeValue', { path }),
        errorCode: 'E_VALIDATION',
      })
    }
  }
  return issues
}

/**
 * 一条值路径属于哪个元素 code（错误清单点回哪一行）：叶子路径就是自己的 code，
 * 有孩子的节点自身值路径 `<code>.0` 归它的父元素；对不上任何元素 ⇒ `''`（卡级问题）。
 */
function codeOfPath(state: StateElement[], path: string): string {
  if (state.some((element) => element.code === path)) return path
  const base = path.endsWith('.0') ? path.slice(0, -2) : ''
  return base !== '' && state.some((element) => element.code === base) ? base : ''
}
