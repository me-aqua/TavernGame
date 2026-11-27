<script setup lang="ts">
/**
 * 编辑器（SPEC §5）：左状态树（可拖宽）· 工作流细条（固定宽）· 中编辑（可拖）· 右公共提示词（可拖）。
 *
 * **一份文件两种模式**，因为表单、栏宽、状态机都该是同一套：
 *   · 卡模式 `#/edit/:cardId`：改 `tg2.cards` 里这张卡，模型写 `tg2.nodeModels[cardId]`；
 *   · 存档模式 `#/edit-save/:saveId`：改的是**这一份存档的 `cardSnapshot`（深拷贝）**与它自己的
 *     `save.nodeModels`，`tg2.cards` 一个字节都不动。**结构锁死**：状态元素不能加 / 删（新元素、加子元素、
 *     删除都不渲染）、没有节点增删排序、卡名不可改；名字 / 备注 / 初值 / 提示词块 / 节点提示词 /
 *     历史轮数 / 眼睛 / 模型预设照常可改。
 *
 * 三条口径：
 *   · **编辑只改内存草稿**：字段一改只动草稿，顶栏【保存】才校验 + 落盘（`[data-save-card]`）。
 *     校验不过 ⇒ 不写盘、草稿保留、中文错误清单可点回那一格；修好再点保存；成功提示 3 秒后自己消失。
 *     有没保存的改动时点【返回】先弹确认（取消 = 留在编辑器）。
 *   · **模型不进卡**：中栏那一格改的是节点映射 —— 卡模式 `tg2.nodeModels[cardId][nodeId]`，
 *     存档模式 `save.nodeModels[nodeId]`；映射**不属于卡草稿**，所以它照旧即时写。
 *     卡模式第一次打开会铺一条「每个节点 → 池子里第一个预设」的映射（没有预设就不铺）；
 *     存档没有自己的映射时先按卡级那一片显示，玩家真改哪一格才把整片写进存档；
 *   · **自由度只有两个**（左宽、右宽），中栏恒为余量；细条宽度固定，不参与拖拽。
 *
 * 两种模式保存时校验的东西不一样（CONTRACT §6.2）：
 *   · 卡模式：整卡（含初始值）必须合法，`cardIssues` 一条都不能有；
 *   · 存档模式：初始值不判（它只是新建存档的种子），改判**新快照容不容得下这一份存档的当前树** ——
 *     `saveTreeIssues` 给出路径级的清单，不兼容 ⇒ 不写盘、草稿保留、错误点回那一格。
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ErrorPanel from '../components/ErrorPanel.vue'
import NodeForm from '../components/NodeForm.vue'
import PromptForm from '../components/PromptForm.vue'
import PromptList from '../components/PromptList.vue'
import StateForm from '../components/StateForm.vue'
import StateTree from '../components/StateTree.vue'
import WorkflowStrip from '../components/WorkflowStrip.vue'
import { asAppError, storage } from '../app-context'
import { cloneCard, nextPromptId, nextStateCode } from '../cards'
import type { AppError } from '../core/errors'
import { validateCard, validateSave } from '../core/schema'
import {
  addChild,
  cardIssues,
  pathsOf,
  removeNode,
  saveTreeIssues,
  setElementType,
  setInitial,
  setTimeMode,
} from '../core/statetree'
import type { CardIssue } from '../core/statetree'
import { DEFAULT_SETTINGS } from '../core/storage'
import type {
  Card,
  ChainNode,
  NodeModels,
  Preset,
  PromptBlock,
  Save,
  StateElement,
  StateType,
  StateValue,
  TimeMode,
} from '../core/types'
import { t } from '../i18n'
import { REPO_URL } from '../repo'
import { routeHash } from '../router'

const props = defineProps<{ cardId?: string; saveId?: string }>()

/** 两个 id 只来一个（路由层保证）；页面按 key 重挂，所以 setup 时定死 */
const cardId = props.cardId
const saveId = props.saveId
/** 存档模式：编辑目标是这一份存档，不是卡带库 */
const editingSave = saveId !== undefined

