<script setup lang="ts">
/**
 * 设置面板：provider / API key / 接口地址 / modelName / 步数上限。
 *
 * 所有输出都走模板插值（{{ }}），由 Vue 自动转义 ——
 * 没有任何 innerHTML 拼接，密钥这类内容不存在注入面。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PRESETS, loadConfig, saveConfig, clearConfig, maskKey } from '../agent/config'
import type { LanguageMode } from '../i18n'
import type { ThemeMode } from '../composables/useTheme'
import { testConnection as testApiConnection } from '../agent/llm'

const { t } = useI18n()

const props = defineProps<{ open: boolean; language: LanguageMode; theme: ThemeMode }>()
const emit = defineEmits<{
  'update:open': [v: boolean]
  saved: []
  language: [mode: LanguageMode]
  theme: [mode: ThemeMode]
  /** 存档动作放在面板里：小屏顶栏没地方 */
  action: [name: 'export' | 'import' | 'reset']
}>()

const THEMES: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: 'settings.themeSystem' },
  { mode: 'light', label: 'settings.themeLight' },
  { mode: 'dark', label: 'settings.themeDark' },
]

const LANGUAGES: { mode: LanguageMode; label: string }[] = [
  { mode: 'system', label: 'settings.languageSystem' },
  { mode: 'zh-CN', label: 'header.languageIconZh' },
  { mode: 'en', label: 'header.languageIconEn' },
]

const provider = ref('deepseek')
const apiKey = ref('')
const apiBase = ref('')
const modelName = ref('')
const steps = ref(8)

const testResult = ref('')
const testStatus = ref<'' | 'ok' | 'bad'>('')
const testing = ref(false)

/** 当前服务商预设（配置里可能存着已不存在的值，故可为 undefined） */
const currentPreset = computed(() => PRESETS[provider.value])

/** 面板打开时，从 localStorage 读一次最新配置填进表单 */
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    const cfg = loadConfig()
    provider.value = cfg.provider
    apiKey.value = cfg.apiKey
    apiBase.value = cfg.apiBase
    modelName.value = cfg.model
    steps.value = cfg.maxAgentSteps
    testResult.value = ''
    testStatus.value = ''
    syncProviderFields()
  },
  { immediate: true },
)

/** 接口地址 / 模型如果还是**任何**一个预设的默认值，切换服务商时就自动替换 */
function syncProviderFields() {
  const p = currentPreset.value
  if (!p) return
  const isPresetBase = (v: string) => Object.values(PRESETS).some((x) => x.apiBase === v)
  const isPresetModel = (v: string) => Object.values(PRESETS).some((x) => x.models?.includes(v))
  if (!apiBase.value.trim() || isPresetBase(apiBase.value.trim())) apiBase.value = p.apiBase
  if (!modelName.value.trim() || isPresetModel(modelName.value.trim())) modelName.value = p.models?.[0] ?? ''
}

const corsHint = computed(() => {
  const c = currentPreset.value?.corsOk
  if (c === false) return t('settings.corsNo')
  if (c === true) return t('settings.corsYes')
  return t('settings.corsUnknown')
})

/** 保存配置并关闭面板 */
function save() {
  saveConfig({
    provider: provider.value,
    apiKey: apiKey.value.trim(),
    apiBase: apiBase.value.trim(),
    model: modelName.value.trim(),
    maxAgentSteps: Number(steps.value),
  })
  emit('update:open', false)
  emit('saved')
}

/** 用表单里的值试一次连接，结果就地显示（失败也是结果） */
async function testConnectionAction() {
  // 先用表单里的值试，不必先保存
  saveConfig({
    provider: provider.value,
    apiKey: apiKey.value.trim(),
    apiBase: apiBase.value.trim(),
    model: modelName.value.trim(),
  })
  testing.value = true
  testStatus.value = ''
  testResult.value = t('settings.testing')
  try {
    const r = await testApiConnection()
    testStatus.value = 'ok'
    testResult.value = t('settings.testOk', { ms: r.ms, reply: r.reply })
  } catch (err) {
    // 边界：这是「测试连接」按钮，失败本身就是结果 —— 显示给用户，不是吞掉
    testStatus.value = 'bad'
    testResult.value = t('settings.testFailed', { message: (err as Error).message })
  } finally {
    testing.value = false
    // 测试连接会把配置写进 localStorage，顶栏状态要跟着刷新
    emit('saved')
  }
}

/** 忘掉密钥（先确认），并清掉界面上的残留 */
function forgetKey() {
  if (!confirm(t('settings.confirmForget'))) return
  clearConfig()
  apiKey.value = ''
  testStatus.value = ''
  testResult.value = t('settings.cleared')
  emit('saved')
}

const fieldLabel = 'mb-1.5 block text-[12.5px] text-muted'
const textareaRef =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-text outline-none transition-colors focus:border-accent-line disabled:opacity-50'
const hintText = 'mt-1.5 text-[11.5px] leading-relaxed text-faint'
</script>

