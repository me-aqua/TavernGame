<script setup lang="ts">
/**
 * 卡界面：四栏外壳里的**枝树 + 中栏那一屏**（设置面板「查看 / 编辑卡图」打开它）。
 *
 * 中栏按**一个**「当前编辑对象」画三态（票 73 · 段 8c-① 把它接成一条轴）：
 * 一步 ⇒ 编屏（`StepForm`）· 一格状态 ⇒ 可写字段表（`BranchForm`）· 都没选 ⇒ 显式空态。
 * 两个入口：细条点一步（`@select`）、左栏树点一行（`@pick`）—— 点谁谁赢，另一轴随之清掉。
 * 形态按决定 #24：绝对定位的浮层盖在故事上，不挤占正文；四栏骨架是 `EditorShell` 的事。
 *
 * **写路径只有一条**（8b-② 立的，8c-② 让「编一步」也走它）：说明 / 加字段 / 删字段 / 一步的
 * 六个键**都只动草稿**，点顶栏那颗「保存」才落卡 —— **深拷整份卡 → 只改这几处 → `importCard`
 * （先校验后落盘）→ 失败只报不改**；成功只 emit `saved`，reload 是外层的事。
 *
 * ⚠️ **卡的知识只走这一条路**：树与表都在这里从 `card.state` 现算，子组件只画收到的行 ——
 *    于是「组件层绿、真浏览器红」那种两份走法漂移没有了。
 * ⚠️ **读与写共用同一个 `fieldsOf`**：`object` 读自己的 `fields`，`map` / `list` 读**元素形状**的
 *    `of.fields`；分成两份就会出「表里显示 `of.fields`、写回 `fields`」这种**静默成立**的错。
 * ⚠️ **界面自己挡三件事，校验器一件都不管**（实测 `""` / `" "` / `"a.b"` 全都过 `checkSchema`）：
 *    键名 trim 后非空 · 不含 `.` · 不与同格已有的键重名（JSON 里同名键只能活一个 ⇒ 静默丢编辑）。
 * ⚠️ **草稿**按「哪一格 + 哪个键」或节点 id 索引：换一处再切回来还在；
 *    **干净 ⇔ 草稿与卡里的值逐字相同**（顶栏那颗按钮的 `disabled` 就是它）。
 * ⚠️ **什么进树**：这一格自己有一张**非空字段表**才进树；元素是标量的 `list` 点进去是一张空表，
 *    不是一格。树是**逐层向下**（宽度优先）展开的，行的先后不承诺（裁决 4）。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BranchForm from './BranchForm.vue'
import CardResources from './CardResources.vue'
import EditorShell from './EditorShell.vue'
import StateTreeNav from './StateTreeNav.vue'
import StepForm from './StepForm.vue'
import { CLOCK_STATE_PATH } from '../game/card-time'
import { isRecord } from '../game/card-read'
import { schemaElement, schemaFields, schemaType, type Schema, type SchemaNode } from '../game/card-state'
import { cardMeta, importCard, type CardSource } from '../game/current-card'
import type { CardData } from '../game/card'

const { t } = useI18n()

const props = defineProps<{ card: CardData; source: CardSource }>()

/** 三个「＋」各自抛一个事件：真的改卡是各自的票（8e 等）的事 */
const emit = defineEmits<{
  close: []
  /** 改完也存下了 —— 外层负责 reload */
  saved: []
  'add-branch': []
  'add-action': []
  'add-step': []
}>()

/** 新行四格的草稿（那一行还没落过盘，只活在内存里） */
type FreshRow = { key: string; kind: 'string' | 'integer'; note: string; initial: string }

/**
 * 中栏正在编的**那一个**对象 —— 一格状态（枝）或一步节点，**二者只会有一个**。
 *
 * ⚠️ 「当前编辑对象」只留这一个：两条轴的高亮与中栏画哪一屏全由它派生 ⇒ 树与细条
 *    **结构上不可能同时亮**（写成两个 `ref` 再靠"点谁清谁"的规则维持，就是等哪天漏一处）。
 * `null` = 还没选（开屏不自动选第 1 步）。
 */
const target = ref<{ kind: 'branch'; path: string } | { kind: 'step'; id: string } | null>(null)
/** 树上选中的那一格（卡里的点号路径）；空串 = 那一轴没亮 */
const picked = computed(() => (target.value?.kind === 'branch' ? target.value.path : ''))
/** 细条里选中的那一步（节点 id）；空串 = 那一轴没亮 */
const selected = computed(() => (target.value?.kind === 'step' ? target.value.id : ''))
/** 资源库面板开着没有（顶栏那颗按钮开合它） */
const resourcesOpen = ref(false)

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

