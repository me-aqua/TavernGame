<script setup lang="ts">
/**
 * 故事区：把事件流的投影一行行画出来。
 *
 * 故事行与调试痕迹在**同一个列表**里 —— 顺序就是它们发生的顺序，
 * 所以「这句话之前模型收到/发出了什么」一眼可见（调试行不会被堆到末尾）。
 *
 * 底部那一行是状态：进行中（三个点）或最近一条通知；它由 store 算出来，
 * 不是事件流里的一行。
 */
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DebugRowKind, Row, Status, StoryRowKind } from '../stores/game'

const { t } = useI18n()

const props = defineProps<{
  /** 事件流的投影：故事行 + （调试模式下的）调试行，按发生顺序 */
  rows: Row[]
  /** 底部状态行：进行中或最近一条通知；null = 什么都不显示 */
  status: Status | null
}>()

const storyEl = ref<HTMLElement | null>(null)

/** 故事行的外观：叙事用正文体，行动用左侧竖线引出来 */
const storyStyles: Record<StoryRowKind, string> = {
  narration: 'text-text/90',
  action: 'border-l-2 border-info/40 pl-3 text-info',
}

/** 调试行的外观：模型 I/O 与工具调用等宽，警告用暖色 */
const debugStyles: Record<DebugRowKind, string> = {
  request: 'rounded-lg border border-line bg-surface-2/60 px-3.5 py-2 font-mono text-[12.5px] text-muted',
  reply: 'rounded-lg border border-line bg-surface-2/60 px-3.5 py-2 font-mono text-[12.5px] text-muted',
  tool: 'rounded-lg border border-line bg-surface-2/60 px-3.5 py-2 font-mono text-[12.5px] text-muted',
  toolResult: 'rounded-lg border border-line bg-surface-2/60 px-3.5 py-2 font-mono text-[12.5px] text-muted',
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
  () => [props.rows.length, props.status] as const,
  async () => {
    await nextTick()
    if (storyEl.value) storyEl.value.scrollTop = storyEl.value.scrollHeight
  },
)
</script>

<template>
  <div ref="storyEl" class="flex h-full flex-col gap-4 overflow-y-auto px-5 py-4 sm:px-8">
    <TransitionGroup name="row" tag="div" class="mx-auto flex w-full max-w-[68ch] flex-col gap-4">
      <template v-for="row in rows" :key="row.id">
        <!-- 调试行带原始内容（模型请求体 / 响应体）：用原生 <details> 折叠 -->
        <details
          v-if="row.debug && row.detail !== undefined"
          class="trace cursor-pointer rounded-lg border border-line bg-surface-2/60 px-3.5 py-1.5"
          :class="row.kind"
        >
          <!-- 折叠条本身就是点击目标：给它 24px 高（可访问性的最小尺寸） -->
          <summary class="min-h-6 py-1 text-[12.5px] text-muted">
            {{ row.text }}{{ t('story.rawToggle') }}
          </summary>
          <pre class="story-text mt-2 text-[12px] leading-relaxed text-faint">{{ row.detail }}</pre>
        </details>
        <p v-else-if="row.debug" class="trace max-w-[70ch]" :class="[row.kind, debugStyles[row.kind]]">
          {{ row.text }}
        </p>
        <p
          v-else
          class="line story-text w-full text-[15px] leading-[1.85]"
          :class="[row.kind, storyStyles[row.kind]]"
        >
          {{ row.text }}
        </p>
      </template>
    </TransitionGroup>

    <p
      v-if="status"
      class="mx-auto w-full max-w-[68ch]"
      :class="statusStyles[status.kind]"
      :data-status="status.kind"
    >
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
