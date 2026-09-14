<script setup lang="ts">
/**
 * 状态浮层：时间 / 地点 / 回合（浮在故事上），加最近一次「值得记」的时间跳跃。
 *
 * 它是**浮在故事上的小块**，不是占一列的侧栏 —— 文字才是主线（用户明确要求：
 * 「右侧边栏的状态也要缩小，最好也悬浮起来」）。DESIGN.md 决定 #15（显示层由卡驱动）
 * 落地后，这里会变成「从卡的声明列表渲染组件」。
 */
import { useI18n } from 'vue-i18n'
import type { TimelineEntry } from '../types/state'

const { t } = useI18n()

defineProps<{
  timeLabel: string
  timeline: TimelineEntry[]
  scene: { name: string; description: string }
  turn: number
}>()
</script>

<template>
  <aside
    class="rounded-2xl border border-line/70 bg-surface/75 px-3 py-2 text-[11.5px] leading-snug shadow-sm backdrop-blur"
  >
    <p class="time-display truncate text-[12.5px] font-semibold text-accent">{{ timeLabel }}</p>
    <p class="scene-name mt-0.5 truncate text-muted">
      {{ scene.name }}
      <span class="text-faint">{{ t('sidebar.separator') }}{{ t('sidebar.turn') }}</span>
      <span data-turn class="font-semibold text-accent tabular-nums">{{ turn }}</span>
    </p>
    <!-- 时间线只渲染**起点**（from）不渲染终点：这是有意设计（用户明确要求），
         终点已经在上面那行时间里了，这里回答的是「从哪个时刻起、发生了什么」。
         ⚠️ 独立审查员曾把这条报成缺陷，已驳回。 -->
    <p v-if="timeline.length" class="timeline mt-1 truncate text-faint">
      {{ t('sidebar.timelineArrow') }} {{ timeline.at(-1)?.from }}
      <span v-if="timeline.at(-1)?.reason" class="opacity-70"
        >{{ t('sidebar.separator') }}{{ timeline.at(-1)?.reason }}</span
      >
    </p>
  </aside>
</template>
