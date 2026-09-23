/**
 * 票 70 · 段 8b-② 判据的**共享夹具与判据表**：左栏枝树 + 中栏**可写**字段表。
 *
 * 契约 `.team/test/2026-09-22/contract-70.md`（上一票是 `contract-69.md`：那时中栏只读）。
 * 两件测试文件共用这一份（★项目规矩：同一个夹具在第二个文件里再写一遍时才提取）：
 * `branch-tree-dom.test.ts` 把 `CHECKS` 挂在**真编辑器**上跑，`branch-tree-selfcheck.test.ts`
 * 把**同一批**挂在一份照契约长的替身上、按故障矩阵数"红了几条"。
 *
 * ⚠️ **期望值全部从卡里现算**，一个中文键名都不手写：`.githooks/checks/ascii.mjs` 连 `tests/`
 *    里的字符串字面量一起拦（中文只许住在注释与 locale 里）。
 * ⚠️ 走法照 `tests/card-keys-cn.test.ts:257-283` 的 `schemaPathsOf`：`object` 往 `fields` 下钻，
 *    `map` / `list` 往 `of.fields` 下钻（元素形状那一段写成 `x.*`，与那件判据同一套写法）。
 * ⚠️ 本票之后「只读」只有一个意思：**引擎接管**（`data-field-readonly` ⇔ `data-field-takeover`）。
 */
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import CardEditor from '../../src/components/CardEditor.vue'
import { i18n } from '../../src/i18n'
import { parseCard } from '../../src/game/card'
import { checkSchema, schemaElement, schemaFields, type Schema } from '../../src/game/card-state'
import { EXAMPLE_CARD } from './card-fixtures'
import { CARD_KEY } from './card-resources'

/** 示例卡（判据要用的枝、容器、字段全部从它现算，不抄第二份） */
export const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))

/** 任意组件包装器（判据表对真界面与替身一视同仁） */
export type AnyWrapper = VueWrapper<any>

/**
 * 一行元素的包装器 —— `findAll` 交出来的是 `DOMWrapper`（不是组件包装器）。
 *
 * ⚠️ 读数里那几处 `textOf(el, …)` 收的就是它：写成 `AnyWrapper` 会**类型不通**
 *    （`DOMWrapper` 没有 `componentVM` 那一族）—— 这只是标注问题，运行时两者都答得出 `find` / `text`。
 */
export type RowWrapper = DOMWrapper<Element>

/** vue-flow 的替身（jsdom 里没有 ResizeObserver）—— 本票之后编辑器里不该再有它 */
const VueFlowStub = defineComponent({
  name: 'VueFlow',
  props: { nodes: { type: Array, required: true }, edges: { type: Array, required: true } },
  emits: ['nodeClick'],
  setup: () => () => h('div', { class: 'flow-stub' }),
})

/** 挂一版**真编辑器**（卡图换替身、挂到 body 上）—— 判据与自检两条通道都从它出发 */
export function editor(): AnyWrapper {
  return mount(CardEditor, {
    props: { card, source: 'builtin' },
    global: { plugins: [i18n], stubs: { VueFlow: VueFlowStub } },
    attachTo: document.body,
  }) as AnyWrapper
}

/**
 * 一个 schema 的类型（字符串缩写就是它自己）。
 *
 * ⚠️ 参数收 `undefined`：这条在自检那一件里是从**卡里现取**的（替身照卡的声明长），
 *    取不到时**报"不是容器"**就够 —— 不必让每个调用点都先断一次。
 */
export function typeOf(node: Schema | undefined): string {
  if (node === undefined) return ''
  return typeof node === 'string' ? node : node.type
}

/** 容器类型 —— 只有这三种可能进左栏那棵树（A1）；标量留在中栏那张表里 */
const CONTAINER = ['object', 'map', 'list']

/** 引擎点名的**整棵子树**（`ENGINE_RESERVED_SUBTREES`，`card-keys-cn.test.ts:64`）—— 只取树根 */
export const ENGINE_ROOTS = ['world.time']

/**
 * 从卡里取一段路径的 schema（`a.b` → `state.a.fields.b`；`a.*` / `a.*.k` → 元素形状）。
 *
 * 照 `card-state.ts:86-95` 的 `schemaAtPath`，多认一段 `*`：`map` / `list` 的元素形状
 * （树里 `roles.*` 那种写法 —— 元素形状自己不是一格，但它的字段是）。
 */
export function schemaAtPath(path: string): Schema | undefined {
  let current: Schema | undefined
  let scope: Record<string, Schema> | undefined = card.state
  for (const segment of path.split('.')) {
    if (segment === '*') {
      current = current === undefined ? undefined : schemaElement(current)
      scope = current === undefined ? undefined : schemaFields(current)
      continue
    }
    if (scope === undefined || !Object.hasOwn(scope, segment)) return undefined
    current = scope[segment]
    scope = schemaFields(current)
  }
  return current
}

/** 一处容器节点的字段表：`object` 读它自己的 `fields`，`map` / `list` 读元素形状的 `of.fields` */
export function fieldsOf(path: string): string[] {
  const node = schemaAtPath(path)
  if (node === undefined) return []
  const own = schemaFields(node)
  if (own !== undefined) return Object.keys(own)
  const element = schemaElement(node)
  const inElement = element === undefined ? undefined : schemaFields(element)
  return inElement === undefined ? [] : Object.keys(inElement)
}

/**
 * 树的**行序列**：卡里"能编"的容器节点，按卡的声明顺序、**逐层向下**（A1 的"逐个相等"就是拿它比）。
 *
 * ⚠️ **顺序是逐层（BFS）**：与实现和 `CardEditor.vue:18` 一致 ——
 *    S3 用两个独立通道证明过（含整页巡检那张 `editor-open--laptop.png` 的左栏 22 行逐行相同）。
 *    ⚠️ **设计图的行序是前序**，那一条差异已记 follow-up（归 8b-② 让设计给说法）——
 *    本票的口径 A1 只说"集合逐个相等"、**没有定顺序**。
 * ⚠️ **什么进树**：这一格自己有一张非空的字段表 —— 中栏编的是"它自己的 `fields`"或
 *    "元素形状的 `of.fields`"，两样都没有的格子点进去是一张空表，那不是一格
 *    （`地点` 是 `list of "string"`、`画像` 是标量）⇒ 它们不进树，也不能被选中。
 */
export const TREE_PATHS: string[] = []
{
  /** 已经出过队（或已经在队里）的路径 —— 同一个格子只许进树一次 */
  const seen = new Set<string>(Object.keys(card.state))
  const queue: string[] = [...seen]
  /** 放一个路径进队（空串丢弃、重复丢弃） */
  const push = (path: string): void => {
    if (path === '' || seen.has(path)) return
    seen.add(path)
    queue.push(path)
  }
  while (queue.length > 0) {
    const path = queue.shift() as string
    const node = schemaAtPath(path)
    if (node === undefined) continue
    if (CONTAINER.includes(typeOf(node)) && fieldsOf(path).length > 0) TREE_PATHS.push(path)
    for (const key of Object.keys(schemaFields(node) ?? {})) push(path + '.' + key)
    // `*` 是元素形状那一段的标记，不是一格：它底下只再走字段，不许再套一层 `*`
    if (path.endsWith('.*')) continue
    const element = schemaElement(node)
    if (element !== undefined) push(path + '.*')
  }
}

