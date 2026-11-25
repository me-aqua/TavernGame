<script setup lang="ts">
/**
 * 左栏 · 状态树（SPEC §5「编辑器」）：单层元素，控件按 S0–S3 一步步露出来。
 *
 *   · **S0**（什么都没选）：只有行 —— 编码 + 名字；
 *   · **S1**（选中了工作流节点）：每行两只眼睛 —— **读**（`reads` 里有它才进提示词）、
 *     **写**（`writable` 里有它才许写）；
 *   · **S2**（选中了某个元素）：栏顶出现 `+`（加元素），**每一行**出现 `×`（删这一行）。
 *
 * `0`（时间元素）永远不许删，它不带 `×`。
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
      <button
        v-if="selectedCode !== null"
        type="button"
        class="icon"
        data-add-state
        :title="t('editor.addState')"
        :aria-label="t('editor.addState')"
        @click="$emit('add')"
      >
        +
      </button>
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
          v-if="selectedCode !== null && element.code !== '0'"
          type="button"
          class="icon"
          data-delete-state
          :title="t('editor.deleteState')"
          @click.stop="$emit('remove', element.code)"
        >
          {{ t('common.remove') }}
        </button>
      </div>
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
</style>
