<script setup lang="ts">
/**
 * 故事区：叙事流的渲染。
 *
 * 叙事流是 v-for 一个数组：渲染与数据同源，
 * **不存在「加了数据但忘了渲染」这种可能**。
 *
 * 每一种行的样式都在下面 lineStyles 表里 —— 加一种 kind 只需加一行映射。
 */
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StoryLine } from '../stores/game'

const { t } = useI18n()

const props = defineProps<{
  lines: StoryLine[]
  thinking: boolean
}>()

const storyEl = ref<HTMLElement | null>(null)

/** 不同 kind 的外观。工具/系统类用等宽字体，叙事用正文体。 */
const lineStyles: Record<StoryLine['kind'], string> = {
  narration: 'text-text/90',
  action: 'border-l-2 border-info/40 pl-3 text-info',
  system: 'rounded-lg border border-dashed border-line bg-surface-2/60 px-3.5 py-2 text-[12.5px] text-muted',
  tool: 'rounded-lg border border-line bg-surface-2/60 px-3.5 py-2 font-mono text-[12.5px] text-muted',
  warn: 'rounded-lg border border-warn/40 bg-warn-soft px-3.5 py-2 text-[12.5px] text-warn',
  error: 'rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2 text-[12.5px] text-danger',
}

// 新内容进来自动滚到底
watch(
  () => [props.lines.length, props.thinking] as const,
  async () => {
    await nextTick()
    if (storyEl.value) storyEl.value.scrollTop = storyEl.value.scrollHeight
  },
)
</script>

<template>
  <div ref="storyEl" class="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
    <template v-for="line in lines" :key="line.id">
      <!-- debugMode：原始响应，用原生 <details> 折叠，不需要 JS -->
      <details
        v-if="line.raw !== undefined"
        class="cursor-pointer rounded-lg border border-line bg-surface-2/60 px-3.5 py-2"
      >
        <summary class="text-[12.5px] text-muted">{{ line.text }}{{ t('story.rawToggle') }}</summary>
        <pre class="story-text mt-2 text-[12px] leading-relaxed text-faint">{{ line.raw }}</pre>
      </details>
      <p
        v-else
        class="line story-text max-w-[70ch] text-[15px] leading-[1.85]"
        :class="[line.kind, lineStyles[line.kind]]"
      >
        {{ line.text }}
      </p>
    </template>

    <p v-if="thinking" class="thinking flex items-center gap-2 text-[13px] text-faint">
      <span class="size-1.5 animate-pulse rounded-full bg-accent" />
      <span class="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:0.2s]" />
      <span class="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:0.4s]" />
      <span class="ml-1">{{ t('story.thinking') }}</span>
    </p>
  </div>
</template>