/** 卡里全部字段键（出现在树上的字段名只许来自它） */
export const FIELD_KEYS = new Set(TREE_PATHS.flatMap((path) => fieldsOf(path)))
/** 三处不同的表：根枝（`lead`）· 元素形状那一格（`roles`）· 它底下有下钻的那一格（`lead.关系`） */
export const PICK_A = TREE_PATHS[0]
export const PICK_B = TREE_PATHS[1]
export const PICK_C = TREE_PATHS.filter((path) => path.split('.').length > 1).find(
  (path) => fieldsOf(path).length >= 3 && fieldsOf(path).length !== fieldsOf(PICK_B).length,
) as string

/**
 * 混着两种行的表：有的行由引擎接管、有的行是作者的东西（`world` 那一格）。
 *
 * A4a / A5b 靠它把「只读 ⇔ 引擎接管」放在**同一张表**上比 —— 分开两格比的话，
 * "一律带上标记"与"一律不带"都可能看不出来。
 */
export const PICK_MIX = TREE_PATHS.find((path) => {
  const keys = fieldsOf(path)
  return (
    keys.some((key) => underEngine(path + '.' + key)) && keys.some((key) => !underEngine(path + '.' + key))
  )
}) as string

/** 元素形状那一格（`map` / `list` 读的是 `of.fields`）—— W4 要两种表各验一次 */
export const PICK_ELEMENT = TREE_PATHS.find(
  (path) => schemaFields(schemaAtPath(path) as Schema) === undefined,
) as string

/**
 * B4 那一格：**既有一行删了卡也过、也有一行删了卡当场坏**。
 *
 * 老板 2026-09-22 拍的「界面不做硬锁」只能在这种格上验：一律可删（或一律锁死）的表
 * 分不出"没锁"与"锁了没生效"。
 */
export const PICK_DEL = TREE_PATHS.find((path) => {
  const free = deletableRows(path).length
  return free > 0 && free < fieldsOf(path).length
}) as string

/** 判据自己造的字段名与说明 —— 测试里的字符串字面量一律 ASCII */
export const NEW_KEY = 'test_field'
export const NEW_NOTE = 'written by the write ticket'

/** 一份卡的 JSON（判据读落盘结果、试删一行时都用它） */
export type CardJson = Record<string, any>

/** 一格里某个字段的 schema（`object` 读自己的 `fields`，`map` / `list` 读元素形状的 `of.fields`） */
function fieldOf(parent: string, key: string): Schema | undefined {
  const node = schemaAtPath(parent)
  if (node === undefined) return undefined
  const element = schemaElement(node)
  const scope = schemaFields(node) ?? (element === undefined ? undefined : schemaFields(element))
  return scope === undefined ? undefined : scope[key]
}

/** 卡里那一行声明的 `note`（没有那个键就是 `undefined` —— 界面上"空框 + 空标记"那一态） */
export function declaredNote(parent: string, key: string): string | undefined {
  const field = fieldOf(parent, key)
  const note = typeof field === 'object' && field !== null ? field.note : undefined
  return typeof note === 'string' ? note : undefined
}

/**
 * 一份卡 JSON 里那一格**可变的**字段表（落盘结果读它、试删一行也用它）。
 *
 * ⚠️ 与组件同一套走法：`*` 那一段下钻到元素形状。写错地方（往 `map` 上塞 `fields`）是
 *    **卡当场被拒**，不是静默成立 —— 所以判据读得出这件事。
 */
export function tableIn(root: CardJson, path: string): Record<string, any> {
  let node: CardJson = { type: 'object', fields: root.state }
  for (const segment of path.split('.')) {
    if (segment === '*') {
      node = node.of
      continue
    }
    const scope = node.type === 'object' ? node.fields : node.of?.fields
    node = (scope ?? {})[segment]
  }
  return node.fields ?? node.of.fields
}

/** 编辑器写进存储的那份卡的**原始 JSON**（不走 parseCard：断言要看见"那个键在不在"） */
export function storedRaw(): CardJson {
  const text = localStorage.getItem(CARD_KEY)
  if (text === null) throw new Error('the editor wrote no card into storage')
  return JSON.parse(text)
}

/**
 * 删掉这一行之后**卡自己也过得去**吗 —— `parseCard` 是唯一的裁判。
 *
 * ⚠️ 这是判据的**前提**，不是界面给的名单：老板 2026-09-22 拍「界面不做硬锁」⇒
 *    垃圾桶出现在每一行上，可删不可删由卡自己决定（删坏了保存会报错）。
 */
export function deletableRows(path: string): string[] {
  return fieldsOf(path).filter((key) => {
    const copy = JSON.parse(JSON.stringify(card)) as CardJson
    delete tableIn(copy, path)[key]
    try {
      parseCard(JSON.stringify(copy))
      return true
    } catch {
      return false
    }
  })
}

/** 一个节点在卡里的**声明**顺序 —— 表里的行序必须跟它一致（A3） */
export function declaredOrder(path: string): string[] {
  return fieldsOf(path)
}

/** 一段路径在不在引擎点名的那棵子树里（含它自己与底下每一格） */
export function underEngine(name: string): boolean {
  return ENGINE_ROOTS.some((root) => name === root || name.startsWith(root + '.'))
}

/** 左栏那棵树读出来的一行 */
export interface NavRow {
  /** `data-branch-node`：卡里的点号路径 */
  path: string
  /** 带 `data-branch-takeover`：这一格（含底下）由引擎接管 */
  taken: boolean
  /** `data-branch-depth`：这一行在第几层（＝路径的段数 —— 裁决 4 用它代替"行的先后"） */
  depth: string
}

/** 中栏字段表读出来的一行 */
export interface FieldRow {
  /** `data-field-key`：卡里的键名 */
  key: string
  /** `data-field-parent`：这一行属于哪一格 */
  parent: string
  /** 这一格显示出来的文字 */
  label: string
  /** 带 `data-field-readonly`：这一行本票只读 */
  readonly: boolean
  /** 带 `data-field-takeover`：这一行由引擎接管（永远不可改） */
  taken: boolean
  /** `data-field-initial`：`"yes"` / `"no"` —— 这一栏**开局在不在**（裁决 6：读得出来） */
  initial: string
}

/** 一棵树 + 一张表的读数 —— 断言只吃它（自检那一块才能拿替身喂同一批断言） */
export interface Editor {
  nav: NavRow[]
  /** 树上亮着的那几行（`data-branch-on`） */
  on: string[]
  rows: FieldRow[]
  /** 中栏字幕那一行在不在（`[data-branch-title]`） */
  title: boolean
  /** 还没编任何一格时那个显式的空态（`[data-branch-none]`） */
  none: boolean
  /** 表里最外面那个容器（`[data-branch-form]`） */
  table: boolean
}

