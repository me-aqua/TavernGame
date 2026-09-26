/**
 * 「另一格」那一族 —— 左栏那棵树 · 中栏那张可写字段表 · 唯一那条写路径 · 票 78 那条脏守卫。
 *
 * 这一层是票 80 从 `CardEditor.vue` **原样搬出来**的（行为一个字节没动）。搬的理由是那个文件
 * 顶着钩子的逐文件上限（`.githooks/pre-commit` 的 550 行），而这一族是它里面最大的一块 ——
 * 拆出来之后主体留得下余量，这一族也就有了自己的判据（`tests/use-branch-draft.test.ts`），
 * 照的是下面这几条**各自有输入输出**的真逻辑：
 *   · 左栏进什么 / 什么算"引擎接管"（`navRows`）；
 *   · 中栏那张表的键序、`hasInitial`、说明的取值优先（`fieldRows`）；
 *   · `dirty` 是**三个来源的并集**（新行 / 待删·说明 / 一步那一族）；
 *   · 草稿按「哪一格 + 哪个键」索引（两格有同名键时不许撞车）。
 *
 * ⚠️ **形状：纯函数提到模块顶层、带状态的封成工厂**。`schemaOf` / `fieldsOf` / `writeNote` 这一族
 *    本来就只吃参数、不闭包，留在函数体里只会让外层那个函数被**大括号深度**量成一整块；
 *    `makeGuard` / `makeSave` 各自把"要读写的那几个 ref"当参数收进来、返回它那几个函数。
 *    ⇒ 导出的 composable 只建 ref、调工厂、拼返回对象（钩子对**每一个**函数都有 170 行上限）。
 * ⚠️ **只画不算那一半不在这里**：`StateTreeNav` / `BranchForm` 只管铺屏与抛事件，值与草稿都由这里现算。
 * ⚠️ **这里没有生命周期钩子、也不 `useI18n`**：翻译走 `src/i18n.ts` 的模块级 `t`（那一句注释的原话
 *    就是"在组件外翻译"），关窗守卫摘成 `dispose()` 由编辑器在 `onBeforeUnmount` 里调 ——
 *    判据因此在**组件外面**直接调它；加 `onMounted` / `useI18n` 会让那几条当场红（签名变了）。
 * ⚠️ **写路径只有一条**：`save()` 深拷整份卡、只改这几处、再走 `importCard`（先校验后落盘）；
 *    一步那一族的草稿由 `input.steps.applyTo(next)` 写进**同一份**深拷卡。
 * ⚠️ **两个 composable 互相看不见**：本件不 import `./useStepDraft`（连类型都不 import），
 *    认识两边的只有 `CardEditor.vue` 那一处接线。
 * ⚠️ **读与写共用同一个 `fieldsOf`**：`object` 读自己的 `fields`，`map` / `list` 读**元素形状**的
 *    `of.fields`；分成两份就会出「表里显示 `of.fields`、写回 `fields`」这种**静默成立**的错。
 * ⚠️ **界面自己挡三件事，校验器一件都不管**（实测 `""` / `" "` / `"a.b"` 全都过 `checkSchema`）：
 *    键名 trim 后非空 · 不含 `.` · 不与同格已有的键重名（同名键在 JSON 里只能活一个 ⇒ 静默丢编辑）。
 * ⚠️ **草稿**按「哪一格 + 哪个键」索引：换一处再切回来还在；**干净 ⇔ 草稿与卡里的值逐字相同**
 *    （顶栏那颗按钮的 `disabled` 就是它）。
 * ⚠️ 🔴 **解构之后别再把这些名字包回一个对象**：从 composable 解构出来的名字，编译器把
 *    `setup-ref` / `setup-const` 降级成 `setup-maybe-ref`；一旦包回对象、模板里写 `family.navRows`，
 *    拿到的是 **ref 本身**（`v-if` 恒真、`v-bind` 展开成空）。⇒ 编辑器在 setup 顶层解构。
 * ⚠️ **`navRows` / `fieldRows` 现读 `input.card()`**（不是一步那一族存过的那份）：存下去之后、
 *    外层 reload 之前，中栏那张表仍显示卡里声明的值。
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { t } from '../i18n'
import { CLOCK_STATE_PATH } from '../game/card-time'
import { isRecord } from '../game/card-read'
import { schemaElement, schemaFields, schemaType, type Schema, type SchemaNode } from '../game/card-state'
import { importCard } from '../game/current-card'
import type { CardData } from '../game/card'

/** 新行四格的草稿（那一行还没落过盘，只活在内存里） */
export type FreshRow = { key: string; kind: 'string' | 'integer'; note: string; initial: string }

