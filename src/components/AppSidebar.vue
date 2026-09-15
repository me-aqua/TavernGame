<script setup lang="ts">
/**
 * 状态浮层：顶栏条目（时间 / 当前场景 / 回合，按卡声明的顺序渲染）加最近一次
 * 「值得记」的时间跳跃。
 *
 * 它是**浮在故事上的小块**，不是占一列的侧栏 —— 文字才是主线（决定 #24）。
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

/** 自己占一行的条目：时间在上，场景与回合跟在它下面 */
function isWide(item: TopbarItem): boolean {
  return item === 'time'
}

/**
 * 这一条前面要不要加分隔点：只有「上一条也在同一行」时才加 ——
 * 时间独占一行，所以它后面的场景前面不该冒出一个孤零零的「 · 」。
 */
function needsSeparator(index: number): boolean {
  return index > 0 && !isWide(props.items[index]) && !isWide(props.items[index - 1])
}
</script>

<template>
  <aside
    class="rounded-2xl border border-line/70 bg-surface/75 px-3 py-2 text-[11.5px] leading-snug shadow-sm backdrop-blur"
  >
    <div class="flex flex-wrap items-baseline gap-y-0.5">
      <template v-for="(item, index) in items" :key="item">
        <span v-if="needsSeparator(index)" class="text-faint">{{ t('sidebar.separator') }}</span>
        <span
          v-if="item === 'time'"
          class="time-display w-full truncate text-[12.5px] font-semibold text-accent"
        >
          {{ timeLabel }}
        </span>
        <span v-else-if="item === 'scene'" class="scene-name truncate text-muted">{{ sceneLabel }}</span>
        <span v-else class="text-faint">
          {{ t('sidebar.turn') }}
          <span data-turn class="ml-0.5 font-semibold text-accent tabular-nums">{{ turn }}</span>
        </span>
      </template>
    </div>
    <!-- 时间线只渲染**起点**（from）不渲染终点：这是有意设计（用户明确要求），
         终点已经在上面那行时间里了，这里回答的是「从哪个时刻起、发生了什么」。
         ⚠️ 独立审查员曾把这条报成缺陷，已驳回。 -->
    <p v-if="timeline.length" class="timeline mt-1 flex items-baseline gap-1 overflow-hidden text-faint">
      <!-- 两段各自截断：日子一长（卡里的历法是完整日期）整行会伸出浮层，
           而探针看的是**每个元素自己的盒子** —— 光给外框加 truncate 拦不住里面那一段 -->
      <span class="truncate">{{ t('sidebar.timelineArrow') }} {{ timeline.at(-1)?.from }}</span>
      <span v-if="timeline.at(-1)?.reason" class="truncate opacity-70">
        {{ t('sidebar.separator') }}{{ timeline.at(-1)?.reason }}
      </span>
    </p>
  </aside>
</template>
