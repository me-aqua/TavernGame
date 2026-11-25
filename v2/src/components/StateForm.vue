<script setup lang="ts">
/**
 * 中栏 · 选中状态元素时的那张表：类型、名字、备注、初值（SPEC §5）。
 *
 * 阶段 1 只有两种元素：**时间**（`code === '0'`，初值是 `{ day, hour }`，用两个数字框编辑）
 * 与**文字**（其余，初值是一个字符串）。类型是只读的展示 —— 元素建出来是什么就是什么。
 */
import type { StateElement, TimeValue } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{ element: StateElement }>()
const emit = defineEmits<{ patch: [patch: Partial<StateElement>] }>()

/** 时间元素的两个数（只有 `code === '0'` 会走到它） */
function timeInitial(): TimeValue {
  return props.element.initial as TimeValue
}

/** 文字元素的初值（时间元素不走这一支） */
function initialText(): string {
  return props.element.initial as string
}

// 天数：只接受 ≥1 的整数；空串与非法值不写，免得把中间态存成 NaN
function patchDay(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  if (raw === '') return
  const day = Number(raw)
  if (!Number.isInteger(day) || day < 1) return
  emit('patch', { initial: { ...timeInitial(), day } })
}

// 小时：只接受 0–23 的整数
function patchHour(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  if (raw === '') return
  const hour = Number(raw)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return
  emit('patch', { initial: { ...timeInitial(), hour } })
}
</script>

<template>
  <div class="form stack">
    <div class="form-head row">
      <span class="form-title ellipsis">{{ element.name }}</span>
      <span class="muted">{{ t('editor.code') }} {{ element.code }}</span>
    </div>

    <div class="field-row">
      <span class="field-label">{{ t('editor.stateType') }}</span>
      <span class="type" data-state-type>
        {{ element.code === '0' ? t('editor.stateTypeTime') : t('editor.stateTypeText') }}
      </span>
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

    <div v-if="element.code === '0'" class="field-row">
      <span class="field-label">{{ t('editor.fieldInitial') }}</span>
      <input
        type="number"
        min="1"
        step="1"
        class="num"
        data-field="initial-day"
        :title="t('editor.fieldInitialDay')"
        :aria-label="t('editor.fieldInitialDay')"
        :value="timeInitial().day"
        @input="patchDay"
      />
      <input
        type="number"
        min="0"
        max="23"
        step="1"
        class="num"
        data-field="initial-hour"
        :title="t('editor.fieldInitialHour')"
        :aria-label="t('editor.fieldInitialHour')"
        :value="timeInitial().hour"
        @input="patchHour"
      />
    </div>
    <label v-else class="field-row">
      <span class="field-label">{{ t('editor.fieldInitial') }}</span>
      <input
        data-field="initial"
        :value="initialText()"
        @input="emit('patch', { initial: ($event.target as HTMLInputElement).value })"
      />
    </label>
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

.type {
  font-size: var(--fs2);
}

.num {
  flex: 0 0 auto;
  width: 72px;
}
</style>
