<script setup lang="ts">
/**
 * 顶栏：品牌 + 连接状态 + 主题切换 + 存档操作 + 设置入口。
 *
 * ⚠️ 这里没有任何 innerHTML —— 状态变了模板自己更新。
 * 样式全部用 Tailwind 语义 token（bg-surface / text-muted / border-line…），
 * 所以深浅色切换不需要改这个文件。
 */
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

const { t } = useI18n()

const props = defineProps<{
  /** statusLight */
  light: 'ok' | 'warn' | 'err'
  /** 状态栏文字，例如「DeepSeek 官方 · deepseek-chat」 */
  statusText: string
  /** themeMode（跟随系统 / 浅色 / 深色） */
  theme: 'system' | 'light' | 'dark'
  /** languageMode（跟随系统 / zh-CN / en） */
  language: 'system' | 'zh-CN' | 'en'
}>()

defineEmits<{
  export: []
  import: []
  reset: []
  settings: []
  toggleTheme: []
  toggleLanguage: []
}>()

const lightColor = computed(() => ({ ok: 'bg-accent', warn: 'bg-warn', err: 'bg-danger' })[props.light])

const themeIcon = computed(
  () =>
    ({
      system: t('header.themeIconSystem'),
      dark: t('header.themeIconDark'),
      light: t('header.themeIconLight'),
    })[props.theme],
)

const themeHint = computed(
  () =>
    ({
      system: t('header.themeSystem'),
      dark: t('header.themeDark'),
      light: t('header.themeLight'),
    })[props.theme],
)

const languageIcon = computed(
  () =>
    ({
      system: t('header.languageIconSystem'),
      'zh-CN': t('header.languageIconZh'),
      en: t('header.languageIconEn'),
    })[props.language],
)

const languageHint = computed(
  () =>
    ({
      system: t('header.languageSystem'),
      'zh-CN': t('header.languageZh'),
      en: t('header.languageEn'),
    })[props.language],
)

// data-* hooks: the theme and language buttons both read "(click to switch)", so a
// test cannot tell them apart by user-facing text. These attributes are selectors
// for tests only (e2e/smoke.mjs), never for styling or behaviour.
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
        data-theme
        :class="secondaryButton"
        :title="themeHint"
        :aria-label="themeHint"
        @click="$emit('toggleTheme')"
      >
        {{ themeIcon }}
      </button>
      <button
        data-language
        :class="secondaryButton"
        :title="languageHint"
        :aria-label="languageHint"
        @click="$emit('toggleLanguage')"
      >
        {{ languageIcon }}
      </button>
      <!-- Export/import also live in the settings drawer, so they collapse on phones;
           reset has no second home and must stay reachable at every width. -->
      <button
        :class="secondaryButton + ' hidden sm:block'"
        :title="t('header.exportTitle')"
        @click="$emit('export')"
      >
        {{ t('header.export') }}
      </button>
      <button
        :class="secondaryButton + ' hidden sm:block'"
        :title="t('header.importTitle')"
        @click="$emit('import')"
      >
        {{ t('header.import') }}
      </button>
      <button
        :class="secondaryButton"
        :title="t('header.resetTitle')"
        :aria-label="t('header.resetTitle')"
        @click="$emit('reset')"
      >
        {{ t('header.reset') }}
      </button>
      <button
        data-settings
        class="ml-1 rounded-lg border border-accent-line bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent transition-opacity hover:opacity-80"
        :aria-label="t('header.settings')"
        @click="$emit('settings')"
      >
        {{ t('header.settings') }}
      </button>
    </span>
  </header>
</template>
