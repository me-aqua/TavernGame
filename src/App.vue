<script setup lang="ts">
/**
 * App.vue —— 应用外壳
 *
 * 这里是唯一的「事件编排层」：子组件只 emit 意图，具体动作在这里做。
 * 样式几乎全在子组件里（Tailwind 工具类），这个文件只管布局。
 *
 * ⚠️ 界面上的每一行都属于三类之一，各有各的家（见 stores/game.ts）：
 *    · 事件流（故事 + 调试痕迹）—— rows 是它的投影，由 StoryPanel 渲染
 *    · 进行中与通知 —— status（computed：phase 与单槽 notice）
 *    所以这里**不往事件流里写任何东西**：没有「写进去等会儿再删」的行。
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppHeader from './components/AppHeader.vue'
import StoryPanel from './components/StoryPanel.vue'
import GameComposer from './components/GameComposer.vue'
import AppSidebar from './components/AppSidebar.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import { storeDebug, useGame } from './stores/game'
import { useTheme } from './composables/useTheme'
import { useLanguage } from './composables/useLanguage'
import { useI18n } from 'vue-i18n'
import { loadConfig, isConfigured, PRESETS } from './agent/config'
import { downloadText, pickFile } from './composables/useDownload'

const {
  startupError,
  timeLabel,
  timeline,
  scene,
  turn,
  rows,
  hasStory,
  status,
  busy,
  debugMode,
  devHost,
  notify,
  runTurnAction,
  resetGame,
  importSave,
  exportSave,
} = useGame()

const { t } = useI18n()
const { mode: themeMode, cycle: toggleTheme } = useTheme()
const { mode: languageMode, cycle: toggleLanguage, select: selectLanguage } = useLanguage()

const settingsOpen = ref(false)
const configState = ref(isConfigured())
const statusLight = ref<'ok' | 'warn' | 'err'>('warn')

const configured = computed(() => configState.value)

/**
 * 顶栏状态文字。
 *
 * ⚠️ 必须是 computed，不能算好存进 ref：
 * 文案跟随界面语言，玩家切语言时它必须跟着变；
 * 存成快照就会留下上一门语言的提示。
 */
const statusText = computed(() => {
  if (!configState.value) return t('app.statusUnconfigured')
  const cfg = loadConfig()
  const label = PRESETS[cfg.provider] ? t(`provider.${cfg.provider}`) : cfg.provider
  return `${label} - ${cfg.model}`
})

/** 刷新顶栏状态灯。成功的回合要把报错时的红灯恢复回来 */
function refreshConfigStatus() {
  configState.value = isConfigured()
  statusLight.value = configState.value ? 'ok' : 'warn'
}

/**
 * 切换调试模式（顶栏那个开关）。
 *
 * 显式选择会被记住：关掉之后刷新页面不会再自己打开，
 * 这样才能看到「非调试的正常界面」。
 */
function toggleDebug() {
  debugMode.value = !debugMode.value
  storeDebug(debugMode.value)
}

// debugMode：本机开发默认打开；顶栏开关或控制台 __DEBUG = true/false 都能改
watch(debugMode, (on) => {
  notify(on ? t('app.debugOn') : t('app.debugOff'))
  window.__DEBUG = on
})
Object.defineProperty(window, '__DEBUG', {
  configurable: true,
  get: () => debugMode.value,
  set: (v: boolean) => {
    debugMode.value = Boolean(v)
  },
})

// ---------- 动作 ----------

/** 玩家提交行动：没配 API 就先开设置，否则跑一个回合 */
async function submitAction(text: string) {
  if (!isConfigured()) {
    settingsOpen.value = true
    return
  }
  try {
    await runTurnAction(text)
  } catch (err) {
    // 错误正文已由 runTurnAction 报给玩家（见 stores/turn.ts），
    // 这里只负责把顶栏状态灯变红 —— 不是吞掉
    if ((err as Error).name !== 'AbortError') statusLight.value = 'err'
  }
}

