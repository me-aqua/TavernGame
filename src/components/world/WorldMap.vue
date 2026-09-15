<script setup lang="ts">
/**
 * 地图块：卡里的每个区域 + 它的「必有地点」，当前所在的区域与地点高亮。
 *
 * 数据由外层（WorldPanel 经 display-blocks）从当前卡读好传进来 ——
 * 这个组件不认识卡，也不认识 store。
 */
import { useI18n } from 'vue-i18n'
import type { AreaView, Spot } from '../../game/display'

const { t } = useI18n()

const props = defineProps<{
  /** 卡声明的区域，按声明顺序 */
  areas: AreaView[]
  /** 当前所在：区域 + 地点（地点为空 = 只认得出区域） */
  spot: Spot
}>()

/** 这一块地点是不是主控此刻站的地方 */
function isHere(area: string, place: string): boolean {
  return area === props.spot.area && place === props.spot.place
}
</script>

<template>
  <div class="space-y-1.5">
    <div
      v-for="area in areas"
      :key="area.name"
      data-area
      :data-current="area.name === spot.area ? '' : undefined"
      class="rounded-xl border px-2.5 py-1.5"
      :class="
        area.name === spot.area ? 'border-accent-line/70 bg-accent-soft/50' : 'border-line/60 bg-surface-2/40'
      "
    >
      <p class="text-[12px] font-semibold" :class="area.name === spot.area ? 'text-accent' : 'text-muted'">
        {{ area.name }}
      </p>
      <ul v-if="area.places.length" class="mt-1 flex flex-wrap gap-1">
        <li
          v-for="place in area.places"
          :key="place"
          data-place
          class="rounded-full px-2 py-0.5 text-[11px] leading-tight"
          :class="isHere(area.name, place) ? 'bg-accent text-page' : 'bg-surface-2 text-muted'"
          :data-current="isHere(area.name, place) ? '' : undefined"
        >
          {{ place }}
        </li>
      </ul>
      <!-- 没写固定地点的区域（地牢）：说清楚是「还没长出来」，不是界面坏了 -->
      <p v-else class="mt-0.5 text-[11px] leading-snug text-faint">{{ t('world.growingPlaces') }}</p>
    </div>
  </div>
</template>
