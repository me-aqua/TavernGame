<script setup lang="ts">
/**
 * App.vue —— 应用外壳
 *
 * 这里是唯一的「事件编排层」：子组件只 emit 意图，具体动作在这里做。
 * 样式几乎全在子组件里（Tailwind 工具类），这个文件只管布局。
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppHeader from './components/AppHeader.vue'
import StoryPanel from './components/StoryPanel.vue'
import GameComposer from './components/GameComposer.vue'
import AppSidebar from './components/AppSidebar.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import { useGame } from './stores/game'
import { useTheme } from './composables/useTheme'
import { useI18n } from 'vue-i18n'
import { loadConfig, isConfigured, PRESETS } from './core/config'
import { downloadText, pickFile } from './composables/useDownload'

const {
  startupError,
  timeLabel,
  timeline,
  scene,
  turn,
  messages,
  running,
  debugMode,
  append,
  restoreLog,
  runTurnAction,
  resetGame,
  importSave,
  exportSave,
} = useGame()

const { t } = useI18n()
const { mode: themeMode, cycle: toggleTheme } = useTheme()

const settingsOpen = ref(false)
const configState = ref(isConfigured())
const statusLight = ref<'ok' | 'warn' | 'err'>('warn')
const statusText = ref(t('app.statusChecking'))

const configured = computed(() => configState.value)

/** 刷新顶栏状态灯。成功的回合要把报错时的红灯恢复回来 */
function refreshConfigStatus() {
  const cfg = loadConfig()
  configState.value = isConfigured()
  if (!configState.value) {
    statusLight.value = 'warn'
    statusText.value = t('app.statusUnconfigured')
    return
  }
  statusLight.value = 'ok'
  statusText.value = `${PRESETS[cfg.provider] ? t(`provider.${cfg.provider}`) : cfg.provider} · ${cfg.model}`
}

// debugMode：在控制台执行 __DEBUG = true 即可打开（刷新后失效）
watch(debugMode, (on) => {
  append('system', on ? t('app.debugOn') : t('app.debugOff'))
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

async function submitAction(text: string) {
  if (!isConfigured()) {
    settingsOpen.value = true
    return
  }
  try {
    await runTurnAction(text)
  } catch (err) {
    // 错误正文已由 runTurnAction 追加到故事区（见 stores/game.ts），
    // 这里只负责把顶栏状态灯变红 —— 不是吞掉
    if ((err as Error).name !== 'AbortError') statusLight.value = 'err'
  }
}

/**
 * 跑开场。
 *
 * ⚠️ 这里**自己消化错误**（显示给玩家），所以调用点可以安全地不等它 ——
 * 否则「点重来 / 保存设置后自动开场」失败时，界面会永远停在「正在生成开场…」，
 * 玩家完全不知道发生了什么。
 */
async function startNewGame() {
  append('system', t('app.generatingOpening'))
  try {
    await runTurnAction()
  } catch (err) {
    // 边界：这是开场生成，失败要显示给玩家 —— 不是吞掉
    if ((err as Error).name === 'AbortError') return
    statusLight.value = 'err'
    append('error', t('app.openingFailed', { message: (err as Error).message }))
  }
}

function doExport() {
  const date = new Date().toISOString().slice(0, 10)
  downloadText(t('app.saveFileName', { date }), exportSave())
  append('system', t('app.saveExported'))
}

async function doImport() {
  const file = await pickFile()
  if (!file) return
  try {
    importSave(await file.text())
    append('system', t('app.saveImported'))
    restoreLog(12)
  } catch (err) {
    // 边界：导入的文件来自用户，坏了要告诉他哪里坏了 —— 不是吞掉
    append('error', t('app.importFailed', { message: (err as Error).message }))
  }
}

function resetAll() {
  if (!confirm(t('app.confirmReset'))) return
  resetGame()
  void startNewGame()
}

function onSettingsSaved() {
  refreshConfigStatus()
  append('system', 'onSettingsSaved ✓')
  // 全新的游戏（没回合、没历史）时，保存配置后顺手把开场跑出来
  if (turn.value === 0 && messages.value.length === 0 && !running.value) void startNewGame()
}

// ---------- 启动 ----------

onMounted(() => {
  refreshConfigStatus()

  // 存档坏了要说清楚，不能装作无事发生（坏数据已另存一份备份）
  if (startupError) {
    append('error', t('app.startupCorrupted', { message: startupError }))
    statusLight.value = 'err'
  }

  // 恢复上次的叙事日志：叙事与玩家行动都按日志顺序原样输出。
  // 刷新时界面是空的，所以不存在重复问题 —— 日志里每条都是唯一的。
  if (!startupError) restoreLog()

  if (isConfigured()) {
    if (turn.value === 0) {
      void startNewGame()
    } else {
      append('system', t('app.resuming', { turn: turn.value }))
    }
  } else {
    append('system', t('app.welcome'))
  }
})
</script>

<template>
  <div class="flex h-full flex-col">
    <AppHeader
      :light="statusLight"
      :status-text="statusText"
      :theme="themeMode"
      @export="doExport"
      @import="doImport"
      @reset="resetAll"
      @settings="settingsOpen = true"
      @toggle-theme="toggleTheme"
    />

    <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <main class="flex min-h-0 flex-1 flex-col">
        <StoryPanel :lines="messages" :thinking="running" />
        <GameComposer :disabled="running" :configured="configured" @submit="submitAction" />
      </main>

      <AppSidebar
        :time-label="timeLabel"
        :timeline="timeline"
        :scene="scene"
        :turn="turn"
        class="shrink-0 border-t border-line lg:border-t-0 lg:border-l"
      />
    </div>

    <SettingsDrawer v-model:open="settingsOpen" @saved="onSettingsSaved" />
  </div>
</template>
