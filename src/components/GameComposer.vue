<script setup lang="ts">
/**
 * 输入区：玩家输入行动。它**浮在故事之上**（半透明 + 毛玻璃），不是页脚的一部分 ——
 * 这样文字可以从它下面滚过去，视线始终留在故事上。
 *
 * 提示文字用模板条件渲染，**不用 v-html** —— 这样连转义都不需要。
 */
import { useI18n } from 'vue-i18n'
import { nextTick, ref, watch } from 'vue'

const { t } = useI18n()

defineProps<{
  /** 正在跑回合时禁用 */
  disabled: boolean
  configured: boolean
}>()

const emit = defineEmits<{ submit: [text: string] }>()

const draft = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

/** 输入框随内容长高，最高 160px */
function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

watch(draft, () => void nextTick(autoResize))

/** 提交草稿：空内容直接忽略 */
function submit() {
  const t = draft.value.trim()
  if (!t) return
  draft.value = ''
  void nextTick(autoResize)
  emit('submit', t)
}
</script>

<template>
  <div class="px-4 pt-2 pb-4">
    <div
      class="mx-auto w-full max-w-[68ch] rounded-2xl border border-line/70 bg-surface/85 px-3 py-2.5 shadow-lg backdrop-blur-md"
    >
      <div class="composer-row flex items-end gap-2.5">
        <textarea
          ref="textareaRef"
          v-model="draft"
          rows="1"
          :placeholder="t('composer.placeholder')"
          :disabled="disabled"
          class="max-h-40 min-h-[42px] flex-1 resize-none rounded-xl border border-line bg-surface-2/70 px-3.5 py-2.5 text-[14px] leading-relaxed text-text outline-none transition-colors placeholder:text-faint focus:border-accent-line disabled:opacity-50"
          @keydown.enter.exact.prevent="submit"
        />
        <button
          class="shrink-0 rounded-xl bg-accent px-5 py-2.5 text-[14px] font-semibold text-page transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="disabled"
          @click="submit"
        >
          {{ t('composer.submit') }}
        </button>
      </div>
      <!-- 只有「还没配 API」才需要一行指引；回车/换行的用法不值得常驻一行字 -->
      <p v-if="!configured" class="mt-2 text-[11px] text-faint">
        {{ t('composer.hintBefore') }}
        <b class="text-text">{{ t('settings.title') }}</b>
        {{ t('composer.hintAfter') }}
      </p>
    </div>
  </div>
</template>
