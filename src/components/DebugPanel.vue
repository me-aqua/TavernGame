<script setup lang="ts">
/**
 * 调试面板：卡图 / 引擎状态 / 工具调用三块（设计第 13 节；只在调试模式渲染）。
 *
 * 三块都在说同一件事：**引擎照卡做了什么** ——
 *   · 卡图是活的：正在跑的节点高亮，被 redo 退回过 / 工具失败的节点标红；
 *   · 引擎状态是这一局的真值（四个顶层分支 + 时间 + 回合 + 本轮写入），还能切到
 *     这一轮还没提交的**工作副本**（事务在跑时它在变，提交 / 回滚后就没了）；
 *   · 工具调用一次一行：哪个节点、什么工具、原始参数、引擎回传的结果、写到了哪条路径。
 *
 * ⚠️ 它**只读**：切页签与切「权威 / 草稿」只改这一层的显示，没有一颗按钮会动游戏状态
 *    （「调试面板成了第二个写入口」正是设计要避免的事）。
 *
 * 数据全部由外层从 store 传入（组件的 props 是纯数据）——状态树的渲染走引擎自己的
 * renderState，界面不另写一套「怎么念状态」。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CardGraph from './CardGraph.vue'
import { format } from '../game/card-calendar'
import { clockIn } from '../game/card-time'
import { renderState, type StateTree } from '../game/card-state'
import { nodeLabel } from '../game/display'
import type { CardData } from '../game/card'
import type { GameData } from '../types/state'
import type { StateWrite, ToolCall } from '../stores/game'

const { t } = useI18n()

const props = defineProps<{
  /** 当前卡（卡图与节点名都从它来） */
  card: CardData
  /** 权威状态树 */
  state: StateTree
  /** 权威时刻（按卡的历法渲染好的文本） */
  timeLabel: string
  /** 权威回合数 */
  turn: number
  /** 这一轮的工作副本；没有回合在跑时是 null */
  draft: GameData | null
  /** 本轮写入清单（stateChange 序列） */
  writes: StateWrite[]
  /** 最近一轮的工具调用（事件流的投影） */
  tools: ToolCall[]
  /** 正在跑的节点 id */
  running: string | null
  /** 要标红的节点 id（退回过 / 工具失败过） */
  failed: string[]
  /** 一打开看哪一块（故事与冒烟用；面板自己管之后的切换） */
  initialTab?: 'graph' | 'state' | 'tools'
  /** 一打开就切到工作副本（故事用） */
  initialDraft?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

/** 三块的页签名（顺序即展示顺序） */
const TABS = [
  { tab: 'graph', key: 'debug.tabGraph' },
  { tab: 'state', key: 'debug.tabState' },
  { tab: 'tools', key: 'debug.tabTools' },
] as const

type Tab = (typeof TABS)[number]['tab']

/** 现在看哪一块 */
const tab = ref<Tab>(props.initialTab ?? 'graph')

/** 引擎状态看的是哪一份：关 = 权威状态，开 = 这一轮的工作副本 */
const draftOn = ref(props.initialDraft ?? false)

/** 真切到草稿了才换数据源：没有回合在跑时草稿是空的，切换按钮也点不动 */
const showingDraft = computed(() => draftOn.value && props.draft !== null)

/** 正在展示的状态树 */
const shownTree = computed<StateTree>(() => (showingDraft.value ? props.draft!.state : props.state))

/** 正在展示的时刻（草稿那份从它自己的状态树里现取，按同一张卡的历法念） */
const shownTime = computed(() =>
  showingDraft.value ? format(props.card.time.calendar, clockIn(props.draft!.state)) : props.timeLabel,
)

/** 正在展示的回合数 */
const shownTurn = computed(() => (showingDraft.value ? props.draft!.meta.turn : props.turn))

/** 状态树的顶层分支（四个分支各占一格，逐层展开）——渲染交给引擎自己的 renderState */
const branches = computed(() =>
  Object.entries(shownTree.value).map(([name, value]) => ({ name, text: renderState({ [name]: value }) })),
)

/** 工具清单里的节点名（id → 卡里的显示名；图还没跑起来时说明这件事） */
function nodeNameOf(id: string | null): string {
  return id === null ? t('debug.noNode') : nodeLabel(props.card, id)
}

/** 写入清单里的一条：路径 ← 值（值的形状由卡决定，原样打印 JSON） */
function writeText(write: StateWrite): string {
  return write.path + ' \u2190 ' + JSON.stringify(write.value)
}

const tabButton = 'rounded-full border px-2.5 py-1 text-[11px] transition-colors'
const tabOn = 'border-accent-line bg-accent-soft text-accent'
const tabOff = 'border-line/70 bg-surface/70 text-faint hover:text-muted'
const box = 'rounded-lg border border-line bg-page px-3 py-2'
</script>