/** 一行字段表（`BranchForm` 照着画） */
export interface FieldRow {
  key: string
  kind: string
  hasInitial: boolean
  taken: boolean
  note: string
}

/** 左栏树上的一行 */
export interface NavRow {
  path: string
  kind: string
  taken: boolean
}

/**
 * 别的草稿族对本件露出来的三样（票 80 的接缝；票 8d-① 起「显示块」那一族按**同一个形状**接进来）。
 *
 * ⚠️ **只吃这三样、不吃对方的整个 API**：本件不 import 那两个模块的任何东西
 *    （连类型都不 import），反过来它们也不知道本件存在 —— **几个 composable 互相看不见**，
 *    唯一认识它们的只有 `CardEditor` 那一处接线（脏是并集，落卡时各自写进同一份深拷卡）。
 */
export interface StepPort {
  /** 那一边脏不脏（本件的 `dirty` 是三源并集，它是第三项） */
  dirty: ComputedRef<boolean>
  /** 把那边改过的几样写进这份深拷卡（`save()` 的第一步） */
  applyTo(next: CardData): void
  /** 记下刚存下去的那份卡（`save()` 成功之后、放行重载之前） */
  markSaved(next: CardData): void
}

export interface BranchDraftInput {
  /** 现取当前卡（getter：`props.card` 换了要跟着变） */
  card: () => CardData
  /** 当前编辑的那一格（点号路径；空串 = 那一轴没亮）。**只读** —— 写它的是编辑器里的 `target` */
  picked: () => string
  /** 一步那一族的三样 */
  steps: StepPort
  /** 该让外层重载的那一刻（编辑器在这里 `emit('saved')`） */
  onSaved: () => void
}

export interface BranchDraftApi {
  navRows: ComputedRef<NavRow[]>
  fieldRows: ComputedRef<FieldRow[]>
  goneKeys: ComputedRef<string[]>
  badKeys: ComputedRef<string[]>
  failed: Ref<boolean>
  failure: Ref<string>
  fresh: Ref<FreshRow | null>
  /** 干净 ⇔ 一处改动都没有（**三源并集**：`fresh` / `touched` / `steps.dirty`） */
  dirty: ComputedRef<boolean>
  discardAsk: Ref<boolean>
  save(): void
  setNote(key: string, text: string): void
  toggleDel(key: string): void
  addRow(): void
  cancelRow(): void
  setFresh(cell: 'key' | 'kind' | 'note' | 'initial', text: string): void
  onResourceSaved(): void
  keepDraft(): void
  discardDraft(): void
  /** 摘掉关窗守卫（编辑器在 `onBeforeUnmount` 里调） */
  dispose(): void
}

/** 能进树的类型：只有容器（标量字段留在中栏那张表里） */
const CONTAINERS = ['object', 'map', 'list']

// ---------- 纯函数：只吃参数、不看闭包（提在顶层，导出的 composable 才留得下余量）----------

/**
 * 一段路径在卡里的 schema：`a.b` 走 `fields`，`a.*` 走元素形状（`of`）。
 *
 * 比 `card-state` 的 `schemaAt` 多认 `*` 那一段 —— 树里 `roles.*` 这种行代表的是**元素形状**，
 * 它自己不是一格，但它的字段是。
 */
