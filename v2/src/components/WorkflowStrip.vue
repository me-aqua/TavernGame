<script setup lang="ts">
/**
 * 工作流细条（SPEC §5）：固定节点，竖着排，点一下选中。
 *
 * 选中某个节点时，**排在它前面的每个节点**旁边多一只「读」眼睛：点一下决定
 * 「选中的节点读不读这个上游节点的输出」（写进选中节点的 `readsUpstream`）。
 * 选中节点自己与它下游的节点没有这只眼睛 —— 上游只能是已经跑完的节点。
 *
 * 宽度**固定**、不参与拖拽 —— 它是「链的骨架」，不是可调的栏（判据：`editor-columns.spec.js`
 * 量它在拖左/拖右栏前后都必须一模一样）。
 */
import { computed } from 'vue'
import type { ChainNode } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{ nodes: ChainNode[]; selectedId: string | null; readsUpstream: string[] }>()
defineEmits<{ select: [id: string]; 'toggle-read': [id: string] }>()

/** 选中节点的位置：只有排在它前面的节点才是上游（-1 = 什么都没选） */
const selectedIndex = computed(() => props.nodes.findIndex((node) => node.id === props.selectedId))
const isUpstream = (index: number): boolean => selectedIndex.value >= 0 && index < selectedIndex.value
</script>

<template>
  <div class="strip" data-workflow-strip>
    <div v-for="(node, index) in nodes" :key="node.id" class="row">
      <button
        type="button"
        class="node"
        :class="{ selected: node.id === selectedId }"
        :data-node-id="node.id"
        :data-selected="node.id === selectedId ? 'true' : 'false'"
        @click="$emit('select', node.id)"
      >
        {{ node.name }}
      </button>
      <button
        v-if="isUpstream(index)"
        type="button"
        class="read"
        data-read-upstream
        :data-upstream-id="node.id"
        :data-on="readsUpstream.includes(node.id) ? 'true' : 'false'"
        :title="t('editor.upstreamEye')"
        @click.stop="$emit('toggle-read', node.id)"
      >
        {{ t('editor.eyeRead') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.strip {
  flex: 0 0 auto;
  width: 96px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border-left: 1px solid var(--line);
  border-right: 1px solid var(--line);
  background: var(--panel-2);
  min-height: 0;
  overflow: auto;
}

.row {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
}

.node {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 24px;
  font-size: var(--fs3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node.selected {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
}

.read {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.read[data-on='true'] {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
</style>
