<script setup lang="ts">
/**
 * App.vue —— 应用外壳（沉浸式布局）
 *
 * 分工只有一句话：**文字是主线，控件都退到它后面**。故事区占满中间整屏，
 * 眉题（场景 / 时间 / 回合）是故事的第一行而不是左上角的白卡，输入区是故事底部
 * 的一条「岸」，世界 / 设置 / 调试是右上角的静默控件。
 *
 * 全新一局不再是空屏：StoryCover 给这张卡一张脸（卡名 / 印记 / 简介），
 * 再给一条明确的下一步。主角与在场人物用「印记」出现在眉题下方 ——
 * 没有立绘，也要让玩家知道「我是谁、身边有谁」。
 *
 * 眉题显示哪几条、世界手札有哪几块、点亮哪盏灯，都由当前卡声明（决定 #15 / #45）；
 * 名字到组件的映射在 components/display-blocks.ts，App 只负责把解析好的结果摆出来。
 *
 * ⚠️ 界面上的每一行都属于三类之一，各有各的家（见 stores/game.ts）：事件流（故事 +
 *    调试痕迹，rows 是它的投影，游戏舞台由 GameStage 渲染、往事古书由 HistoryModal 打开、
 *    调试痕迹由 StoryPanel 台账渲染）、进行中与通知（status = phase 与单槽 notice 算出来的）。
 *    所以这里**不往事件流里写任何东西**。
 */
import { computed, onMounted, ref, watch } from 'vue'
import StoryPanel from './components/StoryPanel.vue'
import ActionDeck from './components/ActionDeck.vue'
import GameStage from './components/GameStage.vue'
import HistoryModal from './components/HistoryModal.vue'
import StoryCover from './components/StoryCover.vue'
import GameComposer from './components/GameComposer.vue'
import AppSidebar from './components/AppSidebar.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import CardEditor from './components/CardEditor.vue'
import WorldPanel from './components/WorldPanel.vue'
import DebugPanel from './components/DebugPanel.vue'
import { atmosphere, topbar, world } from './components/display-blocks'
import { displayOf, hudData } from './game/display'
import { storeDebug, useGame } from './stores/game'
import { useTheme } from './composables/useTheme'
import { useLanguage } from './composables/useLanguage'
import { useI18n } from 'vue-i18n'
import { isConfigured } from './agent/config'
import { downloadText, pickFile } from './composables/useDownload'
import {
  cardMeta,
  cardStartup,
  currentCard,
  exportCardText,
  importCard,
  resetToBuiltinCard,
} from './game/current-card'

