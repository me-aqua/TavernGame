<script setup lang="ts">
/**
 * 右栏 · 公共提示词（SPEC §5）：一块一块的正文，块前一只「读」眼睛。
 *
 * 眼睛说的是「**当前选中的节点**读不读这一块」—— 所以没选节点时不显示眼睛（见 StateTree 的注释）。
 * 块可以增删改；正文逐字进提示词（引擎那边不加工它）。
 */
import type { ChainNode, PromptBlock } from '../core/types'
import { t } from '../i18n'

defineProps<{ prompts: PromptBlock[]; node: ChainNode | null }>()

defineEmits<{
  add: []
  patch: [id: string, patch: Partial<PromptBlock>]
  remove: [id: string]
  toggleRead: [id: string]
}>()
</script>

<template>
  <div class="prompt-list" data-prompt-list>
    <div class="col-title">
      <span class="ellipsis">{{ t('editor.promptsTitle') }}</span>
      <button type="button" data-add-prompt @click="$emit('add')">{{ t('editor.addPrompt') }}</button>
    </div>
    <div class="blocks scroll">
      <div v-for="prompt in prompts" :key="prompt.id" class="block" :data-prompt-block="prompt.id">
        <div class="row block-head">
          <input
            class="title"
            data-prompt-title
            :value="prompt.title"
            @input="$emit('patch', prompt.id, { title: ($event.target as HTMLInputElement).value })"
          />
          <button
            v-if="node"
            type="button"
            class="eye"
            data-prompt-eyes
            :data-on="node.reads.includes(prompt.id) ? 'true' : 'false'"
            :title="t('editor.promptEye')"
            @click="$emit('toggleRead', prompt.id)"
          >
            {{ t('editor.eyeRead') }}
          </button>
          <button
            type="button"
            class="eye"
            data-delete-prompt
            :title="t('editor.deletePrompt')"
            @click="$emit('remove', prompt.id)"
          >
            {{ t('common.remove') }}
          </button>
        </div>
        <textarea
          data-prompt-body
          :value="prompt.body"
          @input="$emit('patch', prompt.id, { body: ($event.target as HTMLTextAreaElement).value })"
        ></textarea>
      </div>
      <p v-if="prompts.length === 0" class="muted hint">{{ t('editor.emptyPrompts') }}</p>
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
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  min-width: 0;
}

.block-head {
  min-width: 0;
}

.title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--fs2);
}

.block textarea {
  width: 100%;
  min-height: 72px;
}

.eye {
  flex: 0 0 auto;
  min-width: 26px;
  height: 24px;
  padding: 0 5px;
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.eye[data-on='true'] {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.hint {
  margin: 0 2px;
}
</style>
