<script setup lang="ts">
/**
 * 中栏 · 引用的定义块（引用契约 §5）：引用自 / 引用字段 / 筛选 / 最少最多。
 *
 *   · 引用自：只列状态树里的**数组**节点（嵌套数组字段也算），显示层级路径「编号 名字」；
 *     包含自己的数组（引用它会递归）仍列出来但 `disabled`；搜索框按编号 / 名字过滤；
 *   · 引用字段：源数组的**直接**标量字段（文字 / 数字 / 下拉），勾选顺序 = 投影顺序；
 *   · 筛选（可选）：单字段等值，值控件跟字段类型走（下拉 / 文本 / 数字），清空字段 = 不筛选；
 *   · 最少 / 最多：两个整数输入，默认 0 / 1。
 *
 * 换源会清掉已勾字段与筛选（旧源的字段 code 对新源没有意义），`min` / `max` 不动。
 * 这里**不夹取、不猜测**非法组合：`0 <= min <= max`、`1 <= max <= 999` 由数据层在保存时拦住并点名元素。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { scalarFieldsOf, sourceOptionsOf } from './ref-support'
import type { StateElement } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  state: StateElement[]
  /** 正在定义的引用元素 */
  element: StateElement
}>()
const emit = defineEmits<{ edit: [element: StateElement] }>()

/** 引用源候选（含不可选的：包含自己的数组） */
const options = computed(() => sourceOptionsOf(props.state, props.element))

/** 引用自的搜索草稿：按编号 / 名字过滤候选，清空恢复全部 */
const search = ref('')

/** 搜索之后仍然列出来的源（不可选的那些也在，只是 `disabled`） */
const visible = computed(() => {
  const query = search.value.trim()
  if (query === '') return options.value
  return options.value.filter(({ element }) => element.code.includes(query) || element.name.includes(query))
})

/** 选中源的直接标量字段：投影与筛选都只用这几档 */
const fields = computed(() => scalarFieldsOf(props.state, props.element.refSource))

/** 筛选字段定义（没选筛选 ⇒ undefined） */
const filterField = computed(() =>
  fields.value.find((field) => field.code === props.element.refFilter?.field),
)

/** 最少 / 最多（缺省 0 / 1，与数据层同一个真源） */
const min = computed(() => props.element.min ?? 0)
const max = computed(() => props.element.max ?? 1)

/**
 * 把默认的 `min = 0` / `max = 1` 写进卡：换类型时数据层会清掉这两格，缺省只在读的时候兜底 ——
 * 不补进卡的话，作者保存下来的引用身上没有数量约束。
 */
function ensureBounds(): void {
  if (props.element.min !== undefined && props.element.max !== undefined) return
  emit('edit', { ...props.element, min: props.element.min ?? 0, max: props.element.max ?? 1 })
}

onMounted(ensureBounds)

/** 换选中元素时同样补齐（组件实例不换，`onMounted` 只跑一次） */
watch(
  () => props.element.code,
  () => ensureBounds(),
)

/** 搜索框输入 */
function setSearch(event: Event): void {
  search.value = (event.target as HTMLInputElement).value
}

/** 换源：清掉已勾字段与筛选（`min` / `max` 保持），再让作者重新勾 */
function chooseSource(event: Event): void {
  const code = (event.target as HTMLSelectElement).value
  emit('edit', { ...props.element, refSource: code, refFields: [], refFilter: undefined })
}

/** 这个投影字段勾了没有 */
function isChosen(code: string): boolean {
  return (props.element.refFields ?? []).includes(code)
}

/** 勾 / 取消一个投影字段：勾上的追加到尾部，勾选顺序就是保存顺序 */
function toggleField(code: string): void {
  const chosen = props.element.refFields ?? []
  const next = chosen.includes(code) ? chosen.filter((item) => item !== code) : [...chosen, code]
  emit('edit', { ...props.element, refFields: next })
}

/** 筛选值的默认值：下拉取白名单第一项，数字 0，文字空串 */
function filterDefaultOf(field: StateElement): string | number {
  if (field.type === 'enum') return (field.values ?? [])[0] ?? ''
  if (field.type === 'integer') return 0
  return ''
}

