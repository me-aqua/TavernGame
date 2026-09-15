<script setup lang="ts">
/**
 * 卡节点的编辑表单：改名 / 改职责 / 改提示词，输出只读展示。
 *
 * 提示词在卡里是「一行一条」的字符串数组，界面上就是一个多行文本框：一条一行，
 * 不用转义、不用管引号（卡的存储格式为引擎优化，作者看不到 JSON）。
 *
 * 表单不碰卡：它把改过的三个字段抛出去，写回整张卡与校验是外层的事。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  /** 节点 id（只读展示 —— 拓扑与提示词都按它索引） */
  id: string
  name: string
  duty: string
  /** 这个节点输出哪些字段（只读：形状由卡里声明，不是文案） */
  output: Record<string, unknown>
  /** 卡里的提示词.节点[id]：一行一条 */
  prompt: string[]
  /** 保存失败的原因（外层校验回来的）；没有就是空串 */
  error?: string
}>()

const emit = defineEmits<{
  save: [value: { name: string; duty: string; prompt: string[] }]
}>()

const nameText = ref(props.name)
const dutyText = ref(props.duty)
const promptText = ref(props.prompt.join('\n'))

/** 输出只读展示：原样打印 JSON，人不改它 */
const outputText = JSON.stringify(props.output, null, 2)

/** 提交：多行文本按行切回数组（空行合法 —— 提示词里本来就有空行） */
function submit() {
  emit('save', { name: nameText.value, duty: dutyText.value, prompt: promptText.value.split('\n') })
}

const field =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-text outline-none transition-colors focus:border-accent-line'
const label = 'mt-3 block text-[11.5px] text-muted'
/** 只读输出的框：长 JSON 自己滚，不许把表单撑破 */
const outputBox =
  'mt-1 max-h-32 overflow-auto rounded-lg border border-line bg-page px-3 py-2 text-[11.5px] leading-relaxed text-muted'
</script>

<template>
  <form data-card-form class="mt-3 rounded-xl border border-line bg-surface-2 p-3" @submit.prevent="submit">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="text-[12.5px] font-semibold text-accent">{{ t('card.editTitle') }}</h3>
      <p class="text-[11px] text-faint">{{ t('card.nodeId', { id }) }}</p>
    </div>

    <label :class="label" for="card-node-name">{{ t('card.nameLabel') }}</label>
    <input id="card-node-name" v-model="nameText" data-card-name :class="field" />

    <label :class="label" for="card-node-duty">{{ t('card.dutyLabel') }}</label>
    <input id="card-node-duty" v-model="dutyText" data-card-duty :class="field" />

    <label :class="label" for="card-node-prompt">{{ t('card.promptLabel') }}</label>
    <textarea id="card-node-prompt" v-model="promptText" data-card-prompt rows="6" :class="field" />

    <p :class="label">{{ t('card.outputLabel') }}</p>
    <pre data-card-output :class="outputBox">{{ outputText }}</pre>

    <p
      v-if="error"
      data-card-error
      class="mt-3 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] leading-relaxed text-danger"
    >
      {{ error }}
    </p>

    <button
      type="button"
      data-card-save
      class="mt-3 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-page transition-opacity hover:opacity-90"
      @click="submit"
    >
      {{ t('card.save') }}
    </button>
  </form>
</template>
