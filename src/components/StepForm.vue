<script setup lang="ts">
/**
 * 中栏：选中那一步的**编屏**（票 73 · 段 8c-① 只读；段 8c-② 起可编）。
 *
 * 一屏一块：卡的 `NODE_KEYS` 里**这一步声明了的**每一个键各一块 —— `name` / `duty` / `prompt`
 * 是必写的，`role` / `tools` / `reads` / `settings` 可省；外加两样**常驻**的：`id`（它是
 * `graph.nodes` 的键、不是一步的声明）与 `settings`（「这一步吃哪几块」任何时候都有答案 ——
 * 不写这个键 = 一块都不发 ⇒ 这一栏不随卡增删，随卡变的是**哪几块勾着**）。
 *
 * ⚠️ **只画不算**：值与草稿都由 `CardEditor` 现算传进来（卡的知识只住一处），这一层只铺屏
 *    与把人的动作抛上去。**这一层没有第二条写路径** —— 落卡只有顶栏那一颗保存。
 * ⚠️ **`role` 永远只读**：它是全卡的指针（取值只有 `story`、全卡恰好一个），不是这一步的开关。
 * ⚠️ **三栏一律「候选 + 挑中」**：候选集就是卡里那张表 ⇒ 结构上写不出卡里没有的名字
 *    （动作名写错会让请求工具表与执行闸门失配，而卡会拒保存）。
 * ⚠️ **三栏的缺省语义各不相同，别合并**（三条都从引擎那边读出来）：
 *    `tools` 不写 = 卡里全部动作（`card-actions.ts:104`）· `reads` 不写 = 全部顶层枝
 *    （`card-state.ts:345`）⇒ 这两栏的"不写"画成**全勾**；
 *    `settings` 不写 = **一块都不发**（票 76）⇒ 这一栏画成**全不勾**。
 * ⚠️ **`settings` 锁最后一块**：一块都不勾要写成空表，而空表过不了卡的校验
 *    （「一块都不发」在卡里由**不写这个键**表达，这一屏删不了键）⇒ 最后一枚点不动。
 * ⚠️ 字号只用 `--fs1/2/3` 三档（整页巡检会数中栏里出现过几档字）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CardData } from '../game/card'

const { t } = useI18n()

const props = defineProps<{
  /** 要编的那张卡（当前卡）—— 这一步的 id 与 `role` 那两样只读的从它现取 */
  card: CardData
  /** 正在编的那一步：`graph.nodes` 的键，也是细条上 `[data-step-on]` 那个值 */
  id: string
  /**
   * 三栏的候选表（顺序照卡）—— 由 `CardEditor` 现算传进来（卡的知识只住一处），
   * 这一层只管画：候选集就是卡里那张表 ⇒ 结构上写不出卡里没有的名字。
   */
  roster: { tools: string[]; reads: string[]; settings: string[] }
  /** 名字（卡里的，或草稿里的） */
  name: string
  /** 职责 */
  duty: string
  /** 主提示词：一步一条，多行文本（一行一条、空行也是卡里的一行） */
  prompt: string
  /** 这一步能用哪几个动作（值 = 卡里 `actions` 的键） */
  tools: string[]
  /** 这一步看得见哪几枝顶层状态 */
  reads: string[]
  /** 这一步吃哪几块设定 */
  settings: string[]
}>()

const emit = defineEmits<{
  /** 文本控件的草稿：`prompt` 原样给（多行文本，切行是保存那一步的事） */
  text: [key: 'name' | 'duty' | 'prompt', value: string]
  /** 一栏勾选的草稿 */
  pick: [key: 'tools' | 'reads' | 'settings', name: string, on: boolean]
}>()

/** 卡里这一步（只读那两样从它现取：`role` 是全卡的指针、`declares()` 决定画不画那一块） */
const node = computed(() => props.card.graph.nodes[props.id])

/** 卡里这一步写没写这个键：没写的那几块不画（`role` 尤其 —— 画空框读起来像"能改成叙事步"） */
function declares(key: string): boolean {
  return Object.hasOwn(node.value, key)
}

/** 只剩一块勾着了吗 —— 那枚锁住，并在下面挂一句为什么 */
const lastSetting = computed(() => props.settings.length === 1)

/** 一段控件里的字（文本格） */
function textOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value
}

/** 一枚勾选框现在勾着没有 */
function checkedOf(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}
</script>

