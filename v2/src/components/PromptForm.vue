<script setup lang="ts">
/**
 * 中栏 · 选中一块公共提示词时的那张表（S3）：名字 + 正文。
 *
 * 提示词块只在右栏「选」，改在这儿 —— 那一栏不摆输入框，也不摆眼睛
 * （「这个节点读不读这一块」在节点那张表里，见 `NodeForm`）。
 */
import type { PromptBlock } from '../core/types'
import { t } from '../i18n'

defineProps<{ prompt: PromptBlock }>()
defineEmits<{ patch: [patch: Partial<PromptBlock>] }>()
</script>

<template>
  <div class="form stack">
    <div class="form-head row">
      <span class="form-title">{{ t('editor.promptsTitle') }}</span>
      <span class="muted">{{ prompt.id }}</span>
    </div>

    <label class="field-row">
      <span class="field-label">{{ t('editor.fieldName') }}</span>
      <input
        data-prompt-title
        :value="prompt.title"
        @input="$emit('patch', { title: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label class="stack grow">
      <span class="field-label">{{ t('editor.promptBody') }}</span>
      <textarea
        class="body"
        data-prompt-body
        :value="prompt.body"
        @input="$emit('patch', { body: ($event.target as HTMLTextAreaElement).value })"
      ></textarea>
    </label>
  </div>
</template>

<style scoped>
.form {
  padding: 8px 10px;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

.form-head {
  justify-content: space-between;
}

.form-title {
  font-size: var(--fs1);
  font-weight: 600;
}

.grow {
  flex: 1 1 auto;
  min-height: 0;
}

.body {
  flex: 1 1 auto;
  min-height: 160px;
  width: 100%;
}
</style>
