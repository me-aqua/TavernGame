<script setup lang="ts">
/**
 * 数组值的编辑块（阶段 3 契约 §4.2 / §4.3）：item 列表 + 每项每个字段一个控件。
 *
 * 一个组件管两种容器，由传进来的 `code` 的元素类型决定：
 *   · `array`（数组元素或数组字段）⇒ item 列表：`[data-array]`（存档模式的当前值是 `[data-current-array]`）；
 *   · `object` 字段 ⇒ 一组字段行：`[data-array-object]`，对象本身不再套 item。
 * 嵌套（对象里套数组、数组里套对象）靠**组件自己递归**；值永远是**整份**往上抛（`change`）：
 * 数组在 `tree` 里是一份 JSON，改一项也要整份交给 `setInitial`（没有「按下标改一格」的路径）。
 *
 * 显示只用中文名（`field.name`）：code 只住在 `data-*` 钩子里，界面上看不见。
 * 只读块（存档模式）不渲染加 / 删按钮，控件 `disabled`。
 *
 * `top` 只由初始值块传 true：`[data-array-item]` / `data-array-index` 是**顶层 item 列表**的钩子，
 * 嵌套数组不重复挂它（否则「外层有几个 item」会被内层的 item 数污染）。
 */
import { computed } from 'vue'
import { arrayItemOf, childrenOf, isRecord } from '../core/statetree'
import type { ArrayValue, ItemObject, ItemValue, StateElement } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  /** 整棵状态树：item 的字段定义与默认值都从它取 */
  state: StateElement[]
  /** 容器 code：数组元素 / 数组字段 / object 字段 */
  code: string
  value: unknown
  /** 存档模式的当前值块：只读、`[data-current-array]` */
  current?: boolean
  /** 顶层初始值块：给 item 挂 `[data-array-item]` / `[data-array-index]` */
  top?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  /** 这一层的整份值（数组 = item 列表；object = 那个对象） */
  change: [value: ArrayValue | ItemObject]
}>()

/** 这个容器的元素类型决定渲染形态（数组 ⇒ item 列表，别的 ⇒ object 字段块） */
const isArray = computed(() => props.state.find((item) => item.code === props.code)?.type === 'array')

/** 这一层的字段定义（顺序 = 左栏编号顺序） */
const fields = computed(() => childrenOf(props.state, props.code))

/** 数组 ⇒ 每个 item；object ⇒ 它自己那一个值（统一成列表，模板只写一遍） */
const items = computed<ItemObject[]>(() => {
  if (isArray.value) return Array.isArray(props.value) ? (props.value as ItemObject[]) : []
  return [isRecord(props.value) ? (props.value as ItemObject) : {}]
})

/** 往外抛：数组抛整份列表，object 抛列表里那一个对象 */
function commit(next: ItemObject[]): void {
  emit('change', isArray.value ? next : next[0])
}

/** 改一项里的一个字段 */
function setField(index: number, fieldCode: string, value: ItemValue): void {
  commit(items.value.map((item, at) => (at === index ? { ...item, [fieldCode]: value } : item)))
}

/** 追加一项：默认值来自 `arrayItemOf`（与「加字段」共用同一个真源） */
function addItem(): void {
  commit([...items.value, arrayItemOf(props.state, props.code)])
}

/** 删掉一项：剩下的按新顺序重排（`data-array-index` 是 1 基位置，重排由渲染自动完成） */
function removeItem(index: number): void {
  commit(items.value.filter((_, at) => at !== index))
}

/** 文本 / 下拉控件：值原样落进草稿 */
function onText(index: number, field: StateElement, event: Event): void {
  setField(index, field.code, (event.target as HTMLInputElement | HTMLSelectElement).value)
}

/** 整数控件：空输入不写草稿（输入框恢复旧值），合法整数才更新 */
function onInteger(index: number, field: StateElement, event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.value.trim() === '') {
    input.value = String(items.value[index]?.[field.code] ?? '')
    return
  }
  const value = Number(input.value)
  if (Number.isInteger(value)) setField(index, field.code, value)
}
</script>

<template>
  <div
    class="array"
    :data-array="isArray && !current ? code : undefined"
    :data-current-array="isArray && current ? code : undefined"
    :data-array-object="isArray ? undefined : code"
  >
    <div
      v-for="(item, index) in items"
      :key="index"
      class="item"
      :data-array-item="top && isArray ? '' : undefined"
      :data-array-index="top && isArray ? index + 1 : undefined"
    >
      <button
        v-if="isArray && !disabled"
        type="button"
        class="icon item-action"
        data-array-remove
        :title="t('editor.arrayRemove')"
        :aria-label="t('editor.arrayRemove')"
        @click="removeItem(index)"
      >
        {{ t('common.remove') }}
      </button>
      <div v-for="field in fields" :key="field.code" class="field">
        <span class="field-name ellipsis" :data-array-field-name="field.code">{{ field.name }}</span>
        <select
          v-if="field.type === 'enum'"
          :data-array-field="field.code"
          :value="item[field.code] ?? ''"
          :disabled="disabled"
          @change="onText(index, field, $event)"
        >
          <option v-for="option in field.values ?? []" :key="option" :value="option">{{ option }}</option>
        </select>
        <input
          v-else-if="field.type === 'integer'"
          type="number"
          class="num"
          :data-array-field="field.code"
          :value="item[field.code] ?? ''"
          :disabled="disabled"
          @input="onInteger(index, field, $event)"
        />
        <input
          v-else-if="field.type === 'text'"
          :data-array-field="field.code"
          :value="item[field.code] ?? ''"
          :disabled="disabled"
          @input="onText(index, field, $event)"
        />
        <!-- 对象 / 数组字段：递归一个同款组件（它自己带 `[data-array-object]` / `[data-array]`） -->
        <ArrayValue
          v-else
          :state="state"
          :code="field.code"
          :value="item[field.code]"
          :disabled="disabled"
          @change="(value) => setField(index, field.code, value)"
        />
      </div>
    </div>

    <span v-if="isArray && items.length === 0" class="empty" data-array-empty>{{
      t('editor.arrayEmpty')
    }}</span>
    <button v-if="isArray && !disabled" type="button" class="add" data-array-add @click="addItem">
      {{ t('editor.arrayAdd') }}
    </button>
  </div>
</template>

<style scoped>
.array {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding-left: 8px;
  border-left: 1px solid var(--line);
}

.item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
}

.item-action {
  align-self: flex-end;
}

.field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.field-name {
  flex: 0 1 auto;
  max-width: 34%;
  font-size: var(--fs2);
}

/* 值控件占剩下的宽度（数字框保持 `.num` 的 72px，与初始值行同一把尺） */
.field > input:not(.num),
.field > select {
  flex: 1 1 auto;
  min-width: 0;
}

.num {
  flex: 0 0 auto;
  width: 72px;
}

.empty {
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.add {
  align-self: flex-start;
}
</style>
