<script setup lang="ts">
/**
 * 卡带编辑器（SPEC §5）：左状态树（可拖宽）· 工作流细条（固定宽）· 中编辑（可拖）· 右公共提示词（可拖）。
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
import PromptList from '../components/PromptList.vue'
import StateForm from '../components/StateForm.vue'
import StateTree from '../components/StateTree.vue'
import WorkflowStrip from '../components/WorkflowStrip.vue'
import { asAppError, storage } from '../app-context'
import { nextPromptId, nextStateCode } from '../cards'
import { AppError } from '../core/errors'
import { DEFAULT_SETTINGS } from '../core/storage'
import type { Card, ChainNode, NodeModels, Preset, PromptBlock, StateElement } from '../core/types'
import { t } from '../i18n'
import { routeHash } from '../router'

const props = defineProps<{ cardId: string }>()

const LEFT = { min: 200, max: 480 }
const RIGHT = { min: 240, max: 560 }
const MIDDLE_MIN = 320
const STRIP_WIDTH = 96
const SPLITTER_WIDTH = 6

const cards = ref<Card[]>([])
const card = ref<Card | null>(null)
const presets = ref<Preset[]>([])
const models = ref<NodeModels>({})
const error = ref<AppError | null>(null)
const selectedNodeId = ref<string | null>(null)
const selectedCode = ref<string | null>(null)
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

const sliceOf = (cardId: string): Record<string, string> => models.value[cardId] ?? {}

/** 某一格当前用的预设 id：映射里有就用它，没有就是池子第一个（`''` = 一个预设都没有） */
function presetIdFor(nodeId: string): string {
  return sliceOf(props.cardId)[nodeId] ?? presets.value[0]?.id ?? ''
}

onMounted(() => {
  try {
    cards.value = storage().loadCards()
    const found = cards.value.find((item) => item.id === props.cardId)
    if (!found) {
      throw new AppError('E_VALIDATION', { message: t('error.missingCard'), nextStep: t('next.home') })
    }
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

function persist(next: Card): void {
  card.value = next
  cards.value = cards.value.map((item) => (item.id === next.id ? next : item))
  storage().saveCards(cards.value)
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

/** 眼睛：把某个引用塞进/拿出当前节点的 `reads` 或 `writable` */
function toggleRef(field: 'reads' | 'writable', ref0: string): void {
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
}

function selectElement(code: string): void {
  selectedCode.value = code
  selectedNodeId.value = null
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
}

function choosePreset(nodeId: string, presetId: string): void {
  try {
    models.value = { ...models.value, [props.cardId]: { ...sliceOf(props.cardId), [nodeId]: presetId } }
    storage().saveNodeModels(models.value)
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

/** 中栏能用的宽度（右栏固定时左栏的上限）——中栏不得小于 `MIDDLE_MIN` */
function clampLeft(px: number): number {
  const width = rowEl.value?.clientWidth ?? 0
  const room = width - columns.right - STRIP_WIDTH - MIDDLE_MIN - SPLITTER_WIDTH * 2
  return Math.round(Math.min(LEFT.max, Math.max(LEFT.min, Math.min(px, room))))
}

function clampRight(px: number): number {
  const width = rowEl.value?.clientWidth ?? 0
  const room = width - columns.left - STRIP_WIDTH - MIDDLE_MIN - SPLITTER_WIDTH * 2
  return Math.round(Math.min(RIGHT.max, Math.max(RIGHT.min, Math.min(px, room))))
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
 * 拖分隔条：位移**直接加到那一栏的宽度**上（往左拖 = 变窄），双击恢复默认 280 / 320。
 * 松手那一刻落盘（拖的过程里不写盘，免得每次 pointermove 都刷一遍 localStorage）。
 */
function startDrag(which: 'left' | 'right', event: PointerEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = which === 'left' ? columns.left : columns.right
  // 拖动中：位移直接加到那一栏的宽度上，夹在允许区间里
  const move = (moveEvent: PointerEvent) => {
    const width = startWidth + (moveEvent.clientX - startX)
    if (which === 'left') columns.left = clampLeft(width)
    else columns.right = clampRight(width)
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

      <WorkflowStrip :nodes="card.chain" :selected-id="selectedNodeId" @select="selectNode" />

      <section class="col middle" data-col="middle">
        <NodeForm
          v-if="selectedNode"
          :node="selectedNode"
          :is-first="selectedNode.id === card.chain[0].id"
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
        <div v-else class="empty-middle muted" data-empty-middle>{{ t('editor.emptyMiddle') }}</div>
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
          :node="selectedNode"
          @add="addPrompt"
          @patch="patchPrompt"
          @remove="removePrompt"
          @toggle-read="(id) => toggleRef('reads', id)"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
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

.empty-middle {
  padding: 16px;
}
</style>