/**
 * 跑开场。
 *
 * ⚠️ 这里**自己消化错误**（显示给玩家），所以调用点可以安全地不等它。
 *    没有占位行需要清理：「正在生成开场…」是 status 从 phase 算出来的，
 *    回合一开始就在、一结束就没。
 */
async function startNewGame() {
  try {
    await runTurnAction()
  } catch (err) {
    // 边界：这是开场生成，失败要显示给玩家 —— 不是吞掉
    if ((err as Error).name === 'AbortError') return
    statusLight.value = 'err'
    notify(t('app.openingFailed', { message: (err as Error).message }), 'error')
  }
}

/** 导出存档为文件 */
function doExport() {
  const date = new Date().toISOString().slice(0, 10)
  downloadText(t('app.saveFileName', { date }), exportSave())
  notify(t('app.saveExported'))
}

/** 从文件导入存档（故事区跟着日志变，不需要额外「恢复」） */
async function doImport() {
  const file = await pickFile()
  if (!file) return
  try {
    importSave(await file.text())
    notify(t('app.saveImported'))
  } catch (err) {
    // 边界：导入的文件来自用户，坏了要告诉他哪里坏了 —— 不是吞掉
    notify(t('app.importFailed', { message: (err as Error).message }), 'error')
  }
}

/** 重来（先确认），然后直接跑开场 */
function resetAll() {
  if (!confirm(t('app.confirmReset'))) return
  resetGame()
  void startNewGame()
}

/**
 * Save-file actions coming from the settings drawer.
 *
 * The drawer only emits the intent; the action runs here, like every other child
 * component in this app. That is why the drawer does not import the game store —
 * one orchestrator, no second copy of the game logic.
 */
function onDrawerAction(name: 'export' | 'import' | 'reset') {
  if (name === 'export') return doExport()
  if (name === 'import') return void doImport()
  settingsOpen.value = false
  resetAll()
}

/** 设置保存后：刷新顶栏状态，首局则顺手把开场跑出来 */
function onSettingsSaved() {
  refreshConfigStatus()
  notify(t('app.settingsSaved'))
  // 全新的游戏（没回合、事件流里也没有故事）时，保存配置后顺手把开场跑出来
  if (turn.value === 0 && !hasStory.value && !busy.value) void startNewGame()
}

// ---------- 启动 ----------

onMounted(() => {
  refreshConfigStatus()

  // 存档坏了要说清楚，不能装作无事发生（坏数据已另存一份备份）
  if (startupError) {
    notify(t('app.startupCorrupted', { message: startupError }), 'error')
    statusLight.value = 'err'
    return
  }

  // 故事不用「恢复」：渲染的就是事件流本身，接着上次玩是**默认行为**，
  // 不需要再播报一句（回合数侧栏一直显示着，而且它才是响应式的）。
  // 启动时只剩两件事要说：配好了就开场，没配就先告诉玩家去哪儿配。
  if (isConfigured()) {
    if (turn.value === 0) void startNewGame()
  } else {
    notify(t('app.welcome'))
  }
})
</script>

<template>
  <div class="flex h-full flex-col">
    <AppHeader
      :light="statusLight"
      :status-text="statusText"
      :theme="themeMode"
      :language="languageMode"
      :debug="debugMode"
      :debug-toggle="devHost"
      @toggle-debug="toggleDebug"
      @export="doExport"
      @import="doImport"
      @reset="resetAll"
      @settings="settingsOpen = true"
      @toggle-theme="toggleTheme"
      @toggle-language="toggleLanguage"
    />

    <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <main class="flex min-h-0 flex-1 flex-col">
        <StoryPanel :rows="rows" :status="status" />
        <GameComposer :disabled="busy" :configured="configured" @submit="submitAction" />
      </main>

      <AppSidebar :time-label="timeLabel" :timeline="timeline" :scene="scene" :turn="turn" />
    </div>

    <SettingsDrawer
      v-model:open="settingsOpen"
      :language="languageMode"
      @saved="onSettingsSaved"
      @language="selectLanguage"
      @action="onDrawerAction"
    />
  </div>
</template>
