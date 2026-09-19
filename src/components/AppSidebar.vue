<script setup lang="ts">
/**
 * 场景眉题：顶栏条目（场景 / 时间 / 回合，按卡声明的顺序）加最近一次
 * 「值得记」的时间跳跃。
 *
 * 它是**故事的一张眉题**，不是一块浮在左上角的 App 状态卡：场景名用叙事衬线，
 * 时间与回合是它下面的一行小字，时间跳跃是一句旁注。文字才是主线（决定 #24），
 * 所以这里没有底色、描边和阴影 —— 只有字与一条细线。
 *
 * 显示哪几条由卡的 声明.显示.顶栏 决定（决定 #15）：条目名 → 渲染键的映射在
 * display-blocks.ts，这里只管怎么画；卡声明了画不出来的条目会在模块加载期炸。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TopbarItem } from './display-blocks'
import type { Spot } from '../game/display'
import type { TimelineEntry } from '../types/state'

const { t } = useI18n()

const props = defineProps<{
  /** 卡声明的顶栏条目，顺序即声明顺序 */
  items: TopbarItem[]
  timeLabel: string
  timeline: TimelineEntry[]
  /** 当前所在 —— world.location 的三段（区域 / 地点 / 场景），从状态树读 */
  scene: Spot
  turn: number
}>()

/** 「场景」那一条写什么：地点 · 场景；卡只声明到区域时退回区域名 */
const sceneLabel = computed(() => {
  const parts = [props.scene.spot, props.scene.scene].filter((part) => part.length > 0)
  return parts.length > 0 ? parts.join(t('sidebar.separator')) : props.scene.area
})

/** 最近一次值得记的时间跳跃 —— 只渲染它的起点（from），终点已经在上面那行时间里 */
const lastTimeline = computed(() => props.timeline.at(-1))

/**
 * 这一条前面要不要加分隔点：只有「相邻两条都在同一行」时才加。
 * 「场景」独占一行（它是眉题的标题），所以它前后都不该冒出一个孤零零的「 · 」。
 */
function needsSeparator(index: number): boolean {
  const previous = props.items[index - 1]
  const current = props.items[index]
  return index > 0 && current !== 'scene' && previous !== 'scene'
}
</script>

<template>
  <aside data-scene-head class="min-w-0">
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <template v-for="(item, index) in items" :key="item">
        <span v-if="needsSeparator(index)" class="scene-meta" aria-hidden="true">
          {{ t('sidebar.separator') }}
        </span>

        <!-- 场景是眉题的标题；卡声明它在哪一条，它就出现在哪一行 -->
        <h1 v-if="item === 'scene'" class="scene-name scene-name-text w-full truncate">
          {{ sceneLabel }}
        </h1>

        <span v-else-if="item === 'time'" class="time-display scene-meta">{{ timeLabel }}</span>

        <span v-else class="scene-meta">
          <span>{{ t('sidebar.turnPrefix') }}</span>
          <span data-turn class="mx-0.5 font-semibold text-accent">{{ turn }}</span>
          <span>{{ t('sidebar.turnSuffix') }}</span>
        </span>
      </template>
    </div>

    <!-- 时间线只渲染**起点**（from）不渲染终点：这是有意设计（用户明确要求），
         终点已经在上面那行时间里了，这里回答的是「从哪个时刻起、发生了什么」。
         ⚠️ 独立审查员曾把这条报成缺陷，已驳回。 -->
    <p v-if="lastTimeline" class="timeline scene-note mt-1.5 max-sm:truncate">
      {{ t('sidebar.timelineArrow') }} {{ lastTimeline.from
      }}{{ lastTimeline.reason ? ' ' + t('sidebar.separator') + ' ' + lastTimeline.reason : '' }}
    </p>
  </aside>
</template>