/** 选筛选字段：`''` = 不筛选；换字段就把筛选值换成新字段的默认值 */
function chooseFilterField(event: Event): void {
  const code = (event.target as HTMLSelectElement).value
  if (code === '') {
    emit('edit', { ...props.element, refFilter: undefined })
    return
  }
  const field = fields.value.find((item) => item.code === code)
  if (field === undefined) return
  emit('edit', { ...props.element, refFilter: { field: code, value: filterDefaultOf(field) } })
}

/** 改筛选值：数字格只收整数，清空 / 非整数不写草稿（等作者打完） */
function setFilterValue(event: Event): void {
  const filter = props.element.refFilter
  const field = filterField.value
  if (filter === undefined || field === undefined) return
  const raw = (event.target as HTMLInputElement | HTMLSelectElement).value
  if (field.type !== 'integer') {
    emit('edit', { ...props.element, refFilter: { ...filter, value: raw } })
    return
  }
  if (raw.trim() === '') return
  const value = Number(raw)
  if (!Number.isInteger(value)) return
  emit('edit', { ...props.element, refFilter: { ...filter, value } })
}

/** 最少 / 最多：只收整数，清空不改草稿；范围合不合法由数据层在保存时判 */
function setBound(key: 'min' | 'max', event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  if (raw.trim() === '') return
  const value = Number(raw)
  if (!Number.isInteger(value)) return
  emit('edit', { ...props.element, [key]: value })
}
</script>

<template>
  <div class="ref-form stack" data-ref-form>
    <div class="field-row">
      <span class="field-label">{{ t('editor.refSource') }}</span>
      <select data-ref-source :value="element.refSource ?? ''" @change="chooseSource">
        <option value="">{{ t('editor.refSourceEmpty') }}</option>
        <option
          v-for="{ element: source, selectable } in visible"
          :key="source.code"
          :value="source.code"
          :disabled="!selectable"
        >
          {{ source.code }} {{ source.name }}
        </option>
      </select>
      <input
        class="ref-search"
        data-ref-source-search
        :value="search"
        :placeholder="t('editor.refSourceSearch')"
        @input="setSearch"
      />
    </div>

    <div v-if="fields.length > 0" class="ref-fields stack">
      <span class="field-label">{{ t('editor.refFields') }}</span>
      <label v-for="field in fields" :key="field.code" class="ref-field">
        <input
          type="checkbox"
          :data-ref-field="field.code"
          :checked="isChosen(field.code)"
          @change="toggleField(field.code)"
        />
        <span class="ref-field-name">{{ field.code }} {{ field.name }}</span>
      </label>
    </div>

    <div v-if="fields.length > 0" class="field-row">
      <span class="field-label">{{ t('editor.refFilter') }}</span>
      <select data-ref-filter-field :value="element.refFilter?.field ?? ''" @change="chooseFilterField">
        <option value="">{{ t('editor.refFilterNone') }}</option>
        <option v-for="field in fields" :key="field.code" :value="field.code">
          {{ field.code }} {{ field.name }}
        </option>
      </select>
      <template v-if="filterField">
        <select
          v-if="filterField.type === 'enum'"
          data-ref-filter-value
          :value="String(element.refFilter?.value ?? '')"
          @change="setFilterValue"
        >
          <option v-for="value in filterField.values ?? []" :key="value" :value="value">{{ value }}</option>
        </select>
        <input
          v-else-if="filterField.type === 'integer'"
          type="number"
          class="num"
          data-ref-filter-value
          :value="element.refFilter?.value ?? ''"
          @input="setFilterValue"
        />
        <input
          v-else
          type="text"
          data-ref-filter-value
          :value="element.refFilter?.value ?? ''"
          @input="setFilterValue"
        />
      </template>
    </div>

    <div class="field-row">
      <span class="field-label">{{ t('editor.refMin') }}</span>
      <input type="number" class="num" data-ref-min :value="min" @input="setBound('min', $event)" />
      <span class="field-label">{{ t('editor.refMax') }}</span>
      <input type="number" class="num" data-ref-max :value="max" @input="setBound('max', $event)" />
    </div>
  </div>
</template>

<style scoped>
.ref-form {
  gap: 6px;
  min-width: 0;
}

.field-row > select,
.ref-search {
  flex: 1 1 auto;
  min-width: 0;
}

.num {
  flex: 0 0 auto;
  width: 72px;
}

.ref-fields {
  gap: 2px;
}

/* 一档投影字段：勾选框 + 「编号 名字」，整行可点 */
.ref-field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  cursor: pointer;
}

.ref-field-name {
  font-size: var(--fs2);
}
</style>
