<script setup lang="ts">
/**
 * 故事区：故事行 + 调试痕迹 + 底部状态行。
 *
 * 故事行是**日志的投影**（store 算好），这里只负责画 ——
 * 所以不存在「显示层自己攒了一行、忘了清掉」这种状态。
 *
 * 调试痕迹只在调试模式下有内容；状态行要么是「进行中」，要么是最近一条通知。
 */
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Status, StoryLine, TraceLine } from '../stores/game'

const { t } = useI18n()

const props = defineProps<{
  /** 故事行（叙事 / 玩家行动），始终显示 */
  lines: StoryLine[]
  /** 调试痕迹（模型输入输出 / 工具调用），调试模式才有 */
  trace: TraceLine[]
  /** 底部状态行：进行中或最近一条通知；null = 什么都不显示 */
  status: Status | null
}>()

const storyEl = ref<HTMLElement | null>(null)

/** 故事行的外观。行动用左侧竖线引出来，叙事用正文体 */
const lineStyles: Record<StoryLine['kind'], string> = {
  narration: 'text-text/90',
  action: 'border-l-2 border-info/40 pl-3 text-info',
}

/** 调试痕迹的外观：工具类等宽、警告用暖色 */
const traceStyles: Record<TraceLine['kind'], string> = {
  tool: 'rounded-lg border border-line bg-surface-2/60 px-3.5 py-2 font-mono text-[12.5px] text-muted',
  raw: 'rounded-lg border border-line bg-surface-2/60 px-3.5 py-2 font-mono text-[12.5px] text-muted',
  warn: 'rounded-lg border border-warn/40 bg-warn-soft px-3.5 py-2 text-[12.5px] text-warn',
}

/** 状态行的外观：进行中是三个点，通知是一行提示，错误用红色边 */
const statusStyles: Record<Status['kind'], string> = {
  busy: 'thinking flex items-center gap-2 text-[13px] text-faint',
  info: 'notice rounded-lg border border-dashed border-line bg-surface-2/60 px-3.5 py-2 text-[12.5px] text-muted',
  error:
    'notice error rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2 text-[12.5px] text-danger',
}

// 新内容进来自动滚到底
watch(
  () => [props.lines.length, props.trace.length, props.status] as const,
  async () => {
    await nextTick()
    if (storyEl.value) storyEl.value.scrollTop = storyEl.value.scrollHeight
  },
)
</script>

<template>
  <div ref="storyEl" class="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
    <p
      v-for="line in lines"
      :key="line.id"
      class="line story-text max-w-[70ch] text-[15px] leading-[1.85]"
      :class="[line.kind, lineStyles[line.kind]]"
    >
      {{ line.text }}
    </p>

    <!-- 调试痕迹：模型在想什么、调了什么工具。不进故事、不进存档 -->
    <template v-for="line in trace" :key="'trace-' + line.id">
      <details
        v-if="line.raw !== undefined"
        class="trace cursor-pointer rounded-lg border border-line bg-surface-2/60 px-3.5 py-2"
      >
        <summary class="text-[12.5px] text-muted">{{ line.text }}{{ t('story.rawToggle') }}</summary>
        <pre class="story-text mt-2 text-[12px] leading-relaxed text-faint">{{ line.raw }}</pre>
      </details>
      <p v-else class="trace max-w-[70ch]" :class="[line.kind, traceStyles[line.kind]]">
        {{ line.text }}
      </p>
    </template>

    <p v-if="status" :class="statusStyles[status.kind]" :data-status="status.kind">
      <template v-if="status.kind === 'busy'">
        <span class="size-1.5 animate-pulse rounded-full bg-accent" />
        <span class="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:0.2s]" />
        <span class="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:0.4s]" />
        <span class="ml-1">{{ status.text }}</span>
      </template>
      <template v-else>{{ status.text }}</template>
    </p>
  </div>
</template>
