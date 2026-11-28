/**
 * 状态树的数据层（阶段 2.2 + 阶段 3 数组）：值路径、初始值展开、增删改时同步每个根元素的初始值表。
 *
 * 形状一句话（`CONTRACT §2.1`）：**键是完整 code 的扁平表**。一个节点可以同时有自己的值和孩子 ——
 * 自身值住在**隐式**的 `<code>.0`（不进 `state[]`），可见孩子从 `<code>.1` 起连续编号；
 * `object` 没有自身值；深度（`.0` 不计）最大 5。`type` 描述的是自身值，所以标量节点可以有孩子、
 * 不会因此变成 `object`。
 *
 * 数组是唯一另一种「值不住在 `.0`」的形态（`CONTRACT §2.6`）：`type: 'array'` 的节点，**值就住在
 * 节点自己的 code**（`2.4`），是一个 item 结构体列表；子元素是 item 的**字段定义**（schema），
 * 不是值路径。`.0` 与数组无关（没有「自身值」这一格）。
 *
 * 初始值一句话（`CONTRACT §2.2` · A）：**只有根元素（`code` 不含 `.`）存初始值**，而且它不是
 * 「元素自己的值」，是**整棵子树的扁平值表**（键是完整 code，与存档 `tree` 同一套口径）。
 * 时间根是唯一例外：它就是时间值本身。子元素存 `initial` 就是坏卡（`E_VALIDATION`）。
 */
import { t } from '../i18n'
import { AppError } from './errors'
import {
  CODE,
  childrenOf,
  elementAt,
  isInsideArray,
  isRecord,
  parentOfCode,
  rootCodeOf,
  subtreeCodes,
} from './state-codes'
import { fieldDefaultOf } from './state-values'
import { addChildValue, arrayRootOf, cloneValue, remapArrayValue, structsAt } from './state-array'
import { NO_HOLIDAYS } from './holidays'
import { defaultTimeOf } from './timevalue'
import type {
  ArrayValue,
  Card,
  InitialTable,
  ItemObject,
  ItemValue,
  StateElement,
  StateType,
  StateValue,
  TimeMode,
  Tree,
  TreeValue,
} from './types'

/** 换类型时新类型给什么默认值（`object` / `array` 有各自的落表规则，不在这里） */
function defaultInitialOf(type: StateType): StateValue | undefined {
  if (type === 'object' || type === 'array') return undefined
  if (type === 'integer') return 0
  return ''
}

/** 换成**标量**时元素自己的默认值（有孩子就写在 `<code>.0`；enum 取白名单第一项） */
function ownInitialOf(element: StateElement): StateValue {
  if (element.type === 'integer') return 0
  if (element.type === 'enum') return (element.values ?? [])[0] ?? ''
  return ''
}

function invalid(message: string, detail: unknown): AppError {
  return new AppError('E_VALIDATION', { message, nextStep: t('next.editor'), detail })
}

/**
 * 一个**引用**覆盖的所有值路径（引用 = 元素 code 或 `<code>.0` 自身值路径）：
 * 深度优先、自身值在前、同级按 code 升序。
 * 元素 code：叶子 ⇒ `[code]`；有孩子的标量 ⇒ `[code.0, …子树…]`；`object` ⇒ 只有子树；
 * **数组 ⇒ 只有 `[code]`**（字段定义不是值路径，不下钻）。
 * `<code>.0`：只覆盖**这一个**自身值（它只对「有孩子的非结构体」成立；叶子 / 结构体 / 数组 / 不存在的父 ⇒ `[]`）。
 * 认不出来 ⇒ `[]`（`reads` / `writable` 里手写的悬空引用靠这一条判，不抛异常）。
 */
export function pathsOf(state: StateElement[], ref: string): string[] {
  const element = state.find((item) => item.code === ref)
  if (!element) {
    // `<code>.0` 是自身值的路径：只有「有孩子的标量」才有这一格
    if (!ref.endsWith('.0')) return []
    const base = state.find((item) => item.code === ref.slice(0, -2))
    if (!base || base.type === 'object' || base.type === 'array') return []
    return pathsOf(state, base.code)[0] === ref ? [ref] : []
  }
  // 数组的字段定义是 schema：它自己不产出值路径
  if (isInsideArray(state, ref)) return []
  if (element.type === 'array') return [ref]
  const children = childrenOf(state, ref)
  const paths: string[] = []
  // 结构体没有自身值：它的 code 不是值路径，只有孩子是
  if (element.type !== 'object') paths.push(children.length > 0 ? `${ref}.0` : ref)
  for (const child of children) paths.push(...pathsOf(state, child.code))
  return paths
}

