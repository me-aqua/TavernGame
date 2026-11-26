<script setup lang="ts">
/**
 * 左栏 · 状态树（SPEC §5「编辑器」）：单层元素，控件按 S0–S3 一步步露出来。
 *
 *   · **S0**（什么都没选）：只有行 —— 编码 + 名字；
 *   · **S1**（选中了工作流节点）：每行两只眼睛 —— **读**（`reads` 里有它才进提示词）、
 *     **写**（`writable` 里有它才许写）；
 *   · **S2**（选中了某个元素）：栏顶出现 `+`（加元素），**每一行**出现 `×`（删这一行）。
 *
 * `structureLocked`（存档编辑器，`#/edit-save/:saveId`）把 `+` 与 `×` **整块拿掉**（不渲染、
 * 不是禁用）：那一侧的卡结构是冻结的，只许改名字 / 备注 / 初值与眼睛。
 *
 * **写眼睛只看 `node.writable`，不按节点类型收窄**（老板 2026-11-26）：时间元素 `0` 与文字元素一样，
 * 每一行都有那只 chip —— 勾上它，这个节点就拿到对应的工具（时间 ⇒ `advance_time`，
 * 文字 ⇒ `write_state`，规则见 `schema.toolsForNode`）。唯一没有写眼睛的是**输出节点**：
 * 它只产故事，`writable` 必须是空的（卡校验会拒）。
 *
 * `0`（时间元素）永远不许删，它不带 `×`。
 */
import type { ChainNode, StateElement } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  elements: StateElement[]
  node: ChainNode | null
  selectedCode: string | null
  /** 结构锁死：不渲染 `+` / `×`（默认 false = 卡编辑器） */
  structureLocked?: boolean
}>()

defineEmits<{
  add: []
  select: [code: string]
  remove: [code: string]
  'toggle-read': [code: string]
  'toggle-write': [code: string]
}>()

/** 这一行要不要露「写」眼睛：输出节点一只都没有，其余节点每一行都有 */
function showsWrite(): boolean {
  return props.node !== null && props.node.type !== 'output'
}
</script>

<template>
  <div class="state-tree" data-state-tree>
    <div class="panel-head">
      <div class="col-title" data-panel-title>
        <span class="ellipsis">{{ t('editor.stateTitle') }}</span>
      </div>
      <button
        v-if="!structureLocked && selectedCode !== null"
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
            v-if="showsWrite()"
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
          v-if="!structureLocked && selectedCode !== null && element.code !== '0'"
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
  background: var(--panel);
  cursor: pointer;
}

/* 悬停只把边框变深、不铺底色；这一条要在 .selected 之前，选中行的 accent 边框才不被盖掉 */
.state-row:hover {
  border-color: var(--line-strong);
}

/* 选中 = 深强调底 + 浅字（与首页卡行 / 提示词块同一套三态）；字重 600，与未选中行区分 */
.state-row.selected {
  border-color: var(--accent);
  background: var(--active-bg);
  color: var(--active-ink);
  font-weight: 600;
}

.state-code {
  flex: 0 0 auto;
  font-size: var(--fs3);
  color: var(--ink-soft);
  min-width: 14px;
}

/* 编号是次要文字，深底上跟着换浅色（ink-soft 压在 accent 上只有 1.2:1） */
.state-row.selected .state-code {
  color: var(--active-ink);
}

.state-name {
  flex: 1 1 auto;
  font-size: var(--fs2);
}
</style>
