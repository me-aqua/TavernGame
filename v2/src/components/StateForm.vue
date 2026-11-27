<script setup lang="ts">
/**
 * 中栏 · 选中状态元素时的那张表（CONTRACT §8.2）：类型、名字、备注、类型自己的格子、初始值。
 *
 * 作者能选的类型只有**文字 / 数字 / 下拉 / 时间**：`object` 是「有子元素」的后台形态，
 * 不在类型下拉里出现（导入的卡里真有一个 `object` 元素时，下拉会把它照实显示出来）。
 *
 * 各类型的格子：
 *   · `text` 初始值一个文本框；`integer` 上下限 + 单次步幅 + 初始值；`enum` 取值白名单（一行一个）+ 初始值下拉；
 *   · `object` 没有自身值（初始值那一格整块不出现）；`time` 是时间值 + 模式 + 颗粒度 + 三个节日勾选，类型只读。
 *
 * 初始值只挂在**根元素**上（CONTRACT §2.2 · A4），所以「初始值块」只在选中的是根元素时渲染：
 *   · `[data-field="initial"]` 编根元素**自己**的值（有孩子时它是 `<code>.0`）；
 *   · `[data-initial-path="<path>"]` 编子树里每一条后代值路径（按 `pathsOf` 顺序）；
 *   · 选中的是子元素 ⇒ 整块不渲染（子元素自己没有初始值可编，也不重复显示根的）。
 * 编辑初始值只**发起请求**（`initial` 事件）：真正写进所属根那张表的活归 `statetree.setInitial`。
 * 换类型同理 —— 只发 `retype` 请求，整份新元素由 `statetree.setElementType` 产出。
 *
 * 存档模式（`initialLocked`）：初始值整块不渲染（这一局的当前值在 `save.tree` 里），时间模式下拉锁死；
 * 节日勾选照旧可改（它们影响的是提示词，不是这一局的状态）。
 */
import { computed } from 'vue'
import { HOLIDAY_GROUPS, NO_HOLIDAYS } from '../core/holidays'
import { TIME_MODES, cellsOfMode, elementOfPath, pathsOf, rootCodeOf, unitsOfMode } from '../core/statetree'
import type {
  Holidays,
  InitialTable,
  StateElement,
  StateType,
  StateValue,
  TimeMode,
  TimeUnit,
  TimeValue,
  YearMinuteValue,
} from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  element: StateElement
  /** 整棵状态树：初始值要按「值路径 → 元素」找控件，也要按 `pathsOf` 排顺序 */
  state: StateElement[]
  /** 存档模式：初始值不可改（初值只是新建存档的种子），时间模式锁死 */
  initialLocked?: boolean
  /** 存档模式：这一格在 `save.tree` 里的当前值（数字元素显示在上下限下方） */
  currentValue?: StateValue
}>()
const emit = defineEmits<{
  /** 换掉整份元素（名字 / 备注 / 白名单 / 上下限 / 节日勾选这类**结构**字段） */
  edit: [element: StateElement]
  /** 换类型：只发请求，整份新元素由 `statetree.setElementType` 产出；下拉元素一起带上，被拒时好拨回去 */
  retype: [type: StateType, select: HTMLSelectElement]
  /** 改初始值：`path` 是值路径，写进所属根元素那张表 */
  initial: [path: string, value: StateValue]
  /** 换时间模式（要确认）：把下拉元素一起带上，取消时好拨回去 */
  'time-mode': [mode: TimeMode, select: HTMLSelectElement]
}>()

/** 作者能选的类型（`object` 不在这里：它是「有子元素」的后台形态） */
const TYPES: StateType[] = ['text', 'integer', 'enum', 'time']

/** 类型标签住文案表：`editor.typeText` / `editor.typeInteger` / … */
function typeLabel(type: StateType): string {
  return t(`editor.type${type.charAt(0).toUpperCase()}${type.slice(1)}`)
}

function unitLabel(unit: TimeUnit): string {
  return t(`time.unit.${unit}`)
}

/** 时间模式标签：`time.mode.year-minute` / … */
function modeLabel(mode: TimeMode): string {
  return t(`time.mode.${mode}`)
}

/** 选中的是不是根元素（初始值只挂在根元素上） */
const isRoot = computed(() => !props.element.code.includes('.'))

/** 时间元素一定有模式（`cardIssues` 兜住缺失）；别的类型身上这一格不参与渲染 */
const mode = computed<TimeMode>(() => props.element.timeMode ?? 'year-minute')

/** 时间值本身（时间根的 `initial` 就是它） */
const timeValue = computed(() => props.element.initial as TimeValue)

