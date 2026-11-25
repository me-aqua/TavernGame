<script setup lang="ts">
/**
 * 中栏 · 选中状态元素时的那张表：名字、备注、初值（SPEC §5）。
 *
 * 阶段 1 每个元素都是根元素，「初值」就是它唯一的编辑区；
 * 时间元素（`code === '0'`）的初值是 `{ day, hour }`，阶段 1 **只读**。
 */
import type { StateElement, TimeValue } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{ element: StateElement }>()
const emit = defineEmits<{ patch: [patch: Partial<StateElement>] }>()

function initialText(): string {
  const value = props.element.initial
  if (typeof value === 'string') return value
  return `day ${(value as TimeValue).day} hour ${(value as TimeValue).hour}`
}

const isTime = () => props.element.code === '0'
</script>

<template>
  <div class="form stack">
    <div class="form-head row">
      <span class="form-title">{{ t('editor.fieldName') }}</span>
      <span class="muted">{{ t('editor.code') }} {{ element.code }}</span>
    </div>

    <label class="field-row">
      <span class="field-label">{{ t('editor.fieldName') }}</span>
      <input
        data-field="name"
        :value="element.name"
        @input="emit('patch', { name: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label class="field-row">
      <span class="field-label">{{ t('editor.fieldNote') }}</span>
      <input
        data-field="note"
        :value="element.note"
        @input="emit('patch', { note: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label class="field-row">
      <span class="field-label">{{ t('editor.fieldInitial') }}</span>
      <input
        data-field="initial"
        :value="initialText()"
        :readonly="isTime()"
        @input="emit('patch', { initial: ($event.target as HTMLInputElement).value })"
      />
    </label>
    <p v-if="isTime()" class="muted hint">{{ t('editor.timeInitial') }}</p>
  </div>
</template>

<style scoped>
.form {
  padding: 8px 10px;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

.form-head {
  justify-content: space-between;
}

.form-title {
  font-size: var(--fs1);
  font-weight: 600;
}

.hint {
  margin: 0;
}
</style>
