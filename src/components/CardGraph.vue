<script setup lang="ts">
/**
 * 卡图：把一张卡画成节点图（卡界面、调试面板与组件故事共用）。
 *
 * 读法（设计 13.1.1）：
 *   · 默认只画**主干**一条链（实线）—— 「上游 = 拓扑前缀」是一条规则，不是 36 条虚线；
 *   · 悬停或选中某个节点时，才画它自己的上游虚线、高亮那些前缀节点，其余淡出；
 *   · 节点框带序号（① ② ③）、折行边带序号，行与行之间那条空档是回边通道；
 *   · 框里还写着节点的声明：role / tools / reads —— 看图就知道这张卡给了谁什么权力。
 *
 * 编辑只做到「选中一个节点」为止：点中的 id 通过 select 抛给外面，改卡是外面的事。
 *
 * ⚠️ 容器不给最小宽度：图再宽在手机上也会把元素顶出视口（探针当场拦下）。
 *    整张图看得见靠 fitView 按容器缩放 + 把视口夹回容器（见 fitInBox）。
 *    容器尺寸是会变的，所以那一套每次尺寸变了都要重算（见下面那句 watch）。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Handle, MarkerType, Position, VueFlow, useVueFlow } from '@vue-flow/core'
import type { Edge, Node, NodeMouseEvent } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import type { CardData } from '../game/card'
import { toGraph } from '../game/card-layout'

const { t } = useI18n()

/** 节点框里的一行字 + 只读声明 + 高亮标记（在跑、失败、选中、上游前缀、淡出） */
interface CardNodeData {
  index: number
  label: string
  sublabel: string
  /** role: story —— 本回合的叙事取自它；别的节点没有这一行 */
  role: string | null
  /** 这个节点能用的动作（显示成一行；不写时是「全部」） */
  tools: string
  /** 这个节点看得见哪几块状态 */
  reads: string
  active: boolean
  failed: boolean
  selected: boolean
  /** 被指到那个节点的上游前缀 —— 指到谁就亮谁的前缀 */
  prefix: boolean
  /** 有节点被指到、而它两头都不沾：淡出，让前缀那一条链显出来 */
  faded: boolean
  /** 这一刻它是什么状态（失败 > 在跑 > 选中 > 上游前缀 > 平常）—— 也是 e2e 的钩子 */
  state: 'failed' | 'active' | 'selected' | 'prefix' | 'plain'
}

const props = defineProps<{
  /** 要画的卡（当前卡；故事里也让给） */
  card: CardData
  /** 正在跑的节点 id；不传 = 没有节点在跑 */
  active?: string | null
  /** 被 redo 退回过 / 工具调用失败的节点；不传 = 没有失败 */
  failed?: string[]
  /** 选中的节点 id（编辑表单对着它）；不传 = 没选中 */
  selected?: string | null
}>()

const emit = defineEmits<{
  /** 点了图上某个节点 */
  select: [id: string]
}>()

/** 画布自己的视口 —— fitView 与夹取都走这一份（它和模板里的 VueFlow 是同一个 store） */
const { viewport, dimensions, setViewport, fitView, onPaneReady } = useVueFlow()

/** 当前这张卡的图：节点按拓扑排成一条链，边由拓扑相邻与前缀推出来 */
const graph = computed(() => toGraph(props.card))

/** 鼠标正指着的节点 —— 它比「选中」优先：指到谁就看谁的上游 */
const hovered = ref<string | null>(null)

/** 这一刻在看谁的上下游：指到的那个，其次才是选中的那个 */
const focus = computed(() => hovered.value ?? props.selected ?? null)

/** 被看那个节点的上游（拓扑前缀，就是读边指向它的那些节点） */
const upstream = computed(() => {
  const target = focus.value
  if (target === null) return new Set<string>()
  return new Set(
    graph.value.edges
      .filter((edge) => edge.kind === 'read' && edge.target === target)
      .map((edge) => edge.source),
  )
})

