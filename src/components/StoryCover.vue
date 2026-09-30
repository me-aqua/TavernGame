<script setup lang="ts">
/**
 * 开场封面：全新一局、还没配 API、或者开场正在生成时，玩家看到的那一页。
 *
 * 它不是「合着的书」，是游戏标题屏：纹章、大标题、简介、两个类型标签，加一枚黄铜开始键。
 * 开场生成时节点进度长在这里；封面之后的正文屏由外面那一层换掉。
 *
 * ⚠️ 它只吃五个入参（卡名 / 简介 / 配没配 API / 正在不在生成 / 一条状态行）——
 *    不读卡、不读存档、不读气氛：颜色从放它的那一层继承，拿不到继承就走自己这一份默认纸色。
 * ⚠️ 两个事件（`configure` / `start`）只往外抛，谁接是接线那一层的事。
 * ⚠️ 样式随件走（文件末尾那个 `<style scoped>`）：它不依赖任何全局类，放进哪一层都长得一样。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import CharacterSigil from './world/CharacterSigil.vue'
import type { Status } from '../stores/game'

const { t } = useI18n()

const props = defineProps<{
  /** 卡名（卡的唯一事实来源 cards/*.json） */
  name: string
  /** 卡简介 —— 开场唯一一段「这个世界是什么」 */
  summary: string
  /** 配了 API 没有 */
  configured: boolean
  /** 开局正在生成 */
  busy: boolean
  /** 进行中 / 通知 / 报错；null = 没有要说的 */
  status: Status | null
}>()

const emit = defineEmits<{ configure: []; start: [] }>()

/** 生成中优先显示节点进度；其余状态（欢迎 / 报错）直接显示在标题下 */
const busyText = computed(() => props.status?.text ?? t('app.generatingOpening'))
</script>