/**
 * 一条**值路径**属于哪个元素：叶子就是自己的 code，有孩子的节点是 `<code>.0`，数组是它自己的 code。
 * `object` 的自身 code / 它的 `.0` 都不返回值路径，数组字段的 code 也不返回 —— 这里返回 `undefined`
 * （引擎据此把「写结构体自身 / 写数组字段」与「路径不存在」都判成链的错）。
 */
export function elementOfPath(state: StateElement[], path: string): StateElement | undefined {
  const own = state.find((element) => element.code === path)
  if (own) return isInsideArray(state, path) ? undefined : own
  if (!path.endsWith('.0')) return undefined
  const base = state.find((element) => element.code === path.slice(0, -2))
  if (!base) return undefined
  return pathsOf(state, base.code).includes(path) ? base : undefined
}

/** 元素自己的值路径：数组就是自己，有孩子的住 `<code>.0`，没孩子的就是自己 */
function ownPathOf(state: StateElement[], element: StateElement): string {
  if (element.type === 'array') return element.code
  return childrenOf(state, element.code).length > 0 ? `${element.code}.0` : element.code
}

/**
 * 某个 code 所属根元素的 `initial` 表（**拷贝**，调用方拿它算新卡）。
 * 时间根不走这里（它的 `initial` 就是时间值）；表坏了 ⇒ `E_VALIDATION`。
 */
function initialTableOf(state: StateElement[], code: string): InitialTable {
  const root = elementAt(state, rootCodeOf(code))
  if (!isRecord(root.initial))
    throw invalid(t('issue.initialTable', { code: root.code }), { code: root.code })
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
 * （深拷贝，不与卡共享引用：数组 / item 对象 / 嵌套数组也逐层复制）。根元素缺 `initial` ⇒ `E_VALIDATION`。
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
      tree[element.code] = cloneValue(value) as TreeValue
      continue
    }
    for (const [path, item] of Object.entries(value as InitialTable)) {
      tree[path] = cloneValue(item)
    }
  }
  return tree
}

