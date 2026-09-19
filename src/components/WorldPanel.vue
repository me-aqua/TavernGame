<script setup lang="ts">
/**
 * 世界面板：卡说侧栏有哪几块、什么顺序，这里就照那个顺序摆出来（决定 #15 / #24）。
 *
 * 它是**浮层**：绝对定位在故事之上，不占正文的宽度 —— 文字始终是主线；面板自己滚，
 * 块再多也挤不走故事。开关在 App 那边（右上角那颗「世界」按钮）。
 *
 * 每块画什么由两块拼出来：块名 → 组件（display-blocks.ts）+ 状态树里的那一段
 * （props(state)）。所以面板画的永远是这一局的真相，不是卡里的预设。
 */
import { useI18n } from 'vue-i18n'
import type { WorldBlock } from './display-blocks'
import type { StateTree } from '../game/card-state'

const { t } = useI18n()

defineProps<{
  /** 卡声明解析出来的块（顺序即声明顺序） */
  blocks: WorldBlock[]
  /** 这一局的状态树 —— 每块从它里面取自己那一段 */
  state: StateTree
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <section
    data-world-panel
    role="dialog"
    :aria-label="t('world.title')"
    class="absolute top-14 right-3 z-20 flex max-h-[min(36rem,72vh)] w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-line/70 bg-surface/95 shadow-[0_30px_70px_-38px_rgba(20,12,4,0.75)] backdrop-blur-md xl:w-[19rem]"
  >
    <header
      class="flex shrink-0 items-center justify-between gap-2 border-b border-line/60 py-2 pr-1.5 pl-3.5"
    >
      <h2 class="font-serif text-[14px] font-semibold tracking-wide text-text">
        {{ t('world.title') }}
      </h2>
      <button
        data-world-close
        :aria-label="t('world.close')"
        :title="t('world.close')"
        class="flex size-7 items-center justify-center rounded-full text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
        @click="emit('close')"
      >
        <span aria-hidden="true">{{ t('world.closeIcon') }}</span>
      </button>
    </header>

    <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5">
      <section v-for="block in blocks" :key="block.name" :data-block="block.name">
        <h3
          class="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.14em] text-accent uppercase"
        >
          {{ t(block.title) }}
          <span class="h-px flex-1 bg-line/70" aria-hidden="true" />
        </h3>
        <component :is="block.view" v-bind="block.props(state)" />
      </section>
    </div>
  </section>
</template>