/** 声明里的「不写 = 全部」—— 卡里的动作全给它 / 状态全看得见 */
const all = computed(() => t('card.declAll'))

/** 声明里的「写了个空表 = 一个都没有」—— judge 那种「不给它任何动作」的节点就长这样 */
const none = computed(() => t('card.declNone'))

/** 一条声明怎么念：没写这个键 = 全部，空表 = 一个都没有，其余按空格连起来 */
function declaration(value: string[] | null): string {
  if (value === null) return all.value
  return value.length === 0 ? none.value : value.join(' ')
}

/**
 * 摆正视口：先 fitView（整张图缩进画布），再把位移夹回容器里。
 *
 * fitView 的居中会留下一个正位移，而 vue-flow 那几层画布都是「宽度 = 容器宽」——
 * 位移一加，它们的盒子右边就伸到容器外（结构探针判「元素不能伸出视口」）。
 * 缩放不超过 1、位移夹进 [0, 宽 x (1 - 缩放)]，整块画布就始终待在自己的盒子里。
 */
async function fitInBox() {
  await fitView({ padding: 0.1 })
  const { width } = dimensions.value
  const zoom = Math.min(viewport.value.zoom, 1)
  const x = Math.min(Math.max(viewport.value.x, 0), width * (1 - zoom))
  await setViewport({ ...viewport.value, x, zoom })
}

/**
 * 这一刻这个节点是什么状态（失败 > 在跑 > 选中 > 上游前缀 > 平常）。
 *
 * 高亮是样式，断言要有稳定的抓手 —— 所以它同时写进 data-node-state（e2e 与故事用它）。
 */
function stateOf(id: string, failed: boolean, inPrefix: boolean): CardNodeData['state'] {
  if (failed) return 'failed'
  if (id === props.active) return 'active'
  if (id === props.selected) return 'selected'
  if (inPrefix) return 'prefix'
  return 'plain'
}

/**
 * 节点一律从左往右走，用自定义类型好把声明摆在名字下面。
 * 高亮由 props 与「现在看着谁」共同决定：失败的节点同时还是在跑的那一个，所以 failed 压过 active。
 */
const nodes = computed<Node<CardNodeData>[]>(() =>
  graph.value.nodes.map((node) => {
    const inPrefix = upstream.value.has(node.id)
    const isFailed = props.failed?.includes(node.id) ?? false
    return {
      id: node.id,
      type: 'card',
      position: node.position,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        index: node.index,
        label: node.label,
        sublabel: node.sublabel,
        role: node.role,
        tools: declaration(node.tools),
        reads: declaration(node.reads),
        failed: isFailed,
        active: node.id === props.active && !isFailed,
        selected: node.id === props.selected,
        prefix: inPrefix,
        faded: focus.value !== null && !inPrefix && node.id !== focus.value,
        state: stateOf(node.id, isFailed, inPrefix),
      },
    }
  }),
)

/** 边：主干与折行始终画；读边只画被看那个节点的上游（默认一条都不画） */
const edges = computed<Edge[]>(() =>
  graph.value.edges
    .filter((edge) => edge.kind !== 'read' || edge.target === focus.value)
    .map((edge) => ({
      id: edge.source + '-' + edge.target + '-' + edge.kind,
      source: edge.source,
      target: edge.target,
      type: edge.kind === 'wrap' ? 'smoothstep' : undefined,
      sourceHandle: edge.kind === 'wrap' ? 'down' : 'out',
      targetHandle: edge.kind === 'wrap' ? 'up' : 'in',
      class: edge.kind === 'read' ? 'card-graph-read' : 'card-graph-flow',
      label: edge.label,
      markerEnd: MarkerType.ArrowClosed,
    })),
)

/** 点节点 = 选中它（编辑表单靠这个事件出） */
function onNodeClick(payload: NodeMouseEvent) {
  emit('select', payload.node.id)
}

/** 指到一个节点：把它的上游虚线叫出来（离开时收回，回到「只画主干」） */
function onNodeEnter(payload: NodeMouseEvent) {
  hovered.value = payload.node.id
}