<template>
  <div data-step-form :data-step-node="id" class="screen">
    <!-- 身份：节点 id 是拓扑的键、不是一步的声明 ⇒ 只读摆在最上面 -->
    <p class="id" data-step-block="id" v-text="t('card.nodeId', { id })" />

    <section class="block" data-step-block="name">
      <label class="title" :for="'step-name-' + id" v-text="t('card.nameLabel')" />
      <input
        :id="'step-name-' + id"
        class="text"
        type="text"
        :value="name"
        @input="emit('text', 'name', textOf($event))"
      />
    </section>

    <section class="block" data-step-block="duty">
      <label class="title" :for="'step-duty-' + id" v-text="t('card.dutyLabel')" />
      <textarea
        :id="'step-duty-' + id"
        class="text short"
        :value="duty"
        @input="emit('text', 'duty', textOf($event))"
      />
    </section>

    <!-- 主提示词：一步只有这一条；一行一条，空行也得留得住 ⇒ 多行框按 `\n` 来回切 -->
    <section class="block" data-step-block="prompt">
      <label class="title" :for="'step-prompt-' + id" v-text="t('card.promptLabel')" />
      <textarea
        :id="'step-prompt-' + id"
        class="text area"
        :value="prompt"
        @input="emit('text', 'prompt', textOf($event))"
      />
    </section>

    <section v-if="declares('role')" class="block" data-step-block="role">
      <h3 class="title" v-text="t('card.declRole')" />
      <p class="value" v-text="node.role" />
    </section>

    <!-- 能用哪些动作：卡里全部动作一个候选一条（勾上的就是这一步给了它的） -->
    <section v-if="declares('tools')" class="block" data-step-block="tools">
      <h3 class="title" v-text="t('card.declTools')" />
      <ul class="picks">
        <li v-for="one in roster.tools" :key="one" class="pick">
          <input
            type="checkbox"
            class="cab"
            :data-step-tool="one"
            :checked="tools.includes(one)"
            @change="emit('pick', 'tools', one, checkedOf($event))"
          />
          <span class="pick-name" v-text="one" />
        </li>
      </ul>
    </section>

    <section v-if="declares('reads')" class="block" data-step-block="reads">
      <h3 class="title" v-text="t('card.declReads')" />
      <ul class="picks">
        <li v-for="one in roster.reads" :key="one" class="pick">
          <input
            type="checkbox"
            class="cab"
            :data-step-read="one"
            :checked="reads.includes(one)"
            @change="emit('pick', 'reads', one, checkedOf($event))"
          />
          <span class="pick-name" v-text="one" />
        </li>
      </ul>
    </section>

    <!-- 吃哪几块设定：五块照卡列全，勾上的就是这一步要的那几块 -->
    <section class="block" data-step-block="settings">
      <h3 class="title" v-text="t('prompts.setting')" />
      <div class="marks" data-card-resource-marks>
        <ul class="picks">
          <li v-for="key in roster.settings" :key="key" class="pick">
            <input
              type="checkbox"
              class="cab"
              :data-card-resource-mark="'setting:' + key"
              :checked="settings.includes(key)"
              :disabled="lastSetting && settings.includes(key)"
              @change="emit('pick', 'settings', key, checkedOf($event))"
            />
            <span class="pick-name" v-text="t('prompts.settingBlock.' + key)" />
          </li>
        </ul>
        <p v-if="lastSetting" class="hint" v-text="t('card.resourceAtLeastOne')" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.screen {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  min-width: 0;
}
/* 节点 id：只读的小字，摆在这一屏最上面 */
.id {
  margin: 0;
  color: var(--color-faint);
  font-size: var(--fs3);
}
.block {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  min-width: 0;
}
.title {
  margin: 0;
  color: var(--color-faint);
  font-size: var(--fs3);
  font-weight: 600;
}
.value {
  margin: 0;
  color: var(--color-text);
  font-size: var(--fs2);
  line-height: 1.6;
  /* 卡里有很长的 ASCII 串（工具名 / 路径）：不让它把中栏顶宽（`[data-mid]` 是 overflow-x: hidden，
     但元素的矩形仍会伸出去 —— e2e 探针把它记成「伸出视口的元素」） */
  overflow-wrap: anywhere;
}
/* 可编的格子：白底 + 框（可编与只读不靠颜色，靠有没有框） */
.text {
  width: 100%;
  min-width: 0;
  height: var(--h-ctl);
  padding: 0 var(--s2);
  border: 1px solid var(--color-line);
  border-radius: var(--r2);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--fs2);
}
.text:focus {
  border-color: var(--color-accent-line);
}
/* `duty` 是"这一步干什么"的完整句子（最长 63 字，且不发给模型）⇒ 单行框装不下，给两行 */
.short {
  height: calc(var(--h-ctl) * 2);
  padding: var(--s1) var(--s2);
  line-height: 1.6;
  resize: vertical;
}
/* 主提示词：卡里最长 31 行 —— 长文本框的最小高度就是给它的（`--h-ta`） */
.area {
  height: var(--h-ta);
  padding: var(--s1) var(--s2);
  line-height: 1.6;
  resize: vertical;
}
.picks {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  min-width: 0;
}
/* 一个候选一行：勾选框 + 名字（名字长了折行，不把中栏顶宽） */
.pick {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
  color: var(--color-text);
  font-size: var(--fs2);
  line-height: 1.6;
}
.cab {
  flex: none;
  width: var(--h-cb);
  height: var(--h-cb);
  margin: 0;
  accent-color: var(--color-accent);
}
.cab:disabled {
  cursor: default;
}
.pick:has(.cab:disabled) {
  color: var(--color-faint);
}
.pick-name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.marks {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  min-width: 0;
}
.hint {
  margin: 0;
  color: var(--color-faint);
  font-size: var(--fs3);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
