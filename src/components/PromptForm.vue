<script setup lang="ts">
/**
 * 中栏：**一条公共提示词的正文**（票 8d-② 那一形态的屏 —— 中栏的第四种形态）。
 *
 * 表头写明编的是哪一条（`公共提示词` + 那一条的名字，照设计稿「编辑 · 公共提示词 · 世界设定」
 * 那个形状），下面就是它的正文：一个多行框 —— 五块与规矩是行数组按 `\n` 拼、`script` 是 JSON 文本。
 *
 * ⚠️ **只画不算**：正文、名字与那句人话都由 `usePromptDraft` 现算传进来（卡的知识只住一处），
 *    这一层只铺屏 + 把人的动作抛上去。**这一层没有第二条写路径** —— 落卡只有顶栏那一颗保存。
 * ⚠️ **坏值的那句话落在这一屏**（`[data-prompt-error]`，不是 `[data-card-error]`）：`script` 的
 *    坏 JSON 由**草稿层**拦下，交给 `importCard` 去发现就等于"整卡错误"，那正是本票要拦的事。
 * ⚠️ 字号只用 `--fs1/2/3` 三档；多行框取 `--h-ta`（`style` 那 233 行比一屏还高，框自己滚）。
 */
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  /** 正在编的那一条的 id（`data-prompt-id`，与第四栏亮着的那一行是同一个） */
  id: string
  /** 那一条的名字（`prompts.*`） */
  name: string
  /** 它的正文（五行 + 规矩 = 行数组按 `\n` 拼；`script` = JSON 文本） */
  body: string
  /** 正文过不了自己的格式时那句话（空串 = 没问题，那一块不在） */
  error: string
}>()

const emit = defineEmits<{
  /** 正文改了（改的是正在编的那一条） */
  text: [value: string]
}>()

/** 正文那个框里的字 */
function typed(event: Event): string {
  return (event.target as HTMLTextAreaElement).value
}
</script>

<template>
  <div data-prompt-form :data-prompt-id="id" class="screen">
    <!-- 表头：编的是哪一条（分隔靠空白与样式，不写字面符号） -->
    <p class="head" data-prompt-head>
      <span class="kind" v-text="t('card.shellPrompts')" />
      <span class="name" v-text="name" />
    </p>

    <p v-if="error" class="bad" data-prompt-error v-text="error" />

    <textarea
      class="body"
      data-prompt-text
      spellcheck="false"
      :value="body"
      @input="emit('text', typed($event))"
    />
  </div>
</template>

<style scoped>
/* 一屏一块：表头 + 那句人话 + 正文框（这一屏自己就是一张表，根上一句字号） */
.screen {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  min-width: 0;
  font-size: var(--fs2);
}
.head {
  display: flex;
  align-items: baseline;
  gap: var(--s1);
  margin: 0;
  font-size: var(--fs3);
}
.kind {
  flex: none;
  color: var(--color-faint);
}
.name {
  min-width: 0;
  overflow: hidden;
  color: var(--color-accent);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 正文过不了自己的格式：那一句人话（这一屏自己的那一块，不冒充整卡错误） */
.bad {
  margin: 0;
  padding: var(--s2);
  border: 1px solid var(--color-danger);
  border-radius: var(--r2);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  line-height: 1.5;
}
/* 正文：白底 + 框（可编与只读不靠颜色，靠有没有框）；长文自己滚 */
.body {
  width: 100%;
  min-width: 0;
  height: var(--h-ta);
  padding: var(--s1) var(--s2);
  border: 1px solid var(--color-line);
  border-radius: var(--r2);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--fs2);
  line-height: 1.6;
  resize: vertical;
}
.body:focus {
  border-color: var(--color-accent-line);
}
</style>
