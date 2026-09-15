<script setup lang="ts">
/**
 * 背包块：主控带在身上的东西 —— 名称 / 数量 / 备注。
 *
 * 武器、防具、硬币、杂物同在一个列表里（卡里就没有装备栏与钱包这两个概念）。
 */
import { useI18n } from 'vue-i18n'
import type { PackView } from '../../game/display'

const { t } = useI18n()

defineProps<{ items: PackView[] }>()
</script>

<template>
  <ul class="space-y-1.5">
    <li v-for="item in items" :key="item.name" data-item>
      <p class="text-[12px] text-text">
        {{ item.name }}
        <span v-if="item.count" class="ml-1 text-[11px] text-accent tabular-nums">{{
          t('world.itemCount', { count: item.count })
        }}</span>
      </p>
      <p v-if="item.note" class="text-[11px] leading-snug text-faint">{{ item.note }}</p>
    </li>
  </ul>
</template>
