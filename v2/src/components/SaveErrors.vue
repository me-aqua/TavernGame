<script setup lang="ts">
/**
 * 保存失败清单（页栏下面那一条）：每条错误都能点回出问题的那一格。
 * 点一条只把 `select` 发出去 —— 选中哪个元素 / 收起提示归编辑器页面。
 */
import type { CardIssue } from '../core/statetree'
import { t } from '../i18n'

const props = defineProps<{ issues: CardIssue[] }>()
defineEmits<{ select: [issue: CardIssue] }>()

/** 一条错误的文字：卡级问题（没有 code）说自己的话，其余前面点名元素 code */
function lineOf(issue: CardIssue): string {
  return issue.code === ''
    ? issue.message
    : t('editor.saveErrorLine', { code: issue.code, message: issue.message })
}
</script>

<template>
  <div v-if="props.issues.length > 0" class="save-errors" data-save-errors>
    <span class="save-failed">{{ t('editor.saveFailed') }}</span>
    <button
      v-for="(issue, at) in props.issues"
      :key="`${issue.code}-${issue.path}-${at}`"
      type="button"
      class="save-error"
      data-save-error
      :data-save-error-code="issue.code"
      @click="$emit('select', issue)"
    >
      {{ lineOf(issue) }}
    </button>
  </div>
</template>

<style scoped>
/* 保存失败：页栏下面一条可换行的清单，每条都能点回那一格 */
.save-errors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.save-failed {
  font-size: var(--fs2);
  color: var(--danger);
}

.save-error {
  text-align: left;
}
</style>
