<script setup lang="ts">
/**
 * 输入区：玩家输入行动。它是故事底部的一条「岸」—— 半透明、毛玻璃、随焦点亮起，
 * 故事从它上面滚过去（决定 #24），但它不再是浮在页脚上的一张白色 App 卡片。
 *
 * 字用叙事衬线：玩家写下的不是表单字段，是这一回合的行动。
 * 提示文字用模板条件渲染，**不用 v-html** —— 这样连转义都不需要。
 */
import { useI18n } from 'vue-i18n'
import { nextTick, ref, watch } from 'vue'

const { t } = useI18n()

const props = defineProps<{
  /** 正在跑回合时禁用 */
  disabled: boolean
  configured: boolean
  /** 行动牌塞进来的一句话：只改写草稿、聚焦，不自动提交 */
  seed?: { text: string; nonce: number } | null
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

/** 行动牌：只把句子写进草稿并聚焦，提交仍然由玩家按「落笔」 */
watch(
  () => props.seed?.nonce,
  () => {
    const seed = props.seed
    if (!seed || seed.text === '') return
    draft.value = seed.text
    void nextTick(() => {
      autoResize()
      textareaRef.value?.focus()
    })
  },
)

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
  <div class="shrink-0 px-4 pt-2 pb-4 sm:px-6 sm:pb-6">
    <div class="composer-shell reading-column px-2.5 py-2">
      <div class="flex items-end gap-2">
        <!-- 羽毛笔/笔尖：桌面上「落笔」的记号，不影响输入的可访问名 -->
        <svg class="quill-icon mb-2.5 ml-1 hidden sm:block" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 2.5 5.5 13 12 21.5 18.5 13 12 2.5Zm0 3.6 3.6 6.1L12 18.3 8.4 12.2 12 6.1Z"
            fill="currentColor"
          />
        </svg>

        <div class="composer-row flex min-w-0 flex-1 items-end gap-2.5">
          <textarea
            ref="textareaRef"
            v-model="draft"
            rows="1"
            :placeholder="t('composer.placeholder')"
            :disabled="disabled"
            class="book-input max-h-40 min-h-[44px] min-w-0 flex-1 resize-none px-3 py-2.5 font-serif text-[16px] leading-relaxed outline-none transition-colors disabled:opacity-50"
            @keydown.enter.exact.prevent="submit"
          />
          <button
            class="ink-button shrink-0 px-4 py-2.5 text-[13.5px] font-semibold transition-transform disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="disabled"
            @click="submit"
          >
            {{ t('composer.submit') }}
          </button>
        </div>
      </div>

      <!-- 只有「还没配 API」才需要一行指引；回车/换行的用法不值得常驻一行字 -->
      <p v-if="!configured" class="composer-hint mt-1.5 px-2.5 text-[11.5px]">
        {{ t('composer.hintBefore') }}
        <b class="text-[#f6e0b8]">{{ t('settings.title') }}</b>
        {{ t('composer.hintAfter') }}
      </p>
    </div>
  </div>
</template>
