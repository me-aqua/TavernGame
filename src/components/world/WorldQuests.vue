<script setup lang="ts">
/**
 * 故事链块：状态树里的 chains 字典，摊成一张张「任务卡」。
 *
 * 和 HUD 读的是同一个 questsHud 投影（形状推导）：键是链名，第一个数字是阶段，
 * 第一个字符串列表是阶段表，第二个是已露线索，第一个长字符串是副标题。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { questsHud } from '../hud'

const { t } = useI18n()

const props = defineProps<{
  /** world.chains：链名 → 那一条链 */
  chains: unknown
}>()

const quests = computed(() => questsHud(props.chains))
</script>

<template>
  <ul v-if="quests.length" class="space-y-2">
    <li
      v-for="quest in quests"
      :key="quest.name"
      data-quest
      class="border-line/70 bg-surface-2/40 rounded-md border px-2.5 py-2"
    >
      <p class="text-text font-serif text-[12.5px] font-semibold">{{ quest.name }}</p>
      <p v-if="quest.subtitle" class="text-muted mt-0.5 text-[11.5px] leading-snug">
        {{ quest.subtitle }}
      </p>
      <div v-if="quest.total" class="mt-1 flex items-center gap-1">
        <span
          v-for="step in quest.total"
          :key="step"
          class="size-1.5 rounded-full"
          :class="step <= quest.stage ? 'bg-accent' : 'bg-line'"
        />
        <span class="text-faint ml-1 text-[10.5px]">
          {{ t('hud.questStage', { stage: quest.stage, total: quest.total }) }}
        </span>
      </div>
      <p v-if="quest.stageName" class="text-muted mt-0.5 text-[11px] leading-snug">
        {{ quest.stageName }}
      </p>
      <ul v-if="quest.revealed.length" class="mt-1 flex flex-wrap gap-1">
        <li
          v-for="clue in quest.revealed"
          :key="clue"
          class="bg-surface text-muted rounded-full px-1.5 py-0.5 text-[10.5px]"
        >
          {{ clue }}
        </li>
      </ul>
    </li>
  </ul>
  <p v-else class="text-muted text-[11.5px]">{{ t('hud.questHint') }}</p>
</template>
