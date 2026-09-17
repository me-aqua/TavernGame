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

const props = withDefaults(
  defineProps<{
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
    /** 这个节点要读哪几块设定（null = 卡里五块全读）—— 勾选区读它决定默认勾上哪几枚 */
    settings?: string[] | null
    /** 卡里的五块设定（勾选区的设定列恰好是这几个，顺序就是卡的声明顺序） */
    settingKeys?: string[]
    /** 卡里的生成器名（勾选区的生成器列恰好是这几条） */
    generatorNames?: string[]
    /** 保存失败的原因（外层校验回来的）；没有就是空串 */
    error?: string
  }>(),
  // ⚠️ 缺省写进默认值而不是靠调用方喂：这两个都是「没有」的表达（null = 卡里全读 / 空串 = 没报错），
  //    写成必填会让每个调用点重复一遍「什么都没有」，缺一个就多一条 Vue 警告
  { settings: null, settingKeys: () => [], generatorNames: () => [], error: '' },
)

const emit = defineEmits<{
  save: [value: { name: string; duty: string; prompt: string[] }]
  /** 勾选变了：这个节点要读的设定块与生成器各是哪几个（写回整份卡是外层的事） */
  marks: [value: { settings: string[]; uses: string[] }]
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

/** 勾选区的两个列头：设定那一列的名字与调试痕迹、资源库面板同一套键 */
const marksLabel = computed(() => ({
  settings: t('prompts.setting'),
  generators: t('prompts.generators'),
}))

const checkedSettings = ref<string[]>([...defaultSettings()])
const checkedUses = ref<string[]>([...(props.uses ?? [])])

/**
 * 只剩一块勾着了吗 —— 那枚锁住，并挂上「为什么」。
 *
 * 为什么锁：卡里写 `settings` 的节点，空表表达不出「什么也不发」（校验器会拒），
 * 而卡里没写这个键的节点，写回的是「删掉这个键」＝ 五块全发 —— 两条路上的
 * 「一块都不勾」都不是用户以为的那件事，所以最后一块一律不许取消。
 */
const lastSetting = computed(() => checkedSettings.value.length === 1)

/**
 * 设定列默认勾哪几块。
 *
 * ⚠️ 卡里**没写** `settings` 这个键 = 五块全发（不是「一块都不发」）—— 那两件事在界面上
 *    长得一样就糟了，所以这里回落到「全勾」，取消勾之后写回的是剩下那几块。
 */
function defaultSettings(): string[] {
  return props.settings ?? [...props.settingKeys]
}

/** 勾上 / 取消勾一块设定：勾选框自己那份状态就是卡里要写的子集 */
function setSetting(key: string, on: boolean): void {
  checkedSettings.value = on
    ? [...checkedSettings.value, key]
    : checkedSettings.value.filter((name) => name !== key)
  emit('marks', { settings: checkedSettings.value, uses: checkedUses.value })
}

/** 勾上 / 取消勾一条生成器 */
function setGenerator(name: string, on: boolean): void {
  checkedUses.value = on ? [...checkedUses.value, name] : checkedUses.value.filter((entry) => entry !== name)
  emit('marks', { settings: checkedSettings.value, uses: checkedUses.value })
}

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

    <!-- 勾选区：这个节点读哪几块设定、带哪几条生成器 —— 勾一下直接写回卡（外层写整份卡） -->
    <div
      data-card-resource-marks
      class="mt-3 grid gap-3 rounded-lg border border-line bg-page px-3 py-2 sm:grid-cols-2"
    >
      <fieldset class="min-w-0">
        <legend class="text-[11.5px] text-muted">{{ marksLabel.settings }}</legend>
        <ul class="mt-1 space-y-0.5">
          <li v-for="key in settingKeys" :key="key" class="flex items-center gap-2">
            <input
              type="checkbox"
              class="size-6 shrink-0 accent-accent"
              :data-card-resource-mark="'setting:' + key"
              :checked="checkedSettings.includes(key)"
              :disabled="lastSetting && checkedSettings.includes(key)"
              @change="setSetting(key, ($event.target as HTMLInputElement).checked)"
            />
            <span class="min-w-0 truncate text-[11.5px] text-text">
              {{ t('prompts.settingBlock.' + key) }}
            </span>
          </li>
        </ul>
        <p v-if="lastSetting" class="mt-1 text-[11px] leading-relaxed text-faint">
          {{ t('card.resourceAtLeastOne') }}
        </p>
      </fieldset>

      <fieldset class="min-w-0">
        <legend class="text-[11.5px] text-muted">{{ marksLabel.generators }}</legend>
        <ul class="mt-1 space-y-0.5">
          <li v-for="generator in generatorNames" :key="generator" class="flex items-center gap-2">
            <input
              type="checkbox"
              class="size-6 shrink-0 accent-accent"
              :data-card-resource-mark="'generator:' + generator"
              :checked="checkedUses.includes(generator)"
              @change="setGenerator(generator, ($event.target as HTMLInputElement).checked)"
            />
            <span class="min-w-0 truncate text-[11.5px] text-text">{{ generator }}</span>
          </li>
        </ul>
        <p v-if="!generatorNames.length" class="mt-1 text-[11px] leading-relaxed text-faint">
          {{ t('card.declNoUses') }}
        </p>
      </fieldset>
    </div>

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
