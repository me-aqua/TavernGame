<script setup lang="ts">
/**
 * 故事流（SPEC §5「对话页」）：按 `save.events` 的顺序画一条时间轴。
 *
 *   · `action` / `narration` —— 玩家行动与叙事，永远显示；
 *   · `trace` —— 一个节点的执行读数（提示词组装 / 思考 / 工具调用 / 输出 / 用量与耗时），
 *     只在调试开关打开时由对话页放进 `items`；
 *   · `turnStats` —— 一回合的合计读数，永远显示（调试关着时是一行紧凑的统计）。
 *
 * 版式（老板 2026-11-25 晚）：行动与叙事**同一版式** —— 左对齐、同字号、无气泡底；
 * 每个块（行动 / 叙事 / trace 卡片）之间一条 `border-top: 1px dashed` 的虚线分隔。
 *
 * `streaming` 是**本回合正在长出来的那段正文**：它还没落盘，所以不进 `items`；
 * 中途按「停止」时把 `streaming` 清空，故事流就回到本回合开始前的样子（存档一个字没动）。
 *
 * `generating` = 这一回合在跑、但**第一段正文还没到**：故事流末尾挂一行「生成中……」。
 * 它和 `streaming` 互斥（第一段一到就换成正文），也不进 `items` —— 它不是故事，是一句状态。
 * 带 `pending` 的那条 action 是对话页的**乐观副本**（还没落盘），本组件只负责把它画出来。
 *
 * 空的段落（没有思考、没有工具调用）**不画空框** —— 没发生的事不该占一行。
 */
import { t } from '../i18n'
import type { TokenUsage } from '../core/types'
import type { StoryItem } from './types'

defineProps<{ items: StoryItem[]; streaming: string; generating: boolean; embedded?: boolean }>()

/** trace 卡片的用量文案：入 / 出两个数；没有用量就直说，不拿 0 冒充 */
function traceTokens(usage: TokenUsage | null): string {
  return usage
    ? t('play.traceTokens', { input: usage.inputTokens, output: usage.outputTokens })
    : t('play.traceNoTokens')
}

/** 回合合计的用量文案：只报总数 */
function statsTokens(usage: TokenUsage | null): string {
  return usage ? t('play.statsTokens', { count: usage.totalTokens }) : t('play.statsNoTokens')
}
</script>

<template>
  <div class="story" :data-story="embedded ? undefined : ''">
    <p v-if="items.length === 0 && streaming === '' && !generating" class="story-empty muted">
      {{ t('play.emptyStory') }}
    </p>
    <template v-for="(item, index) in items" :key="index">
      <div
        v-if="item.type === 'action' || item.type === 'narration'"
        class="line"
        :data-line="item.type"
        :data-pending-action="item.pending ? 'true' : null"
      >
        {{ item.text }}
      </div>
      <article
        v-else-if="item.type === 'trace'"
        class="trace"
        data-trace
        :data-trace-node="item.trace.nodeId"
        :data-trace-turn="item.trace.turn"
      >
        <header class="trace-head">
          <span class="trace-name" data-trace-name>{{ item.trace.nodeName }}</span>
          <span class="muted" data-trace-type>{{ item.trace.nodeType }}</span>
        </header>
        <div class="trace-section">
          <div class="field-label">{{ t('play.tracePrompt') }}</div>
          <div class="mono" data-trace-prompt>{{ item.trace.prompt }}</div>
        </div>
        <div v-if="item.trace.thinking !== ''" class="trace-section">
          <div class="field-label">{{ t('play.traceThinking') }}</div>
          <div class="mono" data-trace-thinking>{{ item.trace.thinking }}</div>
        </div>
        <div v-if="item.trace.toolCalls.length > 0" class="trace-section">
          <div class="field-label">{{ t('play.traceTools') }}</div>
          <div class="mono" data-trace-tools>
            <div v-for="(call, callIndex) in item.trace.toolCalls" :key="callIndex" data-trace-tool>
              {{ call.name }} {{ JSON.stringify(call.args) }}
              <span v-if="call.result !== undefined" class="muted" data-trace-tool-result>
                {{ t('play.traceResult', { result: call.result }) }}
              </span>
            </div>
          </div>
        </div>
        <div v-if="item.trace.output !== ''" class="trace-section">
          <div class="field-label">{{ t('play.traceOutput') }}</div>
          <div class="mono" data-trace-output>{{ item.trace.output }}</div>
        </div>
        <div class="trace-stats">
          <span data-trace-tokens>{{ traceTokens(item.trace.usage) }}</span>
          <span data-trace-tps>
            {{
              item.trace.tps === null
                ? t('play.traceNoTps')
                : t('play.traceTps', { value: item.trace.tps.toFixed(1) })
            }}
          </span>
          <span data-trace-ms>{{ t('play.traceMs', { ms: Math.round(item.trace.durationMs) }) }}</span>
          <span data-trace-preset>{{ t('play.tracePreset', { preset: item.trace.presetId }) }}</span>
        </div>
      </article>
      <div
        v-else-if="item.type === 'turnStats'"
        class="turn-stats"
        data-turn-stats
        :data-turn-stats-turn="item.stats.turn"
      >
        <span data-turn-stats-turn>{{ t('play.statsTurn', { turn: item.stats.turn }) }}</span>
        <span data-turn-stats-tokens>{{ statsTokens(item.stats.usage) }}</span>
        <span data-turn-stats-ms>{{ t('play.statsMs', { ms: Math.round(item.stats.totalMs) }) }}</span>
        <span data-turn-stats-tps>
          {{
            item.stats.tps === null
              ? t('play.statsNoTps')
              : t('play.statsTps', { value: item.stats.tps.toFixed(1) })
          }}
        </span>
      </div>
    </template>
    <div v-if="generating" class="line generating" data-generating>{{ t('play.generating') }}</div>
    <div v-if="streaming !== ''" class="line" data-line="narration">{{ streaming }}</div>
  </div>
</template>

<style scoped>
.story {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.story-empty {
  margin: 0;
}

.line {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: var(--fs1);
  /* 每个故事块之间的虚线分隔：行动与叙事同一版式（左对齐、无气泡底），只有这条线 */
  border-top: 1px dashed var(--line);
  padding-top: 8px;
}

.line[data-line='narration'] {
  color: var(--ink);
}

/* 「生成中……」：一句状态，不是叙事 —— 用弱一档的颜色，不占 data-line 的钩子 */
.generating {
  color: var(--ink-soft);
}

.trace {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  /* trace 卡片也是块：和故事块之间同一条虚线（保留 accent 左沿与卡片底） */
  border-top: 1px dashed var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  background: var(--panel);
}

.trace-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}

.trace-name {
  font-size: var(--fs2);
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-section {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mono {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: var(--fs3);
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 180px;
  overflow: auto;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 6px;
}

.trace-stats,
.turn-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  font-size: var(--fs3);
  color: var(--ink-soft);
}

/* 读数之间画一道细竖线：一行里几个数各有各的口径，别让人读成一串 */
.trace-stats > span + span,
.turn-stats > span + span {
  padding-left: 10px;
  border-left: 1px solid var(--line);
}

.turn-stats {
  padding-top: 4px;
  border-top: 1px dashed var(--line);
}
</style>
