<script setup lang="ts">
/**
 * 中栏 · 选中工作流节点时的那张表（SPEC §5）。
 *
 * 五样东西：节点提示词、**模型预设**、历史回合数、上游眼睛、**读哪几块公共提示词**。
 *
 * 模型预设这一格改的是 `tg2.nodeModels[cardId][nodeId]`（本机映射），**不动卡** ——
 * 卡要能原样带走；模型与 Key 是玩家这台机器的事（CONTRACT §2.5）。
 * 它的「当前值」是**解析结果**：映射里没有这一格时显示的就是池子的第一个预设。
 */
import type { ChainNode, Preset, PromptBlock } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  node: ChainNode
  isFirst: boolean
  presets: Preset[]
  presetId: string
  prompts: PromptBlock[]
}>()

const emit = defineEmits<{
  patch: [patch: Partial<ChainNode>]
  preset: [presetId: string]
  togglePromptRead: [id: string]
}>()

function onHistory(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  const turns = Number(raw)
  if (!Number.isInteger(turns) || turns < 0) return
  emit('patch', { historyTurns: turns })
}

function onUpstream(): void {
  if (props.isFirst) return
  emit('patch', { readsUpstream: !props.node.readsUpstream })
}
</script>

<template>
  <div class="form stack">
    <div class="form-head row">
      <span class="form-title ellipsis">{{ node.name }}</span>
      <span class="muted">{{ node.type }}</span>
    </div>

    <label class="field-row">
      <span class="field-label">{{ t('editor.nodePreset') }}</span>
      <select
        data-node-preset
        :value="presets.length === 0 ? '' : presetId"
        :aria-disabled="presets.length === 0 ? 'true' : 'false'"
        :disabled="presets.length === 0"
        @change="emit('preset', ($event.target as HTMLSelectElement).value)"
      >
        <option v-if="presets.length === 0" value="">-</option>
        <option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option>
      </select>
    </label>

    <label class="field-row">
      <span class="field-label">{{ t('editor.nodeHistory') }}</span>
      <input
        type="number"
        min="0"
        step="1"
        data-node-history
        :value="node.historyTurns"
        @change="onHistory"
      />
    </label>

    <div class="field-row">
      <span class="field-label">{{ t('editor.nodeUpstream') }}</span>
      <button
        type="button"
        class="eye"
        data-node-upstream
        :data-on="node.readsUpstream ? 'true' : 'false'"
        :aria-disabled="isFirst ? 'true' : 'false'"
        @click="onUpstream"
      >
        {{ t('editor.eyeRead') }}
      </button>
    </div>

    <div class="reads">
      <span class="field-label">{{ t('editor.nodePromptReads') }}</span>
      <div class="read-rows" data-node-prompt-reads>
        <div v-for="prompt in prompts" :key="prompt.id" class="read-row">
          <span class="ellipsis">{{ prompt.title }}</span>
          <button
            type="button"
            class="eye"
            data-node-prompt-read
            :data-prompt-id="prompt.id"
            :data-on="node.reads.includes(prompt.id) ? 'true' : 'false'"
            :title="t('editor.promptEye')"
            @click="emit('togglePromptRead', prompt.id)"
          >
            {{ t('editor.eyeRead') }}
          </button>
        </div>
      </div>
    </div>

    <label class="stack grow">
      <span class="field-label">{{ t('editor.nodePrompt') }}</span>
      <textarea
        class="prompt"
        data-node-prompt
        :value="node.prompt"
        @input="emit('patch', { prompt: ($event.target as HTMLTextAreaElement).value })"
      ></textarea>
    </label>
  </div>
</template>

<style scoped>
.form {
  padding: 8px 10px;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

.form-head {
  justify-content: space-between;
}

.form-title {
  font-size: var(--fs1);
  font-weight: 600;
}

.grow {
  flex: 1 1 auto;
  min-height: 0;
}

.prompt {
  flex: 1 1 auto;
  min-height: 120px;
  width: 100%;
}

.reads {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.read-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.read-row {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  font-size: var(--fs2);
}

.eye {
  min-width: 26px;
  height: 24px;
  padding: 0 6px;
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.eye[data-on='true'] {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
</style>
