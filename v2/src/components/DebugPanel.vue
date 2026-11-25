<script setup lang="ts">
/**
 * 调试面板（SPEC §5「对话页」）：一回合的**逐节点**读数 + 工具调用 + 用量 + 模型。
 *
 * 每个节点一行：耗时、token 用量、生成速率（t/s）、这一节点的提示词与返回；
 * 最上面是本回合的总耗时。这一格是**唯一**能看见「这一步到底用了哪个预设」的地方 ——
 * 模型住在本地映射 `tg2.nodeModels` 里，卡与界面上别处都看不到它（CONTRACT §2.5）。
 *
 * 什么时候出现由对话页的 `[data-debug-toggle]` 决定（`?debug=1` 只是它的初始状态）：
 * 关掉时不显示这个面板，页面上只剩最终故事与总耗时。
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
      <div class="mono" data-debug-total>{{ t('debug.total', { ms: Math.round(debug.totalMs) }) }}</div>
      <div v-for="(node, nodeId) in debug.nodes" :key="nodeId" class="node" :data-debug-node="nodeId">
        <div class="node-head">
          <span class="tag">[node:{{ nodeId }}]</span>
          <span class="muted" data-debug-duration>
            {{ t('debug.duration', { ms: Math.round(node.durationMs) }) }}
          </span>
          <span class="muted" data-debug-tokens>
            {{
              node.usage
                ? t('debug.tokens', { input: node.usage.inputTokens, output: node.usage.outputTokens })
                : t('debug.noTokens')
            }}
          </span>
          <span class="muted" data-debug-tps>
            {{ node.tps === null ? t('debug.noTps') : t('debug.tps', { value: node.tps.toFixed(1) }) }}
          </span>
        </div>
        <div class="field-label">{{ t('debug.prompt') }}</div>
        <div class="mono" data-debug-prompt>{{ debug.prompts[nodeId] }}</div>
        <div class="field-label">{{ t('debug.response') }}</div>
        <div class="mono" data-debug-response>{{ debug.responses[nodeId] }}</div>
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

.node {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.node-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: var(--fs3);
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

.tag {
  color: var(--accent);
}
</style>
