<script setup lang="ts">
/**
 * 中栏 · 选中状态元素时的那张表（CONTRACT §8.2）：类型、名字、备注、类型自己的格子、初始值。
 *
 * 作者能选的类型是**文字 / 数字 / 下拉 / 时间 / 数组**：`object` 是「有子元素」的后台形态，
 * 不在类型下拉里出现（导入的卡里真有一个 `object` 元素时，下拉会把它照实显示出来）。
 *
 * **第一行「类型」对时间元素就是模式选择器**（CONTRACT §2.6）：选中的是时间元素时它显示
 * 年-分钟 / 年-日期 / 天数-分钟，底层 `type` 永远是 `time`；作者能选哪几个模式只由 `TIME_MODES` 决定。
 *
 * 各类型的格子：
 *   · `text` 初始值一个文本框；`integer` 上下限 + 单次步幅 + 初始值；`enum` 取值白名单（一行一个）+ 初始值下拉；
 *   · `object` 没有自身值（初始值那一格整块不出现）；`time` 是时间值 + 三个节日勾选；
 *   · `array` 的初始值是一份 item 列表（`ArrayValue` 组件），每项的字段值住在那份 JSON 里。
 *
 * 初始值只挂在**根元素**上（CONTRACT §2.2 · A4），所以「初始值块」只在选中的是根元素时渲染：
 *   · 每一行 = 一条值路径（`pathsOf` 顺序），从左到右是**显示编号 → 中文名 → 值控件**；
 *   · 显示编号是存储路径去掉结尾的 `.0`（`1.1.0` 显示 `1.1`），缩进与左栏同一把尺（每层 12px）；
 *   · 根元素自己的那一格带 `[data-field="initial"]`，后代带 `[data-initial-path="<存储路径>"]`；
 *   · integer 行的输入框右边带 `min~max` 小字（生效上下限）；
 *   · 数组路径那一行不是文本框，而是 `[data-array="<数组 code>"]` 的 item 列表编辑块。
 * 编辑初始值只**发起请求**（`initial` 事件）：真正写进所属根那张表的活归 `statetree.setInitial`。
 * 换类型同理 —— 只发 `retype` 请求，整份新元素由 `statetree.setElementType` 产出。
 *
 * 存档模式（`initialLocked`）：初始值整块不渲染（这一局的当前值在 `save.tree` 里），类型 / 模式下拉锁死；
 * 选中数组元素时给只读的 `[data-current-array]` 当前值块；节日勾选照旧可改（它们影响的是提示词，
 * 不是这一局的状态）。
 */
import { computed } from 'vue'
import ArrayValue from './ArrayValue.vue'
import { HOLIDAY_GROUPS, NO_HOLIDAYS } from '../core/holidays'
import {
  TIME_MODES,
  cellsOfMode,
  elementOfPath,
  isInsideArray,
  integerRangeOf,
  pathsOf,
  rootCodeOf,
} from '../core/statetree'
import type {
  Holidays,
  InitialTable,
  StateElement,
  StateType,
  StateValue,
  TimeMode,
  TimeUnit,
  TimeValue,
  TreeValue,
  YearMinuteValue,
} from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  element: StateElement
  /** 整棵状态树：初始值要按「值路径 → 元素」找控件，也要按 `pathsOf` 排顺序 */
  state: StateElement[]
  /** 存档模式：初始值不可改（初值只是新建存档的种子），时间模式锁死 */
  initialLocked?: boolean
  /** 存档模式：这一格在 `save.tree` 里的当前值（数字 / 数组元素显示在下方） */
  currentValue?: TreeValue
}>()
const emit = defineEmits<{
  /** 换掉整份元素（名字 / 备注 / 白名单 / 上下限 / 节日勾选这类**结构**字段） */
  edit: [element: StateElement]
  /** 换类型：只发请求，整份新元素由 `statetree.setElementType` 产出；下拉元素一起带上，被拒时好拨回去 */
  retype: [type: StateType, select: HTMLSelectElement]
  /** 改初始值：`path` 是值路径，写进所属根元素那张表（数组路径的值就是整份数组） */
  initial: [path: string, value: TreeValue]
  /** 换时间模式（要确认）：把下拉元素一起带上，取消时好拨回去 */
  'time-mode': [mode: TimeMode, select: HTMLSelectElement]
}>()

/** 作者能选的类型（`object` 是「有孩子」的形态：只在导入的卡里照实显示，不是可选类型） */
const TYPES: StateType[] = ['text', 'integer', 'enum', 'time', 'array']

/** 类型标签住文案表：`editor.typeText` / `editor.typeInteger` / … */
function typeLabel(type: StateType): string {
  return t(`editor.type${type.charAt(0).toUpperCase()}${type.slice(1)}`)
}

