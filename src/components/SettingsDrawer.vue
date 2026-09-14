<script setup lang="ts">
/**
 * 设置面板：provider / API key / 接口地址 / modelName / 步数上限。
 *
 * 相比原来的实现，这里少了一处 XSS 隐患：
 * 原来「当前 key」那行是拼接字符串后塞进 innerHTML 的，
 * 现在只是模板里的 {{ }}，自动转义。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PRESETS, loadConfig, saveConfig, clearConfig, maskKey } from '../core/config'
import { testConnection as testApiConnection } from '../core/llm'

const { t } = useI18n()

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [v: boolean]; saved: [] }>()

const provider = ref('deepseek')
const apiKey = ref('')
const apiBase = ref('')
const modelName = ref('')
const steps = ref(8)

const testResult = ref('')
const testStatus = ref<'' | 'ok' | 'bad'>('')
const testing = ref(false)

/** 当前服务商预设。配置可能被填成不存在的值，所以这里要能返回 undefined */
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
  const isOldBase = (v: string) => Object.values(PRESETS).some((x) => x.apiBase === v)
  const isOldModel = (v: string) => Object.values(PRESETS).some((x) => x.models?.includes(v))
  if (!apiBase.value.trim() || isOldBase(apiBase.value.trim())) apiBase.value = p.apiBase
  if (!modelName.value.trim() || isOldModel(modelName.value.trim())) modelName.value = p.models?.[0] ?? ''
}

const corsHint = computed(() => {
  const c = currentPreset.value?.corsOk
  if (c === false) return t('settings.corsNo')
  if (c === true) return t('settings.corsYes')
  return t('settings.corsUnknown')
})

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
      <p class="mt-1.5 mb-5 text-[13px] leading-relaxed text-muted">
        {{ t('settings.introBefore') }}<b class="text-text">{{ t('settings.appName') }}</b
        >{{ t('settings.introAfter') }}
      </p>

      <div class="mb-4">
        <label :class="fieldLabel">provider</label>
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
        <label :class="fieldLabel">modelName</label>
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

      <div class="mt-5 flex flex-wrap gap-2">
        <button
          class="rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[13px] text-text transition-colors hover:border-accent-line disabled:opacity-40"
          :disabled="testing"
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
