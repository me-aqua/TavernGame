<script setup lang="ts">
/**
 * 世界面板：卡说侧栏有哪几块、什么顺序，这里就照那个顺序摆出来（决定 #15 / #24）。
 *
 * 它是**浮层**：绝对定位在故事之上，不占正文的宽度 —— 文字始终是主线；面板自己滚，
 * 块再多也挤不走故事。开关在 App 那边（右上角那颗「世界」按钮）。
 */
import { useI18n } from 'vue-i18n'
import type { WorldBlock } from './display-blocks'

const { t } = useI18n()

defineProps<{
  /** 卡声明解析出来的块（顺序即声明顺序） */
  blocks: WorldBlock[]
  /** 运行时场景名 —— 地图靠它认出当前所在的区域 / 地点 */
  sceneName: string
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <section
    data-world-panel
    role="dialog"
    :aria-label="t('world.title')"
    class="absolute top-14 right-3 z-20 flex max-h-[min(34rem,68vh)] w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-line/70 bg-surface/90 shadow-xl backdrop-blur-md xl:w-64"
  >
    <header
      class="flex shrink-0 items-center justify-between gap-2 border-b border-line/60 py-1.5 pr-1.5 pl-3.5"
    >
      <h2 class="text-[12px] font-semibold tracking-wide text-accent">{{ t('world.title') }}</h2>
      <button
        data-world-close
        :aria-label="t('world.close')"
        :title="t('world.close')"
        class="flex size-6 items-center justify-center rounded-full text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
        @click="emit('close')"
      >
        <span aria-hidden="true">{{ t('world.closeIcon') }}</span>
      </button>
    </header>

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
      <section v-for="block in blocks" :key="block.name" :data-block="block.name">
        <h3 class="mb-1.5 text-[11px] font-semibold text-faint">{{ t(block.title) }}</h3>
        <component :is="block.view" v-bind="block.props(sceneName)" />
      </section>
    </div>
  </section>
</template>
