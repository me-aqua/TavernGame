<script setup lang="ts">
/**
 * 引用的值编辑器（引用契约 §6）：初始值 / 存档当前值 / 数组 item 里那一格共用同一套。
 *
 *   · 单引用（`max = 1`）：有值 ⇒ 一行；零条 ⇒ 「选择引用」按钮；
 *   · 多引用（`max > 1`）：行构建器 —— 每行一条、`+ 添加引用` 追加、`N / max` 计数、
 *     到达 `max` 时添加按钮禁用、删到最后一条回到 `null`；
 *   · 零条就是 `null`（不发明「空手 / 未持有」这类业务名字），没有预览面板；
 *   · 行里显示投影字段，永远不显示裸 id；候选来自源数组，已选中的不再出现在选择器里；
 *   · 少于 `min` 时行内红字（`[data-ref-error]`）；保存拦不拦由数据层的值校验判。
 */
import { computed, ref } from 'vue'
import RefPicker from './RefPicker.vue'
import { candidatesOf, itemOf, rowTextOf } from './ref-support'
import { isMultiRef, refBoundsOf, refIdsOf } from '../core/statetree'
import type { StateElement, TreeValue } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  state: StateElement[]
  /** 引用元素：`refSource` / `refFields` / `refFilter` / `min` / `max` */
  element: StateElement
  /** 源数组现在的 item 列表 */
  items: unknown
  value: unknown
  /** 只读（存档模式里的数组：没有增删按钮） */
  disabled?: boolean
}>()
const emit = defineEmits<{ change: [value: TreeValue] }>()

/** 多引用（`max > 1`）⇒ 行构建器；单引用只有一行 */
const multi = computed(() => isMultiRef(props.element))

/** 最少 / 最多（缺省 0 / 1，与数据层同一个真源） */
const bounds = computed(() => refBoundsOf(props.element))

/** 值里的 id（`null` ⇒ 空列表） */
const ids = computed(() => refIdsOf(props.element, props.value))

/** 已选的行：投影文字按源 item 现算，源 item 不见了就明确说它不在了 */
const rows = computed(() =>
  ids.value.map((id) => {
    const item = itemOf(props.items, id)
    return {
      id,
      text: item === undefined ? t('editor.refDangling') : rowTextOf(props.state, props.element, item),
    }
  }),
)

/** 选择器开着没有 */
const picking = ref(false)

/**
 * 多引用的值是 id 数组（有序、不重复）；`core` 的 `TreeValue` 只写了「item 对象数组」那一档，
 * 所以写回时按值树的一档交出去 —— 值路径那一格的形状由数据层的 `refShapeFits` 判。
 */
function valueTreeOf(ids0: string[]): TreeValue {
  return ids0 as unknown as TreeValue
}

/** 还可以再选几条（低于 `min` 时就是行内红字要说的数） */
const short = computed(() => rows.value.length < bounds.value.min)

/** 候选为空与「还差几个」是两种提示：前者点名筛选，后者点名数量 */
const errorText = computed(() =>
  candidatesOf(props.element, props.items, ids.value).length === 0
    ? t('editor.refNoCandidate', { min: bounds.value.min })
    : t('editor.refBelowMin', { min: bounds.value.min }),
)

/** 选一条：单引用写 id，多引用追加到尾部（顺序就是值的顺序） */
function pick(id: string): void {
  picking.value = false
  emit('change', multi.value ? valueTreeOf([...ids.value, id]) : id)
}

/** 删一行：删到零条就回到 `null`（不是空数组） */
function remove(at: number): void {
  const next = ids.value.filter((_, index) => index !== at)
  if (next.length === 0) {
    emit('change', null)
    return
  }
  emit('change', multi.value ? valueTreeOf(next) : next[0])
}
</script>

<template>
  <div class="ref-value">
    <div v-for="(row, at) in rows" :key="row.id" class="ref-row" :data-ref-row="at + 1">
      <span class="ref-text ellipsis">{{ row.text }}</span>
      <button
        v-if="!disabled"
        type="button"
        class="icon ref-remove"
        data-ref-row-remove
        :title="t('common.remove')"
        :aria-label="t('common.remove')"
        @click="remove(at)"
      >
        {{ t('common.remove') }}
      </button>
    </div>

    <button
      v-if="!disabled && !multi && rows.length === 0"
      type="button"
      class="ref-choose"
      data-ref-choose
      @click="picking = true"
    >
      {{ t('editor.refChoose') }}
    </button>

    <div v-if="multi" class="ref-add-row">
      <button
        v-if="!disabled"
        type="button"
        class="ref-add"
        data-ref-add
        :disabled="rows.length >= bounds.max"
        @click="picking = true"
      >
        {{ t('editor.refAdd') }}
      </button>
      <span class="ref-count" data-ref-count>{{ rows.length }} / {{ bounds.max }}</span>
    </div>

    <span v-if="short && !disabled" class="ref-error" data-ref-error>{{ errorText }}</span>

    <RefPicker
      v-if="picking"
      :state="state"
      :element="element"
      :items="items"
      :taken="ids"
      @pick="pick"
      @close="picking = false"
    />
  </div>
</template>

<style scoped>
.ref-value {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}

/* 一行已选引用：投影文字 + ×，与数组 item 的行同一把尺 */
.ref-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
}

.ref-text {
  flex: 1 1 auto;
  font-size: var(--fs2);
}

.ref-remove {
  flex: 0 0 auto;
}

.ref-add-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ref-add,
.ref-choose {
  flex: 0 0 auto;
  align-self: flex-start;
}

.ref-count {
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.ref-error {
  font-size: var(--fs3);
  color: var(--danger);
}
</style>
