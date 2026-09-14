<script setup lang="ts">
/**
 * 顶栏：品牌 + 连接状态 + 主题切换 + 存档操作 + 设置入口。
 *
 * ⚠️ 这里没有任何 innerHTML —— 状态变了模板自己更新。
 * 样式全部用 Tailwind 语义 token（bg-surface / text-muted / border-line…），
 * 所以深浅色切换不需要改这个文件。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** statusLight */
  light: 'ok' | 'warn' | 'err'
  /** 状态栏文字，例如「DeepSeek 官方 · deepseek-chat」 */
  statusText: string
  /** themeMode（跟随系统 / 浅色 / 深色） */
  theme: 'system' | 'light' | 'dark'
}>()

defineEmits<{
  export: []
  import: []
  reset: []
  settings: []
  toggleTheme: []
}>()

const lightColor = computed(() => ({ ok: 'bg-accent', warn: 'bg-warn', err: 'bg-danger' })[props.light])

const themeIcon = computed(() => (props.theme === 'system' ? '🖥' : props.theme === 'dark' ? '🌙' : '☀️'))

const themeHint = computed(
  () =>
    ({
      system: '主题：跟随系统（点击切换）',
      dark: '主题：深色（点击切换）',
      light: '主题：浅色（点击切换）',
    })[props.theme],
)

const secondaryButton =
  'rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text'
</script>

<template>
  <header class="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
    <span class="text-[13px] font-bold tracking-[0.14em] text-accent">TAVERNGAME</span>

    <span class="flex items-center gap-1.5 text-[12px] text-muted">
      <span class="light size-2 rounded-full" :class="lightColor" />
      <span class="hidden sm:inline">{{ statusText }}</span>
    </span>

    <span class="ml-auto flex items-center gap-1">
      <button
        :class="secondaryButton"
        :title="themeHint"
        :aria-label="themeHint"
        @click="$emit('toggleTheme')"
      >
        {{ themeIcon }}
      </button>
      <button :class="secondaryButton" title="导出存档文件" @click="$emit('export')">doExport</button>
      <button :class="secondaryButton" title="从文件导入存档" @click="$emit('import')">doImport</button>
      <button :class="secondaryButton" title="resetGame" @click="$emit('reset')">resetAll</button>
      <button
        class="ml-1 rounded-lg border border-accent-line bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent transition-opacity hover:opacity-80"
        @click="$emit('settings')"
      >
        ⚙ 设置
      </button>
    </span>
  </header>
</template>
