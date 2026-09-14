<script setup lang="ts">
/**
 * 侧栏：时间 / 地点 / 回合。
 *
 * 现在这三块还是**写死的三块**。
 * DESIGN.md 决定 #15（「显示层由卡驱动」）落地后，这里会变成
 * 「从卡的声明列表渲染组件」—— 到那时这个文件会是第一个被替换的。
 */
import type { TimelineEntry } from '../types/state'

defineProps<{
  timeLabel: string
  timeline: TimelineEntry[]
  scene: { name: string; description: string }
  turn: number
}>()
</script>

<template>
  <aside class="sidebar">
    <div class="card">
      <h2>时间</h2>
      <div class="time-display">{{ timeLabel }}</div>
      <!--
        时间线只渲染**起点**（from），不渲染终点。
        这是有意设计（用户明确要求）：终点已经在上方大字「时间」里了，
        这里要回答的是「从哪个时刻起、发生了什么」。
        ⚠️ 独立审查员曾把这条报成缺陷，已驳回。
      -->
      <div v-if="timeline.length" class="timeline">
        <template v-for="(t, i) in timeline" :key="i">
          ↑ {{ t.from }}
          <span v-if="t.reason" class="reason"><br />　{{ t.reason }}</span>
          <br />
        </template>
      </div>
    </div>

    <div class="card">
      <h2>地点</h2>
      <div class="scene-name">{{ scene.name }}</div>
      <div class="scene-desc">{{ scene.description }}</div>
    </div>

    <div class="card">
      <h2>回合</h2>
      <div class="stat"><span>已进行</span><span>{{ turn }}</span></div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px 14px; overflow-y: auto; background: var(--panel);
}

/* 时间显示：这是唯一的结构化状态，给它视觉分量 */
.time-display {
  font-size: 17px; font-weight: 600; color: var(--accent);
  letter-spacing: 0.04em; font-variant-numeric: tabular-nums;
}

.timeline { margin-top: 10px; font-size: 11.5px; color: var(--faint); line-height: 1.9; }
.reason { color: #4a5270; }

.scene-name { font-size: 13px; color: var(--accent); margin-bottom: 5px; }
.scene-desc { font-size: 12.5px; color: var(--dim); line-height: 1.7; }

.stat { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 0; font-size: 13px; }
.stat span:first-child { color: var(--dim); }
.stat span:last-child { color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; }
</style>