<template>
  <div
    v-if="open"
    class="drawer fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5 backdrop-blur-sm"
    @click.self="emit('update:open', false)"
  >
    <div
      class="sheet max-h-[88vh] w-full max-w-[540px] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl"
    >
      <h2 class="text-[17px] font-semibold text-text">{{ t('settings.title') }}</h2>

      <!-- 主题与语言：顶栏收起来之后，这两件事归设置面板管（同一个面板、同一套三态） -->
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <span :class="fieldLabel + ' mb-0'">{{ t('settings.theme') }}</span>
        <button
          v-for="entry in THEMES"
          :key="entry.mode"
          data-theme-option
          class="rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors"
          :class="
            theme === entry.mode
              ? 'border-accent-line bg-accent-soft text-accent'
              : 'border-line bg-surface-2 text-muted hover:text-text'
          "
          @click="emit('theme', entry.mode)"
        >
          {{ t(entry.label) }}
        </button>
        <span class="w-full text-[11.5px] text-faint">{{ t('settings.themeNote') }}</span>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span :class="fieldLabel + ' mb-0'">{{ t('settings.language') }}</span>
        <button
          v-for="entry in LANGUAGES"
          :key="entry.mode"
          data-language-option
          class="rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors"
          :class="
            language === entry.mode
              ? 'border-accent-line bg-accent-soft text-accent'
              : 'border-line bg-surface-2 text-muted hover:text-text'
          "
          @click="emit('language', entry.mode)"
        >
          {{ t(entry.label) }}
        </button>
        <span class="w-full text-[11.5px] text-faint">{{ t('settings.languageNote') }}</span>
      </div>
      <p class="mt-1.5 mb-5 text-[13px] leading-relaxed text-muted">
        {{ t('settings.introBefore') }}<b class="text-text">{{ t('settings.appName') }}</b
        >{{ t('settings.introAfter') }}
      </p>

      <div class="mb-4">
        <label :class="fieldLabel">{{ t('settings.providerLabel') }}</label>
        <select v-model="provider" :class="textareaRef" @change="syncProviderFields">
          <option v-for="(_preset, k) in PRESETS" :key="k" :value="k">{{ t(`provider.${k}`) }}</option>
        </select>
        <p :class="hintText">{{ corsHint }}</p>
      </div>

      <div class="mb-4">
        <label :class="fieldLabel">{{ t('settings.apiKey') }}</label>
        <input
          v-model="apiKey"
          type="password"
          placeholder="sk-..."
          autocomplete="off"
          :disabled="currentPreset?.noKey"
          :class="textareaRef"
        />
        <p :class="hintText">
          <template v-if="currentPreset?.noKey">{{ t('settings.noKeyNeeded') }}</template>
          <template v-else>
            <a
              v-if="currentPreset?.keyUrl"
              :href="currentPreset.keyUrl"
              target="_blank"
              rel="noopener"
              class="text-info hover:underline"
            >
              {{ t('settings.keyUrlPrefix') }}{{ currentPreset.keyUrl }}
            </a>
          </template>
          <br />{{ t('settings.currentKey', { masked: maskKey(loadConfig().apiKey) }) }}
        </p>
      </div>

      <div class="mb-4">
        <label :class="fieldLabel">{{ t('settings.apiBase') }}</label>
        <input
          v-model="apiBase"
          type="text"
          placeholder="https://api.deepseek.com"
          autocomplete="off"
          :class="textareaRef"
        />
      </div>

      <div class="mb-4">
        <label :class="fieldLabel">{{ t('settings.modelLabel') }}</label>
        <input v-model="modelName" type="text" list="model-list" autocomplete="off" :class="textareaRef" />
        <datalist id="model-list">
          <option v-for="m in currentPreset?.models ?? []" :key="m" :value="m"></option>
        </datalist>
      </div>

      <div class="mb-4">
        <label :class="fieldLabel">{{ t('settings.stepsLimit', { count: steps }) }}</label>
        <input v-model.number="steps" type="range" min="1" max="20" class="w-full accent-accent" />
        <p :class="hintText">{{ t('settings.stepsNote') }}</p>
      </div>

      <div class="mt-5 border-t border-line pt-4">
        <h3 :class="fieldLabel">{{ t('settings.saveSection') }}</h3>
        <div class="flex flex-wrap gap-2">
          <button
            data-export
            class="rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[13px] text-text transition-colors hover:border-accent-line"
            @click="emit('action', 'export')"
          >
            {{ t('settings.exportSave') }}
          </button>
          <button
            data-import
            class="rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[13px] text-text transition-colors hover:border-accent-line"
            @click="emit('action', 'import')"
          >
            {{ t('settings.importSave') }}
          </button>
          <button
            data-reset
            class="rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[13px] text-muted transition-colors hover:border-danger/50 hover:text-danger"
            @click="emit('action', 'reset')"
          >
            {{ t('settings.resetGame') }}
          </button>
        </div>
      </div>

      <!-- Duplicated from the header, which is why this row can disappear on phones.
           The drawer itself is already tight there (it scrolls) and space is worth
           more to the fields above than to a second copy of these buttons. -->
      <div class="mt-5 hidden flex-wrap gap-2 sm:flex">
        <button
          data-test-connection
          class="rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[13px] text-text transition-colors hover:border-accent-line disabled:opacity-40"
          :disabled="testing"
          :aria-label="t('settings.test')"
          @click="testConnectionAction"
        >
          {{ t('settings.test') }}
        </button>
        <button
          class="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-page transition-opacity hover:opacity-90"
          @click="save"
        >
          {{ t('settings.save') }}
        </button>
        <button
          class="ml-auto rounded-lg px-3 py-2 text-[13px] text-muted transition-colors hover:text-danger"
          @click="forgetKey"
        >
          {{ t('settings.forget') }}
        </button>
      </div>

      <p
        v-if="testResult"
        class="story-text mt-4 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed"
        :class="
          testStatus === 'ok'
            ? 'border-accent-line bg-accent-soft text-accent'
            : testStatus === 'bad'
              ? 'border-danger/40 bg-danger-soft text-danger'
              : 'border-line bg-surface-2 text-muted'
        "
      >
        {{ testResult }}
      </p>
    </div>
  </div>
</template>
