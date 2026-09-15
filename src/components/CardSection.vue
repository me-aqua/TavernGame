<script setup lang="ts">
/**
 * 设置面板里的「卡」一节：现在用的是哪张卡（名 / 版本 / 来源），四个动作抛给外层。
 *
 * 卡是唯一事实来源，玩家该看得见自己在玩哪一张 —— 内置示例，还是自己导入 / 编辑过的。
 * 存着的卡读不出来时这里另留一行说明：启动那条通知会被随后的「进行中」状态顶掉，
 * 这一行是留在界面上的那份交代（不许静默退回内置卡）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { cardMeta, cardStartup, currentCard } from '../game/current-card'

const { t } = useI18n()

const emit = defineEmits<{
  action: ['card-view' | 'card-import' | 'card-export' | 'card-reset']
}>()

const meta = computed(() => cardMeta(currentCard))
const sourceLabel = computed(() =>
  t(cardStartup.source === 'imported' ? 'card.sourceImported' : 'card.sourceBuiltin'),
)

const fieldLabel = 'mb-1.5 block text-[12.5px] text-muted'
const button =
  'rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[13px] text-text transition-colors hover:border-accent-line'
</script>

<template>
  <section data-card-section class="mt-5 border-t border-line pt-4">
    <h3 :class="fieldLabel">{{ t('card.section') }}</h3>
    <p class="text-[13px] text-text">
      {{ t('card.meta', { name: meta.name, version: meta.version, source: sourceLabel }) }}
    </p>
    <p class="mt-1 text-[11.5px] leading-relaxed text-faint">{{ t('card.note') }}</p>
    <p v-if="cardStartup.failed" data-card-fallback class="mt-1.5 text-[11.5px] leading-relaxed text-danger">
      {{ t('card.fallbackShort', { message: cardStartup.failed }) }}
    </p>
    <div class="mt-2.5 flex flex-wrap gap-2">
      <button data-card-view :class="button" @click="emit('action', 'card-view')">
        {{ t('card.view') }}
      </button>
      <button data-card-import :class="button" @click="emit('action', 'card-import')">
        {{ t('card.import') }}
      </button>
      <button data-card-export :class="button" @click="emit('action', 'card-export')">
        {{ t('card.export') }}
      </button>
      <button
        data-card-reset
        :class="button"
        class="text-muted hover:border-danger/50 hover:text-danger"
        @click="emit('action', 'card-reset')"
      >
        {{ t('card.reset') }}
      </button>
    </div>
  </section>
</template>