/** 一步的草稿：文本三样 + 三栏名单（`prompt` 是多行框里那**一整段文本**，落卡时才按行切回数组） */
type StepDraft = {
  name: string
  duty: string
  prompt: string
  tools: string[]
  reads: string[]
  settings: string[]
}

/** 一步的草稿（没有这一条 = 这一步没改过，屏上显示卡里的值） */
const stepDrafts = ref<Record<string, StepDraft>>({})
/** 上一次写进存储的那份卡（`null` = 这一次挂载还没存过） */
const written = ref<CardData | null>(null)
/** 屏上的那张卡：存过就以存下去的那份为准（外层收到 `saved` 才 reload，在那之前 props 是旧的） */
const shown = computed(() => written.value ?? props.card)

/** 三栏的候选表：卡里那三张表本身，顺序照卡 */
const roster = computed(() => ({
  tools: Object.keys(shown.value.actions),
  reads: Object.keys(shown.value.state),
  settings: Object.keys(shown.value.settings),
}))

/**
 * 卡里那一步现在的样子 —— 一份草稿就是从它长出来的。
 *
 * 🔴 **三栏的缺省语义各不相同**：`tools` / `reads` 不写 = **全给**（`card-actions.ts:104` · `card-state.ts:345`）；`settings` 不写 = **全不给**（票 76）。
 */
function cardDraft(id: string): StepDraft {
  const node = shown.value.graph.nodes[id]
  return {
    name: node.name,
    duty: node.duty,
    prompt: node.prompt.join('\n'),
    tools: [...(node.tools ?? Object.keys(shown.value.actions))],
    reads: [...(node.reads ?? Object.keys(shown.value.state))],
    settings: [...(node.settings ?? [])],
  }
}

/**
 * 草稿与卡里的值**逐字相同**吗（改回原值 = 没改，顶栏那颗按钮要跟着变回按不动）。
 * ⚠️ 两边都是 `cardDraft` 那个形状长出来的（键序一致）⇒ 逐串比就够。
 */
function stepChanged(id: string): boolean {
  const draft = stepDrafts.value[id]
  return draft !== undefined && JSON.stringify(draft) !== JSON.stringify(cardDraft(id))
}

/** 那一屏要显示的值：草稿优先，没改过就是卡里的；`null` = 那一步那一屏整个不画 */
const stepValues = computed<StepDraft | null>(() =>
  selected.value === '' ? null : (stepDrafts.value[selected.value] ?? cardDraft(selected.value)),
)

/** 记一处改动（第一次改这一步时从卡里长一份草稿出来；没选任何一步就什么都不做） */
function editStep(id: string, change: (draft: StepDraft) => void): void {
  if (id === '') return
  const draft = { ...(stepDrafts.value[id] ?? cardDraft(id)) }
  change(draft)
  stepDrafts.value = { ...stepDrafts.value, [id]: draft }
}

/** 文本控件的草稿 */
function setStepText(key: 'name' | 'duty' | 'prompt', value: string): void {
  editStep(selected.value, (draft) => (draft[key] = value))
}

/**
 * 一栏勾选的草稿：取消勾就摘掉，勾上就**插到它在候选表里的位置**（不是接到末尾）——
 * 保存**只改人动过的那几处**（D1 逐字比整份卡），排在末尾会把卡里原来那几样的先后也改掉。
 */
function setStepPick(key: 'tools' | 'reads' | 'settings', name: string, on: boolean): void {
  editStep(selected.value, (draft) => {
    const list = draft[key]
    if (!on) draft[key] = list.filter((one) => one !== name)
    else if (!list.includes(name)) {
      const at = list.findIndex((one) => roster.value[key].indexOf(one) > roster.value[key].indexOf(name))
      draft[key] = at === -1 ? [...list, name] : [...list.slice(0, at), name, ...list.slice(at)]
    }
  })
}

const meta = computed(() => cardMeta(props.card))
const sourceLabel = computed(() =>
  props.source === 'imported' ? t('card.sourceImported') : t('card.sourceBuiltin'),
)
/** 顶栏那一行身份（外壳只负责画） */
const metaLine = computed(() =>
  t('card.meta', { name: meta.value.name, version: meta.value.version, source: sourceLabel.value }),
)

