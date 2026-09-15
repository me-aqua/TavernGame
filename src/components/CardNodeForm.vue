<script setup lang="ts">
/**
 * 卡节点的编辑表单：改名 / 改职责 / 改提示词，声明只读展示。
 *
 * 提示词在节点里是「一行一条」的字符串数组，界面上就是一个多行文本框：一条一行，
 * 不用转义、不用管引号（卡的存储格式为引擎优化，作者看不到 JSON）。
 *
 * 只读那几行说的正是「机制只看卡」的部分：这个节点能不能写叙事（role）、能用哪些动作
 * （tools）、看得见哪几块状态（reads）、要读哪几条生成器（uses）—— 它们不是文案，
 * 表单一个字节都不改（改它们等于改这张卡给谁什么权力）。
 *
 * 表单不碰卡：它把改过的三个字段抛出去，写回整份卡与校验是外层的事。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  /** 节点 id（只读展示 —— 拓扑与声明都按它索引） */
  id: string
  name: string
  duty: string
  /** 节点的提示词：一行一条 */
  prompt: string[]
  /** role: story —— 本回合的叙事取自它；别的节点是 null */
  role: string | null
  /** 这个节点能用的动作（null = 卡里全部） */
  tools: string[] | null
  /** 这个节点看得见哪几块状态（null = 全部） */
  reads: string[] | null
  /** 这个节点要读哪几条生成器（null = 不带生成器） */
  uses: string[] | null
  /** 保存失败的原因（外层校验回来的）；没有就是空串 */
  error?: string
}>()

const emit = defineEmits<{
  save: [value: { name: string; duty: string; prompt: string[] }]
}>()

const nameText = ref(props.name)
const dutyText = ref(props.duty)
const promptText = ref(props.prompt.join('\n'))

/** 只读声明的四行：值缺了就说清「是什么都没有」还是「卡里全部」 */
const declarations = computed(() => [
  { key: 'card.declRole', value: props.role ?? t('card.declNone') },
  { key: 'card.declTools', value: props.tools ? props.tools.join(' ') : t('card.declAllTools') },
  { key: 'card.declReads', value: props.reads ? props.reads.join(' ') : t('card.declAllReads') },
  { key: 'card.declUses', value: props.uses ? props.uses.join(' ') : t('card.declNoUses') },
])

/** 提交：多行文本按行切回数组（空行合法 —— 提示词里本来就有空行） */
function submit() {
  emit('save', { name: nameText.value, duty: dutyText.value, prompt: promptText.value.split('\n') })
}

const field =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-text outline-none transition-colors focus:border-accent-line'
const label = 'mt-3 block text-[11.5px] text-muted'
/** 只读声明的框：一行一条，值长了自己滚 */
const declBox =
  'mt-1 space-y-0.5 rounded-lg border border-line bg-page px-3 py-2 text-[11.5px] leading-relaxed text-muted'
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

    <p :class="label">{{ t('card.declLabel') }}</p>
    <dl data-card-declarations :class="declBox">
      <div v-for="line in declarations" :key="line.key" class="flex gap-2">
        <dt class="w-12 shrink-0 text-faint">{{ t(line.key) }}</dt>
        <dd class="min-w-0 break-words">{{ line.value }}</dd>
      </div>
    </dl>

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
