<script setup lang="ts">
/**
 * 错误条：**码 + 中文一句话 + 中文下一步**（CONTRACT §6）。
 *
 * 上游英文原文只进 `detail`（调试面板），这里一个字都不显示 —— 玩家看到的必须是中文。
 */
import type { AppError } from '../core/errors'

defineProps<{ error: AppError }>()
</script>

<template>
  <div class="error-panel" data-error role="alert">
    <div class="row error-head">
      <span class="error-code" data-error-code>{{ error.code }}</span>
      <span class="ellipsis">{{ error.message }}</span>
    </div>
    <div class="error-next" data-error-next>{{ error.nextStep }}</div>
  </div>
</template>

<style scoped>
.error-panel {
  margin: 8px;
  padding: 8px 10px;
  border: 1px solid var(--danger);
  border-radius: 8px;
  background: var(--panel);
  color: var(--ink);
  min-width: 0;
}

.error-head {
  font-size: var(--fs2);
}

.error-code {
  flex: 0 0 auto;
  font-size: var(--fs3);
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--danger);
  color: var(--danger);
}

.error-next {
  margin-top: 4px;
  font-size: var(--fs3);
  color: var(--ink-soft);
}
</style>
