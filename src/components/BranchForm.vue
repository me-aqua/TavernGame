<script setup lang="ts">
/**
 * 中栏：选中那一格的**只读字段表**（票 69 · 段 8b-①）。
 *
 * 一行一个字段：卡里的键名（判据逐行比它）· 界面词的类型 · 开局在不在（`initial`）。
 * 只画不算 —— 行由 `CardEditor` 从卡里现算（`object` 读自己的 `fields`，
 * `map` / `list` 读元素形状的 `of.fields`）。
 *
 * ⚠️ 本票**一个可编辑控件都不开**：表里没有输入框 / 垃圾桶 / 加字段（那是 8b-②）。
 *    每一行都带 `data-field-readonly` —— 只读是**标记**，不是「碰巧没控件」。
 * ⚠️ `initial` **两个值都显式打出来**（`yes` / `no`）：拿「属性不在」当 `no`，判据就分不出
 *    「这一栏没有初值」与「这一格根本没报」—— 两件事都得说得出。
 * ⚠️「引擎接管、永远不可改」与「本票暂未开放」**不是同一个标记**：前者多带
 *    `data-field-takeover`，后者只带 `data-field-readonly`。
 * ⚠️ 字号只用 `--fs1/2/3` 三档（整页巡检会数 `[data-card-editor]` 里用了几档）。
 * ⚠️ 列不写死宽度：这一栏会在 1004–1279 那一档被压到 200px 上下，写死就会**无声裁掉**
 *    （`[data-mid]` 是 `overflow-x: hidden`）—— 所以键名那一列吃剩下的宽、窄了就折行。
 */
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  /** 这一格在卡里的点号路径（表里每一行都属于它） */
  path: string
  /** 这一格的字段：卡的声明顺序 */
  rows: Array<{ key: string; kind: string; hasInitial: boolean; taken: boolean }>
}>()
</script>

<template>
  <div data-branch-form class="form">
    <div class="head">
      <span class="cell key">{{ t('card.fieldKey') }}</span>
      <span class="cell kind">{{ t('card.fieldKind') }}</span>
      <span class="cell initial">{{ t('card.fieldInitial') }}</span>
      <span class="cell locked" />
    </div>
    <div
      v-for="row in rows"
      :key="row.key"
      class="row"
      data-field-row
      :data-field-key="row.key"
      :data-field-parent="path"
      data-field-readonly
      :data-field-takeover="row.taken ? '' : null"
      :data-field-initial="row.hasInitial ? 'yes' : 'no'"
    >
      <span class="cell key" data-field-name>{{ row.key }}</span>
      <span class="cell kind">{{ t('card.kind.' + row.kind) }}</span>
      <span class="cell initial">{{ row.hasInitial ? t('card.initialYes') : t('card.initialNo') }}</span>
      <!-- 引擎接管那一行才写字，但这一格**每一行都在**：列位才不会逐行漂 -->
      <span class="cell locked">{{ row.taken ? t('card.fieldLocked') : '' }}</span>
    </div>
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  min-width: 0;
}
.head,
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--s1) var(--s2);
  min-width: 0;
  min-height: var(--h-ctl);
}
.head {
  color: var(--color-faint);
  font-size: var(--fs3);
}
.row {
  border-radius: var(--r1);
  color: var(--color-text);
  font-size: var(--fs2);
}
/* 键名那一列吃剩下的宽：窄了就折行，不横向溢出（中栏是 overflow-x: hidden） */
.cell.key {
  flex: 1 1 8rem;
  min-width: 0;
  overflow: hidden;
  font-size: var(--fs1);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cell.kind,
.cell.initial,
.cell.locked {
  flex: 0 0 auto;
  color: var(--color-faint);
  font-size: var(--fs3);
}
/* 引擎接管：整行按项目里「只读」的长相（左竖条 + 灰字），标记本身也在行上 */
.row[data-field-takeover] {
  color: var(--color-faint);
  box-shadow: inset 2px 0 0 var(--color-line);
}
</style>