/** 鼠标离开节点：不再看它的上游 */
function onNodeLeave() {
  hovered.value = null
}

// 画布尺寸量好之后再摆视口：不用模板上的 fit-view-on-init，那个 Promise
// 什么时候落地不由这里决定，夹取可能被它盖掉
onPaneReady(() => void fitInBox())

// 尺寸变了就重摆：拟合的缩放是按**当时的**容器宽度算的（见 fitInBox），
// 只摆一次的话，窗口或容器之后变窄，图就按旧宽度摊着 ⇒ 画布伸出容器
// （整页巡检的 offenders）。
//
// 跟着 `dimensions` 走就是跟着"尺寸真的变了"这个事件走：vue-flow 的
// useResizeHandler 自己挂着 window resize 与 ResizeObserver，两边都把那整块换掉
// （@vue-flow/core 的 useResizeHandler）⇒ 这里必然被叫醒，不靠定时器去赌。
watch(dimensions, () => void fitInBox())
</script>

<template>
  <div
    class="card-graph h-[220px] w-full overflow-hidden rounded-xl border border-line bg-page sm:h-[320px] xl:h-[420px]"
  >
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :min-zoom="0.2"
      :max-zoom="2"
      :nodes-connectable="false"
      @node-click="onNodeClick"
      @node-mouse-enter="onNodeEnter"
      @node-mouse-leave="onNodeLeave"
    >
      <template #node-card="{ data }">
        <div
          :data-node-box="data.index"
          :data-node-state="data.state"
          class="w-[210px] rounded-lg border bg-surface px-2.5 py-1.5 text-left transition-opacity"
          :class="[
            data.selected
              ? 'border-accent bg-accent-soft'
              : data.failed
                ? 'border-danger bg-danger-soft'
                : data.active || data.prefix
                  ? 'border-accent-line bg-accent-soft'
                  : 'border-line',
            data.faded ? 'opacity-40' : '',
          ]"
        >
          <div class="text-[12.5px] font-semibold text-text">{{ data.label }}</div>
          <div class="mt-0.5 text-[10.5px] leading-snug text-muted">{{ data.sublabel }}</div>
          <dl class="mt-1 space-y-px text-[10px] leading-tight">
            <div v-if="data.role" class="flex gap-1">
              <dt class="shrink-0 text-faint">role</dt>
              <dd class="truncate text-accent">{{ data.role }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="shrink-0 text-faint">tools</dt>
              <dd class="truncate text-muted" :title="data.tools">{{ data.tools }}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="shrink-0 text-faint">reads</dt>
              <dd class="truncate text-muted" :title="data.reads">{{ data.reads }}</dd>
            </div>
          </dl>
          <!-- 四个连接点：左右是主干，上下留给折行那一条（走行间的回边通道） -->
          <Handle id="in" type="target" :position="Position.Left" />
          <Handle id="out" type="source" :position="Position.Right" />
          <Handle id="up" type="target" :position="Position.Top" />
          <Handle id="down" type="source" :position="Position.Bottom" />
        </div>
      </template>
    </VueFlow>
  </div>
</template>

<style>
/* vue-flow 自带主题只有浅色一套：颜色一律换成项目的语义 token，深浅色都看得清 */
.card-graph .vue-flow__edge-path {
  stroke: var(--color-muted);
  stroke-width: 2;
}
.card-graph .vue-flow__edge.card-graph-read .vue-flow__edge-path {
  stroke: var(--color-accent);
  stroke-width: 1.2;
  stroke-dasharray: 5 4;
}
.card-graph .vue-flow__edge-text {
  fill: var(--color-accent);
  font-size: 11px;
  font-weight: 600;
}
.card-graph .vue-flow__edge-textbg {
  fill: var(--color-page);
}
.card-graph .vue-flow__handle {
  width: 4px;
  height: 4px;
  border: 0;
  background: var(--color-line);
}
.card-graph .vue-flow__node-card {
  font-family: inherit;
}
.card-graph .vue-flow__node {
  cursor: pointer;
}
</style>
