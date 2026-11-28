<script setup lang="ts">
/**
 * 源 item 选择器（引用契约 §6.2 / §6.3）：只列满足筛选条件、还没被选中的 item。
 *
 * 每行显示**投影字段**（不是裸 id）；可以按投影字段搜索；`[data-ref-picker-close]` 不开火地关掉。
 * 候选为空时一个 `[data-ref-candidate]` 都不渲染 —— 源数组为空、或筛选后没有 item，就是空列表。
 */
import { computed, ref } from 'vue'
import { candidatesOf, rowTextOf } from './ref-support'
import type { StateElement } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  state: StateElement[]
  /** 引用元素：投影字段与筛选条件都从它取 */
  element: StateElement
  /** 源数组现在的 item 列表（初始值模式来自卡，当前值模式来自 `save.tree`） */
  items: unknown
  /** 已经选中的 id（多引用时不再出现在候选里，防重复） */
  taken: string[]
}>()
const emit = defineEmits<{ pick: [id: string]; close: [] }>()

/** 搜索框的草稿：只过滤候选行，不写卡 */
const query = ref('')

/** 候选行：id + 投影文字（搜索按投影文字匹配） */
const rows = computed(() =>
  candidatesOf(props.element, props.items, props.taken)
    .map((item) => ({ id: String(item.id), text: rowTextOf(props.state, props.element, item) }))
    .filter((row) => query.value === '' || row.text.includes(query.value)),
)

/** 搜索框输入：清空即恢复全部候选 */
function setQuery(event: Event): void {
  query.value = (event.target as HTMLInputElement).value
}
</script>

<template>
  <div class="picker-backdrop">
    <div class="picker" data-ref-picker role="dialog" aria-modal="true">
      <input
        class="picker-search"
        data-ref-picker-search
        :value="query"
        :placeholder="t('editor.refSearch')"
        @input="setQuery"
      />
      <div class="picker-rows scroll">
        <button
          v-for="row in rows"
          :key="row.id"
          type="button"
          class="picker-row"
          :data-ref-candidate="row.id"
          @click="emit('pick', row.id)"
        >
          {{ row.text }}
        </button>
      </div>
      <div class="row picker-actions">
        <button type="button" data-ref-picker-close @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(20 15 10 / 45%);
  z-index: 19;
}

.picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 360px;
  max-width: calc(100vw - 32px);
  max-height: 60vh;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: var(--panel);
  box-shadow: 0 8px 24px rgb(0 0 0 / 25%);
}

.picker-search {
  width: 100%;
}

.picker-rows {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow: auto;
}

/* 一行候选 = 一条 item 的投影文字；整行可点，选中即写回 */
.picker-row {
  flex: 0 0 auto;
  text-align: left;
}

.picker-actions {
  justify-content: flex-end;
}
</style>
