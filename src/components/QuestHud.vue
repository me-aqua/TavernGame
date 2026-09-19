<script setup lang="ts">
/**
 * 故事链 HUD：把卡里的 chains 摊成任务卡 —— 标题、表面、阶段进度、已露的线索。
 *
 * 这条 HUD 只有卡声明了 chains 块才拿得到数据（见 game/display.ts 的 hudData）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { questsHud } from './hud'

const { t } = useI18n()

const props = defineProps<{
  /** world.chains：链名 → 那一条链 */
  chains: unknown
}>()

const quests = computed(() => questsHud(props.chains))
</script>

<template>
  <section class="hud-panel quest-hud" data-quest-hud>
    <p class="hud-title">{{ t('hud.quests') }}</p>

    <ul v-if="quests.length" class="mt-2 space-y-2">
      <li v-for="quest in quests" :key="quest.name" class="quest-card" data-quest-card>
        <p class="hud-name">{{ quest.name }}</p>
        <p v-if="quest.subtitle" class="quest-subtitle">{{ quest.subtitle }}</p>

        <div v-if="quest.total" class="mt-1 flex items-center gap-1">
          <span
            v-for="step in quest.total"
            :key="step"
            class="quest-pip"
            :class="{ 'quest-pip-on': step <= quest.stage }"
          />
          <span class="hud-kicker ml-1">
            {{ t('hud.questStage', { stage: quest.stage, total: quest.total }) }}
          </span>
        </div>
        <p v-if="quest.stageName" class="quest-stage">{{ quest.stageName }}</p>

        <ul v-if="quest.revealed.length" class="mt-1 flex flex-wrap gap-1">
          <li v-for="clue in quest.revealed" :key="clue" class="hud-chip">{{ clue }}</li>
        </ul>
      </li>
    </ul>

    <p v-else class="hud-empty">{{ t('hud.questHint') }}</p>
  </section>
</template>
