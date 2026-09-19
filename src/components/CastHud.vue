<script setup lang="ts">
/**
 * 人物牌 HUD：已经认识的角色，每人一枚纹章 + 完整名字 + 身份标签 + 简介 + 行踪。
 *
 * 行踪（whoIsWhere）是卡声明了 where 块才有的；与当前地点/场景对得上的人标「在场」
 * 并排在前面。点右上角的「世界手札」看完整条目。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { peopleHud } from './hud'
import CharacterSigil from './world/CharacterSigil.vue'
import type { Spot } from '../game/display'

const { t } = useI18n()

const props = defineProps<{
  /** roles：人名 → 角色条目 */
  roles: unknown
  /** world.whoIsWhere：人名 → 地点 */
  where: unknown
  /** 当前所在，用来点亮「在场」 */
  here: Spot
}>()

const emit = defineEmits<{ open: [] }>()

const people = computed(() =>
  [...peopleHud(props.roles, props.where, props.here)].sort((a, b) => Number(b.present) - Number(a.present)),
)
</script>

<template>
  <section class="hud-panel cast-hud" data-cast-hud>
    <header class="flex items-center justify-between gap-2">
      <p class="hud-title">{{ t('hud.cast') }}</p>
      <button data-open-world class="hud-link" @click="emit('open')">{{ t('hud.world') }}</button>
    </header>

    <ul v-if="people.length" class="cast-list mt-2">
      <li
        v-for="person in people"
        :key="person.name"
        class="person-card"
        :class="{ 'person-present': person.present }"
        :data-person-card="person.name"
      >
        <CharacterSigil :name="person.name" size="md" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-1.5">
            <p class="hud-name truncate" data-person-name>{{ person.name }}</p>
            <span v-if="person.present" class="hud-chip hud-chip-hot">
              {{ t('hud.present') }}
            </span>
          </div>
          <p v-if="person.tags.length" class="hud-kicker person-tags">
            {{ person.tags.join('\u00b7') }}
          </p>
          <p v-if="person.note" class="person-note">{{ person.note }}</p>
          <p v-if="person.where" class="hud-kicker person-where">
            {{ t('hud.away', { where: person.where }) }}
          </p>
        </div>
      </li>
    </ul>
    <p v-else class="hud-empty">{{ t('hud.peopleEmpty') }}</p>
  </section>
</template>