function schemaOf(root: Record<string, Schema>, path: string): Schema | undefined {
  let current: Schema | undefined
  let scope: Record<string, Schema> | undefined = root
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

/**
 * 一格的字段表：`object` 读自己的 `fields`，`map` / `list` 读**元素形状**的 `of.fields`。
 *
 * ⚠️ **读与写共用这一个函数**：读它铺表、写它改卡 —— 拿两份走法就会出「表里显示 `of.fields`、
 *    写回 `fields`」这种错，而那种错**静默成立**（卡根本不看被写错的那一处）。
 */
function fieldsOf(root: Record<string, Schema>, path: string): Record<string, Schema> {
  const node = schemaOf(root, path)
  if (node === undefined) return {}
  const own = schemaFields(node)
  if (own !== undefined) return own
  const element = schemaElement(node)
  const inElement = element === undefined ? undefined : schemaFields(element)
  return inElement ?? {}
}

/** 这一行写没写 `initial` —— 「开局在不在」的唯一开关（缩写形式 `"string"` 没有可写的键） */
function declaresInitial(node: Schema): boolean {
  return isRecord(node) && Object.hasOwn(node, 'initial')
}

/** 卡里那一行声明的说明；没有那个键就是空串（界面上「空框 + 空标记」那一态） */
function declaredNote(root: Record<string, Schema>, parent: string, key: string): string {
  const field = fieldsOf(root, parent)[key]
  return isRecord(field) && typeof field.note === 'string' ? field.note : ''
}

/**
 * 这一格在不在**引擎点名的那棵子树**里（连底下每一格）。
 *
 * 今天只有时钟那一格，而它的名字由引擎自己定（`card-time.ts` 的 `CLOCK_STATE_PATH`）——
 * 卡里那五个整数也是引擎词表，所以它整棵只读。
 */
function underEngine(path: string): boolean {
  return path === CLOCK_STATE_PATH || path.startsWith(CLOCK_STATE_PATH + '.')
}

/** 一个草稿的 id：哪一格 + 哪个键（两格有同名键时不会撞车） */
function idOf(parent: string, key: string): string {
  return parent + '|' + key
}

/** 把 id 拆回「哪一格」与「哪个键」 */
function splitId(id: string): { parent: string; key: string } {
  const cut = id.indexOf('|')
  return { parent: id.slice(0, cut), key: id.slice(cut + 1) }
}

/**
 * 这一格是不是"缩写成裸字符串"的那两种（`"string"` / `"integer"`）。
 *
 * ⚠️ 形状判据走边界层的 `isRecord`，组件层不自己写 `typeof`：卡有两种形状是**格式层的知识**，
 *    而 pre-commit 的「边界之外的防御性校验」只放行读外部数据的那几层（`src/game/**` 等）。
 */
function isShorthandSchema(schema: Schema): schema is string {
  return !isRecord(schema)
}

/** 把一条说明落到那一格：改了写进去、**清空 = 删掉这个键**（空串过不了卡自己的校验） */
function writeNote(table: Record<string, Schema>, key: string, text: string): void {
  const trimmed = text.trim()
  const field = table[key]
  if (isShorthandSchema(field)) {
    // 缩写成裸字符串的那两种（`"string"` / `"integer"`）：要加说明就得先展开成对象
    if (trimmed !== '') table[key] = { type: schemaType(field), note: trimmed }
    return
  }
  if (trimmed === '') delete field.note
  else field.note = trimmed
}

// ---------- 三张表 / 两族 id：都从卡现算，吃参数吐结果 ----------

/** 左栏那棵树：卡里「能编」的容器节点，卡的声明顺序、逐层向下 */
function navRowsOf(card: CardData): NavRow[] {
  const rows: NavRow[] = []
  const seen = new Set<string>(Object.keys(card.state))
  const queue: string[] = [...seen]
  /** 放一个路径进队（空串丢弃、已经在队里过的不再进） */
  const push = (path: string): void => {
    if (path === '' || seen.has(path)) return
    seen.add(path)
    queue.push(path)
  }
  while (queue.length > 0) {
    const path = queue.shift() as string
    const node = schemaOf(card.state, path)
    if (node === undefined) continue
    if (CONTAINERS.includes(schemaType(node)) && Object.keys(fieldsOf(card.state, path)).length > 0) {
      rows.push({ path, kind: schemaType(node), taken: underEngine(path) })
    }
    for (const key of Object.keys(schemaFields(node) ?? {})) push(path + '.' + key)
    // `*` 是元素形状那一段的标记、不是一格：它底下只再走字段，不再套第二层
    if (path.endsWith('.*')) continue
    const element = schemaElement(node)
    if (element !== undefined) push(path + '.*')
  }
  return rows
}

/** 中栏那张表：选中那一格的字段，卡的声明顺序；说明那一格显示草稿（没改过就是卡里的） */
function fieldRowsOf(card: CardData, picked: string, notes: Record<string, string>): FieldRow[] {
  return Object.entries(fieldsOf(card.state, picked)).map(([key, node]) => ({
    key,
    kind: schemaType(node),
    hasInitial: declaresInitial(node),
    taken: underEngine(picked + '.' + key),
    note: notes[idOf(picked, key)] ?? declaredNote(card.state, picked, key),
  }))
}

/** 这一行的说明真的改了吗（**改回原值 = 没改**，顶栏那颗按钮要跟着变回按不动） */
function noteChanged(card: CardData, notes: Record<string, string>, id: string): boolean {
  const { parent, key } = splitId(id)
  return notes[id] !== declaredNote(card.state, parent, key)
}

/** 这一次保存牵动的行：待删的 + 说明被改过的（保存被拒时指的就是它们） */
function touchedOf(card: CardData, gone: Record<string, boolean>, notes: Record<string, string>): string[] {
  const ids = Object.keys(gone).filter((id) => gone[id])
  for (const id of Object.keys(notes)) if (noteChanged(card, notes, id)) ids.push(id)
  return ids
}

/** 这一格**待删**的那几行（别的格也有待删时，不该把同名的那一行画成待删） */
function goneKeysOf(gone: Record<string, boolean>, picked: string): string[] {
  return Object.keys(gone)
    .filter((id) => gone[id] && splitId(id).parent === picked)
    .map((id) => splitId(id).key)
}

/** 被拒时打在**这一格**牵动的那几行上（别去猜卡报错里那个路径） */
function badKeysOf(failed: boolean, touched: string[], picked: string): string[] {
  return failed ? touched.filter((id) => splitId(id).parent === picked).map((id) => splitId(id).key) : []
}

// ---------- 两个工厂：要读写 ref 的那两族各自封一个 ----------

/** `save()` 要读写的那几个草稿（都按「哪一格 + 哪个键」索引） */
interface DraftRefs {
  notes: Ref<Record<string, string>>
  gone: Ref<Record<string, boolean>>
  fresh: Ref<FreshRow | null>
  failed: Ref<boolean>
  failure: Ref<string>
}

/** 关窗守卫那一族交给外面的两件 */
interface GuardPort {
  setGuard(on: boolean): void
  dispose(): void
}

/**
 * 关窗 / 刷新那条守卫：跟着 `dirty` 挂与摘（票 78 那条）。
 *
 * ⚠️ 摘与挂都只走 `setGuard`，同一条守卫只挂一次也只摘一次 —— `dispose()` 与「继续」那条路
 *    都要能**显式**摘掉它（那一刻 `dirty` 还是真的，`watch` 收不到变化）。
 */
function makeGuard(dirty: ComputedRef<boolean>): GuardPort {
  /** 那条守卫此刻挂着没有（挂 / 摘成对：同一条只挂一次、也只摘一次） */
  const guardUp = ref(false)

  /** 关窗 / 刷新那条守卫：拦下导航（`returnValue` 是给老浏览器的那一半） */
  function warnUnload(event: BeforeUnloadEvent): void {
    event.preventDefault()
    event.returnValue = ''
  }

  /** 挂 / 摘那条守卫：干净的手上一个监听都不留，脏了才挂一个 */
  function setGuard(on: boolean): void {
    if (on === guardUp.value) return
    guardUp.value = on
    if (on) window.addEventListener('beforeunload', warnUnload)
    else window.removeEventListener('beforeunload', warnUnload)
  }

  /** 草稿一脏就挂、变回干净就摘 —— 挂它的只有这一处 */
  watch(dirty, (isDirty) => setGuard(isDirty), { immediate: true })

  /** 摘掉关窗守卫（编辑器在 `onBeforeUnmount` 里调） */
  function dispose(): void {
    setGuard(false)
  }

  return { setGuard, dispose }
}

/** 那一颗顶栏「保存」的工厂：把 `input` 与要读写的那几个 ref 收进来，返回那一条写路径 */
function makeSave(input: BranchDraftInput, drafts: DraftRefs): () => void {
  const { steps } = input
  const { notes, gone, fresh, failed, failure } = drafts

  /** 界面自己挡下来的那一类：只报不改（存储与内存一个字节都不动） */
  function refuse(reason: string): void {
    failed.value = true
    failure.value = t('card.saveFailed', { message: reason })
  }

  /**
   * 保存：深拷整份卡 → 只改这几处 → 走 `importCard`（先校验后落盘）→ 失败只报不改。
   *
   * 说明在前、删除在后：待删那一行可能同时有说明草稿，倒过来会在已删掉的位置上写。
   * 一步那几处与枝那张表**互不相干**（一个动 `graph.nodes`、一个动 `state`），先后无所谓。
   */
  function save(): void {
    const next = JSON.parse(JSON.stringify(input.card())) as CardData
    steps.applyTo(next)
    for (const id of Object.keys(notes.value)) {
      if (!noteChanged(input.card(), notes.value, id)) continue
      const { parent, key } = splitId(id)
      writeNote(fieldsOf(next.state, parent), key, notes.value[id])
    }
    for (const id of Object.keys(gone.value)) {
      if (!gone.value[id]) continue
      const { parent, key } = splitId(id)
      delete fieldsOf(next.state, parent)[key]
    }
    if (fresh.value !== null) {
      const name = fresh.value.key.trim()
      // 校验器一件都不管这四件事（实测 `""` / `" "` / `"a.b"` 全都过 `checkSchema`；`__proto__` 更连键都落不下）——
      // 界面自己挡：前三件是"卡里会多出一个用不了的键"，第四件是"界面报成功、卡里根本没有那个键"
      if (name === '') return refuse(t('card.fieldNameEmpty'))
      if (name.includes('.')) return refuse(t('card.fieldNameDot'))
      if (name === '__proto__') return refuse(t('card.fieldNameProto'))
      const table = fieldsOf(next.state, input.picked())
      if (Object.hasOwn(table, name)) return refuse(t('card.fieldNameTaken'))
      const field: SchemaNode = { type: fresh.value.kind }
      const typed = fresh.value.initial
      if (typed.trim() !== '') {
        // 数字格：**只有写成规范十进制整数**（`8` / `-3` / `+8`）才落成数字 —— `8.0` / `1e3` / `0x10` / `007`
        // 交给 `Number()` 都会被**静默改成另一个样子**（既不报错、又不是作者写的那个值，最坏的一类），
        // 所以那几种一律**原样**交给卡去拒（卡回一句 `must be an integer (got string)`）；其余类型原样。
        const literal = /^[+-]?(0|[1-9]\d*)$/
        field.initial =
          fresh.value.kind === 'integer' && literal.test(typed.trim()) ? Number(typed.trim()) : typed
      }
      if (fresh.value.note.trim() !== '') field.note = fresh.value.note.trim()
      // 新键只可能落在**末尾**：JS 对象的键序 = 插入序，而表的行序 = 卡里的键序（A3）
      table[name] = field
    }
    try {
      importCard(JSON.stringify(next))
    } catch (err) {
      // 边界：改动是人填的 —— 卡拒了只报不改（存储与内存里那张卡一个字节都没动）
      failed.value = true
      failure.value = t('card.saveFailed', { message: (err as Error).message })
      return
    }
    failed.value = false
    failure.value = ''
    notes.value = {}
    gone.value = {}
    fresh.value = null
    steps.markSaved(next)
    input.onSaved()
  }

  return save
}

// ---------- 对外那一个：只建 ref、调工厂、拼返回对象 ----------

/**
 * 挂起「另一格」那一族（票 80 的接缝）。
 *
 * @param input.card 现取当前卡（getter：`props.card` 换了要跟着变）
 * @param input.picked 当前编辑的那一格（点号路径；空串 = 那一轴没亮）—— **只读**
 * @param input.steps 一步那一族的三样（脏 / 写进深拷卡 / 记下刚存的那份）
 * @param input.onSaved 该让外层重载的那一刻（编辑器在这里 `emit('saved')`）
 */
export function useBranchDraft(input: BranchDraftInput): BranchDraftApi {
  const { steps } = input

  /** 说明的草稿，按「哪一格 + 哪个键」索引（没有这一条 = 没改过，显示卡里的值） */
  const notes = ref<Record<string, string>>({})
  /** 待删的行（**保存时才真删**；键同上） */
  const gone = ref<Record<string, boolean>>({})
  /** 刚开出来、还没保存的那一行（同时只开一行） */
  const fresh = ref<FreshRow | null>(null)
  /** 上一次保存被拒了 ⇒ 打在这一格牵动过的那几行上 */
  const failed = ref(false)
  /** 上一次保存被拒的原因（空串 = 没有；卡自己给的那句话原样带上） */
  const failure = ref('')
  /** 面板那颗「存回卡」撞上了脏草稿：那句问话挂在底栏上没有 */
  const discardAsk = ref(false)

  const navRows = computed(() => navRowsOf(input.card()))
  const fieldRows = computed(() => fieldRowsOf(input.card(), input.picked(), notes.value))
  /** 这一次保存牵动的行：待删的 + 说明被改过的 */
  const touched = computed(() => touchedOf(input.card(), gone.value, notes.value))
  /** 干净 ⇔ 一处改动都没有（顶栏那颗「保存」的 `disabled` 就是它；第三项是「编一步」那一族的脏） */
  const dirty = computed(() => fresh.value !== null || touched.value.length > 0 || steps.dirty.value)
  const goneKeys = computed(() => goneKeysOf(gone.value, input.picked()))
  const badKeys = computed(() => badKeysOf(failed.value, touched.value, input.picked()))

  const { setGuard, dispose } = makeGuard(dirty)
  const save = makeSave(input, { notes, gone, fresh, failed, failure })

  /** 说明格的草稿（跨格留着：一次保存把好几处改动一起提交） */
  function setNote(key: string, text: string): void {
    notes.value[idOf(input.picked(), key)] = text
  }

  /** 行尾那颗垃圾桶：待删 ⇄ 撤销（**保存才真删** —— 卡此刻一个字节没动） */
  function toggleDel(key: string): void {
    const id = idOf(input.picked(), key)
    gone.value[id] = gone.value[id] !== true
  }

  /** 表尾那颗「＋ 加一个字段」：开一行空的新行（同时只开一行） */
  function addRow(): void {
    fresh.value = { key: '', kind: 'string', note: '', initial: '' }
  }

  /** 新行那颗垃圾桶 = **取消**：那一行还没落过盘，直接收掉，不进待删 */
  function cancelRow(): void {
    fresh.value = null
  }

  /** 新行四格的草稿（类型只有下拉给的那两种） */
  function setFresh(cell: 'key' | 'kind' | 'note' | 'initial', text: string): void {
    const row = fresh.value
    if (row === null) return
    if (cell === 'kind') row.kind = text === 'integer' ? 'integer' : 'string'
    else row[cell] = text
  }

  /** 资源库面板那条 `saved`：有草稿就先问一句，干净就直接放行（顶栏那颗「保存」也发同名事件，但不走这条路） */
  function onResourceSaved(): void {
    if (!dirty.value) {
      input.onSaved()
      return
    }
    discardAsk.value = true
  }

  /** 那句问话的「取消」：草稿逐字不动，只是把问话收掉（面板那一次写照样在盘上） */
  function keepDraft(): void {
    discardAsk.value = false
  }

  /**
   * 那句问话的「继续」：守卫的理由已经用掉了 —— ⚠️ 这一刻 `dirty` 还是真的 ⇒ `watch` 收不到变化，
   * 所以要**显式**摘，否则重载时浏览器会拿它再问一遍（用户刚说过"丢掉吧"）。
   */
  function discardDraft(): void {
    discardAsk.value = false
    setGuard(false)
    input.onSaved()
  }

  return {
    navRows,
    fieldRows,
    goneKeys,
    badKeys,
    failed,
    failure,
    fresh,
    dirty,
    discardAsk,
    save,
    setNote,
    toggleDel,
    addRow,
    cancelRow,
    setFresh,
    onResourceSaved,
    keepDraft,
    discardDraft,
    dispose,
  }
}