const LEFT = { min: 200, max: 480 }
const RIGHT = { min: 240, max: 560 }
/** 中栏的最小宽度（CONTRACT §8.2）：两条分隔条都夹着它，先扣掉再谈左右能多宽 */
const MIDDLE_MIN = 320
const STRIP_WIDTH = 96
const SPLITTER_WIDTH = 6

const card = ref<Card | null>(null)
/** 存档模式：正在编辑的那一份（`cardSnapshot` 就是中栏改的东西） */
const save = ref<Save | null>(null)
const presets = ref<Preset[]>([])
/** 卡模式：整张 `tg2.nodeModels`（写回时要带上别的卡那几片） */
const models = ref<NodeModels>({})
/** 当前正在编辑的节点映射：卡模式 = `tg2.nodeModels[cardId]`；存档模式 = `save.nodeModels`（没有就看卡级那一片） */
const nodePresets = ref<Record<string, string>>({})
const error = ref<AppError | null>(null)
/** 上一次点保存的问题清单（空 = 没拦下来）与成功提示 */
const saveIssues = ref<CardIssue[]>([])
const savedOk = ref(false)
/** 草稿动过没有（点【返回】时决定要不要确认） */
const dirty = ref(false)
/** 等着确认的那件事：删元素 / 删提示词 / 换时间模式 / 带着改动离开 */
const pending = ref<
  | { kind: 'state'; code: string }
  | { kind: 'prompt'; id: string }
  | { kind: 'mode'; mode: TimeMode; select: HTMLSelectElement }
  | { kind: 'back' }
  | null
>(null)
const selectedNodeId = ref<string | null>(null)
const selectedCode = ref<string | null>(null)
const selectedPromptId = ref<string | null>(null)
const columns = reactive({
  left: DEFAULT_SETTINGS.editorColumns.left,
  right: DEFAULT_SETTINGS.editorColumns.right,
})
const rowEl = ref<HTMLElement | null>(null)
const selectedNode = computed(
  () => card.value?.chain.find((node) => node.id === selectedNodeId.value) ?? null,
)
const selectedElement = computed(
  () => card.value?.state.find((element) => element.code === selectedCode.value) ?? null,
)
const selectedPrompt = computed(
  () => card.value?.prompts.find((prompt) => prompt.id === selectedPromptId.value) ?? null,
)

/** 页栏标题：卡名（存档模式是快照里的名字）；还没读出来时显示目标 id */
const title = computed(() => card.value?.name ?? saveId ?? cardId)

/** 中栏标题：编辑·<当前选中对象的名字>；什么都没选就是「编辑」 */
const middleTitle = computed(() => {
  if (selectedNode.value) return t('editor.editTitle', { name: selectedNode.value.name })
  if (selectedElement.value) return t('editor.editTitle', { name: selectedElement.value.name })
  if (selectedPrompt.value) return t('editor.editTitle', { name: selectedPrompt.value.title })
  return t('editor.editTitleEmpty')
})

/**
 * 存档模式：选中元素这一格在 `save.tree` 里的当前值（中栏数字元素的「当前值」那一行）。
 * 卡模式没有「当前值」可看（那一份的树还不存在）⇒ `undefined`。
 */
const currentValue = computed(() => {
  const element = selectedElement.value
  const current = save.value
  const draft = card.value
  if (!element || !current || !draft) return undefined
  const [ownPath] = pathsOf(draft.state, element.code)
  return ownPath === undefined ? undefined : current.tree[ownPath]
})

