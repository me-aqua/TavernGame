<script setup lang="ts">
/**
 * 背包块：状态树里主控带在身上的东西（game/display.ts 的 packOf）。
 *
 * 条目要么直接是一个字符串，要么是一段状态 —— 后者取 name 当标题、count 当数量，
 * 其余字段各占一行。武器 / 防具 / 硬币 / 杂物同在一个列表里，界面不分类。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { entriesOf, itemOf } from '../state-view'

const { t } = useI18n()

const props = defineProps<{
  /** lead.pack：主控的物品 */
  items: unknown
}>()

/** 物品摊成「标题 + 数量 + 明细」；不是列表（卡写成字典）就按人名那样的键值画 */
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
      <p class="text-[12.5px] text-text">
        {{ item.title }}
        <span v-if="item.count" class="ml-1 text-[11px] text-accent tabular-nums">{{
          t('world.itemCount', { count: item.count })
        }}</span>
      </p>
      <p v-for="line in item.lines" :key="line.key" class="text-[11.5px] leading-snug text-faint">
        {{ line.text }}
      </p>
    </li>
  </ul>
</template>