/**
 * 类型下拉的可选档（增补 §十.5 / 老板口径）：**「结构体」不是可选类型，它就是「有孩子」**。
 *   · 数组（数组子树之外）⇒ `text` / `integer` / `enum` / `array`（换成标量时字段留成孩子、
 *     第 1 项的值铺进孩子、自己的默认值写 `<code>.0`；不许换成时间）；
 *   · 对象（导入的卡）⇒ 不列 `object`（结构体是内部形态）；只列作者选项（含 `array`，好走 结构体 → 数组）；
 *   · 数组字段 ⇒ 只有 `array`（逐 item 的容器转换不在本票范围，数据层也会拒）；
 *   · 其它元素 ⇒ 作者选项原样。
 */
const typeOptions = computed<StateType[]>(() => {
  const element = props.element
  const field = isInsideArray(props.state, element.code)
  if (element.type === 'array') return field ? ['array'] : ['text', 'integer', 'enum', 'array']
  // 「结构体」任何一行都不出现在下拉里（它是内部形态）：导入的 object 元素只列作者选项
  if (element.type === 'object')
    return field ? ['text', 'integer', 'enum', 'time'] : ['text', 'integer', 'enum', 'time', 'array']
  return [...TYPES]
})

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

/** 这个元素覆盖的值路径（首项 = 它自己的值；`object` 的首项就是第一个孩子的；数组只有它自己） */
const paths = computed(() => pathsOf(props.state, props.element.code))

/** 标量值路径：一行一个控件（数组路径另有整块编辑组件） */
const scalarPaths = computed(() => paths.value.filter((path) => ownerOf(path)?.type !== 'array'))

/** 数组值路径：初始值块里的 item 列表编辑块（`[data-array]`） */
const arrayPaths = computed(() => paths.value.filter((path) => ownerOf(path)?.type === 'array'))

/** 元素自己的值路径（有孩子的住 `.0`） */
const ownPath = computed(() => paths.value[0])

/** 自己那一格的当前初始值（时间根就是时间值本身） */
const ownValue = computed<TreeValue | undefined>(() =>
  props.element.type === 'time' ? (props.element.initial as StateValue) : table.value[ownPath.value],
)

/** 时间值的格子（5 / 3 / 3）跟着模式走 */
const cells = computed(() => cellsOfMode(mode.value))

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

function valueOfPath(path: string): TreeValue | undefined {
  return table.value[path]
}

/** 这一行是不是根元素自己的值（`object` 没有自身值；只有自己那一行带 `[data-field="initial"]`） */
function isOwn(path: string): boolean {
  return props.element.type !== 'object' && path === ownPath.value
}

/** 屏上显示的编号：存储路径去掉结尾的 `.0`（`1.1.0` ⇒ `1.1`） */
function displayCode(path: string): string {
  return path.endsWith('.0') ? path.slice(0, -2) : path
}

/** 与左栏同一把尺：显示编号每多一段，行右移 12px */
function codeIndent(path: string): number {
  return (displayCode(path).split('.').length - 1) * 12
}

/** integer 行的 `min~max` 小字：与校验共用 `integerRangeOf` 的生效上下限 */
function rangeOf(path: string): string {
  const { min, max } = integerRangeOf(ownerOf(path) as StateElement)
  return `${min}~${max}`
}

