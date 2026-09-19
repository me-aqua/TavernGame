<script setup lang="ts">
/**
 * 古书跨页：一回合 = 一跨页。左页是玩家的行动，右页是模型现写的叙事。
 *
 * 翻页有两层：导航按钮/方向键切页时，一张「书叶」绕着书脊转过去；
 * 新回合落地时自动翻到最新一页。最新的右页会触发落笔动画（见 BookPage）。
 *
 * 这里是**唯一**把 rows 折成书叶的地方；分组与分页在纯函数 book.ts 里。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BookPage from './BookPage.vue'
import { toLeaves, type BookLeaf } from './book'
import type { Row, Status } from '../stores/game'
import type { Spot } from '../game/display'

const { t } = useI18n()

const props = defineProps<{
  /** 事件流的投影（故事+调试；调试行由 book.ts 跳过） */
  rows: Row[]
  /** 引擎当前回合数（最新一回的编号） */
  turn: number
  busy: boolean
  status: Status | null
  scene: Spot
  timeLabel: string
  cardName: string
}>()

const leaves = computed(() => toLeaves(props.rows, props.turn))
const latest = computed(() => Math.max(0, leaves.value.length - 1))
const index = ref(latest.value)

const sceneLabel = computed(() => {
  const parts = [props.scene.spot, props.scene.scene].filter((part) => part !== '')
  return parts.length > 0 ? parts.join(t('sidebar.separator')) : props.scene.area
})

type Direction = 'next' | 'prev'

interface Turning {
  from: BookLeaf
  fromIndex: number
  direction: Direction
}

const turning = ref<Turning | null>(null)
let turnTimer: ReturnType<typeof setTimeout> | null = null

/** 用户关掉动效时不做翻页/turn；CSS 那边也有一层 media query 兜底 */
function reduceMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

function startTurn(from: BookLeaf, fromIndex: number, direction: Direction): void {
  if (reduceMotion()) return
  if (turnTimer !== null) clearTimeout(turnTimer)
  turning.value = { from, fromIndex, direction }
  turnTimer = setTimeout(() => {
    turning.value = null
    turnTimer = null
  }, 720)
}

onBeforeUnmount(() => {
  if (turnTimer !== null) clearTimeout(turnTimer)
})

const current = computed<BookLeaf | null>(() => leaves.value[index.value] ?? null)

/** 切页：先把当前页当作「翻走的书叶」，再换索引 */
function go(next: number): void {
  if (next < 0 || next >= leaves.value.length || next === index.value) return
  const from = current.value
  const fromIndex = index.value
  const direction: Direction = next > index.value ? 'next' : 'prev'
  index.value = next
  if (from) startTurn(from, fromIndex, direction)
}

/** 新回合落地（行动刚写下、模型刚续写）都自动翻到最新一页 */
watch(
  () => leaves.value.length,
  (length) => {
    if (length === 0) {
      index.value = 0
      return
    }
    const from = current.value
    const fromIndex = index.value
    const next = length - 1
    if (next === index.value) return
    index.value = next
    if (from) startTurn(from, fromIndex, 'next')
  },
)

const reveal = computed(() => current.value !== null && index.value === latest.value)

/** 叙事文本的小哈希：内容变了就换 key，让落笔动画重新跑一次 */
function hash(text: string): number {
  let value = 0
  for (let i = 0; i < text.length; i += 1) value = ((value << 5) - value + text.charCodeAt(i)) | 0
  return value
}
const revealKey = computed(() => hash(current.value?.narration ?? ''))

function turnLabel(leaf: BookLeaf): string {
  return leaf.turn === 0 ? t('book.prologue') : t('book.turn', { turn: leaf.turn })
}
</script>

<template>
  <div
    data-book-scene
    class="book-scene"
    role="region"
    :aria-label="t('book.title')"
    tabindex="0"
    @keydown.left.prevent="go(index - 1)"
    @keydown.right.prevent="go(index + 1)"
  >
    <div class="book-stage">
      <div class="book">
        <div class="book-frame">
          <div class="book-pages">
            <BookPage
              v-if="current"
              side="left"
              :leaf="current"
              :folio="index * 2 + 1"
              :scene-label="sceneLabel"
              :time-label="timeLabel"
              :card-name="cardName"
              :busy="busy"
              :status="status"
              :reveal="false"
              :reveal-key="0"
            />
            <div class="book-gutter" aria-hidden="true" />

            <BookPage
              v-if="current"
              side="right"
              :leaf="current"
              :folio="index * 2 + 2"
              :scene-label="sceneLabel"
              :time-label="timeLabel"
              :card-name="cardName"
              :busy="busy"
              :status="status"
              :reveal="reveal"
              :reveal-key="revealKey"
            />

            <!-- 翻页：一张纸脸绕书脊转过去；背面是空白纸 -->
            <div v-if="turning" class="book-leaf" :class="turning.direction" aria-hidden="true">
              <div class="book-leaf-face front">
                <div class="book-page right book-ghost">
                  <p class="book-rubric">{{ turnLabel(turning.from) }}</p>
                  <p class="book-ghost-text">{{ turning.from.narration }}</p>
                  <p class="book-page-foot">&mdash; {{ turning.fromIndex * 2 + 2 }} &mdash;</p>
                </div>
              </div>
              <div class="book-leaf-face back" />
            </div>
          </div>

          <div class="book-spine" aria-hidden="true" />
          <svg class="book-corner tl" viewBox="0 0 100 100" aria-hidden="true">
            <path d="M6 8h36M6 8v36" />
            <path d="M6 30c18 0 28 10 28 28" />
            <path d="M12 14c18 0 30 10 32 28" />
            <circle cx="10" cy="10" r="2.6" />
          </svg>
          <svg class="book-corner tr" viewBox="0 0 100 100" aria-hidden="true">
            <path d="M6 8h36M6 8v36" />
            <path d="M6 30c18 0 28 10 28 28" />
            <path d="M12 14c18 0 30 10 32 28" />
            <circle cx="10" cy="10" r="2.6" />
          </svg>
          <svg class="book-corner bl" viewBox="0 0 100 100" aria-hidden="true">
            <path d="M6 8h36M6 8v36" />
            <path d="M6 30c18 0 28 10 28 28" />
            <path d="M12 14c18 0 30 10 32 28" />
            <circle cx="10" cy="10" r="2.6" />
          </svg>
          <svg class="book-corner br" viewBox="0 0 100 100" aria-hidden="true">
            <path d="M6 8h36M6 8v36" />
            <path d="M6 30c18 0 28 10 28 28" />
            <path d="M12 14c18 0 30 10 32 28" />
            <circle cx="10" cy="10" r="2.6" />
          </svg>
        </div>

        <div class="book-edges-right" aria-hidden="true" />
        <div class="book-edges-bottom" aria-hidden="true" />
        <div class="book-ribbon" aria-hidden="true" />

        <button
          data-book-prev
          class="book-nav book-nav-prev"
          :disabled="index <= 0"
          :aria-label="t('book.prev')"
          :title="t('book.prev')"
          @click="go(index - 1)"
        >
          &lsaquo;
        </button>
        <button
          data-book-next
          class="book-nav book-nav-next"
          :disabled="index >= leaves.length - 1"
          :aria-label="t('book.next')"
          :title="t('book.next')"
          @click="go(index + 1)"
        >
          &rsaquo;
        </button>
        <button
          v-if="index < leaves.length - 1"
          data-book-latest
          class="book-latest"
          @click="go(leaves.length - 1)"
        >
          {{ t('book.latest') }}
        </button>
      </div>
    </div>
  </div>
</template>