const {
  startupError,
  timeLabel,
  timeline,
  scene,
  turn,
  stateTree,
  rows,
  hasStory,
  status,
  busy,
  debugMode,
  devHost,
  runningNode,
  debugDraft,
  debugWrites,
  debugTools,
  debugFailedNodes,
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
/** 世界手札开着没有 —— 它是浮层，开关只影响这一层 */
const worldOpen = ref(false)
/** 卡图浮层开着没有 —— 同样只影响这一层（设置面板还开在它下面） */
const cardOpen = ref(false)
/** 调试面板开着没有 —— 只在调试模式里有这一层（入口就在调试开关旁边） */
const debugOpen = ref(false)
/** 往事（古书历史）浮层开着没有 */
const historyOpen = ref(false)
const configState = ref(isConfigured())
const statusLight = ref<'ok' | 'warn' | 'err'>('warn')

const configured = computed(() => configState.value)

/** 右上角那颗状态点的颜色：配好了是语义绿，没配是暖色，出错是红色 */
const lightColor = computed(() => ({ ok: 'bg-ok', warn: 'bg-warn', err: 'bg-danger' })[statusLight.value])

/** 游戏 HUD 的数据：只取卡声明过的块（lead / cast / where / chains / map / pack） */
const hud = computed(() => hudData(displayOf(currentCard), stateTree.value))

/** 行动牌填进输入框的种子；nonce 让同一张牌可以再点一次 */
const actionSeed = ref<{ text: string; nonce: number } | null>(null)

/** 点一张行动牌：只改草稿、聚焦，不自动提交 */
function pickAction(text: string) {
  actionSeed.value = { text, nonce: (actionSeed.value?.nonce ?? 0) + 1 }
}

/** 调试痕迹不进游戏舞台；它们留在下方那条台账里（只在调试模式出现） */
const debugRows = computed(() => rows.value.filter((row) => row.debug))

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

// ---------- 卡（导入 / 导出 / 恢复内置 / 编辑） ----------

/**
 * 换卡之后整页重载。
 *
 * ⚠️ 必须 reload：引擎（agent/agent.ts）与显示块映射（components/display-blocks.ts）
 *    都在**模块加载期**读当前卡，只改内存里的那份不会传到它们手里。
 */
function reloadForCard() {
  location.reload()
}

/** 导出当前卡：文件名用卡名与版本（与存档导出同一套下载） */
function doExportCard() {
  const meta = cardMeta(currentCard)
  downloadText(t('card.fileName', { name: meta.name, version: meta.version }), exportCardText())
  notify(t('card.exported'))
}

/** 从文件导入卡：同一套校验 → 存 → 重载；坏了要说清哪里坏了（存储原样不动） */
async function doImportCard() {
  const file = await pickFile()
  if (!file) return
  try {
    importCard(await file.text())
  } catch (err) {
    // 边界：文件来自用户，坏卡是常态 —— 显示给他看，不是吞掉
    notify(t('card.importFailed', { message: (err as Error).message }), 'error')
    return
  }
  reloadForCard()
}

/** 恢复内置示例：清掉存着的那张 → 重载（本来就是内置的就不白刷一次） */
function doResetCard() {
  if (cardStartup.source === 'builtin') {
    notify(t('card.alreadyBuiltin'))
    return
  }
  if (!confirm(t('card.confirmReset'))) return
  resetToBuiltinCard()
  reloadForCard()
}

/**
 * 设置面板里的动作（存档三件套 + 卡四件套）。
 *
 * 面板只发意图，动作在这里执行 —— 和别的子组件一样：
 * 这就是为什么面板不 import store，只有一处编排。
 */
function onDrawerAction(
  name: 'export' | 'import' | 'reset' | 'card-view' | 'card-import' | 'card-export' | 'card-reset',
) {
  if (name === 'export') return doExport()
  if (name === 'import') return void doImport()
  if (name === 'reset') {
    settingsOpen.value = false
    return resetAll()
  }
  if (name === 'card-view') {
    cardOpen.value = true
    return
  }
  if (name === 'card-import') return void doImportCard()
  if (name === 'card-export') return doExportCard()
  doResetCard()
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

  // 存着的卡用不了、退回了内置示例：这件事比欢迎语重要（它决定玩家看到的世界），
  // 所以放在最后播报 —— 设置面板的「卡」一节里也留了一行（进行中状态会顶掉通知）。
  if (cardStartup.failed) notify(t('card.fallback', { message: cardStartup.failed }), 'error')
})
</script>