/** 确认层的文案与确认按钮：删除说「删除」，换模式与离开说「确定」/「离开」 */
const pendingMessage = computed(() => {
  if (pending.value?.kind === 'state') return t('editor.deleteStateConfirm')
  if (pending.value?.kind === 'prompt') return t('editor.deletePromptConfirm')
  if (pending.value?.kind === 'mode') return t('editor.timeModeConfirm')
  return t('editor.leaveConfirm')
})
const pendingConfirmLabel = computed(() =>
  pending.value?.kind === 'back'
    ? t('editor.leave')
    : pending.value?.kind === 'mode'
      ? t('common.confirm')
      : t('common.delete'),
)

/** 某一格当前用的预设 id：映射里有就用它，没有就是池子第一个（`''` = 一个预设都没有） */
function presetIdFor(nodeId: string): string {
  return nodePresets.value[nodeId] ?? presets.value[0]?.id ?? ''
}

/** 打开卡模式：只按 id 校验要打开的这一张（盘上别的坏卡与它无关），首次打开把模型映射铺上 */
function openCard(id: string): void {
  const found = storage().loadCardById(id)
  card.value = found
  models.value = storage().loadNodeModels()
  if (!models.value[id] && presets.value.length > 0) {
    const first = presets.value[0].id
    models.value = {
      ...models.value,
      [id]: Object.fromEntries(found.chain.map((node) => [node.id, first])),
    }
    storage().saveNodeModels(models.value)
  }
  nodePresets.value = models.value[id] ?? {}
}

/**
 * 打开存档模式：读这一份存档，把它的 `cardSnapshot` **深拷贝**出来当编辑对象（盘上那张卡不参与）。
 *
 * 存档还没有自己的映射时（本票之前建的存档）先按卡级 `tg2.nodeModels[cardId]` 显示 —— 与对话页
 * 用的是同一份解析结果；玩家真改了某一格，才把整片写进 `save.nodeModels`（不迁移、不补写）。
 */
function openSave(id: string): void {
  const found = storage().loadSaveById(id)
  // 初始值不判（§6.2）：这一格在存档里早就展开成 `save.tree`，存档模式也不显示它
  validateCard(found.cardSnapshot, { initial: false })
  validateSave(found, found.cardSnapshot)
  save.value = found
  card.value = cloneCard(found.cardSnapshot)
  nodePresets.value = { ...(found.nodeModels ?? storage().loadNodeModels()[found.cardId] ?? {}) }
}

onMounted(() => {
  try {
    presets.value = storage().loadPresets()
    const settings = storage().loadSettings()
    columns.left = settings.editorColumns.left
    columns.right = settings.editorColumns.right
    if (saveId !== undefined) openSave(saveId)
    else if (cardId !== undefined) openCard(cardId)
  } catch (cause) {
    error.value = asAppError(cause)
  }
})

/** 卡模式：把这张卡换进 `tg2.cards` 那一行，别的行（含坏项）原样带回 */
function writeCard(next: Card): void {
  const entries = storage()
    .loadCardEntries()
    .map((entry) => (entry.card?.id === next.id ? { raw: next, card: next } : entry))
  storage().saveCardsLoose(entries.map((entry) => entry.raw))
}

/** 存档模式：快照 + 这一份自己的模型映射一起换进 `tg2.saves` 那一行，别的存档原样带回 */
function writeSave(next: Card): void {
  const current = save.value
  if (!current) return
  const nextSave: Save = { ...current, cardSnapshot: next, nodeModels: { ...nodePresets.value } }
  validateSave(nextSave, next)
  const entries = storage()
    .loadSaveEntries()
    .map((entry) => (entry.save?.id === nextSave.id ? { raw: nextSave, save: nextSave } : entry))
  storage().saveSavesLoose(entries.map((entry) => entry.raw))
  save.value = nextSave
}

