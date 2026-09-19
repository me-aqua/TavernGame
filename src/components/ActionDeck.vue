<script setup lang="ts">
/**
 * 行动牌：从状态推出来的快捷动词 —— 去某地 / 找某人 / 看某物 / 观察 / 等待 / 休息。
 *
 * 点一张牌只把一句话**填进输入框**（不自动提交），玩家可以改。句子走 i18n，和界面
 * 语言一致（模型语言也跟随界面语言）。牌本身只从卡声明过的状态块取数据。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { actionOptions } from './hud'
import type { HudData } from '../game/display'

const { t } = useI18n()

const props = defineProps<{
  /** 卡声明过的 HUD 数据（game/display.ts 的 hudData） */
  hud: HudData
}>()

const emit = defineEmits<{ pick: [text: string] }>()

const options = computed(() => actionOptions(props.hud))
</script>

<template>
  <section class="action-deck" data-action-deck>
    <div class="flex items-baseline gap-2">
      <p class="hud-kicker action-deck-label">{{ t('hud.actions') }}</p>
      <p class="action-deck-hint">{{ t('hud.actionHint') }}</p>
    </div>

    <div class="action-cards mt-1.5">
      <button
        v-for="option in options"
        :key="option.id"
        class="action-card"
        :class="`action-${option.kind}`"
        :data-action="option.kind"
        :title="t(option.labelKey, option.labelArgs)"
        @click="emit('pick', t(option.textKey, option.textArgs))"
      >
        <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
          <template v-if="option.kind === 'place'">
            <path d="M12 21s7-7.6 7-13A7 7 0 0 0 5 8c0 5.4 7 13 7 13Z" />
            <circle cx="12" cy="8" r="2.5" />
          </template>
          <template v-else-if="option.kind === 'person'">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
          </template>
          <template v-else-if="option.kind === 'item'">
            <path d="M4 8h16l-2 12H6L4 8Z" />
            <path d="M9 8V6a3 3 0 0 1 6 0v2" />
          </template>
          <template v-else>
            <circle cx="12" cy="12" r="3" />
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          </template>
        </svg>
        <span class="action-label truncate">{{ t(option.labelKey, option.labelArgs) }}</span>
      </button>
    </div>
  </section>
</template>