/**
 * 给一个元素加孩子：孩子是文字、没有 `initial`，编号取下一个空位。
 * 标量元素**不转换类型**：它原来的自身值在所属根的初始值表里从 `<code>` 搬到 `<code>.0`，
 * 新孩子的值路径补一条空串。
 *
 * 数组子树下面是「每个 item 都补这个键」：新字段的默认值写进**所有现存**对应 item（外层每个 item、
 * 内层每个嵌套 item），见 `addChildValue`；**标量字段也能加孩子**（与普通节点同权）：它原来的裸值
 * 就地包成 `{<code>.0>: 旧值, 新键: 默认}`。时间不能有孩子；不存在的 code 也是错（都 `E_VALIDATION`）。
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
  const arrayRoot = arrayRootOf(card.state, code)
  if (arrayRoot !== undefined) {
    // 数组子树里：新字段的默认值写进每一层的每个 item，值路径仍是**最外层数组**那一条
    table[arrayRoot] = addChildValue(
      card.state,
      arrayRoot,
      table[arrayRoot] as ArrayValue,
      code,
      childCode,
      fieldDefaultOf(card.state, child),
    )
  } else {
    if (children.length === 0 && element.type !== 'object') {
      table[`${code}.0`] = table[code]
      delete table[code]
    }
    table[childCode] = ''
  }
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

/**
 * 删一个元素：自身值 + 整棵子树一起走；同层兄弟按顺序重排为 `1..n`（`.0` 自身值不动），
 * 链上的 `reads` / `writable` 跟着映射；**每个根元素的初始值表也按同一张映射表搬** ——
 * 被删子树的键整批消失、重排的兄弟（含 `<code>.0`）改名、删光孩子的标量把 `parent.0` 搬回 `parent`。
 * 数组值里的字段键跟着同一张映射表改名 / 消失（`remapArrayValue`）。
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
    parentElement.type !== 'array' &&
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
    if (!isRecord(old.initial)) continue
    tables.set(mapping.get(old.code) ?? old.code, old.initial)
  }

  const nextState = state.map((item) => {
    if (item.code.includes('.') || item.type === 'time') return item
    const old = tables.get(item.code)
    if (old === undefined) return item
    const table: InitialTable = {}
    for (const [path, value] of Object.entries(old)) {
      const moved = mapCode(path)
      if (moved === undefined) continue
      // 数组值里的字段键也跟着重排（`2.4.2` ⇒ `2.4.1`）；非数组值原样搬
      table[moved] =
        elementOfPath(card.state, path)?.type === 'array'
          ? remapArrayValue(card.state, path, value as ArrayValue, mapping, removed)
          : value
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
 * 换一个元素的类型：清掉旧类型的专属格子（values / 上下限 / 步幅 / 模式 / 节日），
 * **所属根的初始值表不整张删**（它还要装新值）—— 只改这一格，并按新类型补默认值：
 *   · 新类型 `object` ⇒ 自己那条值路径从表里删掉（结构体没有自身值）；
 *   · 新类型 `array`：**没有孩子** ⇒ 清掉这个 code 子树在表里的所有键，写入 `table[code] = []`；
 *     **有孩子**（object 或有孩子的标量）⇒ 自己的值清掉，当前孩子值收成**一个 item**（长度 1），
 *     孩子一条值路径都没有 ⇒ `[]`；
 *   · 有孩子 ⇒ 默认值写在 `<code>.0`；没孩子 ⇒ 写在 `<code>`；
 *   · 旧类型 `object`、新类型是标量 ⇒ 补一条自己的值路径。
 * 孩子不动（换类型不搬孩子）。非 `time` 元素换成 `time` ⇒ `E_VALIDATION`。
 *
 * **数组换类型**（卡编辑器；增补票）：只对数组子树之外的容器，字段 code 原样保留（孩子不动）：
 *   · 数组 → `text` / `integer` / `enum`：字段留成孩子，初始值取**第一个 item** 铺进孩子路径，
 *     自己的默认值写 `<code>.0`（0 项 ⇒ 各字段默认值 + 自己的默认值）；有孩子的标量字段按
 *     `<字段>.0` + 孩子路径铺，不留中间键；
 *   · 有孩子的元素 → 数组：见上（own 值清掉、孩子值收一个 item）；
 *   · `array → object` / `array ⇄ time` 一律 `E_VALIDATION`（结构体不可选、时间不能换）。
 * **数组子树里的字段**：标量字段之间照常换（每个实例写新类型的默认值）；容器字段（`object` / `array`）
 * 不换类型 —— 逐 item 的容器转换不在本票范围，数据层与下拉一起拒。**例外（t64）**：
 * **0 个字段**的数组字段可以换回 `text` / `integer` / `enum`（每个外层实例写标量默认值）。
 */
