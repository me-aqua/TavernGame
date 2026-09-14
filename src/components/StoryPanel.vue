<script setup lang="ts">
/**
 * 故事区：叙事流的渲染。
 *
 * ⚠️ 这里修掉了本项目最经典的一个 bug 类型：
 *    原来叙事要靠 onEvent 回调里手动 append 到 DOM，
 *    曾经漏掉那一行 → 界面上什么都看不到（但存档里有）。
 *    现在只是 v-for 一个数组，**不存在「忘了渲染」这种可能**。
 */
import { nextTick, ref, watch } from 'vue'
import type { StoryLine } from '../stores/game'

const props = defineProps<{
  lines: StoryLine[]
  thinking: boolean
}>()

const storyEl = ref<HTMLElement | null>(null)

// 新内容进来自动滚到底（替代手工 scrollTop = scrollHeight）
watch(
  () => [props.lines.length, props.thinking] as const,
  async () => {
    await nextTick()
    if (storyEl.value) storyEl.value.scrollTop = storyEl.value.scrollHeight
  },
)
</script>

<template>
  <div ref="storyEl" class="story">
    <template v-for="line in lines" :key="line.id">
      <!-- 调试模式：模型的原始输出，用原生 <details> 折叠，不需要 JS -->
      <details v-if="line.raw !== undefined" class="line system tool" style="cursor: pointer">
        <summary>{{ line.text }} —— 点击展开</summary>
        <pre>{{ line.raw }}</pre>
      </details>
      <div v-else class="line" :class="line.kind">{{ line.text }}</div>
    </template>

    <div v-if="thinking" class="thinking">
      <span class="dot2"></span><span class="dot2"></span><span class="dot2"></span>
      <span>思考中…</span>
    </div>
  </div>
</template>

<style scoped>
.story {
  flex: 1;
  overflow-y: auto;
  padding: 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 15px;
  scroll-behavior: smooth;
}
.story::-webkit-scrollbar { width: 8px; }
.story::-webkit-scrollbar-thumb { background: rgba(110, 231, 183, 0.18); border-radius: 4px; }

.line { line-height: 1.85; font-size: 15px; max-width: 70ch; white-space: pre-wrap; }
.line.narration { color: #c8d0e2; }
.line.action {
  color: var(--accent2); padding-left: 12px;
  border-left: 2px solid rgba(125, 211, 252, 0.4);
}
.line.system {
  color: var(--faint); font-size: 12.5px; padding: 9px 13px;
  border: 1px dashed rgba(139, 149, 176, 0.25); border-radius: 10px;
  background: rgba(139, 149, 176, 0.05);
}
.line.error {
  color: #f0a5a5; font-size: 12.5px; padding: 9px 13px;
  border: 1px solid rgba(248, 113, 113, 0.45); border-radius: 10px;
  background: rgba(248, 113, 113, 0.06);
}
.line.warn {
  color: var(--warn); font-size: 12.5px; padding: 9px 13px;
  border: 1px solid rgba(251, 191, 36, 0.35); border-radius: 10px;
  background: rgba(251, 191, 36, 0.06);
}
.line.tool {
  border-color: rgba(125, 211, 252, 0.25); color: #9fc4e0;
  background: rgba(125, 211, 252, 0.05);
  font-family: Consolas, monospace;
  font-size: 12.5px; padding: 9px 13px; border-radius: 10px;
  border-width: 1px; border-style: dashed;
}
.line.tool pre {
  white-space: pre-wrap; margin: 8px 0 0; font-size: 12px; line-height: 1.6;
}

.thinking { display: flex; align-items: center; gap: 8px; color: var(--faint); font-size: 13px; }
.dot2 { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: blink 1.2s infinite; }
.dot2:nth-child(2) { animation-delay: 0.2s; }
.dot2:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }
</style>