/**
 * 落盘草稿：**先验后写**。
 *
 * 卡模式：`cardIssues`（状态树 + 链的规矩，含初始值）一条都不能有；
 * 存档模式：不判初始值 —— 改判**新快照容不容得下这一份存档的当前树**（`saveTreeIssues`），
 * 不兼容就是路径级的一条错误，点回那一格。
 *
 * 两种模式都只替换「这一个对象」那一行、宽松写回整表：盘上别的卡 / 存档（包括不合法的那些）
 * **JSON 值**不变（空白 / 数字写法会被重新序列化，不承诺字节逐字相同）。
 */
function saveCard(): void {
  const draft = card.value
  if (!draft) return
  const current = save.value
  const issues =
    editingSave && current
      ? [...cardIssues(draft, { initial: false }), ...saveTreeIssues(draft, current.tree)]
      : cardIssues(draft)
  if (issues.length > 0) {
    saveIssues.value = issues
    savedOk.value = false
    return
  }
  try {
    // 清单空 ⇒ 只剩形状层（数组 / 字符串）；校验器抛的错按一条「卡级」问题显示
    validateCard(draft, { initial: !editingSave })
    if (editingSave) writeSave(draft)
    else writeCard(draft)
    saveIssues.value = []
    dirty.value = false
    flashSaved()
  } catch (cause) {
    saveIssues.value = [{ code: '', path: '', message: asAppError(cause).message, errorCode: 'E_VALIDATION' }]
    savedOk.value = false
  }
}

/** 成功提示只活 3 秒（连着保存两次就从这一次重新计时） */
let savedTimer: number | undefined
function flashSaved(): void {
  savedOk.value = true
  window.clearTimeout(savedTimer)
  savedTimer = window.setTimeout(() => {
    savedOk.value = false
  }, 3000)
}
onUnmounted(() => window.clearTimeout(savedTimer))

/** 点错误清单里的一条：有 code 就选中那一格（卡级问题只清掉成功提示） */
function selectIssue(issue: CardIssue): void {
  savedOk.value = false
  if (issue.code === '') return
  selectElement(issue.code)
}

/** 草稿改动：只动内存，不写盘；从这一刻起草稿就「脏」了（返回要先确认） */
function updateCard(mutate: (current: Card) => Card): void {
  const current = card.value
  if (!current) return
  card.value = mutate(current)
  dirty.value = true
}

function patchNode(nodeId: string, patch: Partial<ChainNode>): void {
  updateCard((current) => ({
    ...current,
    chain: current.chain.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
  }))
}

/** 中栏交回来的是**整份元素**（换类型要能删掉旧类型的字段），所以这里是替换不是合并 */
function patchElement(code: string, element: StateElement): void {
  updateCard((current) => ({
    ...current,
    state: current.state.map((item) => (item.code === code ? element : item)),
  }))
}

/**
 * 眼睛：把某个引用塞进/拿出当前节点的 `reads` / `writable` / `readsUpstream`。
 *
 * 状态元素的【读】/【写】是按**三态**切的：`all` ⇒ 把这一 code 连同它下面已经不用的引用一起摘掉
 * （父行的「全反选」），`some` / `none` ⇒ 加上这一 code（父行加上它 = 自身值 + 整棵子树全选）。
 * 叶子只有 all / none 两态，所以它的按钮永远只切自己。
 */
function toggleRef(
  field: 'reads' | 'writable' | 'readsUpstream',
  ref0: string,
  tri?: 'all' | 'some' | 'none',
): void {
  const node = selectedNode.value
  if (!node) return
  const list = node[field]
  // 提示词块 / 上游节点那两种眼睛不是三态的：它们只翻自己这一条
  if (tri === undefined) {
    patchNode(node.id, {
      [field]: list.includes(ref0) ? list.filter((item) => item !== ref0) : [...list, ref0],
    })
    return
  }
  const inside = (ref: string) => ref === ref0 || ref.startsWith(`${ref0}.`)
  const next = tri === 'all' ? list.filter((item) => !inside(item)) : [...new Set([...list, ref0])]
  patchNode(node.id, { [field]: next })
}

