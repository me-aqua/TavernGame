/**
 * 票 69 · 段 8b-① 判据的**共享夹具与判据表**：左栏枝树 + 中栏只读字段表。
 *
 * 契约 `.team/test/2026-09-22/contract-69.md`。两件测试文件共用这一份（★项目规矩：同一个夹具在
 * 第二个文件里再写一遍时才提取）：`branch-tree-dom.test.ts` 把 `CHECKS` 挂在**真编辑器**上跑，
 * `branch-tree-selfcheck.test.ts` 把**同一批**挂在一份照契约长的替身上、按故障矩阵数"红了几条"。
 *
 * ⚠️ **期望值全部从卡里现算**，一个中文键名都不手写：`.githooks/checks/ascii.mjs` 连 `tests/`
 *    里的字符串字面量一起拦（中文只许住在注释与 locale 里）。
 * ⚠️ 走法照 `tests/card-keys-cn.test.ts:257-283` 的 `schemaPathsOf`：`object` 往 `fields` 下钻，
 *    `map` / `list` 往 `of.fields` 下钻（元素形状那一段写成 `x.*`，与那件判据同一套写法）。
 */
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import CardEditor from '../../src/components/CardEditor.vue'
import { i18n } from '../../src/i18n'
import { parseCard } from '../../src/game/card'
import { schemaElement, schemaFields, type Schema } from '../../src/game/card-state'
import { EXAMPLE_CARD } from './card-fixtures'

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

// ---------- A1–A6：判据（16 条）----------

/** A1a · 左栏树的行集合 = 卡里"能编"的容器节点，顺序也是卡的声明顺序 */
function checkA1a(w: AnyWrapper): void {
  expect(
    editorTree(w).nav.map((row) => row.path),
    'the left tree must list exactly the card nodes',
  ).toEqual(TREE_PATHS)
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

/** A4a · 每一行都标着只读（`data-field-readonly`）—— 只读是标记，不是"碰巧没控件" */
async function checkA4a(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  const rows = tableOf(w, PICK_A)
  expect(rows.length, 'no row to check for the read-only mark').toBeGreaterThan(0)
  expect(
    rows.filter((row) => !row.readonly).map((row) => row.key),
    'every row must carry [data-field-readonly]',
  ).toEqual([])
}

/** A4b · 编辑器里没有任何可编辑控件（没有 `note` 框 / 垃圾桶 / 加字段，也不再有旧表单） */
async function checkA4b(w: AnyWrapper): Promise<void> {
  await pickRow(w, PICK_A)
  expect(editorTree(w).table, 'the table is not there, so "no control in it" says nothing').toBe(true)
  const box = w.find('[data-card-editor]')
  expect(
    box.findAll(
      '[data-branch-form] input, [data-branch-form] textarea, [data-branch-form] select,' +
        ' [data-field-note], [data-field-del], [data-field-add], [data-card-form]',
    ).length,
    'this ticket opens no editable control at all',
  ).toBe(0)
  expect(
    box.findAll('[data-add="action"]').length,
    'the node-oriented plus must be gone while editing a branch',
  ).toBe(0)
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

/** A5b · 两个标记不是同一个：「暂未开放」那些格只带只读标记、不带接管标记 */
async function checkA5b(w: AnyWrapper): Promise<void> {
  await pickRow(w, 'world')
  const rows = editorTree(w).rows
  const engine = rows.filter((row) => row.taken)
  const open = rows.filter((row) => !row.taken)
  expect(engine.length, 'nothing is marked as engine-owned in the table').toBeGreaterThan(0)
  expect(open.length, 'every row is marked as engine-owned: then the two marks say nothing').toBeGreaterThan(
    0,
  )
  expect(
    open.filter((row) => !row.readonly).map((row) => row.key),
    'a row that is not engine-owned is still read-only in this ticket',
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
  { id: 'A2a', what: 'nothing picked means an empty state, not an empty table', run: checkA2a },
  { id: 'A2b', what: 'the table holds the fields declared for the picked node', run: checkA2b },
  { id: 'A2c', what: 'picking another node swaps the table for its own fields', run: checkA2c },
  { id: 'A2d', what: 'every row says whether it carries an initial', run: checkA2d },
  { id: 'A3a', what: 'the rows keep the declaration order of the card', run: checkA3a },
  { id: 'A3b', what: 'a row shows the card key it stands for', run: checkA3b },
  { id: 'A4a', what: 'every row is marked read-only', run: checkA4a },
  { id: 'A4b', what: 'the editor opens no editable control at all', run: checkA4b },
  { id: 'A5a', what: 'the engine-owned subtree is marked, and nothing else is', run: checkA5a },
  { id: 'A5b', what: 'engine-owned and not-yet-open are two different marks', run: checkA5b },
  { id: 'A6a', what: 'the mid subtitle names the node the tree has lit', run: checkA6a },
  { id: 'A6b', what: 'the subtitle and the tree move together', run: checkA6b },
]
