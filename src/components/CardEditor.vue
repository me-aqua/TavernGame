<script setup lang="ts">
/**
 * 卡界面：四栏外壳里的**枝树 + 中栏那一屏**（设置面板「查看 / 编辑卡图」打开它）。
 *
 * 中栏按**一个**「当前编辑对象」画四态（票 73 · 段 8c-① 把它接成一条轴；票 8d-① 长出第三种形态）：
 * 一步 ⇒ 编屏（`StepForm`）· 一格状态 ⇒ 可写字段表（`BranchForm`）· 一块显示 ⇒ `DisplayForm` ·
 * 都没选 ⇒ 显式空态。三个入口：细条点一步（`@select`）、左栏树点一行（`@pick`）、
 * 左栏那颗「显示块」（`@click`）—— 点谁谁赢，另两轴随之清掉；
 * 形态按决定 #24：绝对定位的浮层盖在故事上，不挤占正文，四栏骨架是 `EditorShell` 的事。
 * **三族草稿各有一层**：「编一步」那一族在 `useStepDraft.ts`（票 77），另一格那一族（树 / 字段表 /
 * 唯一那条写路径 / 脏守卫）在 `useBranchDraft.ts`（票 80），「编一块显示」那一族在
 * `useDisplayDraft.ts`（票 8d-①）—— 这里只剩那一条轴与接线。
 *
 * **写路径只有一条**（8b-② 立的，8c-② 让「编一步」也走它，8d-① 让「编一块显示」也走它）：
 * 说明 / 加字段 / 删字段 / 一步的六个键 / 一块显示的四个键**都只动草稿**，点顶栏那颗「保存」
 * 才落卡 —— **深拷整份卡 → 只改这几处 → `importCard`（先校验后落盘）→ 失败只报不改**；
 * 成功只 emit `saved`，reload 是外层的事。
 *
 * ⚠️ **草稿不许被无声丢掉**：资源库面板那条 `saved` 撞上脏草稿时先在底栏问一句（`[data-editor-confirm]`，
 *    两条出路见 `keepDraft` / `discardDraft`）；关窗 / 刷新也只在**有草稿**时挂那条 `beforeunload`。
 *
 * ⚠️ **卡的知识只走这一条路**：树与表都在 `useBranchDraft.ts` 里从 `card.state` 现算，子组件只画收到的行 ——
 *    于是「组件层绿、真浏览器红」那种两份走法漂移没有了。
 * ⚠️ **什么进树**：这一格自己有一张**非空字段表**才进树（元素是标量的 `list` 点进去是一张空表，不是一格）；树是**逐层向下**（宽度优先）展开的，行的先后不承诺（裁决 4）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BranchForm from './BranchForm.vue'
import CardResources from './CardResources.vue'
import DisplayForm from './DisplayForm.vue'
import EditorShell from './EditorShell.vue'
import StateTreeNav from './StateTreeNav.vue'
import StepForm from './StepForm.vue'
import { useBranchDraft } from './useBranchDraft'
import { useDisplayDraft } from './useDisplayDraft'
import { useStepDraft } from './useStepDraft'
import { cardMeta, type CardSource } from '../game/current-card'
import type { CardData } from '../game/card'

const { t } = useI18n()

const props = defineProps<{ card: CardData; source: CardSource }>()

/** 三个「＋」各自抛一个事件（真的改卡是各自的票的事）；`close` / `saved` 是外壳那两颗按钮 */
const emit = defineEmits<{ close: []; saved: []; 'add-branch': []; 'add-action': []; 'add-step': [] }>()

/**
 * 中栏正在编的**那一个**对象 —— 一格状态（枝）· 一步节点 · 一块显示，**三者只会有一个**。
 *
 * ⚠️ 「当前编辑对象」只留这一个：几个入口的高亮与中栏画哪一屏全由它派生 ⇒ 树与细条
 *    **结构上不可能同时亮**（写成两个 `ref` 再靠"点谁清谁"的规则维持，就是等哪天漏一处）。
 * `null` = 还没选（开屏不自动选第 1 步）。
 */