export function setElementType(card: Card, code: string, type: StateType): Card {
  const element = elementAt(card.state, code)
  // 同一个类型 ⇒ 什么都不做（值 / 字段原样；只有下拉真的换了档才走下面的搬运）
  if (element.type === type) return card
  if (type === 'time' && element.type !== 'time') {
    throw invalid(t('issue.typeToTime', { code }), { code, type })
  }
  // 时间元素不能换成别的类型（没有字段容器 / 值路径能接住它）
  if (element.type === 'time' && type !== 'time') {
    throw invalid(t('issue.typeFromTime', { code }), { code, type })
  }
  // 数组元素可以换成标量（字段留成孩子、自己的值写 `<code>.0`），但**不能换成结构体**：
  // 「结构体」不是可选类型，它就是「有孩子」；数组子树里的字段做容器间转换也不在本票范围。
  if (element.type === 'array' && type === 'object') {
    throw invalid(t('issue.arrayToObject', { code }), { code, type })
  }
  // 数组子树里的字段是 schema：容器字段（object / array）默认不换类型；但**数组字段可以换标量**
  // （逐 item 转换：每个外层实例取第一个 item 的字段值做孩子值，第 2 项起丢弃；0 字段 ⇒ 标量默认值）。
  if (isInsideArray(card.state, code)) {
    if (element.type === 'object') {
      throw type === 'array' || type === 'object'
        ? invalid(t('issue.fieldContainerConvert', { code }), { code, type })
        : invalid(t('issue.fieldScalarConvert', { code }), { code, type })
    }
    if (element.type === 'array' && type === 'object') {
      throw invalid(t('issue.fieldContainerConvert', { code }), { code, type })
    }
  }
  // 换成数组会让自身值路径（`<code>.0` / 子孙 `.0`）消失：引用它们的工作流必须先在编辑器里改掉
  if (type === 'array' && element.type !== 'array') {
    const broken = disappearingRefsOf(card, code)[0]
    if (broken !== undefined) {
      throw invalid(t('issue.typeArrayRef', { code, ref: broken }), { code, ref: broken })
    }
  }
  const next: StateElement = { ...element, type }
  delete next.values
  delete next.min
  delete next.max
  delete next.stepMin
  delete next.stepMax
  delete next.timeMode
  delete next.holidays
  // enum 目标：**保留源元素上已有的 values**（导入的数组元素可能带），own 默认从第一项来；
  // 没有 values ⇒ 空白名单（坏卡，等作者补）。
  if (type === 'enum') next.values = Array.isArray(element.values) ? [...element.values] : []
  const table = initialTableOf(card.state, code)
  // 数组子树里的类型是字段类型：值是每个 item 里那一格，不是表里的一条路径
  if (isInsideArray(card.state, code)) {
    const arrayRoot = arrayRootOf(card.state, code) as string
    const value = cloneValue(table[arrayRoot])
    for (const object of structsAt(card.state, arrayRoot, value, parentOfCode(code) as string)) {
      object[code] =
        type === 'array' && element.type !== 'array'
          ? fieldArrayValueOf(card.state, element, object[code])
          : element.type === 'array'
            ? fieldScalarValueOf(card.state, element, next, object[code])
            : fieldDefaultOf(card.state, next)
    }
    table[arrayRoot] = value
  } else if (type === 'array' && childrenOf(card.state, code).length > 0) {
    // 有孩子的元素（object 或有孩子的标量）→ 数组：自己的值清掉，当前孩子值收成**一个 item**；
    // 后代一条值路径都没有 ⇒ `[]`（`<code>.0` 是自己的值，不算孩子值）。
    const hasChildValue = pathsOf(card.state, code).some((path) => path !== `${code}.0` && path in table)
    const item = hasChildValue ? readObjectFromTable(card.state, code, table) : undefined
    clearTableSubtree(table, code)
    table[code] = item === undefined ? [] : [item]
  } else if (element.type === 'array') {
    // 数组 → 标量：字段留成孩子（code 不动），第 1 项的值铺进孩子路径，自己的默认值写 `<code>.0`
    const item = arrayFirstItem(card.state, code, table[code])
    clearTableSubtree(table, code)
    writeItemToTable(card.state, code, item, table)
    const ownPath = childrenOf(card.state, code).length > 0 ? `${code}.0` : code
    table[ownPath] = ownInitialOf(next)
  } else {
    const ownPath = ownPathOf(card.state, element)
    if (type === 'array') {
      // 数组的值住在自己的 code：先清掉这棵子树在表里的键，再写一份空数组
      clearTableSubtree(table, code)
      table[code] = []
    } else {
      delete table[ownPath]
      const initial = defaultInitialOf(type)
      if (initial !== undefined) table[ownPath] = initial
    }
  }
  const isRoot = !code.includes('.')
  const state = card.state.map((item) => {
    if (item.code === code) return isRoot ? { ...next, initial: table } : next
    if (item.code === rootCodeOf(code)) return { ...item, initial: table }
    return item
  })
  return { ...card, state }
}

/** 换成数组后会让哪些引用失效：`<code>.0` 与本子树里以 `.0` 结尾的值路径（自身值路径会消失） */
function disappearingRefsOf(card: Card, code: string): string[] {
  const own = `${code}.0`
  const found = new Set<string>()
  for (const node of card.chain) {
    for (const ref of [...node.reads, ...node.writable]) {
      if (ref === own || (ref.startsWith(`${code}.`) && ref.endsWith('.0'))) found.add(ref)
    }
  }
  return [...found]
}