/** 一处元素的文字（去首尾空白；取不到就是空串） */
export function textOf(w: AnyWrapper | RowWrapper, selector: string): string {
  const el = w.find(selector)
  return el.exists() ? el.text().trim() : ''
}

/** 读一棵渲染好的树：左栏那棵树 + 中栏那张表（缺什么就报缺，不抛） */
export function editorTree(w: AnyWrapper): Editor {
  return {
    nav: w.findAll('[data-branch-node]').map((el) => ({
      path: el.attributes('data-branch-node') ?? '',
      taken: el.attributes('data-branch-takeover') !== undefined,
      depth: el.attributes('data-branch-depth') ?? '',
    })),
    on: w.findAll('[data-branch-on]').map((el) => el.attributes('data-branch-node') ?? ''),
    rows: w.findAll('[data-field-row]').map((el) => ({
      key: el.attributes('data-field-key') ?? '',
      parent: el.attributes('data-field-parent') ?? '',
      label: textOf(el, '[data-field-name]'),
      readonly: el.attributes('data-field-readonly') !== undefined,
      taken: el.attributes('data-field-takeover') !== undefined,
      initial: el.attributes('data-field-initial') ?? '',
    })),
    title: w.find('[data-branch-title]').exists(),
    none: w.find('[data-branch-none]').exists(),
    table: w.find('[data-branch-form]').exists(),
  }
}

/** 点左栏树上的一行（选中那一格），并把树更新完 */
export async function pickRow(w: AnyWrapper, path: string): Promise<void> {
  const row = w.find('[data-branch-node="' + path + '"]')
  expect(row.exists(), 'no row for this state node in the tree: ' + path).toBe(true)
  await row.trigger('click')
}

/** 中栏那一格的字段表（只取属于这一格的行，按显示顺序） */
export function tableOf(w: AnyWrapper, path: string): FieldRow[] {
  return editorTree(w).rows.filter((row) => row.parent === path)
}

/** 表里的某一行（按"哪一格 + 哪个键"认 —— 两格有同名键时不会撞车） */
export function rowFor(w: AnyWrapper, parent: string, key: string): RowWrapper {
  // ⚠️ 两个属性在**同一个元素**上（没有空格）：中间加个空格就成了"后代"，一行都选不到
  const row = w.find('[data-field-parent="' + parent + '"][data-field-key="' + key + '"]')
  expect(row.exists(), 'no row for this field of the picked node: ' + parent + '.' + key).toBe(true)
  return row
}

/**
 * 某一行那个说明格（`[data-field-note]`：本票唯一一个"值来自卡"的输入框）。
 *
 * ⚠️ 每次调用都**重新查一遍 DOM**：组件可能整行重画（换格、保存、报错都会）——
 *    抓着上一次拿到的元素不放，第二次点它就成了点一个已经离屏的节点。
 */
export function noteBox(w: AnyWrapper, parent: string, key: string): RowWrapper {
  const box = rowFor(w, parent, key).find('[data-field-note]')
  expect(box.exists(), 'no editable note cell on this row: ' + parent + '.' + key).toBe(true)
  return box
}

/** 按下顶栏那颗「保存」（本票唯一一个把改动落盘的动作） */
export async function save(w: AnyWrapper): Promise<void> {
  const button = w.find('[data-card-save]')
  expect(button.exists(), 'the top bar hands out no save button').toBe(true)
  await button.trigger('click')
}

/** 点表尾那颗「＋ 加一个字段」、把新行的键名填上（开关它由调用方自己收 —— 每次都重新查 DOM） */
export async function openNewRow(w: AnyWrapper, name: string): Promise<void> {
  const plus = w.find('[data-field-add]')
  expect(plus.exists(), 'the table hands out no add-a-field entry').toBe(true)
  await plus.trigger('click')
  const key = w.find('[data-row-new] [data-field-key-new]')
  expect(key.exists(), 'the plus opened no new row').toBe(true)
  await key.setValue(name)
}

/** 收掉刚开出来的那一行（点它自己的垃圾桶 = 取消，不是"待删"） */
export async function cancelNewRow(w: AnyWrapper): Promise<void> {
  const box = w.find('[data-row-new] [data-field-del]')
  expect(box.exists(), 'the new row hands out no trash (the cancel of an unsaved row)').toBe(true)
  await box.trigger('click')
}

// ---------- A1–A6：判据（16 条）----------

/**
 * A1a · 左栏树的行集合 = 卡里"能编"的容器节点。
 *
 * ⚠️ **顺序不承诺**（裁决 4）：树是展示，不是语义 —— 口径只保证**集合**，实现维持逐层（BFS）、
 *    真改成前序也**不算违反**。行的"在第几层"由 A1e 那个 `data-branch-depth` 守着，
 *    所以这里不再拿行序当判据（上一票是 `toEqual(TREE_PATHS)` 的逐项比较）。
 * ⚠️ **前提：树得在**。树整条不在时下面那句"空 == 空"会空着成立（那是没牙的判据）。
 */
function checkA1a(w: AnyWrapper): void {
  const rows = editorTree(w).nav.map((row) => row.path)
  expect(rows.length, 'the tree is gone, so this check would say nothing').toBeGreaterThan(0)
  expect([...rows].sort(), 'the left tree must list exactly the card nodes').toEqual([...TREE_PATHS].sort())
}

/** A1b · 标量字段一个都不进树（`string` / `integer` / `enum` 留在中栏那张表里） */
function checkA1b(w: AnyWrapper): void {
  const inTree = new Set(editorTree(w).nav.map((row) => row.path))
  // ⚠️ 前提：树必须**在**。树整条不在时下面两句会空着成立 —— 那就是一条没牙的判据
  expect(inTree.size, 'the tree is gone, so this check would say nothing').toBeGreaterThan(0)
  const leaves = [...FIELD_KEYS].filter((key) => inTree.has(key))
  expect(leaves, 'a scalar field name must not appear as a tree row (A1)').toEqual([])
  // 反面控制：卡里确实有标量字段可漏（否则上面那句是空扫）
  expect([...FIELD_KEYS].length - leaves.length, 'the card has no scalar field at all').toBeGreaterThan(0)
}

/** A1c · 树的每一行都带 `data-branch-type`，值就是卡里那一格的 `type` */
function checkA1c(w: AnyWrapper): void {
  const rows = editorTree(w).nav
  // ⚠️ 同上：一行都没有的时候这一条什么也没验
  expect(rows.length, 'the tree is gone, so this check would say nothing').toBeGreaterThan(0)
  const wrong = rows
    .map((row) => ({
      path: row.path,
      kind: w.find('[data-branch-node="' + row.path + '"]').attributes('data-branch-type') ?? '',
      want: typeOf(schemaAtPath(row.path) as Schema),
    }))
    .filter((row) => row.kind !== row.want)
  expect(wrong, 'every tree row must carry the schema type it stands for').toEqual([])
}

/** A1d · 树上出现的**每一个名字**都得是卡里"能编"的容器节点（裁决 1 的字面意思） */
function checkA1d(w: AnyWrapper): void {
  const rows = editorTree(w).nav
  // ⚠️ 同上：没有行的时候这一条什么也没验
  expect(rows.length, 'the tree is gone, so this check would say nothing').toBeGreaterThan(0)
  const containers = new Set(TREE_PATHS)
  expect(
    rows.map((row) => row.path).filter((path) => !containers.has(path)),
    'a name in the tree is not an editable container node of the card',
  ).toEqual([])
}

