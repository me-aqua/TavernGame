<script setup lang="ts">
/**
 * 侧栏：时间 / 地点 / 回合。
 *
 * 这三块还是**写死的三块**。DESIGN.md 决定 #15（显示层由卡驱动）落地后，
 * 这里会变成「从卡的声明列表渲染组件」—— 到那时这个文件是第一个被替换的。
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

const cardTitle = 'mb-2.5 text-[10.5px] font-semibold tracking-[0.14em] text-faint uppercase'
</script>

<template>
  <!--
    Phones: the three cards sit at the bottom in two columns (time + turn), so the
    story keeps the screen. From lg up it is the classic right-hand column.
  -->
  <aside
    class="grid shrink-0 grid-cols-2 gap-3 overflow-y-auto border-t border-line bg-surface px-3.5 py-4 lg:flex lg:w-[280px] lg:flex-col lg:border-t-0 lg:border-l"
  >
    <section class="col-span-2 rounded-xl border border-line bg-surface-2 p-3.5 lg:col-span-1">
      <h2 :class="cardTitle">{{ t('sidebar.time') }}</h2>
      <p class="time-display text-[16px] font-semibold tracking-wide text-accent tabular-nums">
        {{ timeLabel }}
      </p>
      <!--
        时间线只渲染**起点**（from）不渲染终点：这是有意设计（用户明确要求），
        终点已经在上方大字「时间」里了，这里要回答的是「从哪个时刻起、发生了什么」。
        ⚠️ 独立审查员曾把这条报成缺陷，已驳回。
      -->
      <ul v-if="timeline.length" class="timeline mt-2.5 space-y-1 text-[11.5px] leading-relaxed text-faint">
        <li v-for="(entry, i) in timeline" :key="i">
          {{ t('sidebar.timelineArrow') }} {{ entry.from }}
          <span v-if="entry.reason" class="block pl-3 opacity-70">{{ entry.reason }}</span>
        </li>
      </ul>
    </section>

    <section class="col-span-2 rounded-xl border border-line bg-surface-2 p-3.5 lg:col-span-1">
      <h2 :class="cardTitle">{{ t('sidebar.place') }}</h2>
      <p class="scene-name mb-1 text-[13px] font-medium text-accent">{{ scene.name }}</p>
      <p class="text-[12.5px] leading-relaxed text-muted">{{ scene.description }}</p>
    </section>

    <section class="col-span-2 rounded-xl border border-line bg-surface-2 p-3.5 lg:col-span-1">
      <h2 :class="cardTitle">{{ t('sidebar.turn') }}</h2>
      <p class="flex items-baseline justify-between text-[13px]">
        <span class="text-muted">{{ t('sidebar.turnCount') }}</span>
        <span class="font-semibold text-accent tabular-nums">{{ turn }}</span>
      </p>
    </section>
  </aside>
</template>