function selectNode(nodeId: string): void {
  selectedNodeId.value = nodeId
  selectedCode.value = null
  selectedPromptId.value = null
}

function selectElement(code: string): void {
  selectedCode.value = code
  selectedNodeId.value = null
  selectedPromptId.value = null
}

// S3：选中一块公共提示词（中栏换成 PromptForm）
function selectPrompt(id: string): void {
  selectedPromptId.value = id
  selectedNodeId.value = null
  selectedCode.value = null
}

function addState(): void {
  const current = card.value
  if (!current) return
  const code = nextStateCode(current.state)
  const element: StateElement = {
    code,
    name: t('editor.newStateName', { code }),
    note: '',
    type: 'text',
    // 初始值只挂在根元素上：新根的值路径就是它自己的 code
    initial: { [code]: '' },
  }
  updateCard((card0) => ({ ...card0, state: [...card0.state, element] }))
  selectElement(code)
}

/** 给某个元素加孩子：标量不换类型，自身值在所属根的初始值表里搬到 `.0`（归 `statetree.addChild`） */
function addChildOf(code: string): void {
  const current = card.value
  if (!current) return
  const next = addChild(current, code)
  updateCard(() => next)
  const added = next.state.find((element) => !current.state.some((old) => old.code === element.code))
  if (added) selectElement(added.code)
}

/**
 * 删一个元素（连同子树）：同层兄弟重排为 `1..n`、每个根元素的初始值键与链上的 `reads` / `writable`
 * 一起映射 —— 这些规则住在 `statetree.removeNode`，编辑器只把结果当新草稿。
 */
function removeState(code: string): void {
  const current = card.value
  if (!current) return
  updateCard((card0) => removeNode(card0, code))
  if (selectedCode.value === code) selectedCode.value = null
}

/**
 * 换类型：整份新元素由 `statetree.setElementType` 产出（它还要同步所属根的初始值那一格）。
 *
 * 类型下拉里「时间」那一档**留着**（导入的卡可能真是时间类型，作者也该看得见它），但**别的元素换不过去**：
 * `setElementType` 抛 `E_VALIDATION`。所以这里必须接住 —— 不接就是一次静默的空转（下拉停在新选项上、
 * 草稿没变、一个字都不说）。接住之后：错误进页内 `[data-error]`，下拉拨回这个元素真实的类型。
 */
function retypeElement(code: string, type: StateType, select: HTMLSelectElement): void {
  try {
    updateCard((current) => setElementType(current, code, type))
    error.value = null
  } catch (cause) {
    error.value = asAppError(cause)
    select.value = card.value?.state.find((item) => item.code === code)?.type ?? ''
  }
}

/** 改初始值：按值路径写进拥有它的那个根元素（子元素对象自己一个字都不动） */
function setInitialValue(path: string, value: StateValue): void {
  updateCard((current) => setInitial(current, path, value))
}

/**
 * 换时间模式：**先确认、草稿此刻不动**（契约 §B5）。
 * 记下拉元素是因为「取消」时草稿没变，`:value` 不会重绘它 —— 得手动拨回去。
 */
function requestTimeMode(mode: TimeMode, select: HTMLSelectElement): void {
  const current = card.value
  const time = current?.state[0]
  if (!current || !time || time.timeMode === mode) return
  pending.value = { kind: 'mode', mode, select }
}

/** 确认层里点「取消」：换模式那一支要把下拉拨回当前模式，草稿一个字不动 */
function cancelPending(): void {
  const target = pending.value
  pending.value = null
  if (target?.kind === 'mode') target.select.value = card.value?.state[0]?.timeMode ?? ''
}

function addPrompt(): void {
  const current = card.value
  if (!current) return
  const block: PromptBlock = { id: nextPromptId(current.prompts), title: '', body: '' }
  updateCard((card0) => ({ ...card0, prompts: [...card0.prompts, block] }))
  selectPrompt(block.id)
}

