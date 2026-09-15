<script setup lang="ts">
/**
 * 卡图：把一张卡画成节点图（卡界面与组件故事共用）。
 *
 * 卡是唯一事实来源 —— 这里只做「读卡 → 摊成图 → 交给 vue-flow 画」，不认得任何一张
 * 具体的卡。实线是拓扑的先后，虚线不写字：谁读了谁的产出。
 *
 * 编辑只做到「选中一个节点」为止：点中的 id 通过 select 抛给外面，改卡是外面的事。
 *
 * ⚠️ 容器不给最小宽度：640px 的卡图在手机上会把元素顶出视口（探针当场拦下）。
 *    整张图看得见靠 fitView 按容器缩放 + 把视口夹回容器（见 fitInBox），
 *    看不到细节就自己缩放手势放大。
 */
import { computed } from 'vue'
import { VueFlow, MarkerType, Position, useVueFlow } from '@vue-flow/core'
import type { Edge, Node, NodeMouseEvent } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import type { CardData } from '../game/card'
import { toGraph } from '../game/card-layout'

/** 节点框里的两行字 + 高亮标记（在跑、失败、被选中） */
interface CardNodeData {
  label: string
  sublabel: string
  active: boolean
  failed: boolean
  selected: boolean
}

const props = defineProps<{
  /** 要画的卡（当前卡；故事里也让给） */
  card: CardData
  /** 正在跑的节点 id；不传 = 没有节点在跑 */
  active?: string | null
  /** 失败的节点 id；不传 = 没有节点失败 */
  failed?: string | null
  /** 选中的节点 id（编辑表单对着它）；不传 = 没选中 */
  selected?: string | null
}>()

const emit = defineEmits<{
  /** 点了图上某个节点 */
  select: [id: string]
}>()

/** 画布自己的视口 —— fitView 与夹取都走这一份（它和模板里的 VueFlow 是同一个 store） */
const { viewport, dimensions, setViewport, fitView, onPaneReady } = useVueFlow()

/** 当前这张卡的图：节点按拓扑排，边由拓扑推（形状全部来自 JSON） */
const graph = computed(() => toGraph(props.card))

/**
 * 摆正视口：先 fitView（整张图缩进画布），再把位移夹回容器里。
 *
 * fitView 的居中会留下一个正位移，而 vue-flow 那几层画布都是「宽度 = 容器宽」——
 * 位移一加，它们的盒子右边就伸到容器外（结构探针判「元素不能伸出视口」，实测右边缘到 1323px）。
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
 * 节点一律从左往右走，用自定义类型好把副标题摆在名字下面。
 * 高亮由 props 决定：失败的节点同时还是在跑的那一个，所以 failed 压过 active。
 */
const nodes = computed<Node<CardNodeData>[]>(() =>
  graph.value.nodes.map((node) => ({
    id: node.id,
    type: 'card',
    position: node.position,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      label: node.label,
      sublabel: node.sublabel,
      failed: node.id === props.failed,
      active: node.id === props.active && node.id !== props.failed,
      selected: node.id === props.selected,
    },
  })),
)

/** 读边（read）走卡图那套虚线与强调色，主干边是普通实线 */
const edges = computed<Edge[]>(() =>
  graph.value.edges.map((edge, index) => ({
    id: 'edge-' + index,
    source: edge.source,
    target: edge.target,
    class: edge.read ? 'card-graph-read' : 'card-graph-flow',
    markerEnd: MarkerType.ArrowClosed,
  })),
)

/** 点节点 = 选中它（编辑表单靠这个事件出） */
function onNodeClick(payload: NodeMouseEvent) {
  emit('select', payload.node.id)
}

// 画布尺寸量好之后再摆视口：不用模板上的 fit-view-on-init，那个 Promise
// 什么时候落地不由这里决定，夹取可能被它盖掉
onPaneReady(() => void fitInBox())
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
    >
      <template #node-card="{ data }">
        <div
          class="w-[200px] rounded-lg border bg-surface px-3 py-2 text-left"
          :class="
            data.selected
              ? 'border-accent bg-accent-soft'
              : data.failed
                ? 'border-danger bg-danger-soft'
                : data.active
                  ? 'border-accent-line bg-accent-soft'
                  : 'border-line'
          "
        >
          <div class="text-[13px] font-semibold text-text">{{ data.label }}</div>
          <div class="mt-0.5 text-[11px] leading-snug text-muted">{{ data.sublabel }}</div>
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
  fill: var(--color-muted);
  font-size: 10px;
}
.card-graph .vue-flow__edge-textbg {
  fill: var(--color-page);
}
.card-graph .vue-flow__node-card {
  font-family: inherit;
}
.card-graph .vue-flow__node {
  cursor: pointer;
}
</style>
