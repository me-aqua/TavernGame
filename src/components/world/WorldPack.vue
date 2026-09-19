<script setup lang="ts">
/**
 * 背包块：状态树里主控带在身上的东西（game/display.ts 的 packOf）。
 *
 * 条目要么直接是一个字符串（那就是它的标题），要么是一段状态 —— 后者按形状摊成明细行。
 * 武器 / 防具 / 硬币 / 杂物同在一个列表里，界面不分类。
 *
 * ⚠️ 对象条目**读不出「哪一栏是名称 / 数量」**（界面不认字段名：见 state-view 的文件头）⇒
 *    没有粗体标题与数量徽标，值仍在明细行里。最终形态归段 6。
 */
import { computed } from 'vue'
import { entriesOf, itemOf } from '../state-view'

const props = defineProps<{
  /** lead.pack：主控的物品 */
  items: unknown
}>()

/** 物品摊成「标题 + 明细行」；不是列表（卡写成字典）就按人名那样的键值画 */
const entries = computed(() => {
  if (Array.isArray(props.items)) return props.items.map(itemOf)
  return entriesOf(props.items).map(({ key, value }) => {
    const item = itemOf(value)
    return { ...item, title: item.title || key }
  })
})
</script>

<template>
  <ul class="space-y-1.5">
    <li v-for="(item, index) in entries" :key="item.title + index" data-item>
      <p class="text-[12px] text-text">{{ item.title }}</p>
      <p v-for="line in item.lines" :key="line.key" class="line-clamp-2 text-[11px] leading-snug text-faint">
        {{ line.text }}
      </p>
    </li>
  </ul>
</template>
