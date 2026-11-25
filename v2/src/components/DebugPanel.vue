<script setup lang="ts">
/**
 * `?debug=1` 的调试面板（SPEC §5「对话页」）：最近一次的提示词 / 返回 / 工具调用 / 用量 / 模型。
 *
 * 这一格是**唯一**能看见「这一步到底用了哪个预设」的地方 —— 模型住在本地映射
 * `tg2.nodeModels` 里，卡与界面上别处都看不到它（CONTRACT §2.5）。
 */
import type { DebugPayload } from '../core/engine'
import { t } from '../i18n'

defineProps<{ debug: DebugPayload | null }>()
</script>

<template>
  <div class="debug" data-debug>
    <div class="debug-title">{{ t('debug.title') }}</div>
    <p v-if="!debug" class="muted">{{ t('debug.empty') }}</p>
    <template v-else>
      <div class="block">
        <div class="field-label">{{ t('debug.prompt') }}</div>
        <div class="mono" data-debug-prompt>
          <div v-for="(text, nodeId) in debug.prompts" :key="nodeId" class="prompt-block">
            <span class="tag">[node:{{ nodeId }}]</span>
            <span class="prompt-text">{{ text }}</span>
          </div>
        </div>
      </div>
      <div class="block">
        <div class="field-label">{{ t('debug.response') }}</div>
        <div class="mono" data-debug-response>
          <div v-for="(text, nodeId) in debug.responses" :key="nodeId">
            <span class="tag">[node:{{ nodeId }}]</span> {{ text }}
          </div>
          <p v-if="Object.keys(debug.responses).length === 0" class="muted">{{ t('debug.noResponse') }}</p>
        </div>
      </div>
      <div class="block">
        <div class="field-label">{{ t('debug.tools') }}</div>
        <div class="mono" data-debug-tools>
          <div v-for="(tool, index) in debug.tools" :key="index">
            [{{ tool.nodeId }}] {{ tool.name }} {{ JSON.stringify(tool.args) }}
          </div>
          <p v-if="debug.tools.length === 0" class="muted">{{ t('debug.noTools') }}</p>
        </div>
      </div>
      <div class="block">
        <div class="field-label">{{ t('debug.usage') }}</div>
        <div class="mono" data-debug-usage>
          {{ debug.usage ? JSON.stringify(debug.usage) : t('debug.noUsage') }}
        </div>
      </div>
      <div class="block">
        <div class="field-label">{{ t('debug.presets') }}</div>
        <div class="mono" data-debug-presets>
          <div v-for="(presetId, nodeId) in debug.presets" :key="nodeId">[{{ nodeId }}] {{ presetId }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.debug {
  width: 320px;
  flex: 0 0 auto;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px;
  border-left: 1px solid var(--line);
  background: var(--panel-2);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.debug-title {
  font-size: var(--fs2);
  font-weight: 600;
}

.block {
  min-width: 0;
}

.mono {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: var(--fs3);
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 6px;
}

.prompt-block {
  border-bottom: 1px dashed var(--line);
  padding-bottom: 4px;
  margin-bottom: 4px;
}

.tag {
  color: var(--accent);
}
</style>
