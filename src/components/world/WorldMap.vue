<script setup lang="ts">
/**
 * 地图块：状态树里的区域表 + 当前所在（game/display.ts 的 mapOf 给的就是这两段）。
 *
 * 区域的名字是 map 的键，「地点」是那一段里的字符串数组 —— 卡把地点写在哪个键上由
 * 作者决定（spots / places / …），界面只认「它是字符串数组」。当前区域与当前地点高亮：
 * 位置读的是状态树，不是卡里的预设。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { isRecord } from '../../game/save'
import { entriesOf, scalarText, textsOf } from '../state-view'

const { t } = useI18n()

const props = defineProps<{
  /** world.map：区域名 → 那一段状态 */
  areas: unknown
  /** world.location：当前所在（区域 / 地点 / 场景） */
  location: unknown
}>()

/**
 * 区域摊成「名字 + 那句话 + 地点」—— 名字是 map 的键；「那句话」只有**整条就是一个字符串**时才有
 * （对象条目按形状摊不出「哪一栏是简介」：见 state-view 的文件头，最终形态归段 6）。
 */
const places = computed(() =>
  entriesOf(props.areas).map(({ key, value }) => ({
    name: key,
    note: scalarText(value),
    spots: textsOf(value),
  })),
)

/** 当前所在的区域与地点（状态里没有 world 这一段时是两个空串） */
const here = computed(() => {
  const location = isRecord(props.location) ? props.location : {}
  return { area: scalarText(location.area), spot: scalarText(location.spot) }
})
</script>

<template>
  <div class="space-y-1.5">
    <div
      v-for="area in places"
      :key="area.name"
      data-area
      :data-current="area.name === here.area ? '' : undefined"
      class="rounded-xl border px-2.5 py-1.5"
      :class="
        area.name === here.area ? 'border-accent-line/70 bg-accent-soft/50' : 'border-line/60 bg-surface-2/40'
      "
    >
      <p class="text-[12px] font-semibold" :class="area.name === here.area ? 'text-accent' : 'text-muted'">
        {{ area.name }}
      </p>
      <p v-if="area.note" class="mt-0.5 text-[11px] leading-snug text-faint">{{ area.note }}</p>
      <ul v-if="area.spots.length" class="mt-1 flex flex-wrap gap-1">
        <li
          v-for="place in area.spots"
          :key="place"
          data-place
          class="rounded-full px-2 py-0.5 text-[11px] leading-tight"
          :class="
            area.name === here.area && place === here.spot ? 'bg-accent text-page' : 'bg-surface-2 text-muted'
          "
          :data-current="area.name === here.area && place === here.spot ? '' : undefined"
        >
          {{ place }}
        </li>
      </ul>
      <!-- 没写固定地点的区域（地牢那种还没长出来的）：说清楚是没有，不是界面坏了 -->
      <p v-else class="mt-0.5 text-[11px] leading-snug text-faint">{{ t('world.growingPlaces') }}</p>
    </div>
  </div>
</template>
