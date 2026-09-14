<script setup lang="ts">
/**
 * 卡图查看器：把示例卡画成节点图（作者 / 调试工具，只在 Storybook 与 dev 里用）。
 *
 * 卡是唯一事实来源 —— 这里只做「读卡 → 校验 → 摊成图 → 交给 vue-flow 画」，
 * 不认得任何一张具体的卡。实线是拓扑的先后，虚线（标「读」）是谁读了谁的产出。
 *
 * ⚠️ 只被 story 引用：App 与 main.ts 都不引它 —— vue-flow 是 devDependency，不进 dist。
 */
import { computed } from 'vue'
import { VueFlow, MarkerType, Position } from '@vue-flow/core'
import type { Edge, Node } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { parseCard } from '../game/card'
import { READ_LABEL, toGraph } from '../dev/card-graph'
import cardJson from '../../cards/morningwind.json?raw'

/** 节点框里的两行字 + 高亮标记（哪一个在跑、哪一个失败了） */
interface CardNodeData {
  label: string
  sublabel: string
  active: boolean
  failed: boolean
}

const props = defineProps<{
  /** 正在跑的节点 id；不传 = 没有节点在跑 */
  active?: string | null
  /** 失败的节点 id；不传 = 没有节点失败 */
  failed?: string | null
}>()

/** 示例卡的图：读卡 → 校验（通不过就抛，绝不画一张错的图）→ 摊平 */
const graph = toGraph(parseCard(cardJson))

/**
 * 节点一律从左往右走，用自定义类型好把副标题摆在名字下面。
 * 高亮由 props 决定：失败的节点同时还是在跑的那一个，所以 failed 压过 active。
 */
const nodes = computed<Node<CardNodeData>[]>(() =>
  graph.nodes.map((node) => ({
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
    },
  })),
)

/** 读边（label 是 READ_LABEL）走卡图那套虚线与强调色，主干边是普通实线 */
const edges: Edge[] = graph.edges.map((edge, index) => ({
  id: 'edge-' + index,
  source: edge.source,
  target: edge.target,
  label: edge.label,
  class: edge.label === READ_LABEL ? 'card-graph-read' : 'card-graph-flow',
  markerEnd: MarkerType.ArrowClosed,
}))
</script>

<template>
  <div
    class="card-graph h-[430px] min-h-[320px] w-full min-w-[640px] overflow-hidden rounded-xl border border-line bg-page"
  >
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :min-zoom="0.5"
      :max-zoom="2"
      :nodes-connectable="false"
      :elements-selectable="false"
    >
      <template #node-card="{ data }">
        <div
          class="w-[200px] rounded-lg border bg-surface px-3 py-2 text-left"
          :class="
            data.failed
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
</style>