const target = ref<
  { kind: 'branch'; path: string } | { kind: 'step'; id: string } | { kind: 'display' } | null
>(null)
/** 树上选中的那一格（卡里的点号路径）；空串 = 那一轴没亮 */
const picked = computed(() => (target.value?.kind === 'branch' ? target.value.path : ''))
/**
 * 细条里选中的那一步（节点 id）；空串 = 那一轴没亮。
 *
 * ⚠️ 它**可写**：写它就是"选中那一步"（`useStepDraft.pickStep` 走的就是它）——
 *    两条轴仍然落在**同一个 `target`** 上 ⇒ 结构上不可能同时亮。
 */
const selected = computed({
  get: () => (target.value?.kind === 'step' ? target.value.id : ''),
  set: (id: string) => (target.value = { kind: 'step', id }),
})
/**
 * 「编一步」那一族（草稿 / 候选 / 脏 / 落卡）—— 票 77 从本文件搬出去的。
 *
 * ⚠️ **把要用的几样在顶层解出来**：模板只自动解包 setup 顶层的 ref；挂成一个 `steps` 对象再用
 *    `steps.stepValues` 取，拿到的是 **ref 本身**（`v-bind` 展开成空、`v-if` 恒真）—— 实测踩过一次。
 */
const steps = useStepDraft({ card: () => props.card, selected })
const { roster, stepValues, pickStep, setStepText, setStepPick } = steps

/**
 * 「编一块显示」那一族（草稿 / 选中号 / 脏 / 写进深拷卡）—— 票 8d-① 新增的那个新件。
 *
 * ⚠️ **草稿的底是 `steps.shown`**（屏上那张卡：存过就以存下去的那份为准）—— 存完之后草稿与它
 *    逐字相同、顶栏那颗按钮自己变回按不动，本族不必另记一份"刚存过"。
 */
const {
  entries: displayEntries,
  at: displayAt,
  dirty: displayDirty,
  pick: pickBlock,
  add: addBlock,
  setField: setDisplayField,
  applyTo: applyDisplay,
} = useDisplayDraft({ shown: () => steps.shown.value })

/**
 * 「另一格」那一族（树 / 字段表 / 草稿 / 唯一那条写路径 / 脏守卫）—— 票 80 从本文件搬出去的。
 *
 * ⚠️ **同样在顶层解构**：模板直接读下面这些名字，而挂成对象再取（`family.navRows`）拿到的是
 *    **ref 本身**。另外两族的 `dirty` / `applyTo` / `markSaved` 从这里喂给新件，那边只调不用。
 */
const {
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
} = useBranchDraft({
  card: () => props.card,
  picked: () => picked.value,
  // 三族草稿搭**同一条**写路径（那三件的形状一样）：脏是并集，落卡时各自写进**同一份**深拷卡
  steps: {
    dirty: computed(() => steps.dirty.value || displayDirty.value),
    // 落卡：两族各自写进**同一份**深拷卡（一个动 `graph.nodes`、一个动 `display`，先后无所谓）
    applyTo: (next) => {
      steps.applyTo(next)
      applyDisplay(next)
    },
    // 显示块那一族读的就是 `steps.shown` ⇒ 那一边记下刚存的那份，它就跟着变，不必另记
    markSaved: steps.markSaved,
  },
  onSaved: () => emit('saved'),
})
onBeforeUnmount(() => dispose())

/** 资源库面板开着没有（顶栏那颗按钮开合它） */
const resourcesOpen = ref(false)

const meta = computed(() => cardMeta(props.card))
const sourceLabel = computed(() =>
  props.source === 'imported' ? t('card.sourceImported') : t('card.sourceBuiltin'),
)
/** 顶栏那一行身份（外壳只负责画） */
const metaLine = computed(() =>
  t('card.meta', { name: meta.value.name, version: meta.value.version, source: sourceLabel.value }),
)

/** 点树上的一行：中栏换成那一格的字段表（另两轴随之清掉） */
function pick(path: string): void {
  target.value = { kind: 'branch', path }
}

