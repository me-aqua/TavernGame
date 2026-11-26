<script setup lang="ts">
/**
 * 游戏卡编辑器（SPEC §5）：左状态树（可拖宽）· 工作流细条（固定宽）· 中编辑（可拖）· 右公共提示词（可拖）。
 *
 * 三条口径：
 *   · **没有保存按钮**：字段一改就落 `tg2.cards`（切页、刷新都在）；
 *   · **模型不进卡**：中栏那一格改的是本机映射 `tg2.nodeModels[cardId][nodeId]`；
 *     这张卡第一次打开时会铺一条「每个节点 → 池子里第一个预设」的映射（没有预设就不铺，
 *     写空串只会制造假数据）；
 *   · **自由度只有两个**（左宽、右宽），中栏恒为余量；细条宽度固定，不参与拖拽。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import ErrorPanel from '../components/ErrorPanel.vue'
import NodeForm from '../components/NodeForm.vue'
import PromptForm from '../components/PromptForm.vue'
import PromptList from '../components/PromptList.vue'
import StateForm from '../components/StateForm.vue'
import StateTree from '../components/StateTree.vue'
import WorkflowStrip from '../components/WorkflowStrip.vue'
import { asAppError, storage } from '../app-context'
import { nextPromptId, nextStateCode } from '../cards'
import { AppError } from '../core/errors'
import { validateCard } from '../core/schema'
import { DEFAULT_SETTINGS } from '../core/storage'
import type { Card, ChainNode, NodeModels, Preset, PromptBlock, StateElement } from '../core/types'
import { t } from '../i18n'
import { REPO_URL } from '../repo'
import { routeHash } from '../router'

const props = defineProps<{ cardId: string }>()

const LEFT = { min: 200, max: 480 }
const RIGHT = { min: 240, max: 560 }
/** 中栏的最小宽度（CONTRACT §8.2）：两条分隔条都夹着它，先扣掉再谈左右能多宽 */
const MIDDLE_MIN = 320
const STRIP_WIDTH = 96
const SPLITTER_WIDTH = 6

const card = ref<Card | null>(null)
const presets = ref<Preset[]>([])
const models = ref<NodeModels>({})
const error = ref<AppError | null>(null)
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

/** 中栏标题：编辑·<当前选中对象的名字>；什么都没选就是「编辑」 */
const middleTitle = computed(() => {
  if (selectedNode.value) return t('editor.editTitle', { name: selectedNode.value.name })
  if (selectedElement.value) return t('editor.editTitle', { name: selectedElement.value.name })
  if (selectedPrompt.value) return t('editor.editTitle', { name: selectedPrompt.value.title })
  return t('editor.editTitleEmpty')
})

const sliceOf = (cardId: string): Record<string, string> => models.value[cardId] ?? {}

/** 某一格当前用的预设 id：映射里有就用它，没有就是池子第一个（`''` = 一个预设都没有） */
function presetIdFor(nodeId: string): string {
  return sliceOf(props.cardId)[nodeId] ?? presets.value[0]?.id ?? ''
}

onMounted(() => {
  try {
    // 只按 id 校验要打开的这一张：盘上别的坏卡与它无关
    const found = storage().loadCardById(props.cardId)
    card.value = found
    presets.value = storage().loadPresets()
    models.value = storage().loadNodeModels()
    const settings = storage().loadSettings()
    columns.left = settings.editorColumns.left
    columns.right = settings.editorColumns.right

    if (!models.value[props.cardId] && presets.value.length > 0) {
      const first = presets.value[0].id
      models.value = {
        ...models.value,
        [props.cardId]: Object.fromEntries(found.chain.map((node) => [node.id, first])),
      }
      storage().saveNodeModels(models.value)
    }
  } catch (cause) {
    error.value = asAppError(cause)
  }
})

/**
 * 落盘一张卡：**先验后写** —— 不合法的中间态既不进内存、也不进 localStorage。
 *
 * 写的是**逐条读回来的整张表**（`loadCardEntries()`），只把这一张换掉再宽松写回：
 * 盘上别的卡（包括不合法的那些）**JSON 值**不变（空白 / 数字写法会被重新序列化，不承诺字节逐字相同）。
 */
