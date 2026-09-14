<script setup lang="ts">
/**
 * App.vue —— 应用外壳（沉浸式布局）
 *
 * 分工只有一句话：**文字是主线，控件都浮在它上面**。
 *   · 故事区占满整屏（它是主角）
 *   · 输入框浮在底部
 *   · 状态（时间 / 地点 / 回合 + 最近一次时间跳跃）浮在左上角
 *   · 设置与调试浮在右上角：主题、语言、存档、服务商全在设置面板里
 *
 * ⚠️ 界面上的每一行都属于三类之一，各有各的家（见 stores/game.ts）：
 *    · 事件流（故事 + 调试痕迹）—— rows 是它的投影，由 StoryPanel 渲染
 *    · 进行中与通知 —— status（computed：phase 与单槽 notice）
 *    所以这里**不往事件流里写任何东西**：没有「写进去等会儿再删」的行。
 */
import { computed, onMounted, ref, watch } from 'vue'
import StoryPanel from './components/StoryPanel.vue'
import GameComposer from './components/GameComposer.vue'
import AppSidebar from './components/AppSidebar.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import { storeDebug, useGame } from './stores/game'
import { useTheme } from './composables/useTheme'
import { useLanguage } from './composables/useLanguage'
import { useI18n } from 'vue-i18n'
import { isConfigured } from './agent/config'
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
const { mode: themeMode, select: selectTheme } = useTheme()
const { mode: languageMode, select: selectLanguage } = useLanguage()

const settingsOpen = ref(false)
const configState = ref(isConfigured())
const statusLight = ref<'ok' | 'warn' | 'err'>('warn')

const configured = computed(() => configState.value)

/** 右上角那颗状态点的颜色：配好了是主题色，没配是暖色，出错是红色 */
const lightColor = computed(() => ({ ok: 'bg-accent', warn: 'bg-warn', err: 'bg-danger' })[statusLight.value])

/** 刷新连接状态灯。成功的回合要把报错时的红灯恢复回来 */
function refreshConfigStatus() {
  configState.value = isConfigured()
  statusLight.value = configState.value ? 'ok' : 'warn'
}

/**
 * 切换调试模式（右上角那个小开关，只在本机开发出现）。
 * 显式选择会被记住：关掉之后刷新不会再自己打开。
 */
function toggleDebug() {
  debugMode.value = !debugMode.value
  storeDebug(debugMode.value)
}

// debugMode：本机开发默认打开；开关或控制台 __DEBUG = true/false 都能改
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
    // 这里只负责把状态点变红 —— 不是吞掉
    if ((err as Error).name !== 'AbortError') statusLight.value = 'err'
  }
}

/**
 * 跑开场。
 *
 * ⚠️ 这里**自己消化错误**（显示给玩家），所以调用点可以安全地不等它。
 *    没有占位行需要清理：「正在生成开场…」是 status 从 phase 算出来的。
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

/** 从文件导入存档（故事跟着事件流变，不需要额外「恢复」） */
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
 * 设置面板里的动作（存档三件套）。
 *
 * 面板只发意图，动作在这里执行 —— 和别的子组件一样：
 * 这就是为什么面板不 import store，只有一处编排。
 */
function onDrawerAction(name: 'export' | 'import' | 'reset') {
  if (name === 'export') return doExport()
  if (name === 'import') return void doImport()
  settingsOpen.value = false
  resetAll()
}

/** 设置保存后：刷新状态点，首局则顺手把开场跑出来 */
function onSettingsSaved() {
  refreshConfigStatus()
  notify(t('app.settingsSaved'))
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

  // 故事不用「恢复」：渲染的就是事件流本身。
  // 启动时只剩两件事要说：配好了就开场，没配就先告诉玩家去哪儿配。
  if (isConfigured()) {
    if (turn.value === 0) void startNewGame()
  } else {
    notify(t('app.welcome'))
  }
})
</script>

<template>
  <div class="story-bg flex h-full flex-col overflow-hidden">
    <!--
      三段式：上带（浮层）/ 故事（占满剩下的高度，自己滚）/ 下带（输入卡片）。
      ⚠️ 浮层有自己的**带**，不是绝对定位压在正文上 —— 文字滚到哪儿都不会被挡
      （e2e/probe.ts 有一条「正文不许被悬浮控件压住」在守着）。
    -->
    <div class="flex shrink-0 items-start justify-between gap-2 px-3 pt-3">
      <AppSidebar
        class="max-w-[62%] sm:max-w-[46%] lg:max-w-[26rem]"
        :time-label="timeLabel"
        :timeline="timeline"
        :scene="scene"
        :turn="turn"
      />
      <button
        v-if="devHost"
        data-debug
        :title="t('header.debugToggleTitle')"
        class="hidden shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur transition-colors sm:inline-block"
        :class="
          debugMode
            ? 'border-warn/40 bg-warn-soft/90 text-warn'
            : 'border-line bg-surface/80 text-faint hover:text-muted'
        "
        @click="toggleDebug"
      >
        {{ debugMode ? t('header.debugToggleOn') : t('header.debugToggleOff') }}
      </button>
      <button
        data-settings
        :title="t('header.settings')"
        :aria-label="t('header.settings')"
        class="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-[12.5px] text-muted shadow-sm backdrop-blur transition-colors hover:text-text"
        @click="settingsOpen = true"
      >
        <span class="size-2 rounded-full" :class="lightColor" />
        {{ t('header.settings') }}
      </button>
    </div>

    <!-- 主线：故事（占满剩下的高度，只有它滚动） -->
    <StoryPanel class="min-h-0 flex-1" :rows="rows" :status="status" />

    <!-- 下带：输入卡片（在流里，但视觉上浮起） -->
    <GameComposer :disabled="busy" :configured="configured" @submit="submitAction" />

    <SettingsDrawer
      v-model:open="settingsOpen"
      :language="languageMode"
      :theme="themeMode"
      @saved="onSettingsSaved"
      @language="selectLanguage"
      @theme="selectTheme"
      @action="onDrawerAction"
    />
  </div>
</template>
