<script setup lang="ts">
/**
 * 故事流（SPEC §5「对话页」）：只画两样东西 —— 玩家行动与叙事。
 *
 * `streaming` 是**本回合正在长出来的那段正文**：它还没落盘，所以不进 `lines`；
 * 中途按「停止」时把 `streaming` 清空，故事流就回到本回合开始前的样子（存档一个字没动）。
 */
import { t } from '../i18n'
import type { StoryLine } from './types'

defineProps<{ lines: StoryLine[]; streaming: string }>()
</script>

<template>
  <div class="story" data-story>
    <p v-if="lines.length === 0 && streaming === ''" class="story-empty muted">{{ t('play.emptyStory') }}</p>
    <div v-for="(line, index) in lines" :key="index" class="line" :data-line="line.type">
      {{ line.text }}
    </div>
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
}

.line[data-line='action'] {
  align-self: flex-end;
  max-width: 72%;
  padding: 6px 10px;
  border-radius: 10px 10px 2px 10px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  font-size: var(--fs2);
}

.line[data-line='narration'] {
  color: var(--ink);
}
</style>
