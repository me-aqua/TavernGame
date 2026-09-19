<script setup lang="ts">
/**
 * 古书的一页。左页写玩家的行动（rubric 式的红字），右页写模型的叙事（黑墨）。
 *
 * 叙事按空行切成段，每段是一次「落笔」；`writing` 时这些段落依次从墨迹里浮出来。
 * 首字若是文字，就做一个手抄本式的 drop cap —— 但引号/标点不做，免得放大的是「「」。
 *
 * 页脚是页码与一个小花饰；页眉是回目 / 叙事，加场景与时间。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookLeaf } from './book'
import type { Status } from '../stores/game'

const { t } = useI18n()

const props = defineProps<{
  side: 'left' | 'right'
  leaf: BookLeaf
  /** 印刷页码（左页奇数、右页偶数） */
  folio: number
  sceneLabel: string
  timeLabel: string
  cardName: string
  busy: boolean
  status: Status | null
  /** 最新的那一页正在「落笔」：叙事段依次浮出来 */
  reveal: boolean
  /** 叙事内容变化时换 key，逼动画重新跑一次 */
  revealKey: number
}>()

const turnLabel = computed(() =>
  props.leaf.turn === 0 ? t('book.prologue') : t('book.turn', { turn: props.leaf.turn }),
)

const paragraphs = computed(() =>
  props.leaf.narration.split(/\n{2,}/).filter((paragraph) => paragraph.trim() !== ''),
)

const firstParagraph = computed(() => paragraphs.value[0] ?? '')
/** 首字：只有文字/数字才做 drop cap，引号与标点留给正文 */
const dropCap = computed(() => {
  const lead = Array.from(firstParagraph.value)[0] ?? ''
  return /[\p{L}\p{N}]/u.test(lead) ? lead : ''
})
const firstRest = computed(() =>
  dropCap.value === '' ? firstParagraph.value : firstParagraph.value.slice(dropCap.value.length),
)
const prologueMark = computed(() => Array.from(props.cardName)[0] ?? t('book.prologue'))
</script>

<template>
  <section class="book-page" :class="side" :data-book-page="side">
    <header class="book-page-head">
      <p class="book-rubric">{{ side === 'left' ? turnLabel : t('book.narration') }}</p>
      <p class="book-meta">
        <span v-if="side === 'left'">{{ sceneLabel }}</span>
        <span v-else>{{ timeLabel }}</span>
      </p>
    </header>

    <div class="book-page-body" :aria-live="side === 'right' ? 'polite' : undefined">
      <!-- 左页：你写下的行动 / 序 -->
      <template v-if="side === 'left'">
        <template v-if="leaf.action">
          <div class="book-written">
            <p class="book-action-note">{{ t('book.action') }}</p>
            <p class="line action book-action story-text">{{ leaf.action }}</p>
          </div>
          <div class="book-action-tail" aria-hidden="true">
            <span class="book-wax-seal">{{ t('book.actionSeal') }}</span>
            <span class="book-flourish">&#10087;</span>
          </div>
        </template>

        <div v-else class="book-prologue">
          <span class="book-prologue-mark" aria-hidden="true">{{ prologueMark }}</span>
          <p class="book-prologue-title">{{ cardName }}</p>
          <p class="book-prologue-note">{{ t('book.prologueNote') }}</p>
          <span class="book-flourish" aria-hidden="true">&#10087;</span>
        </div>
      </template>

      <!-- 右页：模型现写的叙事 -->
      <template v-else>
        <div v-if="paragraphs.length" class="book-written">
          <p
            :key="revealKey"
            class="line narration book-narration story-text"
            :class="{ writing: reveal }"
            data-book-narration
          >
            <span
              v-for="(paragraph, index) in paragraphs"
              :key="index"
              class="ink-para"
              :style="{ animationDelay: `${index * 130}ms` }"
            >
              <template v-if="index === 0 && dropCap">
                <span class="drop-cap">{{ dropCap }}</span
                >{{ firstRest }}
              </template>
              <template v-else>{{ paragraph }}</template>
            </span>
          </p>

          <p v-if="reveal && busy" data-status="busy" class="ink-status mt-3">
            <span class="ink-drop" aria-hidden="true" />
            <span class="quill-cursor" aria-hidden="true">&#10087;</span>
            <span>{{ status?.text ?? t('book.busy') }}</span>
          </p>

          <p v-if="!busy && status" :data-status="status.kind" class="book-status">
            {{ status.text }}
          </p>
        </div>

        <div v-else class="book-written">
          <p v-if="busy" data-status="busy" class="ink-status">
            <span class="ink-drop" aria-hidden="true" />
            <span>{{ status?.text ?? t('book.busy') }}</span>
          </p>
          <p v-else-if="status" :data-status="status.kind" class="book-status">{{ status.text }}</p>
          <p v-else class="book-blank">{{ t('book.blank') }}</p>
        </div>
      </template>
    </div>

    <footer class="book-page-foot">
      <span>&mdash; {{ folio }} &mdash;</span>
      <span class="book-ornament" aria-hidden="true">&#10087;</span>
    </footer>

    <!-- 页脚水印：左页罗盘（决定），右页羽毛笔与墨池（书写） -->
    <svg
      v-if="side === 'left'"
      class="page-vignette page-vignette-left"
      viewBox="0 0 120 120"
      aria-hidden="true"
    >
      <circle cx="60" cy="60" r="46" />
      <circle cx="60" cy="60" r="32" />
      <path d="M60 7v15M60 98v15M7 60h15M98 60h15" />
      <path d="M60 29l7.5 23.5L91 60l-23.5 7.5L60 91l-7.5-23.5L29 60l23.5-7.5Z" />
    </svg>
    <svg v-else class="page-vignette" viewBox="0 0 120 120" aria-hidden="true">
      <path d="M92 8C64 18 48 38 44 64c-1 6 0 11 2 16l8-4c-2-4-2-8-1-12 4-20 16-36 37-46Z" />
      <path d="M46 76 22 108" />
      <path d="M56 50c8-1 15 1 21 6" />
      <path d="M49 60c8-1 15 1 21 6" />
      <path d="M42 70c8-1 15 1 21 6" />
    </svg>
  </section>
</template>
