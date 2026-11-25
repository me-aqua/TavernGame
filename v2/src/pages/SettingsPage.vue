<script setup lang="ts">
/**
 * 设置页（SPEC §5）：主题 + 模型预设。
 *
 * 两条口径：
 *   · **默认两条 DeepSeek 预设只在新装时写一次**（`tg2.presets` 这个键没有的时候）。
 *     用户删光了就是空的，不许每次打开又长回来；
 *   · **Key 只住本机**：它只进 `tg2.presets`，不写日志、不进卡、不随卡与存档走。
 */
import { onMounted, ref } from 'vue'
import ErrorPanel from '../components/ErrorPanel.vue'
import ModelPresetList from '../components/ModelPresetList.vue'
import { asAppError, storage } from '../app-context'
import type { AppError } from '../core/errors'
import { STORAGE_KEYS } from '../core/storage'
import type { Preset } from '../core/types'
import { t } from '../i18n'
import { routeHash } from '../router'
import { setTheme, theme } from '../theme'

const presets = ref<Preset[]>([])
const error = ref<AppError | null>(null)

/** 新装时铺的两条默认预设：预设名 = 模型名，Key 空着（绝不内置任何 Key） */
const DEFAULT_PRESETS: Preset[] = [
  {
    id: 'p-deepseek-flash',
    name: 'deepseek-flash',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    apiKey: '',
    reasoning: 'medium',
  },
  {
    id: 'p-deepseek-v4-pro',
    name: 'deepseek-v4-pro',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    apiKey: '',
    reasoning: 'off',
  },
]

onMounted(() => {
  try {
    if (localStorage.getItem(STORAGE_KEYS.presets) === null) {
      storage().savePresets(DEFAULT_PRESETS.map((preset) => ({ ...preset })))
    }
    presets.value = storage().loadPresets()
    const settings = storage().loadSettings()
    setTheme(settings.theme)
  } catch (cause) {
    error.value = asAppError(cause)
  }
})

function persist(next: Preset[]): void {
  presets.value = next
  storage().savePresets(next)
}

function patch(id: string, patch0: Partial<Preset>): void {
  try {
    persist(presets.value.map((preset) => (preset.id === id ? { ...preset, ...patch0 } : preset)))
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

function add(): void {
  try {
    persist([
      ...presets.value,
      {
        id: `p-${crypto.randomUUID()}`,
        name: t('settings.newPreset', { count: presets.value.length + 1 }),
        provider: 'openai-compatible',
        baseUrl: '',
        model: '',
        apiKey: '',
        reasoning: 'off',
      },
    ])
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

function remove(id: string): void {
  try {
    persist(presets.value.filter((preset) => preset.id !== id))
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

function chooseTheme(next: 'light' | 'dark'): void {
  try {
    setTheme(next)
    const settings = storage().loadSettings()
    storage().saveSettings({ ...settings, theme: next })
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

function goBack(): void {
  location.hash = routeHash({ name: 'home' })
}
</script>

<template>
  <div class="page" data-page="settings">
    <header class="page-bar">
      <button type="button" data-back @click="goBack">{{ t('nav.back') }}</button>
      <span class="page-title">{{ t('settings.title') }}</span>
      <span class="spacer"></span>
      <span class="field-label">{{ t('settings.theme') }}</span>
      <button
        type="button"
        data-theme="light"
        :aria-pressed="theme === 'light' ? 'true' : 'false'"
        @click="chooseTheme('light')"
      >
        {{ t('settings.light') }}
      </button>
      <button
        type="button"
        data-theme="dark"
        :aria-pressed="theme === 'dark' ? 'true' : 'false'"
        @click="chooseTheme('dark')"
      >
        {{ t('settings.dark') }}
      </button>
    </header>

    <ErrorPanel v-if="error" :error="error" />

    <div class="page-body settings-body">
      <div class="settings-col panel">
        <ModelPresetList :presets="presets" @add="add" @patch="patch" @remove="remove" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.spacer {
  flex: 1 1 auto;
}

.settings-body {
  padding: 10px;
}

.settings-col {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-width: 960px;
}
</style>