/**
 * A1e · 裁决 4：每一行都读得出它在**第几层**（`data-branch-depth` ＝ 路径的段数）。
 *
 * 行的先后**不承诺**（A1a），但要看出"谁归谁"就得有个机械可断的东西 —— 缩进本来就是按层数算的，
 * 所以这一条只是把缩进已经用到的那件事报出来。⚠️ 以后真改前序时，这一条一个字都不用动。
 */
function checkA1e(w: AnyWrapper): void {
  const rows = editorTree(w).nav
  expect(rows.length, 'the tree is gone, so this check would say nothing').toBeGreaterThan(0)
  expect(
    rows
      .filter((row) => row.depth !== String(row.path.split('.').length))
      .map((row) => row.path + ' -> ' + JSON.stringify(row.depth)),
    'every tree row must carry its depth ([data-branch-depth] = the number of path segments)',
  ).toEqual([])
  // ⚠️ 反面控制：层数不能**一律相同** —— 写死一个 `0` 也满足上面那句
  expect(
    new Set(rows.map((row) => row.depth)).size,
    'a fixed depth would pass the line above',
  ).toBeGreaterThan(1)
}

/** A2a · 没选任何一格时中栏是显式的空态（不是一张空表） */
function checkA2a(w: AnyWrapper): void {
  const before = editorTree(w)
  // ⚠️ 前提：**接缝先在**。不然"没有表"在旧界面上也成立（旧中栏本来就没有这张表）
  expect(before.none, 'the mid column must say it has nothing to edit yet').toBe(true)
  expect(before.table, 'no field table [data-branch-form] before anything is picked').toBe(false)
  expect(before.rows.length, 'no field row may exist before anything is picked').toBe(0)
}

/** A2b · 选一处 ⇒ 表里的行集合与卡的声明逐个相等；树上的每一行都有东西可编 */
async function checkA2b(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  expect(editorTree(w).table, 'the field table must show up once a node is picked').toBe(true)
  const rows = tableOf(w, PICK_A)
  // ⚠️ 前提：**有行**。空表时下面那句逐项比较会空着成立（"空 == 空"）
  expect(rows.length, 'the table is empty, so this check would say nothing').toBeGreaterThan(0)
  expect(
    rows.map((row) => row.key),
    'the table rows are not the declared fields',
  ).toEqual(declaredOrder(PICK_A))
  // 树上不该出现"点进去是一张空表"的格子（`地点` 那种 `list of "string"`）
  const empty = TREE_PATHS.filter((path) => fieldsOf(path).length === 0)
  expect(empty, 'a row with no table is not a row').toEqual([])
}

/** A2c · 换一格 ⇒ 表跟着换（三处不同的表：根枝 / 元素形状 / 有下钻的那一格） */
async function checkA2c(w: AnyWrapper): Promise<void> {
  // 反面控制：这三处不是同一张表（否则"换了一格"与"根本没换"分不出来）
  expect(new Set([PICK_A, PICK_B, PICK_C]).size, 'the three picks must be different nodes').toBe(3)
  expect(
    new Set([PICK_A, PICK_B, PICK_C].map((path) => fieldsOf(path).join('|'))).size,
    'the three picks must have three different tables',
  ).toBe(3)
  for (const path of [PICK_A, PICK_B, PICK_C]) {
    await pickRow(w, path)
    expect(
      tableOf(w, path).map((row) => row.key),
      'the table must be the fields of the picked node: ' + path,
    ).toEqual(declaredOrder(path))
  }
}

/** A2d · 裁决 6：每一行**读得出**它的 `initial` 在不在（形状不定死，界面怎么画是设计的事） */
async function checkA2d(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  const rows = tableOf(w, PICK_A)
  expect(rows.length, 'no row to read the initial of').toBeGreaterThan(0)
  expect(
    rows.filter((row) => row.initial !== 'yes' && row.initial !== 'no').map((row) => row.key),
    'every row must say whether it carries an initial ([data-field-initial])',
  ).toEqual([])
  // ⚠️ 两个值都得出**现过**：只写 `yes` 的实现也满足"读得出" —— 那是拿"属性不在"当 `no`（假绿的经典形状）。
  //    这一格（`lead`）天然有 `no`（`固有` 没有 initial）⇒ 真的在报状态的实现必然两个值都有。
  const says = (value: string): number => rows.filter((row) => row.initial === value).length
  expect(says('yes'), 'no row says it carries an initial: that is not "reading the state"').toBeGreaterThan(0)
  expect(says('no'), 'no row says it carries no initial: a fixed "yes" would pass too').toBeGreaterThan(0)
}

/** A3a · 行的顺序与卡里的声明顺序逐项相等（卡的声明顺序是唯一的顺序） */
async function checkA3a(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  expect(declaredOrder(PICK_A).length, 'this node has no field to order').toBeGreaterThan(1)
  expect(
    tableOf(w, PICK_A).map((row) => row.key),
    'the row order must be the declaration order in the card',
  ).toEqual([...declaredOrder(PICK_A)])
}

/** A3b · 每一行显示的名字就是卡里的键（不翻译、不美化、不加后缀） */
async function checkA3b(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  const rows = tableOf(w, PICK_A)
  // ⚠️ 前提：**有行**。空表时下面那句"没有一行名不对"会空着成立
  expect(rows.length, 'the table is empty, so this check would say nothing').toBeGreaterThan(0)
  expect(
    rows.filter((row) => row.label !== row.key).map((row) => row.key + ' -> ' + row.label),
    'a row must show the card key it stands for',
  ).toEqual([])
}

/**
 * A4a · 只读标记的含义**收窄**成"这一行**整行**不可写"，而它今天只有一个来源：引擎接管（W9）。
 *
 * ⚠️ 上一票断的是"每一行都带 `data-field-readonly`"—— 本票把"写"接回来之后那句话就不成立了。
 *    新断言比旧的**严**：不只是"带"，而是**双向相等**（带它的行 ⇔ 引擎接管那一族），
 *    并且接管行要**整行**没控件（说明格是只读文字、行尾连垃圾桶都不画）。
 */
