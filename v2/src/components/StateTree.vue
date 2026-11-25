<script setup lang="ts">
/**
 * 左栏 · 状态树（SPEC §5「编辑器」）：单层元素，控件按 S0–S3 一步步露出来。
 *
 *   · **S0**（什么都没选）：只有行 —— 编码 + 名字；
 *   · **S1**（选中了工作流节点）：每行两只眼睛 —— **读**（`reads` 里有它才进提示词）、
 *     **写**（`writable` 里有它才许写）；
 *   · **S2**（选中了某个元素）：栏顶出现 `+`（加元素），**每一行**出现 `×`（删这一行）。
 *
 * **写眼睛按节点类型收窄**（与 schema 的链规矩同一套）：时间节点只有时间元素 0 那只，
 * 输出节点一只都没有，其余类型每行都有。界面上不该露出一个点了会被引擎拒的开关。
 *
 * `0`（时间元素）永远不许删，它不带 `×`。
 */
import type { ChainNode, StateElement } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
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

/** 这一行要不要露「写」眼睛（类型规则见文件头） */
function showsWrite(code: string): boolean {
  if (!props.node) return false
  if (props.node.type === 'output') return false
  if (props.node.type === 'time') return code === '0'
  return true
}
</script>

<template>
  <div class="state-tree" data-state-tree>
    <div class="panel-head">
      <div class="col-title" data-panel-title>
        <span class="ellipsis">{{ t('editor.stateTitle') }}</span>
      </div>
      <button
        v-if="selectedCode !== null"
        type="button"
        class="icon panel-head-action"
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
            class="chip"
            data-eyes="read"
            :data-on="node.reads.includes(element.code) ? 'true' : 'false'"
            :title="t('editor.readEye')"
            @click.stop="$emit('toggle-read', element.code)"
          >
            {{ t('editor.eyeRead') }}
          </button>
          <button
            v-if="showsWrite(element.code)"
            type="button"
            class="chip"
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
  flex: 1 1 auto;
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
  height: var(--row-h);
  padding: 3px 4px;
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
</style>