/** 左栏那颗「显示块」：中栏换成第三形态（另两轴随之清掉） */
function openDisplay(): void {
  target.value = { kind: 'display' }
}

/**
 * 第三形态那颗「＋」：路径挑左栏树上**第一枝没被画过、容器是 `object` 的**（树序）——
 * 它要与新条目的格式相符（格式取词表第一个 `key-value` ⇒ 要 `object` 容器）；挑不出来就给空串，
 * 保存会被卡照常拒掉、界面只报不改。
 */
function addDisplayBlock(): void {
  const drawn = new Set(displayEntries.value.map((entry) => entry.path))
  const free = navRows.value.find((row) => row.kind === 'object' && !drawn.has(row.path))
  addBlock(free === undefined ? '' : free.path)
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
        <!-- 左栏：进第三形态那颗按钮 + 卡声明的那棵状态树（选一格就在中栏编它） -->
        <template #content>
          <button type="button" data-display-open class="open-display" @click="openDisplay">
            {{ t('card.displayOpen') }}
          </button>
          <StateTreeNav :rows="navRows" :picked="picked" @pick="pick" />
        </template>

        <!-- 中栏四态：一步（编屏）· 一格（可写字段表）· 一块显示（四个键）· 都没选（显式空态） -->
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
          <DisplayForm
            v-else-if="target?.kind === 'display'"
            :entries="displayEntries"
            :at="displayAt"
            @pick="pickBlock"
            @field="setDisplayField"
            @add="addDisplayBlock"
          />
          <p v-else data-branch-none class="none">{{ t('card.branchNone') }}</p>
        </template>

        <!-- 第四栏：公共提示词的读与改（还是资源库面板那套；换成新表单是 8d-② 的事） -->
        <template #prompts>
          <CardResources v-if="resourcesOpen" :card="card" error="" @saved="onResourceSaved" />
        </template>
      </EditorShell>

      <!-- 面板那颗「存回卡」撞上没保存的草稿：问一句再决定丢不丢（它不占四栏的栅格） -->
      <div v-if="discardAsk" data-editor-confirm class="confirm">
        <p class="m-0 min-w-0 flex-1">{{ t('card.discardDraft') }}</p>
        <button type="button" data-editor-confirm-cancel class="confirm-btn" @click="keepDraft">
          {{ t('card.discardCancel') }}
        </button>
        <button type="button" data-editor-confirm-continue class="confirm-btn go" @click="discardDraft">
          {{ t('card.discardContinue') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 左栏那颗进「编一块显示」的按钮：整行宽 + ≥24 高（整页巡检的下限），长相照「＋」那一族 */
.open-display {
  display: block;
  width: 100%;
  min-height: 24px;
  margin-bottom: var(--s1);
  padding: 0 var(--s1);
  border: 1px dashed var(--color-line);
  border-radius: var(--r1);
  background: none;
  color: var(--color-accent);
  font-family: inherit;
  font-size: var(--fs2);
  text-align: left;
  cursor: pointer;
}
/* 还没编任何一格时的显式空态（字号只用三档里的一档） */
.none {
  margin: 0;
  font-size: var(--fs2);
  color: var(--color-faint);
}
/* 确认条：编辑器浮层的底栏（不占四栏的栅格；字号与间距走尺度 token，布局那几样走 tailwind） */
.confirm {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: var(--s2) var(--s3);
  border-top: 1px solid var(--color-line);
  background: var(--color-surface-2);
  color: var(--color-text);
  font-size: var(--fs2);
}
.confirm-btn {
  flex: none;
  min-height: 24px;
  padding: 0 var(--s2);
  border: 1px solid var(--color-line);
  border-radius: var(--r2);
  background: var(--color-surface);
  color: var(--color-muted);
  font: inherit;
  cursor: pointer;
}
/* 「继续」会丢掉草稿：用危险色，别与「取消」长成一个样 */
.confirm-btn.go {
  border-color: var(--color-danger);
  color: var(--color-danger);
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
