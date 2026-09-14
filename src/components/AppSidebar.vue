<script setup lang="ts">
/**
 * 侧栏：时间 / 地点 / 回合。
 *
 * 这三块还是**写死的三块**。DESIGN.md 决定 #15（显示层由卡驱动）落地后，
 * 这里会变成「从卡的声明列表渲染组件」—— 到那时这个文件是第一个被替换的。
 */
import type { TimelineEntry } from '../types/state'

defineProps<{
  timeLabel: string
  timeline: TimelineEntry[]
  scene: { name: string; description: string }
  turn: number
}>()

const cardTitle = 'mb-2.5 text-[10.5px] font-semibold tracking-[0.14em] text-faint uppercase'
</script>

<template>
  <aside class="flex flex-col gap-3 overflow-y-auto bg-surface px-3.5 py-4 lg:w-[280px]">
    <section class="rounded-xl border border-line bg-surface-2 p-3.5">
      <h2 :class="cardTitle">时间</h2>
      <p class="time-display text-[16px] font-semibold tracking-wide text-accent tabular-nums">
        {{ timeLabel }}
      </p>
      <!--
        时间线只渲染**起点**（from）不渲染终点：这是有意设计（用户明确要求），
        终点已经在上方大字「时间」里了，这里要回答的是「从哪个时刻起、发生了什么」。
        ⚠️ 独立审查员曾把这条报成缺陷，已驳回。
      -->
      <ul v-if="timeline.length" class="timeline mt-2.5 space-y-1 text-[11.5px] leading-relaxed text-faint">
        <li v-for="(t, i) in timeline" :key="i">
          ↑ {{ t.from }}
          <span v-if="t.reason" class="block pl-3 opacity-70">{{ t.reason }}</span>
        </li>
      </ul>
    </section>

    <section class="rounded-xl border border-line bg-surface-2 p-3.5">
      <h2 :class="cardTitle">地点</h2>
      <p class="scene-name mb-1 text-[13px] font-medium text-accent">{{ scene.name }}</p>
      <p class="text-[12.5px] leading-relaxed text-muted">{{ scene.description }}</p>
    </section>

    <section class="rounded-xl border border-line bg-surface-2 p-3.5">
      <h2 :class="cardTitle">回合</h2>
      <p class="flex items-baseline justify-between text-[13px]">
        <span class="text-muted">已进行</span>
        <span class="font-semibold text-accent tabular-nums">{{ turn }}</span>
      </p>
    </section>
  </aside>
</template>