function patchPrompt(id: string, patch: Partial<PromptBlock>): void {
  updateCard((current) => ({
    ...current,
    prompts: current.prompts.map((prompt) => (prompt.id === id ? { ...prompt, ...patch } : prompt)),
  }))
}

/** 点【×】（删元素）：先弹确认，真删在 `confirmPending`（取消 ⇒ 草稿一个字不动） */
function requestRemoveState(code: string): void {
  pending.value = { kind: 'state', code }
}

/** 点提示词块的【×】：同样先确认 */
function requestRemovePrompt(id: string): void {
  pending.value = { kind: 'prompt', id }
}

/** 提示词块真的删掉：同样要把它从每个节点的 `reads` 里摘掉 */
function removePrompt(id: string): void {
  updateCard((current) => ({
    ...current,
    prompts: current.prompts.filter((prompt) => prompt.id !== id),
    chain: current.chain.map((node) => ({ ...node, reads: node.reads.filter((ref0) => ref0 !== id) })),
  }))
  if (selectedPromptId.value === id) selectedPromptId.value = null
}

/** 确认层的「确定」：删元素 / 删提示词 / 换时间模式 / 带着改动离开；确认按钮的字由 `pendingConfirmLabel` 给 */
function confirmPending(): void {
  const target = pending.value
  pending.value = null
  if (!target) return
  if (target.kind === 'state') removeState(target.code)
  else if (target.kind === 'prompt') removePrompt(target.id)
  else if (target.kind === 'mode') updateCard((current) => setTimeMode(current, target.mode))
  else location.hash = routeHash({ name: 'home' })
}

/**
 * 改某一格的模型预设：卡模式写 `tg2.nodeModels[cardId]`（整张表连别的卡那几片一起写回）；
 * 存档模式写进**这一份存档自己的** `nodeModels`，卡的映射一个字不动。
 */
