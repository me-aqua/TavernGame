<script setup lang="ts">
/**
 * 行踪块：状态树里的 whoIsWhere（人名 → 地点）。谁在哪，一眼扫完。
 * 人物牌的「在场」高亮与这里读的是同一段状态。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { entriesOf, scalarText } from '../state-view'

const { t } = useI18n()

const props = defineProps<{
  /** world.whoIsWhere：人名 → 地点 */
  where: unknown
}>()

const rows = computed(() =>
  entriesOf(props.where).map(({ key, value }) => ({ name: key, place: scalarText(value) })),
)
</script>

<template>
  <ul v-if="rows.length" class="space-y-1.5">
    <li
      v-for="row in rows"
      :key="row.name"
      data-where
      class="border-accent-line/45 flex items-baseline gap-2 border-l-2 pl-2"
    >
      <span class="text-text font-serif text-[12.5px] font-semibold">{{ row.name }}</span>
      <span class="text-muted text-[11.5px]">{{ row.place }}</span>
    </li>
  </ul>
  <p v-else class="text-muted text-[11.5px]">{{ t('world.whereEmpty') }}</p>
</template>