/** 三个节日勾选的当前值（缺省 = 全关；增量写回时只换这一格） */
const holidays = computed<Holidays>(() => props.element.holidays ?? NO_HOLIDAYS)

/** 所属根元素身上那张「值路径 → 值」的表（时间根不是表，拿到的是时间值，不参与） */
const table = computed<InitialTable>(() => {
  const root = props.state.find((item) => item.code === rootCodeOf(props.element.code))
  const initial = root?.initial
  return typeof initial === 'object' && initial !== null && !Array.isArray(initial)
    ? (initial as InitialTable)
    : {}
})

/** 这个元素覆盖的值路径（首项 = 它自己的值；`object` 的首项就是第一个孩子的） */
const paths = computed(() => pathsOf(props.state, props.element.code))

/** 元素自己的值路径（有孩子的住 `.0`） */
const ownPath = computed(() => paths.value[0])

/** 后代值路径（根元素那一块的逐行控件；`object` 自己不是值路径） */
const descendants = computed(() => (props.element.type === 'object' ? paths.value : paths.value.slice(1)))

/** 自己那一格的当前初始值（时间根就是时间值本身） */
const ownValue = computed<StateValue | undefined>(() =>
  props.element.type === 'time' ? (props.element.initial as StateValue) : table.value[ownPath.value],
)

/** 时间值的格子（5 / 3 / 3）与可推进单位都跟着模式走 */
const cells = computed(() => cellsOfMode(mode.value))
const units = computed(() => unitsOfMode(mode.value))

/** 初始值块：只在「选中的是根元素」且非存档模式时渲染 */
const showsInitial = computed(() => !props.initialLocked && isRoot.value)

/** 某条后代值路径归哪个元素（控件的类型跟着它走） */
function ownerOf(path: string): StateElement | undefined {
  return elementOfPath(props.state, path)
}

function nameOf(path: string): string {
  return ownerOf(path)?.name ?? ''
}

function valuesOf(path: string): string[] {
  return ownerOf(path)?.values ?? []
}

function valueOfPath(path: string): StateValue | undefined {
  return table.value[path]
}

