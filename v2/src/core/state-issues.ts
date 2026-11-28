/**
 * 状态树与链的**问题清单**（`CONTRACT §6.1`）：保存按钮与 `validateCard` 共用这一份。
 *
 * 两条口径不在这里重写：
 *   · 值路径怎么算 ⇒ `pathsOf`；值像不像 ⇒ `valueFits`；
 *   · 编号铁律（孩子从 1 起连续、父 code 存在、深度 ≤ 5）是**所有**元素共有的，
 *     数组的字段定义也照这一条（它们是 `state[]` 里的元素）。
 *
 * 数组（阶段 3）多出来的四条：
 *   · 数组必须有 ≥1 个字段；`object` / `array` 字段必须有孩子；
 *   · 数组字段不能是 `time`（直接字段或嵌套子孙都不行）；
 *   · **标量字段和普通节点同权**：可以同时有自己的值和子字段（item 里值住 `<code>.0` + 孩子）；
 *   · 初始值表里，数组只占它自己的 code 一条（`2.4.1` / `2.4.0` 都是多余路径）。
 */
import { t } from '../i18n'
import {
  CODE,
  INTEGER_LIMIT,
  MAX_DEPTH,
  childrenOf,
  codeDepth,
  isInsideArray,
  isRecord,
  parentOfCode,
} from './state-codes'
import { integerRangeOf, valueFits } from './state-values'
import { elementOfPath, pathsOf } from './state-data'
import { isFieldRef } from './state-refs'
import { HOLIDAY_GROUPS } from './holidays'
import { TIME_MODES, isTimeValue } from './timevalue'
import type { Card, Holidays, StateElement, Tree } from './types'
import type { ErrorCode } from './errors'

/**
 * 一条卡问题。`code` = 出问题的状态元素 code（卡级问题给 `''`），`path` = 更细的路径
 * （如 `2.4.0`）或 `''`，`message` = 中文。
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

/** 三个节日勾选齐全且都是布尔（组名从 `holidays.ts` 走：加组时这里自动跟上） */
function holidaysFit(holidays: Holidays | undefined): boolean {
  if (holidays === undefined) return false
  return HOLIDAY_GROUPS.every((group) => typeof holidays[group] === 'boolean')
}

/** 一个根元素的初始值表要覆盖哪些值路径：`pathsOf` 就是口径（数组只占一条） */
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
    if (!isRecord(element.initial)) {
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
      if (owner === undefined || !valueFits(card.state, owner, table[path])) {
        add(owner?.code ?? '', path, t('issue.initialValue', { path }))
      }
    }
  }
  return issues
}

/**
 * 状态元素这一半的清单。数组的字段定义也是元素，所以编号 / 深度 / 类型这几条对它们自动成立；
 * 数组特有的几条（字段数、容器字段必须有孩子、时间不能做字段）在这里按「在不在数组子树里」判。
 */
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
    if (!['time', 'text', 'integer', 'enum', 'object', 'array'].includes(element.type)) {
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
    const field = isInsideArray(state, element.code)
    // 数组子树里只有时间不能当字段；标量字段可以和普通节点一样**有自身值 + 子字段**
    if (field && element.type === 'time') add(element.code, '', t('issue.timeField', { code: element.code }))
    if (element.type === 'array') {
      if (children.length === 0) add(element.code, '', t('issue.emptyArray', { code: element.code }))
      continue
    }
    if (element.type === 'object') {
      if (children.length === 0) add(element.code, '', t('issue.emptyObject', { code: element.code }))
      continue
    }
    // 数字 / 下拉的专属格子：上下限与白名单本身坏没坏（与初始值无关，永远判）
    if (element.type === 'integer') issues.push(...integerIssues(element))
    else if (element.type === 'enum') issues.push(...enumIssues(element))
    if (element.type !== 'time') continue
    // 时间元素：模式、节日格子、时间值本身（存量）：三条各自独立，缺一条就说一条
    const mode = element.timeMode
    if (mode === undefined || !TIME_MODES.includes(mode)) {
      add(element.code, '', t('issue.timeMode', { code: element.code }))
    } else {
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

/** 数字元素的上下限 / 步幅本身坏没坏（顺序、正负、整数、上限都与校验同一把尺） */
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

/** 下拉白名单：非空、不重复、都是字符串 */
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

/** 链的规矩（`CONTRACT §6.1`）：输出个数、时间上限、id 唯一、上游只能往前读、引用必须存在 */
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
  // 引用可以是一个元素 code、一个 `<code>.0`（只取自身值），也可以是一个**数组字段**引用
  // （`2.4.1` = 所有 item 里的那一格）。认不出来的两者都不算。
  const known = (ref: string) => elementOfPath(card.state, ref) !== undefined || isFieldRef(card.state, ref)
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
 * 每条值路径都还在、没有多出来的键、每个值仍符合元素的类型与上下限（时间按模式判、数组按 item 形状判）。
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
    if (!valueFits(card.state, element, tree[path])) {
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