async function checkA4a(w: AnyWrapper): Promise<void> {
  // ① 一张混着两种行的表：只读与接管必须**逐行相等**（两个方向都在这一句里）
  await pickRow(w, PICK_MIX)
  const mixed = editorTree(w).rows
  expect(mixed.filter((row) => row.taken).length, 'no engine-owned row to compare against').toBeGreaterThan(0)
  expect(
    mixed.filter((row) => !row.taken).length,
    'every row here is engine-owned: then the two marks say nothing',
  ).toBeGreaterThan(0)
  expect(
    mixed.filter((row) => row.readonly !== row.taken).map((row) => row.key),
    'a row must carry [data-field-readonly] exactly when it is engine-owned',
  ).toEqual([])
  // ② 另一格一行都不带：[data-field-readonly] 不再是"每一行都带"
  await pickRow(w, PICK_A)
  expect(
    editorTree(w)
      .rows.filter((row) => row.readonly)
      .map((row) => row.key),
    'no row of an author-owned node may be marked read-only any more',
  ).toEqual([])
  // ③ 接管行**整行**不可写：没有输入控件、行尾不画垃圾桶、说明那一格是只读文字
  await pickRow(w, PICK_MIX)
  for (const row of mixed.filter((one) => one.taken)) {
    const cell = rowFor(w, PICK_MIX, row.key)
    expect(cell.find('input, select, textarea').exists(), 'an engine-owned row may hold no control').toBe(
      false,
    )
    expect(cell.find('[data-field-del]').exists(), 'an engine-owned row must not draw the trash').toBe(false)
    const locked = cell.find('[data-field-note-locked]')
    expect(locked.exists(), 'an engine-owned row must hand out the read-only note cell').toBe(true)
    // 「你可以填」的暗示一个都不许有：空标记说的是"这里还没有说明"，接管行不该这么说
    expect(
      locked.element.hasAttribute('data-field-note-empty'),
      'the read-only note cell must not pretend it is waiting for input',
    ).toBe(false)
  }
}

/**
 * A4b · 表里**允许出现的可编辑控件只有白名单那四个**，而且四个都要真的出现过（W8）。
 *
 * ⚠️ 上一票断的是"表里一个可编辑控件都没有"（本票把三个动作放开了，那句话不再成立）。
 *    换成正面的白名单之后，**四个都要真的出现**这句是整条的牙：少了它，
 *    "一个控件都没有"的实现照样全绿 —— 那正是旧 A4b 的形状。
 */
async function checkA4b(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  expect(editorTree(w).table, 'the table is not there, so "which control is in it" says nothing').toBe(true)
  const box = w.find('[data-card-editor]')
  // 表尾那颗「＋」要先按下去 —— 新行的三格是白名单里的一半
  const plus = w.find('[data-field-add]')
  expect(plus.exists(), 'the table hands out no add-a-field entry').toBe(true)
  await plus.trigger('click')
  const allowed = '[data-field-note], [data-field-key-new], [data-field-kind-new], [data-field-initial-new]'
  expect(
    box
      .findAll('[data-branch-form] input, [data-branch-form] select, [data-branch-form] textarea')
      .filter((el) => !el.element.matches(allowed))
      .map((el) => el.element.tagName),
    'this table may only hold the four editable controls of the contract',
  ).toEqual([])
  for (const one of [
    '[data-field-note]',
    '[data-field-key-new]',
    '[data-field-kind-new]',
    '[data-field-initial-new]',
  ]) {
    expect(
      box.findAll(one).length,
      'this control was never on screen, so the whitelist above says nothing: ' + one,
    ).toBeGreaterThan(0)
  }
  // 白名单之外的两样仍然不许回来（上一票的替换面，一个字节都不许退）
  expect(box.findAll('[data-card-form]').length, 'the node-oriented form must stay out of the editor').toBe(0)
  expect(
    box.findAll('[data-add="action"]').length,
    'the node-oriented plus must be gone while editing a branch',
  ).toBe(0)
}

/**
 * A4c · 票 71 补的那一条（⑦）：那四个控件不只要**存在**，还要**能用**。
 *
 * ⚠️ A4b 断的是"表里允许出现的可编辑控件只有那四个、而且四个都出现过"——
 *    一个**整表 `:disabled`（或 `readonly`）**的实现照样全绿：控件在、形状对、一条都点不动。
 *    那是"有形状、没行为"。这一条把行为补上：四个控件一个都不许禁用 / 只读，
 *    而且**真的用一次** —— 填进去的类型与初值要落到卡里（B3b / B3c 只用了默认值：
 *    `string` + 空初值，A4c 走的是另外两格）。
 */
async function checkA4c(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  const row = declaredOrder(PICK_A).find((key) => declaredNote(PICK_A, key) !== undefined) as string
  /** 一格控件必须既没禁用、也没只读 —— 少了这一半，"整表点不动"照样全绿 */
  const guard = (el: RowWrapper, what: string): void => {
    expect(el.attributes('disabled'), what + ' is disabled: the table is not really writable').toBeUndefined()
    expect(
      el.attributes('readonly'),
      what + ' is read-only: the table is not really writable',
    ).toBeUndefined()
  }
  guard(noteBox(w, PICK_A, row), 'the note cell of an existing row')
  await openNewRow(w, NEW_KEY)
  for (const one of ['[data-field-key-new]', '[data-field-kind-new]', '[data-field-initial-new]']) {
    const el = w.find('[data-row-new] ' + one)
    expect(el.exists(), 'the new row is missing a cell: ' + one).toBe(true)
    guard(el, one)
  }
  // 用一次：类型选数字、初值填 7 ⇒ 保存之后卡里那一格就是**填进去的**那个（不是默认那个）
  await w.find('[data-row-new] [data-field-kind-new]').setValue('integer')
  await w.find('[data-row-new] [data-field-initial-new]').setValue('7')
  await save(w)
  expect(
    tableIn(storedRaw(), PICK_A)[NEW_KEY],
    'what was typed into the new row must reach the card',
  ).toEqual({ type: 'integer', initial: 7 })
}

/**
 * A5a · 引擎接管的那棵子树：**树上那一行** + 表里那几行都带接管标记，**别处一行都不带**。
 *
 * ⚠️ 树上那一半是 S3（票 69 的独立评审）点出来的洞：`NavRow.taken` 原来**读了从不断言**
 *    ⇒ 把 `roles` / `lead.pack` / `world.map`（都在 `ENGINE_RESERVED_PATHS` 里）**整枝标成"引擎接管"**
 *    也会全绿。接管是**一条路径**（今天只有 `world.time`），不是"看着像引擎的就都算"。
 */
async function checkA5a(w: AnyWrapper): Promise<void> {
  const tree = editorTree(w).nav
  expect(tree.length, 'the tree is gone, so this check would say nothing').toBeGreaterThan(0)
  // ① 该带的带：`world.time` 那一行
  for (const root of ENGINE_ROOTS) {
    const row = tree.find((entry) => entry.path === root)
    expect(row !== undefined, 'the engine-owned subtree has no row of its own: ' + root).toBe(true)
    expect(w.find('[data-branch-node="' + root + '"]').attributes('data-branch-takeover')).toBeDefined()
  }
  // ② 不该带的一行都不许带 —— 卡自己点名的那几段（`roles` / `lead.pack` / `world.map` …）是**作者的东西**
  const treeTaken = tree.filter((row) => row.taken).map((row) => row.path)
  expect(
    treeTaken.filter((path) => !underEngine(path)),
    'only the engine-owned path may carry the takeover mark on a tree row',
  ).toEqual([])
  // ③ 表里那几行（选到那一格自己才看得见）—— **底下每一行都要带**，不是"有那么几行带"。
  //    S3 复核指出的洞：原来只断 `taken.length > 0` ⇒ **只标 `year`、其余四个整数不标也全绿**。
  await pickRow(w, ENGINE_ROOTS[0])
  const rows = editorTree(w).rows
  const taken = rows.filter((row) => row.taken).map((row) => row.parent + '.' + row.key)
  expect(rows.length, 'no row under the engine-owned node at all').toBeGreaterThan(0)
  expect(taken.length, 'every row of the engine-owned node must carry the mark').toBe(rows.length)
  expect(
    taken.filter((path) => !underEngine(path)),
    'only the engine-owned subtree may carry [data-field-takeover]',
  ).toEqual([])
}

