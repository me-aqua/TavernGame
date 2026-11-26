<script setup lang="ts">
/**
 * 中栏 · 选中状态元素时的那张表（CONTRACT §8.2）：类型、名字、备注、类型自己的格子、初始值。
 *
 * 五种类型各有自己的字段：
 *   · `text` 初始值一个文本框；`integer` 上下限 + 单次步幅 + 初始值；`enum` 取值白名单（一行一个）+ 初始值下拉；
 *   · `object` 没有自身值（初始值那一格整块不出现）；`time` 是六格公历 + 颗粒度上下界，类型只读。
 *
 * 改类型时**收拾干净**：`object` 删掉 `initial`（结构体没有自身值），其余类型按新类型给一个能编辑的值；
 * 不留在旧类型上的字段（`values` / 上下限 / 颗粒度），否则一份草稿会带着两边都不认的钥匙。
 */
import { TIME_UNITS } from '../core/statetree'
import type { StateElement, StateType, TimeUnit, TimeValue } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{ element: StateElement }>()
const emit = defineEmits<{ edit: [element: StateElement] }>()

const TYPES: StateType[] = ['text', 'integer', 'enum', 'object', 'time']
const TIME_PARTS = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const
const DEFAULT_TIME: TimeValue = { year: 1024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

/** 类型标签住文案表：`editor.typeText` / `editor.typeInteger` / … */
function typeLabel(type: StateType): string {
  return t(`editor.type${type.charAt(0).toUpperCase()}${type.slice(1)}`)
}

function unitLabel(unit: TimeUnit): string {
  return t(`time.unit.${unit}`)
}

/** 只属于某一种类型的字段（换类型时全部摘掉，再按新类型补） */
const TYPED_FIELDS: (keyof StateElement)[] = [
  'values',
  'min',
  'max',
  'stepMin',
  'stepMax',
  'granularityUpper',
  'granularityLower',
  'initial',
]

function strip(source: StateElement, keys: (keyof StateElement)[]): StateElement {
  const next = { ...source }
  for (const key of keys) delete next[key]
  return next
}

function isClock(value: StateElement['initial']): value is TimeValue {
  return typeof value === 'object' && value !== null
}

/** 换成另一种类型：清掉旧类型的字段，给新类型一套能编辑的初始值，然后把整份新元素交出去 */
function withType(type: StateType): void {
  const base = strip(props.element, TYPED_FIELDS)
  const initial = props.element.initial
  if (type === 'object') {
    emit('edit', { ...base, type })
    return
  }
  if (type === 'time') {
    emit('edit', {
      ...base,
      type,
      initial: isClock(initial) ? { ...initial } : { ...DEFAULT_TIME },
      granularityUpper: props.element.granularityUpper ?? 'day',
      granularityLower: props.element.granularityLower ?? 'minute',
    })
    return
  }
  if (type === 'integer') {
    emit('edit', { ...base, type, initial: typeof initial === 'number' ? initial : 0 })
    return
  }
  if (type === 'enum') {
    emit('edit', {
      ...base,
      type,
      values: props.element.values ?? [],
      initial: typeof initial === 'string' ? initial : '',
    })
    return
  }
  emit('edit', { ...base, type, initial: typeof initial === 'string' ? initial : '' })
}

/** 名字 / 备注这类普通文本格 */
function setText(key: 'name' | 'note', raw: string): void {
  emit('edit', { ...props.element, [key]: raw })
}
/** 数值格：空串 = 用缺省（把这一格删掉），其余按数字存（手打的中间态不写进草稿） */
function setNumber(key: 'min' | 'max' | 'stepMin' | 'stepMax' | 'initial', raw: string): void {
  const next = { ...props.element }
  if (raw.trim() === '') {
    delete next[key]
    emit('edit', next)
    return
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  next[key] = value
  emit('edit', next)
}

/** 下拉白名单：一行一个，空行不算一项 */
function setValues(raw: string): void {
  emit('edit', {
    ...props.element,
    values: raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  })
}

/** 时间的一格（年月日时分秒）：只认整数 */
function setTimePart(key: keyof TimeValue, raw: string): void {
  if (raw.trim() === '') return
  const value = Number(raw)
  if (!Number.isInteger(value)) return
  emit('edit', { ...props.element, initial: { ...timeOf(), [key]: value } })
}

function timeOf(): TimeValue {
  const initial = props.element.initial
  return isClock(initial) ? (initial as TimeValue) : { ...DEFAULT_TIME }
}

function setUnit(key: 'granularityUpper' | 'granularityLower', raw: string): void {
  emit('edit', { ...props.element, [key]: raw as TimeUnit })
}
</script>

<template>
  <div class="form stack">
    <div class="field-row">
      <span class="field-label">{{ t('editor.stateType') }}</span>
      <select
        data-state-type
        :value="element.type"
        :disabled="element.type === 'time'"
        @change="withType(($event.target as HTMLSelectElement).value as StateType)"
      >
        <option v-for="type in TYPES" :key="type" :value="type">{{ typeLabel(type) }}</option>
      </select>
    </div>

    <label class="field-row">
      <span class="field-label">{{ t('editor.fieldName') }}</span>
      <input
        data-field="name"
        :value="element.name"
        @input="setText('name', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <label class="field-row">
      <span class="field-label">{{ t('editor.fieldNote') }}</span>
      <input
        data-field="note"
        :value="element.note"
        @input="setText('note', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <template v-if="element.type === 'enum'">
      <label class="stack">
        <span class="field-label">{{ t('editor.fieldValues') }}</span>
        <textarea
          class="values"
          data-field="values"
          :value="(element.values ?? []).join('\n')"
          @input="setValues(($event.target as HTMLTextAreaElement).value)"
        ></textarea>
      </label>
      <label class="field-row">
        <span class="field-label">{{ t('editor.fieldInitial') }}</span>
        <select
          data-field="initial"
          :value="element.initial"
          @change="emit('edit', { ...element, initial: ($event.target as HTMLSelectElement).value })"
        >
          <option v-for="value in element.values ?? []" :key="value" :value="value">{{ value }}</option>
        </select>
      </label>
    </template>

    <template v-if="element.type === 'integer'">
      <label class="field-row">
        <span class="field-label">{{ t('editor.fieldMin') }}</span>
        <input
          type="number"
          class="num"
          data-field="min"
          :value="element.min ?? ''"
          @input="setNumber('min', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="field-row">
        <span class="field-label">{{ t('editor.fieldMax') }}</span>
        <input
          type="number"
          class="num"
          data-field="max"
          :value="element.max ?? ''"
          @input="setNumber('max', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="field-row">
        <span class="field-label">{{ t('editor.fieldStepMin') }}</span>
        <input
          type="number"
          class="num"
          data-field="step-min"
          :value="element.stepMin ?? ''"
          @input="setNumber('stepMin', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="field-row">
        <span class="field-label">{{ t('editor.fieldStepMax') }}</span>
        <input
          type="number"
          class="num"
          data-field="step-max"
          :value="element.stepMax ?? ''"
          @input="setNumber('stepMax', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="field-row">
        <span class="field-label">{{ t('editor.fieldInitial') }}</span>
        <input
          type="number"
          class="num"
          data-field="initial"
          :value="element.initial ?? ''"
          @input="setNumber('initial', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </template>

    <template v-if="element.type === 'text'">
      <label class="field-row">
        <span class="field-label">{{ t('editor.fieldInitial') }}</span>
        <input
          data-field="initial"
          :value="element.initial"
          @input="emit('edit', { ...element, initial: ($event.target as HTMLInputElement).value })"
        />
      </label>
    </template>

    <template v-if="element.type === 'time'">
      <label class="field-row">
        <span class="field-label">{{ t('editor.fieldGranularityUpper') }}</span>
        <select
          data-field="granularity-upper"
          :value="element.granularityUpper"
          @change="setUnit('granularityUpper', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="unit in TIME_UNITS" :key="unit" :value="unit">{{ unitLabel(unit) }}</option>
        </select>
      </label>
      <label class="field-row">
        <span class="field-label">{{ t('editor.fieldGranularityLower') }}</span>
        <select
          data-field="granularity-lower"
          :value="element.granularityLower"
          @change="setUnit('granularityLower', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="unit in TIME_UNITS" :key="unit" :value="unit">{{ unitLabel(unit) }}</option>
        </select>
      </label>
      <div class="field-row time-row">
        <span class="field-label">{{ t('editor.fieldInitial') }}</span>
        <input
          v-for="part in TIME_PARTS"
          :key="part"
          type="number"
          class="num"
          :data-field="`time-${part}`"
          :title="unitLabel(part)"
          :aria-label="unitLabel(part)"
          :value="timeOf()[part]"
          @input="setTimePart(part, ($event.target as HTMLInputElement).value)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.form {
  padding: 8px 10px;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

.num {
  flex: 0 0 auto;
  width: 72px;
}

.values {
  min-height: 96px;
  width: 100%;
}

.time-row {
  flex-wrap: wrap;
}
</style>