/** 能进树的类型：只有容器（标量字段留在中栏那张表里） */
const CONTAINERS = ['object', 'map', 'list']

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
function declaredNote(parent: string, key: string): string {
  const field = fieldsOf(props.card.state, parent)[key]
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

/** 左栏那棵树：卡里「能编」的容器节点，卡的声明顺序、逐层向下 */
const navRows = computed(() => {
  const rows: Array<{ path: string; kind: string; taken: boolean }> = []
  const seen = new Set<string>(Object.keys(props.card.state))
  const queue: string[] = [...seen]
  /** 放一个路径进队（空串丢弃、已经在队里过的不再进） */
  const push = (path: string): void => {
    if (path === '' || seen.has(path)) return
    seen.add(path)
    queue.push(path)
  }
  while (queue.length > 0) {
    const path = queue.shift() as string
    const node = schemaOf(props.card.state, path)
    if (node === undefined) continue
    if (CONTAINERS.includes(schemaType(node)) && Object.keys(fieldsOf(props.card.state, path)).length > 0) {
      rows.push({ path, kind: schemaType(node), taken: underEngine(path) })
    }
    for (const key of Object.keys(schemaFields(node) ?? {})) push(path + '.' + key)
    // `*` 是元素形状那一段的标记、不是一格：它底下只再走字段，不再套第二层
    if (path.endsWith('.*')) continue
    const element = schemaElement(node)
    if (element !== undefined) push(path + '.*')
  }
  return rows
})

/** 一个草稿的 id：哪一格 + 哪个键（两格有同名键时不会撞车） */
function idOf(parent: string, key: string): string {
  return parent + '|' + key
}

/** 把 id 拆回「哪一格」与「哪个键」 */
function splitId(id: string): { parent: string; key: string } {
  const cut = id.indexOf('|')
  return { parent: id.slice(0, cut), key: id.slice(cut + 1) }
}

/** 中栏那张表：选中那一格的字段，卡的声明顺序；说明那一格显示草稿（没改过就是卡里的） */
const fieldRows = computed(() =>
  Object.entries(fieldsOf(props.card.state, picked.value)).map(([key, node]) => ({
    key,
    kind: schemaType(node),
    hasInitial: declaresInitial(node),
    taken: underEngine(picked.value + '.' + key),
    note: notes.value[idOf(picked.value, key)] ?? declaredNote(picked.value, key),
  })),
)

/** 这一行的说明真的改了吗（**改回原值 = 没改**，顶栏那颗按钮要跟着变回按不动） */
function noteChanged(id: string): boolean {
  const { parent, key } = splitId(id)
  return notes.value[id] !== declaredNote(parent, key)
}

/** 这一次保存牵动的行：待删的 + 说明被改过的（保存被拒时指的就是它们） */
const touched = computed(() => {
  const ids = Object.keys(gone.value).filter((id) => gone.value[id])
  for (const id of Object.keys(notes.value)) if (noteChanged(id)) ids.push(id)
  return ids
})

/** 干净 ⇔ 一处改动都没有（顶栏那颗「保存」的 `disabled` 就是它） */
const dirty = computed(
  () => fresh.value !== null || touched.value.length > 0 || Object.keys(stepDrafts.value).some(stepChanged),
)

/** 这一格**待删**的那几行（别的格也有待删时，不该把同名的那一行画成待删） */
const goneKeys = computed(() =>
  Object.keys(gone.value)
    .filter((id) => gone.value[id] && splitId(id).parent === picked.value)
    .map((id) => splitId(id).key),
)

/** 被拒时打在**这一格**牵动的那几行上（别去猜卡报错里那个路径） */
const badKeys = computed(() =>
  failed.value
    ? touched.value.filter((id) => splitId(id).parent === picked.value).map((id) => splitId(id).key)
    : [],
)

/** 点树上的一行：中栏换成那一格的字段表（细条那一轴随之清掉） */
function pick(path: string): void {
  target.value = { kind: 'branch', path }
}

/** 点细条上的一步：中栏换成那一步的编屏，可以直接改（树那一轴随之清掉） */
function pickStep(id: string): void {
  target.value = { kind: 'step', id }
}

/** 说明格的草稿（跨格留着：一次保存把好几处改动一起提交） */
function setNote(key: string, text: string): void {
  notes.value[idOf(picked.value, key)] = text
}

/** 行尾那颗垃圾桶：待删 ⇄ 撤销（**保存才真删** —— 卡此刻一个字节没动） */
function toggleDel(key: string): void {
  const id = idOf(picked.value, key)
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

/** 界面自己挡下来的那一类：只报不改（存储与内存一个字节都不动） */
function refuse(reason: string): void {
  failed.value = true
  failure.value = t('card.saveFailed', { message: reason })
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

/**
 * 保存：深拷整份卡 → 只改这几处 → 走 `importCard`（先校验后落盘）→ 失败只报不改。
 *
 * 说明在前、删除在后：待删那一行可能同时有说明草稿，倒过来会在已删掉的位置上写。
 * 一步那几处与枝那张表**互不相干**（一个动 `graph.nodes`、一个动 `state`），先后无所谓。
 */
function save(): void {
  const next = JSON.parse(JSON.stringify(props.card)) as CardData
  for (const id of Object.keys(stepDrafts.value)) {
    if (!stepChanged(id)) continue
    const draft = stepDrafts.value[id]
    const card = cardDraft(id)
    const node = next.graph.nodes[id]
    // 🔴 **只写真的改过的那几样**：卡没写 `tools` / `reads` / `settings` 这个键时，"不写"与
    //    "写全"在引擎那边等价，可它是**作者没写的一个键** —— 顺手补进卡里就是"保存多改一处"
    //    （D1 逐字比整份卡要拦的正是这件事）。`name` / `duty` / `prompt` 是必写键，不必判。
    if (draft.name !== card.name) node.name = draft.name
    if (draft.duty !== card.duty) node.duty = draft.duty
    // 主提示词一行一条：空行也是卡里的一行 ⇒ 多行框按 `\n` 切回数组
    if (draft.prompt !== card.prompt) node.prompt = draft.prompt.split('\n')
    // 三栏名单：顺序也算（它是卡里的声明顺序）⇒ 逐串比
    if (JSON.stringify(draft.tools) !== JSON.stringify(card.tools)) node.tools = draft.tools
    if (JSON.stringify(draft.reads) !== JSON.stringify(card.reads)) node.reads = draft.reads
    if (JSON.stringify(draft.settings) !== JSON.stringify(card.settings)) node.settings = draft.settings
  }
  for (const id of Object.keys(notes.value)) {
    if (!noteChanged(id)) continue
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
    const table = fieldsOf(next.state, picked.value)
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
  // ⚠️ **一步的草稿不清**（它记的就是"这一步屏上现在是什么"），改成把**刚存下去的那份卡**
  //    记进 `written`：于是草稿与它逐字相同 ⇒ 又是干净的，而别的步也读得到最新的那张卡。
  //    真实外层收到 `saved` 会 reload 整张卡，那时组件整个重建，这两样自然都不在。
  written.value = next
  emit('saved')
}
</script>

<template>
  <div
    data-card-editor
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[92vh] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl xl:max-w-[1240px] 2xl:max-w-[1400px]"
    >
      <EditorShell
        :card="card"
        :selected="selected"
        :branch="picked"
        :meta="metaLine"
        :prompts-open="resourcesOpen"
        :dirty="dirty"
        @close="emit('close')"
        @toggle-resources="resourcesOpen = !resourcesOpen"
        @save="save"
        @select="pickStep"
        @add-branch="emit('add-branch')"
        @add-action="emit('add-action')"
        @add-step="emit('add-step')"
      >
        <!-- 左栏：卡声明的那棵状态树（选一格就在中栏编它） -->
        <template #content>
          <StateTreeNav :rows="navRows" :picked="picked" @pick="pick" />
        </template>

        <!-- 中栏三态：一步（编屏）· 一格（可写字段表）· 都没选（显式空态） -->
        <template #mid>
          <!-- 整次保存的那个原因（哪一行出事由行上的 `data-row-bad` 指） -->
          <p v-if="failure" data-card-error class="failure" v-text="failure" />
          <StepForm
            v-if="stepValues"
            :card="card"
            :id="selected"
            :roster="roster"
            v-bind="stepValues"
            @text="setStepText"
            @pick="setStepPick"
          />
          <BranchForm
            v-else-if="picked"
            :path="picked"
            :rows="fieldRows"
            :gone="goneKeys"
            :bad-keys="badKeys"
            :failed="failed"
            :fresh="fresh"
            @note="setNote"
            @del="toggleDel"
            @add="addRow"
            @cancel="cancelRow"
            @fresh="setFresh"
          />
          <p v-else data-branch-none class="none">{{ t('card.branchNone') }}</p>
        </template>

        <!-- 右栏：公共提示词的读与改（8d 才换成新表单） -->
        <template #prompts>
          <CardResources v-if="resourcesOpen" :card="card" error="" @saved="emit('saved')" />
        </template>
      </EditorShell>
    </div>
  </div>
</template>

<style scoped>
/* 还没编任何一格时的显式空态（字号只用三档里的一档） */
.none {
  margin: 0;
  font-size: var(--fs2);
  color: var(--color-faint);
}
/* 保存被拒的原因：与资源库那一块同一个形状（复用现成的危险色） */
.failure {
  margin: 0;
  padding: var(--s2);
  border: 1px solid var(--color-danger);
  border-radius: var(--r2);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font-size: var(--fs2);
  line-height: 1.5;
}
</style>
