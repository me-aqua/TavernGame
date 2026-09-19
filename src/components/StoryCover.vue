<script setup lang="ts">
/**
 * 开场舞台：全新一局、还没配 API、或者开场正在生成时，玩家看到的那一页。
 *
 * 不是「合着的古书」，是游戏标题屏：场景剪影、纹章、大标题、简介、三个类型标签，
 * 加一枚黄铜开始键。开场生成时节点进度长在这里；翻开的故事舞台由 GameStage 接手。
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
