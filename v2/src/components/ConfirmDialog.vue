<script setup lang="ts">
/**
 * 删除 / 离开前的确认层（CONTRACT §8）：只有 `[data-confirm-ok]` 才真做，`[data-confirm-cancel]` 什么都不做。
 * 确认按钮的字默认是「删除」；「离开编辑器」这类不是删除的场景由调用方传 `confirmLabel`。
 */
import { t } from '../i18n'

defineProps<{ message: string; confirmLabel?: string }>()
defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div class="confirm-backdrop">
    <div class="confirm" data-confirm role="dialog" aria-modal="true">
      <p class="confirm-text">{{ message }}</p>
      <div class="row confirm-actions">
        <button type="button" data-confirm-cancel @click="$emit('cancel')">{{ t('common.cancel') }}</button>
        <button type="button" class="danger" data-confirm-ok @click="$emit('confirm')">
          {{ confirmLabel ?? t('common.delete') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(20 15 10 / 45%);
  z-index: 20;
}

.confirm {
  width: 360px;
  max-width: calc(100vw - 32px);
  padding: 16px;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: var(--panel);
  box-shadow: 0 8px 24px rgb(0 0 0 / 25%);
}

.confirm-text {
  margin: 0 0 12px;
  font-size: var(--fs2);
}

.confirm-actions {
  justify-content: flex-end;
}

.danger {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
