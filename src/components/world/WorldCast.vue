<script setup lang="ts">
/**
 * 角色块：状态树里的角色字典（game/display.ts 的 castOf）—— 键是人名，值是他的那几段。
 *
 * 每段叫什么由卡决定（身份 / 种族 / 生平 / 性格……），界面按形状画：标量一行、
 * 字符串数组连成一行，嵌套对象不展开（面板是给人扫一眼的，不是状态树的全文）。
 */
import { computed } from 'vue'
import { linesOf, entriesOf, scalarText } from '../state-view'

const props = defineProps<{
  /** roles：人名 → 那个角色的几段状态 */
  cast: unknown
}>()

/**
 * 角色摊成「名字 + 那一段 + 几行状态」。
 *
 * ⚠️ 「那一段」只有**整条就是一个字符串**时才有（对象条目的每一栏都走明细行 ——
 *    界面不认「哪一栏是简介」：见 state-view 的文件头，最终形态归段 6）。
 */
const people = computed(() =>
  entriesOf(props.cast).map(({ key, value }) => ({
    name: key,
    note: scalarText(value),
    lines: linesOf(value),
  })),
)
</script>

<template>
  <ul class="space-y-2">
    <li v-for="person in people" :key="person.name" data-cast class="border-l-2 border-line/70 pl-2">
      <p class="text-[12.5px] font-semibold text-text">{{ person.name }}</p>
      <p v-if="person.note" class="mt-0.5 text-[11px] leading-snug text-muted">{{ person.note }}</p>
      <ul v-if="person.lines.length" class="mt-0.5 space-y-0.5">
        <li
          v-for="line in person.lines"
          :key="line.key"
          class="line-clamp-2 text-[11px] leading-snug text-muted"
        >
          <span class="text-faint">{{ line.key }}</span>
          {{ line.text }}
        </li>
      </ul>
    </li>
  </ul>
</template>
