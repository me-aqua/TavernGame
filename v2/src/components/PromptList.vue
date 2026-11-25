<script setup lang="ts">
/**
 * 右栏 · 公共提示词：**块名 + 读眼睛 + 删除**。
 *
 * 名字点一下就选中（S3），改名与正文都在中栏的 `PromptForm` 里 —— 右栏不摆输入框。
 * 选中了工作流节点时，每块旁边多一只「读」眼睛（决定选中节点读不读这一块）；
 * 没选节点时眼睛不出现（没有「谁读」可言）。
 * `+` 永远是裸的一个加号；`×` 对「开场」那块不出现（每张卡都有它，删不掉）。
 */
import { OPENING_PROMPT_ID } from '../core/schema'
import type { ChainNode, PromptBlock } from '../core/types'
import { t } from '../i18n'

defineProps<{ prompts: PromptBlock[]; selectedId: string | null; node: ChainNode | null }>()

defineEmits<{
  add: []
  select: [id: string]
  remove: [id: string]
  'toggle-read': [id: string]
}>()
</script>

<template>
  <div class="prompt-list" data-prompt-list>
    <div class="panel-head">
      <div class="col-title" data-panel-title>
        <span class="ellipsis">{{ t('editor.promptsTitle') }}</span>
      </div>
      <button
        type="button"
        class="icon panel-head-action"
        data-add-prompt
        :title="t('editor.addPrompt')"
        :aria-label="t('editor.addPrompt')"
        @click="$emit('add')"
      >
        +
      </button>
    </div>
    <div class="blocks scroll">
      <div
        v-for="prompt in prompts"
        :key="prompt.id"
        class="block"
        :class="{ selected: prompt.id === selectedId }"
        :data-prompt-block="prompt.id"
        :data-selected="prompt.id === selectedId ? 'true' : 'false'"
        @click="$emit('select', prompt.id)"
      >
        <span class="name ellipsis" data-prompt-name>{{ prompt.title }}</span>
        <button
          v-if="node"
          type="button"
          class="chip"
          data-prompt-read
          :data-prompt-id="prompt.id"
          :data-on="node.reads.includes(prompt.id) ? 'true' : 'false'"
          :title="t('editor.promptEye')"
          @click.stop="$emit('toggle-read', prompt.id)"
        >
          {{ t('editor.eyeRead') }}
        </button>
        <button
          v-if="prompt.id !== OPENING_PROMPT_ID"
          type="button"
          class="icon"
          data-delete-prompt
          :title="t('editor.deletePrompt')"
          @click.stop="$emit('remove', prompt.id)"
        >
          {{ t('common.remove') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prompt-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
}

.blocks {
  flex: 1 1 auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.block {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
  height: var(--row-h);
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  cursor: pointer;
}

.block:hover {
  border-color: var(--line-strong);
}

.block.selected {
  border-color: var(--accent);
  background: var(--panel-2);
}

.name {
  flex: 1 1 auto;
  font-size: var(--fs2);
}
</style>
