<script setup lang="ts">
/**
 * 中栏 · 选中状态元素时的那张表（CONTRACT §8.2）：类型、名字、备注、类型自己的格子、初始值。
 *
 * 作者能选的类型只有**文字 / 数字 / 下拉 / 时间**：`object` 是「有子元素」的后台形态，
 * 不在类型下拉里出现（导入的卡里真有一个 `object` 元素时，下拉会把它照实显示出来）。
 *
 * 各类型的格子：
 *   · `text` 初始值一个文本框；`integer` 上下限 + 单次步幅 + 初始值；`enum` 取值白名单（一行一个）+ 初始值下拉；
 *   · `object` 没有自身值（初始值那一格整块不出现）；`time` 是六格公历 + 颗粒度上下界，类型只读。
 *
 * **中栏分两段**：上半 = 结构字段，下半 = 初始值块（从 ~50% 起往下排，不贴底、不靠 `margin-top: auto`；
 * 两块之间至少 16px，放不下就滚动）。初始值是「新建存档时的种子」，不属于上面那些结构字段。
 * 存档模式（`initialLocked`）整块不渲染 —— 当前值住在 `save.tree` 里。
 *
 * 改类型时**收拾干净**：清掉旧类型的字段（`values` / 上下限 / 颗粒度 / `initial`），再按新类型给一套
 * 能编辑的值，否则一份草稿会带着两边都不认的钥匙。
 */
import { TIME_UNITS } from '../core/statetree'
import type { StateElement, StateType, StateValue, TimeUnit, TimeValue } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  element: StateElement
  /** 存档模式：初值不可改（初值只是新建存档的种子） */
  initialLocked?: boolean
  /** 存档模式：这一格在 `save.tree` 里的当前值（数字元素显示在上下限下方） */
  currentValue?: StateValue
}>()
const emit = defineEmits<{ edit: [element: StateElement] }>()

/** 作者能选的类型（`object` 不在这里：它是「有子元素」的后台形态） */
const TYPES: StateType[] = ['text', 'integer', 'enum', 'time']
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
function setNumber(key: 'min' | 'max' | 'stepMin' | 'stepMax', raw: string): void {
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

/**
 * 数字初值：清空不许进草稿（缺 `initial` 会让渲染期的 `initialTreeOf` 抛错、整页卡住），
 * 并且要把输入框的显示恢复成草稿里的旧值 —— 否则界面空白、草稿还是 80（N-5）。
 */
function setInitial(input: HTMLInputElement): void {
  if (input.value.trim() === '') {
    input.value = String(props.element.initial ?? '')
    return
  }
  const value = Number(input.value)
  if (!Number.isFinite(value)) return
  emit('edit', { ...props.element, initial: value })
}

/** 下拉白名单：一行一个，空行不算一项；旧值不在新表里 ⇒ 重置为第一项（契约 §2.2） */
function setValues(raw: string): void {
  const values = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  // 白名单被清空时没有「第一项」可重置：保留旧值，保存校验会拦住空白名单
  const keep = typeof props.element.initial === 'string' && values.includes(props.element.initial)
  emit('edit', {
    ...props.element,
    values,
    ...(keep || values.length === 0 ? {} : { initial: values[0] }),
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
  <div class="form">
    <div class="fields stack">
      <div class="field-row">
        <span class="field-label">{{ t('editor.stateType') }}</span>
        <select
          data-state-type
          :value="element.type"
          :disabled="element.type === 'time'"
          @change="withType(($event.target as HTMLSelectElement).value as StateType)"
        >
          <!-- 导入的卡里真有一个结构体时照实显示它；作者新建 / 换类型只能选下面那四档 -->
          <option v-if="element.type === 'object'" value="object">{{ typeLabel('object') }}</option>
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

      <label v-if="element.type === 'enum'" class="stack">
        <span class="field-label">{{ t('editor.fieldValues') }}</span>
        <textarea
          class="values"
          data-field="values"
          :value="(element.values ?? []).join('\n')"
          @input="setValues(($event.target as HTMLTextAreaElement).value)"
        ></textarea>
      </label>

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
        <!-- 存档模式：这一局的当前值（读自 save.tree），改上下限时照着它判会不会越界 -->
        <div v-if="currentValue !== undefined" class="field-row">
          <span class="field-label">{{ t('editor.fieldCurrent') }}</span>
          <span class="current" data-current-value>{{ currentValue }}</span>
        </div>
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
      </template>
    </div>

    <!-- 初始值：新建存档时的种子。存档模式不渲染（这一局的当前值在 save.tree 里） -->
    <div v-if="!initialLocked && element.type !== 'object'" class="initial stack" data-initial-block>
      <span class="field-label">{{ t('editor.fieldInitial') }}</span>
      <template v-if="element.type === 'enum'">
        <select
          data-field="initial"
          :value="element.initial"
          @change="emit('edit', { ...element, initial: ($event.target as HTMLSelectElement).value })"
        >
          <option v-for="value in element.values ?? []" :key="value" :value="value">{{ value }}</option>
        </select>
      </template>
      <template v-if="element.type === 'integer'">
        <input
          type="number"
          class="num"
          data-field="initial"
          :value="element.initial ?? ''"
          @input="setInitial($event.target as HTMLInputElement)"
        />
      </template>
      <template v-if="element.type === 'text'">
        <input
          data-field="initial"
          :value="element.initial"
          @input="emit('edit', { ...element, initial: ($event.target as HTMLInputElement).value })"
        />
      </template>
      <template v-if="element.type === 'time'">
        <div class="time-row">
          <span v-for="part in TIME_PARTS" :key="part" class="time-part">
            <input
              type="number"
              class="num"
              :data-field="`time-${part}`"
              :aria-label="unitLabel(part)"
              :value="timeOf()[part]"
              @input="setTimePart(part, ($event.target as HTMLInputElement).value)"
            />
            <span class="time-unit" :data-time-unit="part">{{ unitLabel(part) }}</span>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

/*
 * 中栏分两段：上半 = 结构字段（至少占一半），下半 = 初始值块（从 ~50% 起往下排）。
 * 不用 `margin-top: auto` 贴底 —— 那会把初始值一直沉到中栏最底下，不是「下半部分」。
 * 字段多过一半就往下长，两块合计放不下时由 `.form` 自己滚（`padding-top` 保证 ≥16px 的缝）。
 */
.fields {
  flex: 0 0 auto;
  min-height: 50%;
}

.initial {
  flex: 0 0 auto;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.num {
  flex: 0 0 auto;
  width: 72px;
}

.current {
  font-size: var(--fs2);
}

.values {
  min-height: 96px;
  width: 100%;
}

.time-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.time-part {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}

.time-unit {
  font-size: var(--fs3);
  color: var(--ink-soft);
}
</style>
