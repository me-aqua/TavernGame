<script setup lang="ts">
/**
 * 故事区：把事件流的投影一行行画出来。
 *
 * 故事的排版只有两种声音（决定 #18 的视觉落地）：
 *   · 叙事 = 系统衬线 + 暖墨色，像翻一页小说；
 *   · 玩家行动 = 界面无衬线 + 铜色，前面一短横与一个 ❯，是「你刚刚做了什么」，
 *     不再是像超链接一样的蓝字。
 *
 * 故事行与调试痕迹在**同一个列表**里 —— 顺序就是它们发生的顺序，
 * 所以「这句话之前模型收到/发出了什么」一眼可见（调试行不会被堆到末尾）。
 *
 * 底部那一行是状态：进行中（一滴墨在呼吸）或最近一条通知；它由 store 算出来，
 * 不是事件流里的一行。
 */
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Blocks from './Blocks.vue'
import type { DebugRowKind, Row, Status, StoryRowKind } from '../stores/game'

const { t } = useI18n()

const props = defineProps<{
  /** 事件流的投影：故事行 + （调试模式下的）调试行，按发生顺序 */
  rows: Row[]
  /** 底部状态行：进行中或最近一条通知；null = 什么都不显示 */
  status: Status | null
}>()

const storyEl = ref<HTMLElement | null>(null)

/** 故事行的外观：叙事用衬线正文，行动用「你的声音」 */
const storyStyles: Record<StoryRowKind, string> = {
  narration: 'narration prose-story',
  action: 'action story-action',
}

/** 调试行的外观：模型 I/O 与工具调用等宽、低对比；节点进度用强调色，警告用暖色 */
const debugStyles: Record<DebugRowKind, string> = {
  node: 'rounded-md border border-accent-line bg-accent-soft/70 px-3 py-2 text-[12px] text-text',
  thinking: 'rounded-md border border-line bg-surface-2/50 px-3 py-2 font-mono text-[12px] text-faint',
  request: 'rounded-md border border-line bg-surface-2/50 px-3 py-2 font-mono text-[12px] text-muted',
  model: 'rounded-md border border-line bg-surface-2/50 px-3 py-2 font-mono text-[12px] text-muted',
  tool: 'rounded-md border border-line bg-surface-2/50 px-3 py-2 font-mono text-[12px] text-muted',
  toolResult: 'rounded-md border border-line bg-surface-2/50 px-3 py-2 font-mono text-[12px] text-muted',
  stateChange: 'rounded-md border border-line bg-surface-2/50 px-3 py-2 font-mono text-[12px] text-muted',
  warn: 'rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12px] text-warn',
}

/** 状态行的外观：进行中是一滴墨，通知是一行提示，错误用红色边 */
const statusStyles: Record<Status['kind'], string> = {
  busy: 'thinking ink-status',
  info: 'notice rounded-md border border-dashed border-line bg-surface-2/50 px-3 py-2 text-[12.5px] text-muted',
  error: 'notice error rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger',
}

// 新内容进来自动滚到底；**载入存档也要**（immediate）——
// 一局玩到一半刷新，玩家落在最新的一段，而不是故事的开头。
watch(
  () => [props.rows.length, props.status] as const,
  async () => {
    await nextTick()
    if (storyEl.value) storyEl.value.scrollTop = storyEl.value.scrollHeight
  },
  { immediate: true },
)
</script>

<template>
  <div ref="storyEl" class="flex h-full flex-col gap-5 overflow-y-auto px-5 pt-6 pb-8 sm:px-6">
    <TransitionGroup name="row" tag="div" class="reading-column flex flex-col gap-5">
      <template v-for="row in rows" :key="row.id">
        <!-- 调试行带原始内容（模型请求体 / 响应体）：用原生 <details> 折叠 -->
        <details
          v-if="row.debug && row.detail !== undefined"
          class="trace cursor-pointer rounded-md border border-line bg-surface-2/50 px-3 py-1.5"
          :class="row.kind"
        >
          <!-- 折叠条本身就是点击目标：给它 24px 高（可访问性的最小尺寸） -->
          <summary class="min-h-6 py-1 text-[12px] text-muted">
            {{ row.text }}{{ t('story.rawToggle') }}
          </summary>
          <!-- 模型输入 / 原始回复：按块清单渲染（块与行都由装配器交出，界面不切文本）；
               旧痕迹没有这套结构，退回原来的「一坨原始文本」 -->
          <template v-if="row.blocks?.length">
            <Blocks :groups="row.blocks" />
            <details data-raw class="mt-2">
              <summary class="min-h-6 py-1 text-[12px] text-faint">{{ t('debug.raw') }}</summary>
              <!-- 原始内容逐字节照旧：v-text 不带子节点，格式化器插不进空白 -->
              <pre
                data-raw-body
                class="mt-1 overflow-x-auto text-[12px] leading-relaxed text-faint"
                v-text="row.detail"
              ></pre>
            </details>
          </template>
          <pre v-else class="story-text mt-2 text-[12px] leading-relaxed text-faint">{{ row.detail }}</pre>
        </details>
        <p v-else-if="row.debug" class="trace max-w-[70ch]" :class="[row.kind, debugStyles[row.kind]]">
          {{ row.text }}
        </p>
        <p v-else class="line story-text w-full" :class="[row.kind, storyStyles[row.kind]]">
          {{ row.text }}
        </p>
      </template>
    </TransitionGroup>

    <p v-if="status" class="reading-column" :class="statusStyles[status.kind]" :data-status="status.kind">
      <template v-if="status.kind === 'busy'">
        <span class="ink-drop" aria-hidden="true" />
        <span>{{ status.text }}</span>
      </template>
      <template v-else>{{ status.text }}</template>
    </p>
  </div>
</template>
