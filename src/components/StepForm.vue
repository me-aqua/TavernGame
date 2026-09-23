<script setup lang="ts">
/**
 * 中栏：选中那一步的**只读编屏**（票 73 · 段 8c-①）。
 *
 * 一屏一块：卡的 `NODE_KEYS` 里**这一步声明了的**每一个键各一块 —— `name` / `duty` / `prompt`
 * 是必写的，`role` / `tools` / `reads` / `settings` 可省；外加两样**常驻**的：`id`（它是
 * `graph.nodes` 的键、不是一步的声明）与 `settings`（「这一步读哪几块」任何时候都有答案：
 * 不写 = 一块都不读 ⇒ 这一栏不随卡增删，随卡变的是**哪几块 on**）。
 *
 * ⚠️ 本刀**只读**：这一屏里一个 `input` / `select` / `textarea` / 垃圾桶 / ＋ 都没有
 *    （改写归 8c-②）⇒ 勾选那一栏画的是**只读标记**，不是勾选框。
 * ⚠️ 卡的知识只读 `card` 这一份：屏上每一个字都从 `graph.nodes[id]` 现取，不抄第二份。
 * ⚠️ `role` 只在**写了它的那一步**画一块（全卡恰好一步）：没写的那几步**不画那一块**，
 *    不是画成空框 —— 画空框读起来像"这 7 步都能改成叙事步"。
 * ⚠️ 字号只用 `--fs1/2/3` 三档（整页巡检会数中栏里出现过几档字）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CardData } from '../game/card'

const { t } = useI18n()

const props = defineProps<{
  /** 要编的那张卡（当前卡） */
  card: CardData
  /** 正在编的那一步：`graph.nodes` 的键，也是细条上 `[data-step-on]` 那个值 */
  id: string
}>()

/** 卡里这一步本身（屏上每一块都从它现取） */
const node = computed(() => props.card.graph.nodes[props.id])
/** 这一步能用哪几个动作（没写这个键 = 一个都不给，与 `reads` 同一套读法） */
const tools = computed(() => node.value.tools ?? [])
/** 这一步看得见哪几枝顶层状态 */
const reads = computed(() => node.value.reads ?? [])
/** 五块设定的键 —— 顺序就是卡里 `settings` 的声明顺序 */
const settingKeys = computed(() => Object.keys(props.card.settings))
/** 这一步**读到**的那几块（不写 = 一块都不读） */
const marks = computed(() => node.value.settings ?? [])

/** 卡里这一步写没写这个键：没写的那几块不画（`role` 尤其） */
function declares(key: string): boolean {
  return Object.hasOwn(node.value, key)
}
</script>

<template>
  <div data-step-form :data-step-node="id" class="screen">
    <!-- 身份：节点 id 是拓扑的键、不是一步的声明 ⇒ 只读摆在最上面 -->
    <p class="id" data-step-block="id" v-text="t('card.nodeId', { id })" />

    <section class="block" data-step-block="name">
      <h3 class="title" v-text="t('card.nameLabel')" />
      <p class="value" v-text="node.name" />
    </section>

    <section class="block" data-step-block="duty">
      <h3 class="title" v-text="t('card.dutyLabel')" />
      <p class="value" v-text="node.duty" />
    </section>

    <!-- 主提示词：一步只有这一条，一行一条、空行也是卡里的一行 -->
    <section class="block" data-step-block="prompt">
      <h3 class="title" v-text="t('card.promptLabel')" />
      <div class="lines">
        <p
          v-for="(line, index) in node.prompt"
          :key="index"
          class="prompt-line"
          data-step-prompt-line
          v-text="line"
        />
      </div>
    </section>

    <section v-if="declares('role')" class="block" data-step-block="role">
      <h3 class="title" v-text="t('card.declRole')" />
      <p class="value" v-text="node.role" />
    </section>

    <section v-if="declares('tools')" class="block" data-step-block="tools">
      <h3 class="title" v-text="t('card.declTools')" />
      <ul v-if="tools.length > 0" class="rows">
        <li v-for="name in tools" :key="name" class="row" :data-step-tool="name" v-text="name" />
      </ul>
      <!-- 写了空表就是一个都不给：这一档要看得出来，不能是一块空白 -->
      <p v-else class="none" v-text="t('card.declNone')" />
    </section>

    <section v-if="declares('reads')" class="block" data-step-block="reads">
      <h3 class="title" v-text="t('card.declReads')" />
      <ul v-if="reads.length > 0" class="rows">
        <li v-for="name in reads" :key="name" class="row" :data-step-read="name" v-text="name" />
      </ul>
      <p v-else class="none" v-text="t('card.declNone')" />
    </section>

    <!-- 这一步吃哪几块设定：五块照卡列全，读到的那几块带只读标记（本刀没有勾选框） -->
    <section class="block" data-step-block="settings">
      <h3 class="title" v-text="t('prompts.setting')" />
      <ul class="rows" data-card-resource-marks>
        <li
          v-for="key in settingKeys"
          :key="key"
          class="mark"
          :data-card-resource-mark="'setting:' + key"
          :data-card-resource-mark-on="marks.includes(key) ? '' : null"
        >
          <span class="box" />
          <span v-text="t('prompts.settingBlock.' + key)" />
        </li>
      </ul>
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
.lines {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* 提示词逐行原样：空行也要占一行（它就是卡里的一行）
   ⚠️ 类名**不叫 `.line`**：那是故事行的约定（`e2e/probe.ts` 全页数它、查它的遮挡，
   `e2e/selection.spec.ts` 也按它找故事行）—— 同名会把这一屏的行混进那些读数里 */
.prompt-line {
  margin: 0;
  color: var(--color-text);
  font-size: var(--fs2);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  min-width: 0;
}
.row {
  color: var(--color-text);
  font-size: var(--fs2);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.none {
  margin: 0;
  color: var(--color-faint);
  font-size: var(--fs2);
}
/* 勾选那一栏：只读标记 —— 一个方框（读到 = 实心，没读到 = 空框），不是勾选框 */
.mark {
  display: flex;
  align-items: center;
  gap: var(--s2);
  color: var(--color-muted);
  font-size: var(--fs2);
}
.box {
  flex: none;
  width: var(--h-cb);
  height: var(--h-cb);
  border: 1px solid var(--color-line);
  border-radius: var(--r1);
  background: var(--color-surface);
}
.mark[data-card-resource-mark-on] {
  color: var(--color-text);
}
.mark[data-card-resource-mark-on] .box {
  border-color: var(--color-accent-line);
  background: var(--color-accent);
  box-shadow: inset 0 0 0 2px var(--color-surface);
}
</style>