/** 一个字段实例（数组值）换成标量：**第一个 item 的字段值**做孩子值、自己的值取默认；第 2 项起丢弃 */
function fieldScalarValueOf(
  state: StateElement[],
  element: StateElement,
  next: StateElement,
  value: unknown,
): ItemValue {
  const children = childrenOf(state, element.code)
  if (children.length === 0) return fieldDefaultOf(state, next)
  const items = Array.isArray(value) ? value : []
  const first = isRecord(items[0]) ? items[0] : {}
  return Object.fromEntries([
    [`${element.code}.0`, ownInitialOf(next)],
    ...children.map((child) => [child.code, first[child.code] ?? fieldDefaultOf(state, child)]),
  ])
}
/** 一个字段实例换成数组：自己的值丢掉，直接孩子的当前值收成**一个 item**；一个孩子值都没有 ⇒ `[]` */
function fieldArrayValueOf(state: StateElement[], element: StateElement, value: unknown): ItemValue {
  const children = childrenOf(state, element.code)
  if (children.length === 0) return []
  const source = isRecord(value) ? value : {}
  if (!children.some((child) => child.code in source)) return []
  return [
    Object.fromEntries(
      children.map((child) => [child.code, source[child.code] ?? fieldDefaultOf(state, child)]),
    ) as ItemObject,
  ]
}
/** 清掉一个 code 子树在初始值表里的所有键（数组 / 对象换类型时先腾空） */
function clearTableSubtree(table: InitialTable, code: string): void {
  for (const key of Object.keys(table)) {
    if (key === code || key.startsWith(`${code}.`)) delete table[key]
  }
}

/** 数组换对象时取的第一个 item；空数组 ⇒ 各字段默认值拼出来的 item */
function arrayFirstItem(state: StateElement[], code: string, value: unknown): ItemObject {
  return normalizeObjectOf(state, code, Array.isArray(value) ? value[0] : undefined)
}

/** 按字段定义补全一个对象值（缺的字段用默认值，有孩子的字段递归） */
function normalizeObjectOf(state: StateElement[], code: string, value: unknown): ItemObject {
  const source = isRecord(value) ? value : {}
  const item: ItemObject = {}
  for (const field of childrenOf(state, code)) {
    item[field.code] = normalizeFieldValue(state, field, source[field.code])
  }
  return item
}

/** 补全一个 item 里字段的值：对象 / 数组字段递归；标量字段有孩子时带 `<code>.0` 与孩子 */
function normalizeFieldValue(state: StateElement[], field: StateElement, value: unknown): ItemValue {
  if (field.type === 'object') return normalizeObjectOf(state, field.code, value)
  if (field.type === 'array') return cloneValue(Array.isArray(value) ? value : [])
  const children = childrenOf(state, field.code)
  const fallback = fieldDefaultOf(state, field)
  if (children.length === 0) return (value ?? fallback) as ItemValue
  const source = isRecord(value) ? value : {}
  const ownKey = `${field.code}.0`
  return Object.fromEntries([
    [ownKey, source[ownKey] ?? (fallback as ItemObject)[ownKey]],
    ...children.map((child) => [child.code, normalizeFieldValue(state, child, source[child.code])]),
  ])
}

/**
 * 把一个 item 的字段值铺回初始值表：有孩子的字段，自己的值写 `<code>.0`、孩子按普通节点继续铺；
 * 数组字段写它自己的 code（整份嵌套数组）；标量叶子写自己那一格。
 */
function writeItemToTable(state: StateElement[], code: string, item: ItemObject, table: InitialTable): void {
  for (const field of childrenOf(state, code)) {
    writeFieldToTable(state, field, item[field.code], table)
  }
}

function writeFieldToTable(
  state: StateElement[],
  field: StateElement,
  value: unknown,
  table: InitialTable,
): void {
  if (field.type === 'array') {
    table[field.code] = cloneValue(value ?? []) as TreeValue
    return
  }
  const children = childrenOf(state, field.code)
  const fallback = fieldDefaultOf(state, field)
  if (field.type === 'object') {
    const source = isRecord(value) ? value : {}
    for (const child of children) writeFieldToTable(state, child, source[child.code], table)
    return
  }
  if (children.length === 0) {
    table[field.code] = cloneValue(value ?? fallback) as TreeValue
    return
  }
  const source = isRecord(value) ? value : {}
  const ownKey = `${field.code}.0`
  table[ownKey] = cloneValue(source[ownKey] ?? (fallback as ItemObject)[ownKey]) as TreeValue
  for (const child of children) writeFieldToTable(state, child, source[child.code], table)
}

