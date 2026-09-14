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

const draft = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

watch(draft, () => void nextTick(autoResize))

function submit() {
  const t = draft.value.trim()
  if (!t) return
  draft.value = ''
  void nextTick(autoResize)
  emit('submit', t)
}
</script>

<template>
  <div class="shrink-0 border-t border-line bg-surface px-4 py-3">
    <div class="composer-row flex items-end gap-2.5">
      <textarea
        ref="textareaRef"
        v-model="draft"
        rows="1"
        placeholder="你想做什么？"
        :disabled="disabled"
        class="max-h-40 min-h-[42px] flex-1 resize-none rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] leading-relaxed text-text outline-none transition-colors placeholder:text-faint focus:border-accent-line disabled:opacity-50"
        @keydown.enter.exact.prevent="submit"
      />
      <button
        class="rounded-xl bg-accent px-5 py-2.5 text-[14px] font-semibold text-page transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="disabled"
        @click="submit"
      >
        行动
      </button>
    </div>
    <p class="mt-2 text-[11px] text-faint">
      <template v-if="!configured">
        还没配置 API key —— 点右上角 <b class="text-text">⚙ 设置</b> 填一下就能开始
      </template>
      <template v-else>Enter 发送 · Shift+Enter 换行</template>
    </p>
  </div>
</template>
