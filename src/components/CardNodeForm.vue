<script setup lang="ts">
/**
 * 卡节点的编辑表单：改名 / 改职责 / 改提示词，声明只读展示。
 *
 * 提示词在节点里是「一行一条」的字符串数组，界面上就是一个多行文本框：一条一行，
 * 不用转义、不用管引号（卡的存储格式为引擎优化，作者看不到 JSON）。
 *
 * 只读那几行说的正是「机制只看卡」的部分：这个节点能不能写叙事（role）、能用哪些动作
 * （tools）、看得见哪几块状态（reads）—— 它们不是文案，
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
    /** 这个节点要读哪几块设定（null = 卡里不写这个键 = **一块都不读**，票 76）—— 勾选区读它决定默认勾上哪几枚 */
    settings?: string[] | null
    /** 卡里的五块设定（勾选区的设定列恰好是这几个，顺序就是卡的声明顺序） */
    settingKeys?: string[]
    /** 保存失败的原因（外层校验回来的）；没有就是空串 */
    error?: string
  }>(),
  // ⚠️ 缺省写进默认值而不是靠调用方喂：这两个都是「没有」的表达（null = 卡里没写这个键 / 空串 = 没报错），
  //    写成必填会让每个调用点重复一遍「什么都没有」，缺一个就多一条 Vue 警告
  { settings: null, settingKeys: () => [], error: '' },
)

const emit = defineEmits<{
  save: [value: { name: string; duty: string; prompt: string[] }]
  /** 勾选变了：这个节点要读的设定块是哪几个（写回整份卡是外层的事） */
  marks: [value: { settings: string[] }]
}>()

const nameText = ref(props.name)
const dutyText = ref(props.duty)
const promptText = ref(props.prompt.join('\n'))

/**
 * 一条声明怎么念：没写这个键 = 卡里的全部，
 * 写了个空表 = 一个都没有 —— 两件事长得一样就糟了，空表不能画成空白。
 */
function declaration(value: string[] | null, whenAbsent: string): string {
  if (value === null) return whenAbsent
  return value.length === 0 ? t('card.declNone') : value.join(' ')
}

/** 只读声明的三行：值缺了就说清「是什么都没有」还是「卡里全部」 */
const declarations = computed(() => [
  { key: 'card.declRole', value: props.role ?? t('card.declNone') },
  { key: 'card.declTools', value: declaration(props.tools, t('card.declAllTools')) },
  { key: 'card.declReads', value: declaration(props.reads, t('card.declAllReads')) },
])

/** 勾选区那一列的头：设定那一列的名字与调试痕迹、资源库面板同一套键 */
const marksLabel = computed(() => ({ settings: t('prompts.setting') }))

const checkedSettings = ref<string[]>([...defaultSettings()])

/**
 * 只剩一块勾着了吗 —— 那枚锁住，并挂上「为什么」。
 *
 * 为什么锁：勾选落回卡里的是一个数组，**一块都不勾就是空表**，而空表过不了校验器
 * （`must not be empty`）——「一块设定都不发」在卡里由**省掉这个键**表达，这一屏写不出来，
 * 所以最后一块一律不许取消。
 */
const lastSetting = computed(() => checkedSettings.value.length === 1)

/**
 * 设定列默认勾哪几块。
 *
 * ⚠️ 卡里**没写** `settings` 这个键的节点一枚都不勾 —— 卡格式里「不写这个键」= **一块都不发**
 *    （票 76 定的语义，与 `prompts.ts:135` 一致）。取消勾之后写回的是剩下那几块；
 *    一个都不勾就落成空表，而空表过不了校验器 ⇒ 最后一块锁住（见 `lastSetting`）。
 */
function defaultSettings(): string[] {
  return props.settings ?? []
}

/** 勾上 / 取消勾一块设定：勾选框自己那份状态就是卡里要写的子集 */
function setSetting(key: string, on: boolean): void {
  checkedSettings.value = on
    ? [...checkedSettings.value, key]
    : checkedSettings.value.filter((name) => name !== key)
  emit('marks', { settings: checkedSettings.value })
}

/** 提交：多行文本按行切回数组（空行合法 —— 提示词里本来就有空行） */
function submit() {
  emit('save', { name: nameText.value, duty: dutyText.value, prompt: promptText.value.split('\n') })
}

const field =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-text outline-none transition-colors focus:border-accent-line'
const label = 'mt-3 block text-muted small'
/** 只读声明的框：一行一条，值长了自己滚 */
const declBox =
  'mt-1 space-y-0.5 rounded-lg border border-line bg-page px-3 py-2 leading-relaxed text-muted small'
</script>

<template>
  <form
    data-card-form
    class="form mt-3 rounded-xl border border-line bg-surface-2 p-3"
    @submit.prevent="submit"
  >
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="font-semibold text-accent">{{ t('card.editTitle') }}</h3>
      <p class="small text-faint">{{ t('card.nodeId', { id }) }}</p>
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

    <!-- 勾选区：这个节点读哪几块设定 —— 勾一下落成草稿，写回卡是外层那颗保存的事 -->
    <div data-card-resource-marks class="mt-3 grid gap-3 rounded-lg border border-line bg-page px-3 py-2">
      <fieldset class="min-w-0">
        <legend class="text-muted small">{{ marksLabel.settings }}</legend>
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
            <span class="min-w-0 truncate text-text small">
              {{ t('prompts.settingBlock.' + key) }}
            </span>
          </li>
        </ul>
        <p v-if="lastSetting" class="mt-1 leading-relaxed text-faint small">
          {{ t('card.resourceAtLeastOne') }}
        </p>
      </fieldset>
    </div>

    <p
      v-if="error"
      data-card-error
      class="mt-3 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 leading-relaxed text-danger small"
    >
      {{ error }}
    </p>

    <button
      type="button"
      data-card-save
      class="mt-3 rounded-lg bg-accent px-4 py-2 font-semibold text-page transition-opacity hover:opacity-90"
      @click="submit"
    >
      {{ t('card.save') }}
    </button>
  </form>
</template>

<style scoped>
/* 这一屏只许用尺度层那三档字号：正文那一档由表单根定，附注那一档是 `.small`
   （表单控件不继承字体 ⇒ 显式接上，否则 `<input>` 会退回浏览器默认字号） */
.form {
  font-size: var(--fs2);
}
.form input,
.form textarea {
  font-family: inherit;
  font-size: inherit;
}
.small {
  font-size: var(--fs3);
}
</style>