/** 节日勾选的可见文案（也是那只自定义勾选框的无障碍名字） */
function holidayLabel(group: keyof Holidays): string {
  return t(`editor.holiday${group.charAt(0).toUpperCase()}${group.slice(1)}`)
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
function setHoliday(group: keyof Holidays): void {
  emit('edit', { ...props.element, holidays: { ...holidays.value, [group]: !holidays.value[group] } })
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
</script>

<template>
  <div class="form">
    <div class="fields stack">
      <div class="field-row">
        <span class="field-label">{{ t('editor.stateType') }}</span>
        <!-- 时间元素：这一行就是模式选择器（底层 type 仍是 time）；别的元素照旧选类型。
             存档模式整格锁死（`initialLocked`）：换类型改的是卡的种子值，不属于这一局。 -->
        <select
          data-state-type
          data-field="type"
          :value="element.type === 'time' ? mode : element.type"
          :disabled="initialLocked"
          @change="element.type === 'time' ? requestMode($event) : requestType($event)"
        >
          <template v-if="element.type === 'time'">
            <option v-for="item in TIME_MODES" :key="item" :value="item">{{ modeLabel(item) }}</option>
          </template>
          <template v-else>
            <!-- 选项由 `typeOptions` 决定：数组行 = text/integer/enum/array，对象行多一档 object，数组字段只留 array -->
            <option v-for="type in typeOptions" :key="type" :value="type">{{ typeLabel(type) }}</option>
          </template>
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

      <!-- 存档模式：数组元素的当前值（读自 save.tree，只读、没有增删） -->
      <div v-if="element.type === 'array' && currentValue !== undefined" class="current-array">
        <span class="field-label">{{ t('editor.fieldCurrent') }}</span>
        <ArrayValue :state="state" :code="element.code" :value="currentValue" current top disabled />
      </div>

      <!-- 三个节日勾选同一水平行、左对齐；勾选框是自定义绘制的小方盒（不是浏览器原生蓝框） -->
      <div v-if="element.type === 'time' && mode !== 'days-minute'" class="holidays" data-holidays>
        <div v-for="group in HOLIDAY_GROUPS" :key="group" class="holiday-row">
          <span
            class="holiday-box"
            role="checkbox"
            tabindex="0"
            :aria-checked="holidays[group] ? 'true' : 'false'"
            :aria-label="holidayLabel(group)"
            :data-holiday="group"
            @click="setHoliday(group)"
            @keydown.space.prevent="setHoliday(group)"
          ></span>
          <span class="holiday-name" @click="setHoliday(group)">{{ holidayLabel(group) }}</span>
          <span v-if="group === 'traditional'" class="holiday-note" data-holiday-note>{{
            t('editor.holidayTraditionalNote')
          }}</span>
        </div>
      </div>
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
      <!-- 其余根元素：每条值路径一行，编号 → 中文名 → 值控件；缩进与左栏同一把尺 -->
      <div v-else class="initial-rows">
        <div
          v-for="path in scalarPaths"
          :key="path"
          class="initial-row"
          :data-initial-row="path"
          :style="{ marginLeft: `${codeIndent(path)}px` }"
        >
          <span class="initial-code" data-initial-code>{{ displayCode(path) }}</span>
          <span class="initial-name ellipsis" :data-initial-name="path">{{ nameOf(path) }}</span>
          <select
            v-if="ownerOf(path)?.type === 'enum'"
            :data-field="isOwn(path) ? 'initial' : undefined"
            :data-initial-path="isOwn(path) ? undefined : path"
            :value="valueOfPath(path)"
            @change="emit('initial', path, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="value in valuesOf(path)" :key="value" :value="value">{{ value }}</option>
          </select>
          <template v-else-if="ownerOf(path)?.type === 'integer'">
            <input
              type="number"
              class="num"
              :data-field="isOwn(path) ? 'initial' : undefined"
              :data-initial-path="isOwn(path) ? undefined : path"
              :value="valueOfPath(path) ?? ''"
              @input="setIntegerInitial($event.target as HTMLInputElement, path)"
            />
            <span class="initial-range" data-initial-range>{{ rangeOf(path) }}</span>
          </template>
          <input
            v-else
            :data-field="isOwn(path) ? 'initial' : undefined"
            :data-initial-path="isOwn(path) ? undefined : path"
            :value="valueOfPath(path)"
            @input="setTextInitial(path, ($event.target as HTMLInputElement).value)"
          />
        </div>

        <!-- 数组值：整份 item 列表的编辑块（加 / 删一项、每个字段一个控件） -->
        <div
          v-for="path in arrayPaths"
          :key="path"
          class="initial-array"
          :data-initial-row="path"
          :style="{ marginLeft: `${codeIndent(path)}px` }"
        >
          <div class="initial-row">
            <span class="initial-code" data-initial-code>{{ displayCode(path) }}</span>
            <span class="initial-name ellipsis" :data-initial-name="path">{{ nameOf(path) }}</span>
          </div>
          <ArrayValue
            :state="state"
            :code="path"
            :value="valueOfPath(path)"
            top
            @change="(value) => emit('initial', path, value)"
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

/*
 * 三个节日勾选：**永远同一水平行、左对齐**。中栏窄到放不下时由这一行自己横向滚动，
 * 不换行、也不给页面加横向溢出。
 */
.holidays {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 12px;
  min-width: 0;
  overflow-x: auto;
}

.holiday-row {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  align-items: center;
}

/*
 * 自定义勾选框：视觉上是 14×14 的小方盒，颜色全取自页面变量（不用浏览器原生蓝框）。
 * `::before` 把**点按热区**扩到 24×24（WCAG 2.5.8）—— 盒子的盒子模型不因此改变，
 * e2e 量到的 `getBoundingClientRect()` 仍是 14×14。
 */
.holiday-box {
  position: relative;
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  appearance: none;
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  background: var(--panel);
  cursor: pointer;
}

.holiday-box::before {
  content: '';
  position: absolute;
  inset: -5px;
}

.holiday-box[aria-checked='true'] {
  background: var(--accent);
  border-color: var(--accent);
}

.holiday-box[aria-checked='true']::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 0;
  width: 4px;
  height: 9px;
  border: solid var(--accent-ink);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

/* 文字也点得动（与勾选框同一动作）；备注小字不接指针，避免误触 */
.holiday-name {
  flex: 0 0 auto;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.holiday-note {
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.initial-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.initial-array {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.current-array {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.initial-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* 编号 / 名字是次要文字，值控件占剩下的宽度；integer 的 `.num` 保持 72px 再把 `min~max` 放在它右边 */
.initial-row > input:not(.num),
.initial-row > select {
  flex: 1 1 auto;
  min-width: 0;
}

.initial-name {
  flex: 0 1 auto;
  max-width: 34%;
  font-size: var(--fs2);
}

.initial-code {
  flex: 0 0 auto;
  min-width: 2ch;
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.initial-range {
  flex: 0 0 auto;
  font-size: var(--fs3);
  color: var(--ink-soft);
}
</style>