function persist(next: Card): void {
  try {
    validateCard(next)
  } catch (cause) {
    error.value = asAppError(cause)
    return
  }
  const entries = storage()
    .loadCardEntries()
    .map((entry) => (entry.card?.id === next.id ? { raw: next, card: next } : entry))
  storage().saveCardsLoose(entries.map((entry) => entry.raw))
  card.value = next
}

function updateCard(mutate: (current: Card) => Card): void {
  const current = card.value
  if (!current) return
  try {
    persist(mutate(current))
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

function patchNode(nodeId: string, patch: Partial<ChainNode>): void {
  updateCard((current) => ({
    ...current,
    chain: current.chain.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
  }))
}

function patchElement(code: string, patch: Partial<StateElement>): void {
  updateCard((current) => ({
    ...current,
    state: current.state.map((element) => (element.code === code ? { ...element, ...patch } : element)),
  }))
}

/** 眼睛：把某个引用塞进/拿出当前节点的 `reads` / `writable` / `readsUpstream` */
function toggleRef(field: 'reads' | 'writable' | 'readsUpstream', ref0: string): void {
  const node = selectedNode.value
  if (!node) return
  const list = node[field]
  patchNode(node.id, {
    [field]: list.includes(ref0) ? list.filter((item) => item !== ref0) : [...list, ref0],
  })
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
    type: 'string',
    initial: '',
  }
  updateCard((card0) => ({ ...card0, state: [...card0.state, element] }))
  selectElement(code)
}

/** 删元素要顺手把引用它的 `reads` / `writable` 一起摘掉，否则卡会变成「悬空引用」 */
function removeState(code: string): void {
  updateCard((current) => ({
    ...current,
    state: current.state.filter((element) => element.code !== code),
    chain: current.chain.map((node) => ({
      ...node,
      reads: node.reads.filter((ref0) => ref0 !== code),
      writable: node.writable.filter((item) => item !== code),
    })),
  }))
  if (selectedCode.value === code) selectedCode.value = null
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

/** 删提示词块：同样要把它从每个节点的 `reads` 里摘掉 */
function removePrompt(id: string): void {
  updateCard((current) => ({
    ...current,
    prompts: current.prompts.filter((prompt) => prompt.id !== id),
    chain: current.chain.map((node) => ({ ...node, reads: node.reads.filter((ref0) => ref0 !== id) })),
  }))
  if (selectedPromptId.value === id) selectedPromptId.value = null
}

function choosePreset(nodeId: string, presetId: string): void {
  try {
    models.value = { ...models.value, [props.cardId]: { ...sliceOf(props.cardId), [nodeId]: presetId } }
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

function goBack(): void {
  location.hash = routeHash({ name: 'home' })
}
</script>

<template>
  <div class="page" data-page="editor">
    <header class="page-bar">
      <button type="button" data-back @click="goBack">{{ t('nav.back') }}</button>
      <span class="page-title ellipsis">{{ card ? card.name : cardId }}</span>
      <span class="repo-center">
        <a class="repo-url" :href="REPO_URL" :data-repo-url="REPO_URL" target="_blank" rel="noopener">{{
          REPO_URL
        }}</a>
      </span>
    </header>

    <ErrorPanel v-if="error" :error="error" />

    <div v-if="card" ref="rowEl" class="page-body editor-row">
      <section class="col" data-col="left" :style="{ width: `${columns.left}px` }">
        <StateTree
          :elements="card.state"
          :node="selectedNode"
          :selected-code="selectedCode"
          @add="addState"
          @select="selectElement"
          @remove="removeState"
          @toggle-read="(code) => toggleRef('reads', code)"
          @toggle-write="(code) => toggleRef('writable', code)"
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
            @patch="(patch) => patchElement(selectedElement!.code, patch)"
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
          @remove="removePrompt"
          @toggle-read="(id) => toggleRef('reads', id)"
        />
      </section>
    </div>
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