/**
 * A5b · 两个标记**不是同一个** —— 但本票之后它们的关系反过来了。
 *
 * 上一票断的是"引擎接管的行之外**仍然只读**"（那时整张表都只读）；本票把"暂未开放"整条消掉
 * ⇒ 「只读」在编辑器里只剩一种意思，所以这里断的是**反面**：**非接管行不许再带只读标记**。
 * ⚠️ 与 A4a 分开留着：A4a 断"标记与接管逐行相等"，这一条断"两个标记真的在说两件事"
 *    （一张表上同时存在带与不带的行，否则两个标记合成了一个）。
 */
async function checkA5b(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_MIX)
  const rows = editorTree(w).rows
  const engine = rows.filter((row) => row.taken)
  const open = rows.filter((row) => !row.taken)
  expect(engine.length, 'nothing is marked as engine-owned in the table').toBeGreaterThan(0)
  expect(open.length, 'every row is marked as engine-owned: then the two marks say nothing').toBeGreaterThan(
    0,
  )
  expect(
    open.filter((row) => row.readonly).map((row) => row.key),
    'a row that is not engine-owned is writable in this ticket: it may not carry the read-only mark',
  ).toEqual([])
}

/** A6a · 中栏字幕 = 当前编的那一格，与左栏亮着的那一行是同一个路径 */
async function checkA6a(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  expect(editorTree(w).on, 'exactly the picked row may stay lit').toEqual([PICK_A])
  expect(textOf(w, '[data-branch-title]'), 'the mid subtitle must name the node being edited').toContain(
    PICK_A,
  )
}

/** A6b · 换选中 ⇒ 字幕与左栏同时变（两处不许各说各的），树本身不动 */
async function checkA6b(w: AnyWrapper): Promise<void> {
  const before = editorTree(w)
  const beforeTitle = textOf(w, '[data-branch-title]')
  await pickRow(w, PICK_C)
  const after = editorTree(w)
  expect(after.on, 'the highlight moved with the pick').toEqual([PICK_C])
  expect(after.nav, 'picking a row must not change the tree itself').toEqual(before.nav)
  const title = textOf(w, '[data-branch-title]')
  expect(title, 'the subtitle did not follow the pick').not.toBe(beforeTitle)
  expect(title, 'the subtitle and the tree disagree about what is being edited').toContain(PICK_C)
}

// ---------- B1–B4：可写态的判据（10 条）----------

/**
 * B1a · G1 读法甲：**每一行**都交出一个说明格，值就是卡里那一条 `note`（裁决 3）。
 *
 * ⚠️ "带 `note` 的行才可编"是**当前卡的状态**，不是界面的规则 —— 所以这里断的是"每一行都有框"，
 *    而"框里是不是空的"由卡决定：卡里没那个键 ⇒ 空框 **且** 带 `data-field-note-empty`。
 * ⚠️ 两个态都要**真的出现过**（一律空框 / 一律有值都过不了）。
 */
async function checkB1a(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  const rows = tableOf(w, PICK_A)
  expect(rows.length, 'no row to read the note of').toBeGreaterThan(0)
  let filled = 0
  for (const row of rows) {
    const cell = rowFor(w, PICK_A, row.key).find('[data-field-note]')
    expect(cell.exists(), 'every row must hand out a note cell: ' + row.key).toBe(true)
    const want = declaredNote(PICK_A, row.key)
    expect(
      (cell.element as HTMLInputElement).value,
      'the note cell must show the note the card declares: ' + row.key,
    ).toBe(want ?? '')
    expect(
      cell.element.hasAttribute('data-field-note-empty'),
      'the empty marker must follow the card, not the widget: ' + row.key,
    ).toBe(want === undefined)
    if (want !== undefined) filled += 1
  }
  expect(filled, 'no row of this node declares a note: the empty state is the only one seen').toBeGreaterThan(
    0,
  )
  expect(
    filled,
    'every row of this node declares a note: the filled state is the only one seen',
  ).toBeLessThan(rows.length)
}

/**
 * B2a · W1：改一格说明 → 保存 ⇒ 落盘的卡就是**"只改了那一处"**的那张卡。
 *
 * ⚠️ 比"那一行的 note 变了"强：整份卡逐字（结构上）相等 ⇒ 一次保存**没有顺手改别处**。
 *    落盘那份从存储里读**原始 JSON**（不过 `parseCard`）—— 断言要看得见"键在不在"。
 */
async function checkB2a(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  const row = declaredOrder(PICK_A).find((key) => declaredNote(PICK_A, key) !== undefined) as string
  expect(row, 'this node has no row with a note to edit').not.toBe(undefined)
  await noteBox(w, PICK_A, row).setValue(NEW_NOTE)
  await save(w)
  const want = JSON.parse(JSON.stringify(card)) as CardJson
  tableIn(want, PICK_A)[row].note = NEW_NOTE
  expect(storedRaw(), 'the saved card must be the card with exactly that one note changed').toEqual(want)
  expect(w.emitted('saved'), 'a save must tell the shell it happened').toHaveLength(1)
}

/**
 * B2b · W2：清空说明 = **删掉 `note` 这个键**，不是写空串（只输空格也算清空）。
 *
 * ⚠️ 这一条自带反面证据：空串**连校验器都过不了**（`checkSchema` 的 `requireText`）⇒
 *    "删键"不是风格选择，是唯一走得通的路。少了这句，把 `note` 写成 `""` 的实现也会绿。
 */
async function checkB2b(w: AnyWrapper): Promise<void> {
  expect(
    () => checkSchema({ type: 'string', note: '' }, 'demo'),
    'an empty note must be rejected by the card format itself',
  ).toThrow()
  await pickRow(w, PICK_A)
  const row = declaredOrder(PICK_A).find((key) => declaredNote(PICK_A, key) !== undefined) as string
  expect(row, 'this node has no row with a note to clear').not.toBe(undefined)
  const want = JSON.parse(JSON.stringify(card)) as CardJson
  delete tableIn(want, PICK_A)[row].note
  for (const typed of ['', '   ']) {
    await noteBox(w, PICK_A, row).setValue(typed)
    await save(w)
    expect(
      Object.hasOwn(tableIn(storedRaw(), PICK_A)[row], 'note'),
      'clearing must drop the key, not write an empty string: ' + JSON.stringify(typed),
    ).toBe(false)
    expect(storedRaw(), 'nothing but that key may change: ' + JSON.stringify(typed)).toEqual(want)
  }
}