<template>
  <section
    data-debug-panel
    role="dialog"
    :aria-label="t('debug.title')"
    class="absolute inset-x-0 bottom-0 z-40 flex max-h-[62vh] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface/95 shadow-2xl backdrop-blur-md"
  >
    <header class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line/60 px-3 py-2">
      <h2 class="text-[12px] font-semibold text-accent">{{ t('debug.title') }}</h2>
      <div class="flex items-center gap-1">
        <button
          v-for="item in TABS"
          :key="item.tab"
          :data-debug-tab="item.tab"
          :aria-pressed="tab === item.tab"
          :class="[tabButton, tab === item.tab ? tabOn : tabOff]"
          @click="tab = item.tab"
        >
          {{ t(item.key) }}
        </button>
      </div>
      <button
        data-debug-close
        :aria-label="t('debug.close')"
        :title="t('debug.close')"
        class="ml-auto flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
        @click="emit('close')"
      >
        {{ t('debug.closeIcon') }}
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <!-- ① 活的卡图：跑哪个节点亮哪个，退回过 / 工具失败的标红 -->
      <template v-if="tab === 'graph'">
        <p class="mb-2 text-[11.5px] text-muted">{{ t('debug.graphLegend') }}</p>
        <CardGraph :card="card" :active="running" :failed="failed" />
      </template>

      <!-- ② 引擎状态：四个顶层分支 + 时间 + 回合 + 本轮写入，可切到工作副本 -->
      <template v-else-if="tab === 'state'">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <span class="text-[11.5px] text-muted">{{ t('debug.time') }} {{ shownTime }}</span>
          <span class="text-[11.5px] text-muted">{{ t('debug.turn') }} {{ shownTurn }}</span>
          <button
            data-debug-draft
            :aria-pressed="draftOn"
            :disabled="draft === null"
            :class="[tabButton, draftOn ? tabOn : tabOff, draft === null ? 'opacity-50' : '']"
            @click="draftOn = !draftOn"
          >
            {{ draftOn ? t('debug.draftOn') : t('debug.draftOff') }}
          </button>
        </div>
        <p v-if="draftOn && draft === null" data-debug-draft-empty class="mb-2 text-[11.5px] text-faint">
          {{ t('debug.draftNone') }}
        </p>

        <details
          v-for="branch in branches"
          :key="branch.name"
          open
          :data-debug-branch="branch.name"
          class="mb-1.5 rounded-lg border border-line bg-page"
        >
          <summary class="min-h-6 cursor-pointer px-3 py-1 text-[12px] font-semibold text-text">
            {{ branch.name }}
          </summary>
          <pre class="overflow-x-auto px-3 pb-2 text-[11.5px] leading-relaxed text-muted">{{
            branch.text
          }}</pre>
        </details>

        <h3 class="mt-3 mb-1 text-[12px] font-semibold text-text">
          {{ t('debug.writes', { count: writes.length }) }}
        </h3>
        <p v-if="!writes.length" data-debug-writes-empty class="text-[11.5px] text-faint">
          {{ t('debug.writesNone') }}
        </p>
        <ul v-else class="space-y-1">
          <li v-for="(write, index) in writes" :key="index" data-debug-write :class="box">
            <pre class="overflow-x-auto text-[11.5px] leading-relaxed text-muted">{{ writeText(write) }}</pre>
          </li>
        </ul>
      </template>

      <!-- ③ 工具调用：哪个节点、什么工具、原始参数、结果、写到了哪条路径 -->
      <template v-else>
        <p v-if="!tools.length" data-debug-tools-empty class="text-[11.5px] text-faint">
          {{ t('debug.toolsNone') }}
        </p>
        <details
          v-for="(call, index) in tools"
          :key="index"
          data-tool-call
          class="mb-1.5 rounded-lg border border-line bg-page"
          :class="call.failed ? 'border-danger/40' : ''"
        >
          <summary class="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1 text-[12px]">
            <span class="text-faint">{{ nodeNameOf(call.node) }}</span>
            <span class="font-semibold text-text">{{ call.tool }}</span>
            <span v-if="call.failed" data-tool-failed class="text-[11px] text-danger">
              {{ t('debug.toolFailed') }}
            </span>
            <span v-if="call.redoFrom" data-tool-redo class="text-[11px] text-warn">
              {{ t('debug.redo', { node: nodeNameOf(call.redoFrom) }) }}
            </span>
          </summary>
          <div class="space-y-1 px-3 pb-2">
            <p class="text-[11px] text-faint">{{ t('debug.args') }}</p>
            <pre class="overflow-x-auto text-[11.5px] leading-relaxed text-muted">{{ call.args }}</pre>
            <p class="text-[11px] text-faint">{{ t('debug.result') }}</p>
            <pre class="overflow-x-auto text-[11.5px] leading-relaxed text-muted">{{
              call.result ?? t('debug.pending')
            }}</pre>
            <template v-if="call.writes.length">
              <p class="text-[11px] text-faint">{{ t('debug.callWrites') }}</p>
              <pre
                v-for="(write, at) in call.writes"
                :key="at"
                class="overflow-x-auto text-[11.5px] leading-relaxed text-muted"
                >{{ writeText(write) }}</pre>
            </template>
          </div>
        </details>
      </template>
    </div>
  </section>
</template>
