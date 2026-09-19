<script setup lang="ts">
/**
 * 往事：把古书（BookPanel）当成一本「历史图鉴」打开。
 *
 * 主界面不再翻书；旧回合要看时才从叙事面板右上角的「翻阅历史」进来。
 * 书里保留一回合 = 一跨页、旧页翻回、落笔动画；关掉就回到游戏舞台。
 */
import { useI18n } from 'vue-i18n'
import BookPanel from './BookPanel.vue'
import type { Row, Status } from '../stores/game'
import type { Spot } from '../game/display'

const { t } = useI18n()

defineProps<{
  rows: Row[]
  turn: number
  busy: boolean
  status: Status | null
  scene: Spot
  timeLabel: string
  cardName: string
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div
    data-history
    class="fixed inset-0 z-40 flex items-center justify-center bg-[#120b05]/70 p-2 backdrop-blur-sm sm:p-4"
    role="dialog"
    aria-modal="true"
    :aria-label="t('hud.historyTitle')"
    @click.self="emit('close')"
  >
    <div
      class="border-line/70 bg-surface flex h-[min(760px,90vh)] w-[min(1180px,96vw)] flex-col overflow-hidden rounded-xl border shadow-[0_40px_90px_-40px_rgba(0,0,0,0.9)]"
    >
      <header class="border-line/70 flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <h2 class="text-text font-serif text-[16px] font-semibold">
          {{ t('hud.historyTitle') }}
        </h2>
        <button data-history-close class="hud-link" @click="emit('close')">
          {{ t('hud.close') }}
        </button>
      </header>

      <BookPanel
        class="min-h-0 flex-1"
        :rows="rows"
        :turn="turn"
        :busy="false"
        :status="null"
        :scene="scene"
        :time-label="timeLabel"
        :card-name="cardName"
      />
    </div>
  </div>
</template>
