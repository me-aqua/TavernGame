<script setup lang="ts">
/**
 * 角色块：状态树里的角色字典（game/display.ts 的 castOf）—— 键是人名，值是他的那几段。
 *
 * 每个人是一条细边 + 完整名字 + 简介 + 几行状态：面板是给人「认人」的，不是状态树的全文。
 * 名字不再被切成一个首字当印记 —— 「萨伦」显示成「萨」没有信息，还容易看成另一个字。
 * 每段叫什么由卡决定（身份 / 种族 / 生平 / 性格……），界面按形状画：标量一行、
 * 字符串数组连成一行，嵌套对象不展开；简介不再被截成两行 —— 一个人最值得看的就是那段话。
 */
import { computed } from 'vue'
import { linesOf, entriesOf, noteOf, ITEM_NOTE } from '../state-view'

const props = defineProps<{
  /** roles：人名 → 那个角色的几段状态 */
  cast: unknown
}>()

/**
 * 角色摊成「名字 + 简介 + 几行状态」。
 *
 * ⚠️ 简介那一行已经从条目里取走了（noteOf），明细行里就得把 note 摘掉 ——
 *    不然同一句话会在面板上出现两遍。
 */
const people = computed(() =>
  entriesOf(props.cast).map(({ key, value }) => ({
    name: key,
    note: noteOf(value),
    lines: linesOf(value).filter((line) => line.key !== ITEM_NOTE),
  })),
)
</script>

<template>
  <ul class="space-y-3">
    <li v-for="person in people" :key="person.name" data-cast class="border-l-2 border-accent-line/45 pl-2.5">
      <p class="font-serif text-[14px] font-semibold text-text">{{ person.name }}</p>
      <p v-if="person.note" class="mt-0.5 text-[11.5px] leading-relaxed text-muted">
        {{ person.note }}
      </p>
      <div v-if="person.lines.length" class="mt-1 space-y-0.5">
        <p v-for="line in person.lines" :key="line.key" class="text-[11.5px] leading-snug text-muted">
          <span class="text-[10px] tracking-wide text-faint uppercase">{{ line.key }}</span>
          {{ line.text }}
        </p>
      </div>
    </li>
  </ul>
</template>