/**
 * B3a · 「＋ 加一个字段」：表尾**多一行**新行，四格控件齐、类型默认「文字」、键名格拿到焦点。
 *
 * ⚠️ 新行落在**表尾**：保存按行序写回 ⇒ 新键必然是那一格 `fields` 的最后一个（B3b/B3c 验落盘）。
 * ⚠️ 刚开出来的行**还没落过盘** ⇒ 它的垃圾桶是"取消"，不进"待删"。
 */
async function checkB3a(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  const before = tableOf(w, PICK_A).length
  const plus = w.find('[data-field-add]')
  expect(plus.exists(), 'the table hands out no add-a-field entry').toBe(true)
  expect(plus.element.tagName, 'the add entry must be a real button').toBe('BUTTON')
  await plus.trigger('click')
  expect(w.findAll('[data-row-new]').length, 'pressing the plus must open exactly one new row').toBe(1)
  const fresh = (): RowWrapper => w.find('[data-row-new]')
  expect(fresh().attributes('data-field-parent'), 'the new row must belong to the node being edited').toBe(
    PICK_A,
  )
  for (const one of ['[data-field-key-new]', '[data-field-kind-new]', '[data-field-initial-new]']) {
    expect(fresh().find(one).exists(), 'the new row is missing a cell: ' + one).toBe(true)
  }
  expect(
    (fresh().find('[data-field-kind-new]').element as HTMLSelectElement).value,
    'a new field starts as text',
  ).toBe('string')
  expect(document.activeElement, 'the key cell of the new row must take the focus').toBe(
    fresh().find('[data-field-key-new]').element,
  )
  expect(tableOf(w, PICK_A).length, 'the new row must join the table').toBe(before + 1)
  expect(
    w.findAll('[data-field-row]').at(-1)?.attributes('data-row-new'),
    'the new row must be the last one of the table',
  ).toBeDefined()
  // 取消：刚开出来的那一行点一下就没了，而且**不进**待删
  await cancelNewRow(w)
  expect(w.findAll('[data-row-new]').length, 'a row that never hit the card is dropped right away').toBe(0)
  expect(w.findAll('[data-row-pending-del]').length, 'a row that never hit the card cannot be pending').toBe(
    0,
  )
}

/**
 * B3b · W4：加一行 → 保存 ⇒ 那一格**多一个键、而且在最后**（`object` 自己的 `fields`）。
 *
 * ⚠️ 新行没填初值 ⇒ 卡里**不写 `initial` 这个键**（"开局没有这一栏"是卡里有意义的一个状态）。
 */
async function checkB3b(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  const keys = declaredOrder(PICK_A)
  await openNewRow(w, NEW_KEY)
  await save(w)
  const table = tableIn(storedRaw(), PICK_A)
  expect(Object.keys(table), 'the new key must be the last one of that table').toEqual([...keys, NEW_KEY])
  expect(table[NEW_KEY], 'a new field with an empty initial carries no initial key').toEqual({
    type: 'string',
  })
}

/**
 * B3c · W4 的另一半：选中**元素形状**那一格（`map` / `list` 的 `of.fields`）时，新键也必须落在那里。
 *
 * ⚠️ 两处各写一遍不是啰嗦：写错地方（往 `map` 上塞 `fields`）是**卡当场被拒**，
 *    而"表里显示 `of.fields`、写回 `fields`"这种错会静默成立 —— 只有两处都断才拦得住。
 */
async function checkB3c(w: AnyWrapper): Promise<void> {
  expect(PICK_ELEMENT, 'the card has no element-shaped table at all').not.toBe(undefined)
  expect(PICK_ELEMENT, 'this pick must not be the same node as PICK_A').not.toBe(PICK_A)
  await pickRow(w, PICK_ELEMENT)
  const keys = declaredOrder(PICK_ELEMENT)
  await openNewRow(w, NEW_KEY)
  await save(w)
  const table = tableIn(storedRaw(), PICK_ELEMENT)
  expect(Object.keys(table), 'the new key must land in the element table, last').toEqual([...keys, NEW_KEY])
  expect(table[NEW_KEY], 'a new field with an empty initial carries no initial key').toEqual({
    type: 'string',
  })
}

/**
 * B3d · W7：界面必须挡**四件事**，校验器一件都不管 —— 挡不住就是一次**静默丢编辑**。
 *
 * 四种非法键名：空 / 只空格 / 含 `.`（路径语义会崩掉，那一行永远选不中）/ 与同格已有的键重名
 * （JSON 里同名键只能存在一个，后写的吃掉先写的 ⇒ 卡里根本抓不到）。
 * ⚠️ 每一轮都先种一份已知文本：`toBeNull()` 只证"存储里没有卡"，证不了"一个字节不动"。
 */
async function checkB3d(w: AnyWrapper): Promise<void> {
  const taken = declaredOrder(PICK_A)[0]
  const illegal: Array<[string, string]> = [
    ['', 'an empty key name'],
    ['   ', 'a key name of spaces only'],
    ['a.b', 'a dotted key name (the path syntax would never reach that row)'],
    [taken, 'a key name this node already has'],
  ]
  const seeded = JSON.stringify(card, null, 2)
  const before = JSON.stringify(card)
  await pickRow(w, PICK_A)
  for (const [name, why] of illegal) {
    localStorage.setItem(CARD_KEY, seeded)
    await openNewRow(w, name)
    await save(w)
    expect(localStorage.getItem(CARD_KEY), 'a refused save must not touch storage: ' + why).toBe(seeded)
    expect(w.emitted('saved'), 'nothing was saved, so nothing may be announced: ' + why).toBeUndefined()
    const shown = w.find('[data-card-error]')
    expect(shown.exists(), 'the reason must be visible: ' + why).toBe(true)
    expect(shown.text().trim().length, 'the reason must say something: ' + why).toBeGreaterThan(0)
    await cancelNewRow(w)
  }
  expect(JSON.stringify(card), 'a refused save must not touch the card').toBe(before)
}

/**
 * B4a · W10 的前两态：顶栏那颗「保存」**干净时按不动**、改了草稿就能用。
 *
 * ⚠️ 反面控制是最后那一句：**改回原值 = 又是干净的**。少了它，"永远可用"也满足前面两句。
 */
async function checkB4a(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  const button = (): RowWrapper => w.find('[data-top] [data-card-save]')
  expect(button().exists(), 'the top bar must carry the save button (W10)').toBe(true)
  expect(
    button().attributes('disabled'),
    'nothing was changed yet, so saving must be out of reach',
  ).toBeDefined()
  const row = declaredOrder(PICK_A).find((key) => declaredNote(PICK_A, key) !== undefined) as string
  await noteBox(w, PICK_A, row).setValue(NEW_NOTE)
  expect(button().attributes('disabled'), 'a pending change must make the save usable').toBeUndefined()
  await noteBox(w, PICK_A, row).setValue(declaredNote(PICK_A, row) as string)
  expect(
    button().attributes('disabled'),
    'typing the card value back is not a change: the save must go back to being out of reach',
  ).toBeDefined()
}

/**
 * B4b · W3 / W10 第三态：**卡自己拒**的那条路 —— 原因看得见、指得到哪一行、卡一个字节不动。
 *
 * ⚠️ 这是 W3 唯一"真的走到 `importCard` 被拒"的造法：数字初值填个非整数（界面**故意不拦**——
 *    设计 §三.3：让它走到卡那儿被拒）。前三种非法键名（B3d）界面自己就挡了，证不了这件事。
 */
