<script setup lang="ts">
/**
 * 左栏 · 状态树（SPEC §5「编辑器」）：单层文本元素，行内两只会「眼睛」。
 *
 * 眼睛的语义与引擎完全一致：**读**（`reads` 里有它才进提示词）、**写**（`writable` 里有它才许写）。
 * 眼睛只在**选中了工作流节点**时出现 —— 它们说的都是「当前这个节点」读/写什么，
 * 没有当前节点时它们没有意义（显示了反而会让人以为点的是一个全局开关）。
 */
import type { ChainNode, StateElement } from '../core/types'
import { t } from '../i18n'

defineProps<{
  elements: StateElement[]
  node: ChainNode | null
  selectedCode: string | null
}>()

defineEmits<{
  add: []
  select: [code: string]
  remove: [code: string]
  'toggle-read': [code: string]
  'toggle-write': [code: string]
}>()
</script>

<template>
  <div class="state-tree" data-state-tree>
    <div class="col-title">
      <span class="ellipsis">{{ t('editor.stateTitle') }}</span>
      <button type="button" data-add-state @click="$emit('add')">{{ t('editor.addState') }}</button>
    </div>
    <div class="rows scroll">
      <div
        v-for="element in elements"
        :key="element.code"
        class="state-row"
        :class="{ selected: element.code === selectedCode }"
        :data-state-item="element.code"
        @click="$emit('select', element.code)"
      >
        <span class="state-code" data-state-code>{{ element.code }}</span>
        <span class="state-name ellipsis" data-state-name>{{ element.name }}</span>
        <template v-if="node">
          <button
            type="button"
            class="eye"
            data-eyes="read"
            :data-on="node.reads.includes(element.code) ? 'true' : 'false'"
            :title="t('editor.readEye')"
            @click.stop="$emit('toggle-read', element.code)"
          >
            {{ t('editor.eyeRead') }}
          </button>
          <button
            type="button"
            class="eye"
            data-eyes="write"
            :data-on="node.writable.includes(element.code) ? 'true' : 'false'"
            :title="t('editor.writeEye')"
            @click.stop="$emit('toggle-write', element.code)"
          >
            {{ t('editor.eyeWrite') }}
          </button>
        </template>
        <button
          v-if="element.code !== '0'"
          type="button"
          class="eye"
          data-delete-state
          :title="t('editor.deleteState')"
          @click.stop="$emit('remove', element.code)"
        >
          {{ t('common.remove') }}
        </button>
      </div>
      <p v-if="!node" class="muted hint">{{ t('editor.eyesHint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.state-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
}

.rows {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.state-row {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}

.state-row:hover {
  background: var(--panel-2);
}

.state-row.selected {
  border-color: var(--accent);
  background: var(--panel-2);
}

.state-code {
  flex: 0 0 auto;
  font-size: var(--fs3);
  color: var(--ink-soft);
  min-width: 14px;
}

.state-name {
  flex: 1 1 auto;
  font-size: var(--fs2);
}

.eye {
  flex: 0 0 auto;
  width: 26px;
  height: 24px;
  padding: 0;
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.eye[data-on='true'] {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.hint {
  margin: 4px 2px 0;
}
</style>
