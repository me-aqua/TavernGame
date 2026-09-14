<script setup lang="ts">
/**
 * 输入区：玩家输入行动。
 * 输入框随字数长高 —— 用 scrollHeight 算，再夹一个 max-height。
 *
 * 提示文字用模板条件渲染，**不用 v-html** —— 这样连转义都不需要。
 */
import { nextTick, ref, watch } from 'vue'

defineProps<{
  /** 正在跑回合时禁用 */
  disabled: boolean
  /** 是否已完成 API 配置 */
  configured: boolean
}>()

const emit = defineEmits<{ submit: [text: string] }>()

const 文本 = ref('')
const 输入框 = ref<HTMLTextAreaElement | null>(null)

function 自适应高度() {
  const el = 输入框.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 130)}px`
}

watch(文本, () => void nextTick(自适应高度))

function 提交() {
  const t = 文本.value.trim()
  if (!t) return
  文本.value = ''
  // 有意不等待：高度调整是纯视觉的，下一帧做就行
  void nextTick(自适应高度)
  emit('submit', t)
}
</script>

<template>
  <div class="composer">
    <div class="composer-row">
      <textarea
        ref="输入框"
        v-model="文本"
        rows="1"
        placeholder="你想做什么？"
        :disabled="disabled"
        @keydown.enter.exact.prevent="提交"
      ></textarea>
      <button class="primary" :disabled="disabled" @click="提交">行动</button>
    </div>
    <div class="hint">
      <template v-if="!configured"> 还没配置 API key —— 点右上角 <b>⚙ 设置</b> 填一下就能开始 </template>
      <template v-else>Enter 发送 · Shift+Enter 换行</template>
    </div>
  </div>
</template>

<style scoped>
.composer {
  flex-shrink: 0;
  padding: 11px 14px 14px;
  border-top: 1px solid var(--border);
  background: var(--panel);
}
.composer-row {
  display: flex;
  gap: 9px;
  align-items: flex-end;
}
textarea {
  flex: 1;
  resize: none;
  min-height: 42px;
  max-height: 130px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel-2);
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  outline: none;
  transition: border-color 0.2s;
}
textarea:focus {
  border-color: rgba(110, 231, 183, 0.5);
}
textarea::placeholder {
  color: var(--faint);
}
.hint {
  margin-top: 7px;
  font-size: 11px;
  color: var(--faint);
  min-height: 14px;
}
b {
  color: var(--text);
}
</style>