async function checkB4b(w: AnyWrapper): Promise<void> {
  const seeded = JSON.stringify(card, null, 2)
  localStorage.setItem(CARD_KEY, seeded)
  const before = JSON.stringify(card)
  await pickRow(w, PICK_A)
  await openNewRow(w, NEW_KEY)
  await w.find('[data-row-new] [data-field-kind-new]').setValue('integer')
  await w.find('[data-row-new] [data-field-initial-new]').setValue('abc')
  await save(w)
  expect(localStorage.getItem(CARD_KEY), 'a rejected save must not touch storage').toBe(seeded)
  expect(JSON.stringify(card), 'a rejected save must not touch the card in memory').toBe(before)
  expect(w.emitted('saved'), 'nothing was saved, so nothing may be announced').toBeUndefined()
  const shown = w.find('[data-card-error]')
  expect(shown.exists(), 'the card refused the change and nobody said why').toBe(true)
  expect(shown.text(), 'the reason must be the one the card gave (it names the cell)').toContain('initial')
  const bad = w.findAll('[data-row-bad]')
  expect(bad.length, 'the refused row must be pointed at').toBe(1)
  expect(bad[0].attributes('data-row-new'), 'the row pointed at must be the new one').toBeDefined()
}

/**
 * B4c · W5：垃圾桶在**每一行**上（包括删了卡当场坏的那一行 —— 老板 2026-09-22 拍：界面不做硬锁）·
 * 点一下只是"待删"（还没落盘）· 同一颗再点一下是撤销 · **保存**才真删。
 *
 * ⚠️ 前提从卡里现算：这一格**既要有**"删了卡也过"的行、**也要有**"删了卡当场坏"的行 ——
 *    一律可删（或一律锁死）的表分不出"没锁"与"锁了没生效"。
 */
async function checkB4c(w: AnyWrapper): Promise<void> {
  expect(PICK_DEL, 'no node of this card holds both a safe and an unsafe field to delete').not.toBe(undefined)
  const free = deletableRows(PICK_DEL)
  const doomed = free[0]
  await pickRow(w, PICK_DEL)
  const rows = tableOf(w, PICK_DEL)
  expect(rows.length, 'the table is not there, so "which row is locked" says nothing').toBeGreaterThan(0)
  expect(free.length, 'no row here can be deleted at all: the premise of this check is gone').toBeGreaterThan(
    0,
  )
  expect(
    free.length,
    'every row here survives its own deletion: then "no hard lock" cannot be told apart from "locked"',
  ).toBeLessThan(rows.length)
  const boxes = w.findAll('[data-field-del]')
  expect(boxes.length, 'every row must hand out the trash: this ticket locks no row').toBe(rows.length)
  for (const box of boxes) {
    expect(
      box.attributes('disabled'),
      'a locked trash contradicts the ruling: no hard lock in the UI',
    ).toBeUndefined()
  }
  const seeded = JSON.stringify(card, null, 2)
  localStorage.setItem(CARD_KEY, seeded)
  const pending = (): string | undefined => rowFor(w, PICK_DEL, doomed).attributes('data-row-pending-del')
  const trash = (): RowWrapper => rowFor(w, PICK_DEL, doomed).find('[data-field-del]')
  await trash().trigger('click')
  expect(pending(), 'one click means "will be deleted", not "deleted"').toBeDefined()
  expect(localStorage.getItem(CARD_KEY), 'nothing may hit the card before the save').toBe(seeded)
  await trash().trigger('click')
  expect(pending(), 'the same button must take the pending mark back').toBeUndefined()
  await trash().trigger('click')
  await save(w)
  expect(
    Object.keys(tableIn(storedRaw(), PICK_DEL)),
    'the saved card must be missing exactly that one field',
  ).toEqual(declaredOrder(PICK_DEL).filter((key) => key !== doomed))
  expect(w.emitted('saved'), 'the delete only lands with the save').toHaveLength(1)
}

/** 一条判据：编号 + 一句话（用例名）+ 断言（吃一棵挂好的树） */
export interface Check {
  id: string
  what: string
  run: (w: AnyWrapper) => Promise<void> | void
}
/** 这一件的判据表 —— 真编辑器那一遍与替身那一遍跑的都是它 */
export const CHECKS: Check[] = [
  { id: 'A1a', what: 'the tree lists exactly the editable nodes of the card', run: checkA1a },
  { id: 'A1b', what: 'a scalar field name never becomes a tree row', run: checkA1b },
  { id: 'A1c', what: 'each tree row carries the schema type it stands for', run: checkA1c },
  { id: 'A1d', what: 'every name in the tree is an editable node of the card', run: checkA1d },
  { id: 'A1e', what: 'each tree row says how deep it sits', run: checkA1e },
  { id: 'A2a', what: 'nothing picked means an empty state, not an empty table', run: checkA2a },
  { id: 'A2b', what: 'the table holds the fields declared for the picked node', run: checkA2b },
  { id: 'A2c', what: 'picking another node swaps the table for its own fields', run: checkA2c },
  { id: 'A2d', what: 'every row says whether it carries an initial', run: checkA2d },
  { id: 'A3a', what: 'the rows keep the declaration order of the card', run: checkA3a },
  { id: 'A3b', what: 'a row shows the card key it stands for', run: checkA3b },
  { id: 'A4a', what: 'read-only means engine-owned, and only that', run: checkA4a },
  {
    id: 'A4b',
    what: 'the table holds the four editable controls of the contract, and only those',
    run: checkA4b,
  },
  { id: 'A4c', what: 'the four editable controls really take input and reach the card', run: checkA4c },
  { id: 'A5a', what: 'the engine-owned subtree is marked, and nothing else is', run: checkA5a },
  { id: 'A5b', what: 'engine-owned and author-owned are two different marks', run: checkA5b },
  { id: 'A6a', what: 'the mid subtitle names the node the tree has lit', run: checkA6a },
  { id: 'A6b', what: 'the subtitle and the tree move together', run: checkA6b },
  { id: 'B1a', what: 'every row hands out a note cell holding the note of the card', run: checkB1a },
  { id: 'B2a', what: 'editing a note and saving writes exactly that one change', run: checkB2a },
  { id: 'B2b', what: 'clearing a note drops the key instead of writing an empty string', run: checkB2b },
  { id: 'B3a', what: 'the plus opens one new row at the end of the table', run: checkB3a },
  { id: 'B3b', what: 'a new field lands last in the fields of the node', run: checkB3b },
  { id: 'B3c', what: 'a new field lands last in the element table too', run: checkB3c },
  { id: 'B3d', what: 'the UI refuses the four key names the card format cannot catch', run: checkB3d },
  { id: 'B4a', what: 'the save is out of reach until something really changed', run: checkB4a },
  { id: 'B4b', what: 'a card that refuses the change says why and touches nothing', run: checkB4b },
  { id: 'B4c', what: 'the trash marks a row first and only the save deletes it', run: checkB4c },
]
