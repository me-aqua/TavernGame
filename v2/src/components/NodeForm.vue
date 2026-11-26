<script setup lang="ts">
/**
 * 中栏 · 选中工作流节点时的那张表（SPEC §5）。
 *
 * 四样东西：**名字**、**模型预设**、读取历史回合、节点提示词。
 *
 * 名字是这个节点的展示名（工作流细条、中栏标题、提示词里的 `<上游输出·名字>` 都用它），
 * 卡模式与存档模式都能改 —— 改的是卡（或存档快照）里的 `node.name`，不动链结构。
 *
 * 眼睛不在这张表里：读哪几块公共提示词在右栏（`PromptList`），读哪些上游节点在工作流细条
 * （`WorkflowStrip`）—— 两处都是「眼睛挨着被读的东西」，不用先在脑子里对上名字。
 *
 * 模型预设这一格改的是 `tg2.nodeModels[cardId][nodeId]`（本机映射），**不动卡** ——
 * 卡要能原样带走；模型与 Key 是玩家这台机器的事（CONTRACT §2.5）。
 * 它的「当前值」是**解析结果**：映射里没有这一格时显示的就是池子的第一个预设。
 */
import type { ChainNode, Preset } from '../core/types'
import { t } from '../i18n'

defineProps<{
  node: ChainNode
  presets: Preset[]
  presetId: string
}>()

const emit = defineEmits<{
  patch: [patch: Partial<ChainNode>]
  preset: [presetId: string]
}>()

function onHistory(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  const turns = Number(raw)
  if (!Number.isInteger(turns) || turns < 0) return
  emit('patch', { historyTurns: turns })
}
</script>

<template>
  <div class="form stack">
    <label class="field-row">
      <span class="field-label">{{ t('editor.fieldName') }}</span>
      <input
        type="text"
        data-node-name
        :value="node.name"
        @input="emit('patch', { name: ($event.target as HTMLInputElement).value })"
      />
    </label>

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

.grow {
  flex: 1 1 auto;
  min-height: 0;
}

.prompt {
  flex: 1 1 auto;
  min-height: 120px;
  width: 100%;
}
</style>
