<script setup lang="ts">
/**
 * 角色块：卡里点名的 NPC —— 姓名 / 身份 · 种族 / 一句设定。
 *
 * 生平与性格是给模型看的，不进这一块：玩家该从戏里认识人，不是从面板上读简历。
 */
import { useI18n } from 'vue-i18n'
import type { CastView } from '../../game/display'

const { t } = useI18n()

defineProps<{ cast: CastView[] }>()
</script>

<template>
  <ul class="space-y-2">
    <li v-for="person in cast" :key="person.name" class="border-l-2 border-line/70 pl-2">
      <p class="text-[12.5px] font-semibold text-text">{{ person.name }}</p>
      <p class="text-[11px] text-faint">
        {{ t('world.personRole', { role: person.role, race: person.race }) }}
      </p>
      <p class="mt-0.5 text-[11px] leading-snug text-muted">{{ person.bio }}</p>
    </li>
  </ul>
</template>