/** 从初始值表里读回一个对象元素的当前值（有孩子的字段拼出自己的值 + 孩子） */
function readObjectFromTable(state: StateElement[], code: string, table: InitialTable): ItemObject {
  const item: ItemObject = {}
  for (const field of childrenOf(state, code)) {
    item[field.code] = readFieldFromTable(state, field, table)
  }
  return item
}

function readFieldFromTable(state: StateElement[], field: StateElement, table: InitialTable): ItemValue {
  if (field.type === 'array') return cloneValue(table[field.code] ?? []) as ItemValue
  const children = childrenOf(state, field.code)
  if (field.type === 'object') {
    return Object.fromEntries(children.map((child) => [child.code, readFieldFromTable(state, child, table)]))
  }
  const fallback = fieldDefaultOf(state, field)
  if (children.length === 0) return cloneValue(table[field.code] ?? fallback) as ItemValue
  const ownKey = `${field.code}.0`
  return Object.fromEntries([
    [ownKey, cloneValue(table[ownKey] ?? (fallback as ItemObject)[ownKey])],
    ...children.map((child) => [child.code, readFieldFromTable(state, child, table)]),
  ])
}

/**
 * 编辑器换类型前的提示用：这个数组元素 / 数组字段一共会丢掉多少个 item
 * （每个实例 `len - 1` 之和；嵌套字段按每个外层 item 各算一次）。
 */
export function arrayDiscardedCount(card: Card, code: string): number {
  const root = arrayRootOf(card.state, code)
  if (root === undefined) return 0
  const table = initialTableOf(card.state, code)
  if (root === code) return countDiscarded(table[code])
  return structsAt(card.state, root, table[root], parentOfCode(code) as string).reduce(
    (sum, object) => sum + countDiscarded(object[code]),
    0,
  )
}

/** 一份数组值里会丢掉的 item 数（`[]` / 单元素都是 0） */
function countDiscarded(value: unknown): number {
  return Array.isArray(value) ? Math.max(0, value.length - 1) : 0
}

/**
 * 编辑器改初始值走这一条：把 `value` 写进「拥有这条值路径的根元素的初始值表」。
 * 时间根的路径就是它自己的 code（值就是时间值本身）。数组路径写的就是整份数组。
 * `path` 不属于任何根的初始值 ⇒ `E_VALIDATION`（点名 path）。不校验值得类型（那是 `cardIssues`）。
 */
export function setInitial(card: Card, path: string, value: TreeValue): Card {
  const rootCode = rootCodeOf(path)
  const root = elementAt(card.state, rootCode)
  if (root.type === 'time') {
    if (path !== rootCode) throw invalid(t('issue.initialPath', { path }), { path })
    return {
      ...card,
      state: card.state.map((item) =>
        item.code === rootCode ? { ...item, initial: value as StateValue } : item,
      ),
    }
  }
  const table = initialTableOf(card.state, path)
  if (!(path in table)) throw invalid(t('issue.initialPath', { path }), { path })
  table[path] = value
  return withInitialTable(card, rootCode, table)
}

/**
 * 换时间模式：时间初始值重置成新模式的默认值；`days-minute` 删掉节日那一格，
 * 从天数模式切回年份模式则补一份三个都是 `false` 的节日勾选。
 * 卡上多出来的字段（如 `granularityUpper`）原样留着 —— 不读、不改。
 */
export function setTimeMode(card: Card, mode: TimeMode): Card {
  const state = card.state.map((element) => {
    if (element.type !== 'time') return element
    const next: StateElement = { ...element, timeMode: mode, initial: defaultTimeOf(mode) }
    if (mode === 'days-minute') {
      delete next.holidays
      return next
    }
    next.holidays = { ...NO_HOLIDAYS, ...element.holidays }
    return next
  })
  return { ...card, state }
}
