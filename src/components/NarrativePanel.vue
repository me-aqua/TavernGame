<script setup lang="ts">
/**
 * 叙事面板：主界面中央的「模型正在说话」的地方。
 *
 * 它只渲染**最新一回**（toLeaves 的最后一叶）：上面是玩家写下的行动，下面是模型的
 * 回答，带着落笔动画；不是古书页，没有页码/火漆/drop cap —— 那是一本历史图鉴的事。
 *
 * 进行中与通知仍然只有一处 [data-status]（busy 优先），旧的聊天投影不再需要。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toLeaves } from './book'
import SceneSigil from './world/SceneSigil.vue'
import type { Row, Status } from '../stores/game'

const { t } = useI18n()

const props = defineProps<{
  rows: Row[]
  /** 引擎当前回合数（最新一回的编号） */
  turn: number
  busy: boolean
  status: Status | null
  sceneLabel: string
  timeLabel: string
  cardName: string
  /** 场景剪影水印的种子；缺省用卡名 */
  sigilSeed?: string
}>()

const emit = defineEmits<{ history: [] }>()

const leaf = computed(() => toLeaves(props.rows, props.turn).at(-1) ?? null)
const paragraphs = computed(() =>
  (leaf.value?.narration ?? '').split(/\n{2,}/).filter((paragraph) => paragraph.trim() !== ''),
)

const turnLabel = computed(() => {
  if (!leaf.value) return ''
  return leaf.value.turn === 0 ? t('book.prologue') : t('book.turn', { turn: leaf.value.turn })
})

/** 叙事内容的小哈希：内容变了就换 key，让落笔动画重新跑一次 */
function hash(text: string): number {
  let value = 0
  for (let i = 0; i < text.length; i += 1) value = ((value << 5) - value + text.charCodeAt(i)) | 0
  return value
}
const revealKey = computed(() => hash(leaf.value?.narration ?? ''))

const bodyEl = ref<HTMLElement | null>(null)

// 新一回、或模型的回答刚落到这一页：从页首开始读，不把视线留在上一回的底部
watch(
  () => [leaf.value?.turn, leaf.value?.narration.length] as const,
  async () => {
    await nextTick()
    if (bodyEl.value) bodyEl.value.scrollTop = 0
  },
)
</script>

<template>
  <section class="hud-panel narrative-panel" data-narrative>
    <header class="panel-head">
      <div class="min-w-0">
        <p class="panel-scene truncate">{{ sceneLabel || cardName }}</p>
        <p class="panel-meta truncate">{{ timeLabel }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <span v-if="turnLabel" class="panel-turn">{{ turnLabel }}</span>
        <button data-history-open class="hud-link" @click="emit('history')">
          {{ t('hud.history') }}
        </button>
      </div>
    </header>

    <SceneSigil class="panel-sigil" :seed="sigilSeed || cardName" />

    <div ref="bodyEl" class="panel-body" aria-live="polite">
      <div class="panel-written">
        <p class="panel-rubric">{{ t('hud.narrative') }}</p>

        <p v-if="leaf?.action" class="line action panel-action story-text">
          {{ leaf.action }}
        </p>

        <p
          v-if="paragraphs.length"
          :key="revealKey"
          class="line narration panel-narration story-text writing"
          data-panel-narration
        >
          <span
            v-for="(paragraph, index) in paragraphs"
            :key="index"
            class="ink-para"
            :style="{ animationDelay: `${index * 130}ms` }"
          >
            {{ paragraph }}
          </span>
        </p>

        <p v-if="busy" data-status="busy" class="ink-status panel-status">
          <span class="ink-drop" aria-hidden="true" />
          <span>{{ status?.text ?? t('hud.busy') }}</span>
        </p>
        <p v-else-if="status" :data-status="status.kind" class="panel-status panel-note">
          {{ status.text }}
        </p>

        <p v-if="!paragraphs.length && !busy && !status" class="panel-empty">
          {{ t('hud.empty') }}
        </p>
      </div>
    </div>
  </section>
</template>
