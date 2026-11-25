<script setup lang="ts">
/**
 * 工作流细条（SPEC §5）：固定四节点，竖着排，点一下选中。
 *
 * 宽度**固定**、不参与拖拽 —— 它是「链的骨架」，不是可调的栏（判据：`editor-columns.spec.js`
 * 量它在拖左/拖右栏前后都必须一模一样）。
 */
import type { ChainNode } from '../core/types'

defineProps<{ nodes: ChainNode[]; selectedId: string | null }>()
defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div class="strip" data-workflow-strip>
    <button
      v-for="node in nodes"
      :key="node.id"
      type="button"
      class="node"
      :class="{ selected: node.id === selectedId }"
      :data-node-id="node.id"
      :data-selected="node.id === selectedId ? 'true' : 'false'"
      @click="$emit('select', node.id)"
    >
      {{ node.name }}
    </button>
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

.node {
  width: 100%;
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
</style>