<template>
  <div
    class="story-bg relative flex h-full flex-col overflow-hidden"
    :data-atmosphere="atmosphere"
    data-tavern-shell
  >
    <!-- 桌面的烛光与浮尘：只做气氛，不接收指针；reduced motion 下静止 -->
    <div class="desk-ambience" aria-hidden="true">
      <span class="desk-lamp" />
      <span class="dust dust-a" />
      <span class="dust dust-b" />
      <span class="dust dust-c" />
    </div>

    <!--
      上带：场景眉题 + 右上角静默控件。
      ⚠️ 常驻控件有自己的**带**，不压在正文上 —— 文字滚到哪儿都不会被挡
      （e2e/probe.ts 有一条「正文不许被悬浮控件压住」在守着）。
      世界手札是**玩家自己点开**的那一层（与设置面板同类），所以它在带之外。
    -->
    <div class="relative shrink-0 px-4 pt-2 sm:px-6 sm:pt-4 xl:pt-5">
      <!--
        控件成一组靠右：justify-between 会把中间那颗推到屏幕正中。
        xl 以上它们浮在右上角（那里有足够留白）；更窄时先占一行，避免压住眉题。
      -->
      <div
        data-controls
        class="mb-1.5 flex flex-wrap items-center justify-end gap-1.5 xl:absolute xl:top-5 xl:right-6 xl:z-20 xl:mb-0"
      >
        <button
          data-world
          :title="t('world.toggleTitle')"
          :aria-expanded="worldOpen"
          class="book-tab inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] backdrop-blur transition-colors"
          :class="
            worldOpen
              ? 'border-accent-line bg-accent-soft/80 text-accent'
              : 'border-line/60 bg-surface/45 text-muted hover:border-accent-line hover:text-text'
          "
          @click="worldOpen = !worldOpen"
        >
          <span aria-hidden="true" class="text-[10px]">&#9671;</span>
          {{ t('world.toggle') }}
        </button>
        <button
          v-if="devHost"
          data-debug
          :title="t('header.debugToggleTitle')"
          class="hidden min-h-7 shrink-0 items-center rounded-full px-2 py-1 text-[11px] transition-colors sm:inline-flex"
          :class="debugMode ? 'text-warn/90 hover:text-warn' : 'text-faint hover:text-muted'"
          @click="toggleDebug"
        >
          {{ debugMode ? t('header.debugToggleOn') : t('header.debugToggleOff') }}
        </button>
        <button
          v-if="devHost && debugMode"
          data-debug-panel-toggle
          :title="t('header.debugPanelTitle')"
          :aria-expanded="debugOpen"
          class="book-tab hidden min-h-7 shrink-0 items-center rounded-full px-2 py-1 text-[11px] transition-colors sm:inline-flex"
          :class="debugOpen ? 'text-accent' : 'text-faint hover:text-muted'"
          @click="debugOpen = !debugOpen"
        >
          {{ t('header.debugPanel') }}
        </button>
        <button
          data-settings
          :title="t('header.settings')"
          :aria-label="t('header.settings')"
          class="book-tab flex min-h-8 shrink-0 items-center gap-2 rounded-full border border-line/70 bg-surface/55 px-3 py-1.5 text-[12px] text-muted shadow-sm backdrop-blur transition-colors hover:text-text"
          @click="settingsOpen = true"
        >
          <span class="size-2 rounded-full" :class="lightColor" />
          {{ t('header.settings') }}
        </button>
      </div>

      <div class="reading-column">
        <AppSidebar
          :items="topbar"
          :time-label="timeLabel"
          :timeline="timeline"
          :scene="scene"
          :turn="turn"
        />
      </div>
    </div>

    <!-- 世界手札：浮在故事上，不占正文的宽度（块与顺序来自卡的声明，内容读状态树） -->
    <WorldPanel v-if="worldOpen" :blocks="world" :state="stateTree" @close="worldOpen = false" />

    <!-- 调试面板：只在调试模式里存在的一层（只读，入口在调试开关旁边） -->
    <DebugPanel
      v-if="debugMode && debugOpen"
      :card="currentCard"
      :state="stateTree"
      :time-label="timeLabel"
      :turn="turn"
      :draft="debugDraft"
      :writes="debugWrites"
      :tools="debugTools"
      :running="runningNode"
      :failed="debugFailedNodes"
      @close="debugOpen = false"
    />

    <!-- 主线：游戏舞台（左主角牌 / 中叙事 / 右人物 / 底行动牌）；还没开始时是开场封面 -->
    <GameStage
      v-if="hasStory"
      :rows="rows"
      :turn="turn"
      :busy="busy"
      :status="status"
      :scene="scene"
      :time-label="timeLabel"
      :card-name="currentCard.card.name"
      :hud="hud"
      @history="historyOpen = true"
      @world="worldOpen = true"
    />
    <StoryCover
      v-else
      :name="currentCard.card.name"
      :summary="currentCard.card.summary"
      :configured="configured"
      :busy="busy"
      :status="status"
      @configure="settingsOpen = true"
      @start="startNewGame"
    />

    <!-- 常驻行动牌：贴在输入区上方；点一张只把句子填进草稿，不自动提交 -->
    <ActionDeck v-if="hasStory" class="shrink-0" :hud="hud" @pick="pickAction" />

    <!-- 调试台账：只在调试模式出现；游戏舞台里不放模型的请求体与工具调用 -->
    <div v-if="debugMode && debugRows.length" class="h-32 shrink-0 border-t border-line/40 sm:h-40">
      <StoryPanel :rows="debugRows" :status="null" />
    </div>

    <!-- 下带：书桌的羽毛笔与羊皮纸。故事还没开始时由封面负责「下一步」，不抢戏 -->
    <GameComposer
      v-if="hasStory"
      :disabled="busy"
      :configured="configured"
      :seed="actionSeed"
      @submit="submitAction"
    />

    <!-- 往事：古书历史图鉴，从叙事面板右上角的「翻阅历史」打开 -->
    <HistoryModal
      v-if="historyOpen"
      :rows="rows"
      :turn="turn"
      :busy="busy"
      :status="status"
      :scene="scene"
      :time-label="timeLabel"
      :card-name="currentCard.card.name"
      @close="historyOpen = false"
    />

    <SettingsDrawer
      v-model:open="settingsOpen"
      :language="languageMode"
      :theme="themeMode"
      @saved="onSettingsSaved"
      @language="selectLanguage"
      @theme="selectTheme"
      @action="onDrawerAction"
    />

    <!-- 卡图浮层：盖在设置面板之上（z-60 > z-50），关掉它设置面板还在原地 -->
    <CardEditor
      v-if="cardOpen"
      :card="currentCard"
      :source="cardStartup.source"
      @close="cardOpen = false"
      @saved="reloadForCard"
    />
  </div>
</template>