function choosePreset(nodeId: string, presetId: string): void {
  try {
    nodePresets.value = { ...nodePresets.value, [nodeId]: presetId }
    if (editingSave) {
      // 映射不属于卡草稿：只换存档那一份的 nodeModels，快照一个字不动
      const current = save.value
      if (!current) return
      const nextSave: Save = { ...current, nodeModels: { ...nodePresets.value } }
      const entries = storage()
        .loadSaveEntries()
        .map((entry) => (entry.save?.id === nextSave.id ? { raw: nextSave, save: nextSave } : entry))
      storage().saveSavesLoose(entries.map((entry) => entry.raw))
      save.value = nextSave
      return
    }
    if (cardId === undefined) return
    models.value = { ...models.value, [cardId]: nodePresets.value }
    storage().saveNodeModels(models.value)
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

/**
 * 栏宽的夹取：左 / 右各自 [min, max]，**并且中栏不许小于 320**（CONTRACT §8.2）。
 *
 * 所以每条栏的上限不是写死的常数，而是「当前可用宽度」：
 * `可用 = 总宽 - 另一栏 - 细条 - 中栏最小 - 两条分隔条`，再与自己那一档的 max 取小。
 * 1280 宽、右栏 320 时左栏能到 480；右栏 390 时左栏就只能到 462 —— 中栏那 320 谁也挤不掉。
 * （窗口本身窄到连中栏 320 都放不下时，退回各栏自己的 min：那时哪一栏都不该被压成 0。）
 */
function clampWidth(px: number, range: { min: number; max: number }, room: number): number {
  const ceiling = Math.max(range.min, Math.min(range.max, room))
  return Math.round(Math.min(ceiling, Math.max(range.min, px)))
}

// 这一栏最多能有多宽：把另一栏、细条、中栏最小与分隔条都先扣掉
function roomFor(which: 'left' | 'right'): number {
  const width = rowEl.value?.clientWidth ?? 0
  const other = which === 'left' ? columns.right : columns.left
  return width - other - STRIP_WIDTH - MIDDLE_MIN - SPLITTER_WIDTH * 2
}

function persistColumns(): void {
  try {
    const settings = storage().loadSettings()
    storage().saveSettings({
      ...settings,
      editorColumns: { left: Math.round(columns.left), right: Math.round(columns.right) },
    })
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

/**
 * 拖分隔条：分隔条**跟着指针走** —— 两条分隔条各自贴在「它右边那一栏」的左边缘上。
 *   · 左分隔条在左栏右侧：往右拖 ⇒ 左栏变宽（`+dx`）；
 *   · 右分隔条在右栏左侧：往左拖 ⇒ 右栏变宽（`-dx`）。
 * 双击恢复默认 280 / 320；松手那一刻落盘（拖的过程里不写盘，免得每次 pointermove 都刷一遍 localStorage）。
 */
function startDrag(which: 'left' | 'right', event: PointerEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = which === 'left' ? columns.left : columns.right
  // 拖动中：左栏吃正向位移、右栏吃反向位移，各自夹在允许区间里
  const move = (moveEvent: PointerEvent) => {
    const dx = moveEvent.clientX - startX
    if (which === 'left') columns.left = clampWidth(startWidth + dx, LEFT, roomFor('left'))
    else columns.right = clampWidth(startWidth - dx, RIGHT, roomFor('right'))
  }
  // 松手：摘掉两个监听，并把这一档栏宽落盘
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    persistColumns()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function resetColumns(which: 'left' | 'right'): void {
  if (which === 'left') columns.left = DEFAULT_SETTINGS.editorColumns.left
  else columns.right = DEFAULT_SETTINGS.editorColumns.right
  persistColumns()
}

/** 【返回】：草稿脏的时候先问一句，确认才真的离开 */
function goBack(): void {
  if (dirty.value) {
    pending.value = { kind: 'back' }
    return
  }
  location.hash = routeHash({ name: 'home' })
}
</script>

<template>
  <div class="page" data-page="editor">
    <header class="page-bar">
      <button type="button" data-back @click="goBack">{{ t('nav.back') }}</button>
      <span class="page-title ellipsis">{{ title }}</span>
      <span class="repo-center">
        <a class="repo-url" :href="REPO_URL" :data-repo-url="REPO_URL" target="_blank" rel="noopener">{{
          REPO_URL
        }}</a>
      </span>
      <button type="button" data-save-card :disabled="!card" @click="saveCard">{{ t('editor.save') }}</button>
      <span v-if="savedOk" class="save-ok" data-save-ok>{{ t('editor.saveOk') }}</span>
    </header>

    <ErrorPanel v-if="error" :error="error" />

    <div v-if="saveIssues.length > 0" class="save-errors" data-save-errors>
      <span class="save-failed">{{ t('editor.saveFailed') }}</span>
      <button
        v-for="(issue, at) in saveIssues"
        :key="`${issue.code}-${issue.path}-${at}`"
        type="button"
        class="save-error"
        data-save-error
        :data-save-error-code="issue.code"
        @click="selectIssue(issue)"
      >
        {{
          issue.code === ''
            ? issue.message
            : t('editor.saveErrorLine', { code: issue.code, message: issue.message })
        }}
      </button>
    </div>

    <div v-if="card" ref="rowEl" class="page-body editor-row">
      <section class="col" data-col="left" :style="{ width: `${columns.left}px` }">
        <StateTree
          :elements="card.state"
          :node="selectedNode"
          :selected-code="selectedCode"
          :structure-locked="editingSave"
          @add="addState"
          @select="selectElement"
          @remove="requestRemoveState"
          @add-child="addChildOf"
          @toggle-read="(code, tri) => toggleRef('reads', code, tri)"
          @toggle-write="(code, tri) => toggleRef('writable', code, tri)"
        />
      </section>

      <div
        class="splitter"
        data-splitter="left"
        role="separator"
        aria-orientation="vertical"
        @pointerdown="startDrag('left', $event)"
        @dblclick="resetColumns('left')"
      ></div>

      <WorkflowStrip
        :nodes="card.chain"
        :selected-id="selectedNodeId"
        :reads-upstream="selectedNode?.readsUpstream ?? []"
        @select="selectNode"
        @toggle-read="(id) => toggleRef('readsUpstream', id)"
      />

      <section class="col middle" data-col="middle">
        <div class="panel-head">
          <div class="col-title" data-panel-title>
            <span class="ellipsis">{{ middleTitle }}</span>
          </div>
        </div>
        <div class="middle-body">
          <NodeForm
            v-if="selectedNode"
            :node="selectedNode"
            :presets="presets"
            :preset-id="presetIdFor(selectedNode.id)"
            @patch="(patch) => patchNode(selectedNode!.id, patch)"
            @preset="(presetId) => choosePreset(selectedNode!.id, presetId)"
          />
          <StateForm
            v-else-if="selectedElement"
            :element="selectedElement"
            :state="card.state"
            :initial-locked="editingSave"
            :current-value="currentValue"
            @edit="(element) => patchElement(selectedElement!.code, element)"
            @retype="(type, select) => retypeElement(selectedElement!.code, type, select)"
            @initial="setInitialValue"
            @time-mode="requestTimeMode"
          />
          <PromptForm
            v-else-if="selectedPrompt"
            :prompt="selectedPrompt"
            @patch="(patch) => patchPrompt(selectedPrompt!.id, patch)"
          />
          <div v-else data-empty-middle></div>
        </div>
      </section>

      <div
        class="splitter"
        data-splitter="right"
        role="separator"
        aria-orientation="vertical"
        @pointerdown="startDrag('right', $event)"
        @dblclick="resetColumns('right')"
      ></div>

      <section class="col" data-col="right" :style="{ width: `${columns.right}px` }">
        <PromptList
          :prompts="card.prompts"
          :selected-id="selectedPromptId"
          :node="selectedNode"
          @add="addPrompt"
          @select="selectPrompt"
          @remove="requestRemovePrompt"
          @toggle-read="(id) => toggleRef('reads', id)"
        />
      </section>
    </div>

    <ConfirmDialog
      v-if="pending"
      :message="pendingMessage"
      :confirm-label="pendingConfirmLabel"
      @confirm="confirmPending"
      @cancel="cancelPending"
    />
  </div>
</template>

<style scoped>
/*
 * 页栏标题给正中的库址让位：链接半宽约 101px + 左起（内边距 12 + 返回 43 + 间隔 8 = 63）
 * + 约 20px 间隙 ⇒ 最多占页栏内容宽的一半再减 172。名字再长就省略号（`.ellipsis` 已有
 * min-width:0 / overflow:hidden / text-overflow:ellipsis / white-space:nowrap），不许伸进链接。
 */
.page-title {
  max-width: calc(50% - 172px);
}

.editor-row {
  align-items: stretch;
}

/* 保存成功的提示：页栏里的一小行次要文字 */
.save-ok {
  font-size: var(--fs3);
  color: var(--ink-soft);
}

/* 保存失败：页栏下面一条可换行的清单，每条都能点回那一格 */
.save-errors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.save-failed {
  font-size: var(--fs2);
  color: var(--danger);
}

.save-error {
  text-align: left;
}

.col {
  flex: 0 0 auto;
  min-width: 0;
  min-height: 0;
  background: var(--panel);
  overflow: hidden;
}

.col.middle {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.middle-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.splitter {
  flex: 0 0 auto;
  width: 6px;
  cursor: col-resize;
  background: var(--bg-2);
  border-left: 1px solid var(--line);
  border-right: 1px solid var(--line);
}

.splitter:hover {
  background: var(--line);
}
</style>