<template>
  <div data-cover class="start-stage">
    <section class="start-card">
      <div class="start-head">
        <CharacterSigil :name="name" you size="lg" />
        <div class="min-w-0">
          <p class="cover-kicker">{{ t('cover.kicker') }}</p>
          <h1 data-cover-name class="start-title">{{ name }}</h1>
        </div>
      </div>

      <p data-cover-summary class="start-summary">{{ summary }}</p>

      <div class="start-tags">
        <span>&#10022; {{ t('cover.kicker') }}</span>
        <span>&#10022; {{ t('cover.gm') }}</span>
      </div>

      <!-- 状态行只有一处：进行中显示节点进度，其余显示最近一条通知（未配置的欢迎语就在这里） -->
      <div class="cover-status start-status">
        <p v-if="busy" data-status="busy" class="ink-status">
          <span class="ink-drop" aria-hidden="true" />
          <span>{{ busyText }}</span>
        </p>
        <p v-else-if="status" :data-status="status.kind">{{ status.text }}</p>
        <p v-else-if="!configured" data-status="info">{{ t('cover.unconfigured') }}</p>
      </div>

      <div class="start-actions">
        <button v-if="!configured" data-cover-configure class="start-cta" @click="emit('configure')">
          {{ t('cover.configure') }}
        </button>
        <button v-else-if="!busy" data-cover-start class="start-cta" @click="emit('start')">
          {{ t('cover.start') }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 装饰本件的规则全在这一块里（`.cover-kicker` / `.start-*` 全族 / 生成中那一滴墨）——
 * `<style scoped>` 只服务本组件，不外泄到全局。
 * ⚠️ 色值与字体是字面量：我们树里没有 `--book-gold` 那一族与 `--font-serif`，
 *    也不往 `:root` 加新变量名 —— 那四个值逐字是他的。 */

/* 生成中：一滴墨在呼吸，不是聊天软件的三点脉冲 */
.ink-status {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  font-size: 0.82rem;
  color: var(--color-muted);
}
.ink-drop {
  width: 0.5rem;
  height: 0.5rem;
  flex: none;
  border-radius: 9999px;
  background: var(--color-accent);
  animation: ink-breathe 1.8s ease-in-out infinite;
}
@keyframes ink-breathe {
  0%,
  100% {
    transform: scale(0.72);
    opacity: 0.5;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}

/* ============================================================
 *  首屏：游戏标题屏 —— 纹章、大标题、简介、开始键，不是空屏加一行提示
 * ============================================================ */

.cover-kicker {
  font-size: 0.68rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--color-faint);
}

/* ---- 游戏开场：标题屏，不再是合着的书 ---- */

.start-stage {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 1rem;
}

.start-stage::before {
  content: '';
  position: absolute;
  inset: -10% -20%;
  background: radial-gradient(closest-side at 50% 42%, rgb(232 200 119 / 0.14), transparent 70%);
  pointer-events: none;
}

.start-card {
  position: relative;
  z-index: 1;
  display: flex;
  width: min(660px, 92vw);
  flex-direction: column;
  gap: 1rem;
  border: 1px solid color-mix(in oklab, #7d5f2a 75%, transparent);
  border-radius: 0.85rem;
  background: linear-gradient(180deg, rgb(42 26 15 / 0.95), rgb(18 11 6 / 0.97));
  box-shadow:
    0 40px 90px -46px rgb(0 0 0 / 0.95),
    0 0 70px -24px rgb(232 200 119 / 0.22),
    inset 0 1px 0 rgb(255 233 180 / 0.08);
  padding: clamp(1.1rem, 3vw, 1.8rem);
  color: #e9dcc0;
}

.start-card::before {
  content: '';
  position: absolute;
  inset: 5px;
  border: 1px solid rgb(255 233 180 / 0.06);
  border-radius: 0.6rem;
  pointer-events: none;
}

.start-head {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.start-head .cover-kicker {
  color: #c9a24a;
}

.start-title {
  font-family:
    'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'SimSun', ui-serif, Georgia, serif;
  font-size: clamp(2.4rem, 7vw, 4.2rem);
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: 0.02em;
  color: #efd99a;
  text-shadow:
    0 2px 0 #000,
    0 0 28px rgb(232 200 119 / 0.25);
}

.start-summary {
  font-family:
    'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'SimSun', ui-serif, Georgia, serif;
  font-size: clamp(0.95rem, 1.5vw, 1.05rem);
  line-height: 1.85;
  color: #d4c5a5;
  white-space: pre-line;
}

.start-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.start-tags span {
  border: 1px solid color-mix(in oklab, #7d5f2a 55%, transparent);
  border-radius: 9999px;
  background: rgb(232 200 119 / 0.07);
  padding: 0.18rem 0.55rem;
  color: #d8c59d;
  font-size: 0.68rem;
}

.start-status {
  min-height: 1.8rem;
}
.start-status .ink-status {
  color: #e0cba0;
}
.start-status [data-status='error'] {
  color: #f0b3a6;
}

.start-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.start-cta {
  display: inline-flex;
  min-height: 2.9rem;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  border: 1px solid #c9a24a;
  border-radius: 0.45rem;
  background: linear-gradient(180deg, #b07a2f, #7a4a1a);
  box-shadow:
    0 8px 18px -10px rgb(0 0 0 / 0.8),
    inset 0 1px 0 rgb(255 240 200 / 0.25);
  padding: 0.65rem 1.4rem;
  color: #fff4d6;
  font-family:
    'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'SimSun', ui-serif, Georgia, serif;
  font-size: 1rem;
  font-weight: 600;
  transition:
    transform 0.16s ease,
    filter 0.16s ease;
}
.start-cta::before {
  content: '\25C6';
  font-size: 0.7em;
  opacity: 0.9;
}
.start-cta:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}
@media (max-width: 640px) {
  .start-stage {
    align-items: flex-start;
    overflow-y: auto;
    padding: 0.75rem 0.6rem;
  }
  .start-card {
    margin-block: auto;
  }
  .start-title {
    font-size: clamp(2rem, 12vw, 3rem);
  }
}

/* 关掉动效偏好时墨滴静止 */
@media (prefers-reduced-motion: reduce) {
  .ink-drop {
    animation: none;
  }
}
</style>