/** 时间值某一格（模板里读不出联合类型的格子，这里收成数字） */
function cellValue(cell: keyof YearMinuteValue): number {
  return (timeValue.value as unknown as Record<string, number>)[cell]
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

/** 数字初始值：清空不许进草稿（空值不是合法的整数值），输入框恢复成草稿里的旧值 */
function setIntegerInitial(input: HTMLInputElement, path: string): void {
  if (input.value.trim() === '') {
    input.value = String(valueOfPath(path) ?? '')
    return
  }
  const value = Number(input.value)
  if (!Number.isFinite(value)) return
  emit('initial', path, value)
}

/** 文字初始值 */
function setTextInitial(path: string, raw: string): void {
  emit('initial', path, raw)
}

/** 下拉白名单：一行一个，空行不算一项；旧值不在新表里 ⇒ 重置为第一项（契约 §2.2） */
function setValues(raw: string): void {
  const values = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  // 白名单被清空时没有「第一项」可重置：保留旧值，保存校验会拦住空白名单
  const keep = typeof ownValue.value === 'string' && values.includes(ownValue.value)
  emit('edit', { ...props.element, values })
  if (!keep && values.length > 0 && ownPath.value !== undefined) emit('initial', ownPath.value, values[0])
}

/** 时间的一格：只认整数 */
function setTimeCell(cell: keyof YearMinuteValue, raw: string): void {
  if (raw.trim() === '') return
  const value = Number(raw)
  if (!Number.isInteger(value)) return
  emit('initial', props.element.code, { ...(timeValue.value as TimeValue), [cell]: value } as TimeValue)
}

/** 勾一个节日：只换这一格，另外两格照旧 */
function setHoliday(group: keyof Holidays, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  emit('edit', { ...props.element, holidays: { ...holidays.value, [group]: checked } })
}

/** 换类型：只发请求；下拉元素一起带上 —— 被拒时草稿没变，`:value` 不会重绘它，得手动拨回去 */
function requestType(event: Event): void {
  const select = event.target as HTMLSelectElement
  emit('retype', select.value as StateType, select)
}

/** 换时间模式：先发请求（页面弹确认），草稿此刻一个字都不动 */
function requestMode(event: Event): void {
  const select = event.target as HTMLSelectElement
  emit('time-mode', select.value as TimeMode, select)
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
          @change="requestType($event)"
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
          <span class="field-label">{{ t('editor.fieldTimeMode') }}</span>
          <select
            data-field="time-mode"
            :value="mode"
            :disabled="initialLocked"
            @change="requestMode($event)"
          >
            <option v-for="item in TIME_MODES" :key="item" :value="item">{{ modeLabel(item) }}</option>
          </select>
        </label>
        <label class="field-row">
          <span class="field-label">{{ t('editor.fieldGranularityUpper') }}</span>
          <select
            data-field="granularity-upper"
            :value="element.granularityUpper"
            @change="setUnit('granularityUpper', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="unit in units" :key="unit" :value="unit">{{ unitLabel(unit) }}</option>
          </select>
        </label>
        <label class="field-row">
          <span class="field-label">{{ t('editor.fieldGranularityLower') }}</span>
          <select
            data-field="granularity-lower"
            :value="element.granularityLower"
            @change="setUnit('granularityLower', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="unit in units" :key="unit" :value="unit">{{ unitLabel(unit) }}</option>
          </select>
        </label>
        <!-- 三个节日勾选：只在前两个模式渲染；三个都**永远可点**（传统节日的年份范围问题静默不产出） -->
        <div v-if="mode !== 'days-minute'" class="holidays stack" data-holidays>
          <label v-for="group in HOLIDAY_GROUPS" :key="group" class="field-row holiday-row">
            <input
              type="checkbox"
              :data-holiday="group"
              :checked="holidays[group]"
              @change="setHoliday(group, $event)"
            />
            <span>{{ t(`editor.holiday${group.charAt(0).toUpperCase()}${group.slice(1)}`) }}</span>
            <span v-if="group === 'traditional'" class="holiday-note" data-holiday-note>{{
              t('editor.holidayTraditionalNote')
            }}</span>
          </label>
        </div>
      </template>
    </div>

    <!-- 初始值：新建存档时的种子，只挂在**根元素**身上。存档模式不渲染（这一局的当前值在 save.tree 里） -->
    <div v-if="showsInitial" class="initial stack" data-initial-block>
      <span class="field-label">{{ t('editor.fieldInitial') }}</span>

      <!-- 根元素自己的那一格（时间根是 5 / 3 / 3 个格子） -->
      <template v-if="element.type === 'time'">
        <div class="time-row">
          <span v-for="cell in cells" :key="cell" class="time-part">
            <input
              type="number"
              class="num"
              :data-field="`time-${cell}`"
              :aria-label="unitLabel(cell)"
              :value="cellValue(cell)"
              @input="setTimeCell(cell, ($event.target as HTMLInputElement).value)"
            />
            <span class="time-unit" :data-time-unit="cell">{{ unitLabel(cell) }}</span>
          </span>
        </div>
      </template>
      <template v-else-if="element.type === 'object'"></template>
      <template v-else-if="element.type === 'enum'">
        <select
          data-field="initial"
          :value="ownValue"
          @change="emit('initial', ownPath, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="value in element.values ?? []" :key="value" :value="value">{{ value }}</option>
        </select>
      </template>
      <template v-else-if="element.type === 'integer'">
        <input
          type="number"
          class="num"
          data-field="initial"
          :value="ownValue ?? ''"
          @input="setIntegerInitial($event.target as HTMLInputElement, ownPath)"
        />
      </template>
      <template v-else>
        <input
          data-field="initial"
          :value="ownValue"
          @input="setTextInitial(ownPath, ($event.target as HTMLInputElement).value)"
        />
      </template>

      <!-- 子树上每一条后代值路径：一行一个控件，标签是那个元素的名字 -->
      <div v-if="descendants.length > 0" class="descendants stack">
        <span class="field-label">{{ t('editor.initialDescendant') }}</span>
        <div v-for="path in descendants" :key="path" class="initial-row">
          <span class="initial-name ellipsis" :data-initial-name="path">{{ nameOf(path) }}</span>
          <span class="initial-code">{{ path }}</span>
          <select
            v-if="ownerOf(path)?.type === 'enum'"
            :data-initial-path="path"
            :value="valueOfPath(path)"
            @change="emit('initial', path, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="value in valuesOf(path)" :key="value" :value="value">{{ value }}</option>
          </select>
          <input
            v-else-if="ownerOf(path)?.type === 'integer'"
            type="number"
            class="num"
            :data-initial-path="path"
            :value="valueOfPath(path) ?? ''"
            @input="setIntegerInitial($event.target as HTMLInputElement, path)"
          />
          <input
            v-else
            :data-initial-path="path"
            :value="valueOfPath(path)"
            @input="setTextInitial(path, ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
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

.holiday-row {
  justify-content: flex-start;
  gap: 6px;
}

.holiday-note {
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.initial-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.initial-name {
  flex: 0 0 auto;
  max-width: 40%;
  font-size: var(--fs2);
}

.initial-code {
  flex: 0 0 auto;
  font-size: var(--fs3);
  color: var(--ink-soft);
}
</style>
