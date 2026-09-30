<script setup lang="ts">
/**
 * App.vue —— 应用外壳（沉浸式布局）
 *
 * 分工只有一句话：**文字是主线，控件都浮在它上面**。正文那一列占满剩下的高度、只有它自己滚；
 * 输入框浮在底部；状态（顶栏条目 + 最近一次时间跳跃）浮在左上角，设置 / 调试浮在右上角。
 *
 * 玩家屏是**三档形状**（决定 #59）：≥1280 左栏 | 正文 | 右栏 · 821–1279 一条栏（右在上）·
 * ≤820 两条满宽带接在正文下面；窄 **且** 竖的那一屏不给玩（与编辑器同一条闸门）。
 * 哪一块画在哪一栏由当前卡的 声明.显示.侧栏 决定（R12：一条 = 一枝状态的路径 + 标题 +
 * 一种预设格式 + 放哪一侧，按声明解析出来的是 components/display-blocks.ts 的 `world`）；
 * 左上角那三行（时间 / 场景 / 回合）是**引擎自己的**（R32，`topbar`）—— App 只负责把这两样摆出来。
 *
 * ⚠️ 界面上的每一行都属于三类之一，各有各的家（见 stores/game.ts）：事件流（故事 +
 *    调试痕迹，rows 是它的投影，由 StoryPanel 渲染）、进行中与通知（status =
 *    phase 与单槽 notice 算出来的）。所以这里**不往事件流里写任何东西**：
 *    没有「写进去等会儿再删」的行。
 */
import { computed, onMounted, ref, watch } from 'vue'
import StoryPanel from './components/StoryPanel.vue'
import GameComposer from './components/GameComposer.vue'
import AppSidebar from './components/AppSidebar.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import CardEditor from './components/CardEditor.vue'
import WorldPanel from './components/WorldPanel.vue'
import DebugPanel from './components/DebugPanel.vue'
import StoryCover from './components/StoryCover.vue'
import { blocksOfSide, topbar, world } from './components/display-blocks'
import { atPath } from './game/display'
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
/** 卡图浮层开着没有 —— 只影响这一层（设置面板还开在它下面） */
const cardOpen = ref(false)

/**
 * 两条栏里的块：按卡的声明分左右（分栏是 `world` 那张表的**投影**，不另存一份常量）。
 * 卡一条都没声明 ⇒ `hasSides` 为假，这一屏退回单栏（`long-night` 的空表就是这个形状）：
 * 两栏画不画，看的是**声明空不空**，不是"内容有没有"。
 */
const leftBlocks = blocksOfSide(world, 'left')
const rightBlocks = blocksOfSide(world, 'right')
const hasSides = world.length > 0

/**
 * 右栏那两件装饰（主控徽记 + 地标剪影）吃的两个字符串 —— 都从**卡声明的那条指路**现读。
 *
 * `display.scene` 是卡说一次的「谁在哪」来源：`who` 指向主控名字那一格。🔴 名字只能这么取：
 * 位置那一串的第一个值是**区域名**（不是人名），从块数据里猜"唯一的字符串栏"在真卡上会猜出种族。
 * 卡没声明 / 那一格读不到 / 不是非空串 ⇒ 空串 ⇒ 那两件整件不画（不画一枚无名圆章）。
 */
const sceneDecl = currentCard.display.scene
const leadName = computed(() => {
  if (sceneDecl === undefined) return ''
  const name = atPath(stateTree.value, sceneDecl.who)
  return typeof name === 'string' ? name : ''
})

/**
 * 剪影的种子：册子里主控那一条的字面串，用分隔点点开 —— 与侧栏 `.scene-name` **同一份口径**。
 *
 * ⚠️ 空串要在这里先滤掉：`sceneValues` 是按字段顺序给的那一串，册子某一格没写就是空串，
 *    而侧栏那边（`AppSidebar.vue` 的 `sceneLabel`）**也滤**。两边都不滤会让同一个种子在
 *    "显示的这一串"与"算剪影的那一串"上分叉（今天恰好不分叉，将来会红得看不懂）。
 */
const sceneSeed = computed(() => scene.value.filter((value) => value.length > 0).join(t('sidebar.separator')))

/**
 * 卡图是**模态浮层**：它开着的时候，遮罩底下**每一层**（顶栏 / 两条栏 / 输入区 / 设置抽屉 /
 * 调试面板 / **开场封面**）一起挂 `inert` —— 模态之下的东西不许被聚焦、也不许被点到；关掉就摘干净。
 *
 * 这几层绑同一个名字，因为它们是一件事。⚠️ `inert` 落在这几个兄弟层上、**不落根节点**：
 * 落根上会把卡图自己一起罩进去，那就得再写一条规则把它撤销回来。
 * ⚠️ 也不许换成 `pointer-events: none`（只管鼠标）/ `disabled` / `tabindex="-1"`（一颗一颗糊）：
 * 它们都拦不住 Tab 走到这一层。
 * 🔴 **封面是这一套里最容易漏的一处**：它与 `.player-grid` 互斥，所以卡图开着时它多半**不在屏上**，
 *    于是只有"卡图开着 **且** 还没有故事"那一档才照得到它 —— 而那一档真实存在
 *    （`e2e/smoke.spec.ts` 的卡图用例就不种存档）⇒ 漏了它，那颗「开始这一局」照样能被 `focus()` 拿到。
 */
const belowCardModalInert = computed(() => cardOpen.value)
/** 调试面板开着没有 —— 只在调试模式里有这一层（入口就在调试开关旁边） */
const debugOpen = ref(false)
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

/**
 * 玩家在封面上点过「开始这一局」没有 —— **这一次会话里**的一次性事实，不落盘、不进存档。
 *
 * 🔴 它是「开机要不要自己把开场跑掉」那把闸的**正向**那一半：极性只能是"点过才跑"，
 *    **不能**反着写成"没点过就不许自己跑"再靠一个初始为假的标记去拦 ——
 *    那样初始状态本身就在放行（实测：那样写，挂载后 **95ms** 照样发出第一次请求）。
 * ⇒ 于是"配好 API 的全新一局"不再自动开场：玩家看到的是封面，点了才开始。
 */
const startedByPlayer = ref(false)

/**
 * 封面那颗「开始这一局」：玩家自己按的，记下来再跑。
 *
 * ⚠️ 与 `resetAll` 那条路分开写：那条是"重来 ⇒ 立刻跑新的一局"（玩家自己按的重来），
 *    它不走这里、也不看这根标记 —— 两条路一件事只在一个地方说。
 */
function startFromCover() {
  startedByPlayer.value = true
  void startNewGame()
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

/** 重来（先确认），然后直接跑开场 —— 🔴 这一处的自动开场与「启动 / 存配置」那两处**不同向**：
 *  「重来」就是玩家自己按下的"再开一局"，这里必须自动跑（封面会在重来之后闪一下，那是对的） */
function resetAll() {
  if (!confirm(t('app.confirmReset'))) return
  resetGame()
  void startNewGame()
}

// ---------- 卡（导入 / 导出 / 恢复内置 / 编辑） ----------

/**
 * 换卡之后整页重载。
 *
 * ⚠️ 必须 reload：引擎（agent/agent.ts）与卡声明解析出来的那几块（components/display-blocks.ts）
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
  // 🔴 首局顺手跑开场，闸是"**玩家点过开始**"（`startedByPlayer`）：
  //    从封面的「填入 API Key」进设置、填完保存 —— 那时玩家只是去填 key，不是按了开始。
  if (turn.value === 0 && !hasStory.value && !busy.value && startedByPlayer.value) void startNewGame()
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
  // 🔴 启动时**不自动开场**：开场这件事属于封面那颗「开始这一局」（`startFromCover`）——
  //    少了这条闸，全新一局会"封面在屏上、开场在背后自己跑"（实测：挂载后 **95ms** 就发出第一次请求）。
  //    这里只剩一件事要说：没配 API 就先告诉玩家去哪儿配（那句话住封面的状态行里）。
  if (!isConfigured()) notify(t('app.welcome'))

  // 存着的卡用不了、退回了内置示例：这件事比欢迎语重要（它决定玩家看到的世界），
  // 所以放在最后播报 —— 设置面板的「卡」一节里也留了一行（进行中状态会顶掉通知）。
  if (cardStartup.failed) notify(t('card.fallback', { message: cardStartup.failed }), 'error')
})
</script>

<template>
  <div class="story-bg relative flex h-full flex-col overflow-hidden">
    <!--
      四段式：上带（浮层）/ 左栏 · 正文 · 右栏（三档形状）/ 下带（输入卡片）。
      ⚠️ 常驻浮层（顶栏与那几颗按钮）有自己的**带**，不压在正文上 —— 文字滚到哪儿都不会被挡
      （e2e/probe.ts 有一条「正文不许被悬浮控件压住」在守着）。
      ⚠️ 卡声明的块**常驻在两条栏里**：没有"点开世界面板"这一层了（老板：「都常驻了，
         就不用展开按钮了」）—— 所以右上角那颗「世界」按钮与那层浮层一起撤了。
    -->
    <div class="flex shrink-0 items-start justify-between gap-2 px-3 pt-3" :inert="belowCardModalInert">
      <AppSidebar
        class="min-w-0 max-w-[62%] sm:max-w-[46%] lg:max-w-[26rem]"
        :items="topbar"
        :time-label="timeLabel"
        :timeline="timeline"
        :scene="scene"
        :turn="turn"
      />
      <!-- 两颗按钮成一组靠右：justify-between 会把中间那颗推到屏幕正中 -->
      <div class="flex shrink-0 items-center gap-1.5">
        <button
          v-if="devHost"
          data-debug
          :title="t('header.debugToggleTitle')"
          class="hidden shrink-0 rounded-full border px-2.5 py-1 text-[11px] backdrop-blur transition-colors sm:inline-block"
          :class="
            debugMode
              ? 'border-warn/25 bg-warn-soft/60 text-warn/90 hover:text-warn'
              : 'border-line/70 bg-surface/70 text-faint hover:text-muted'
          "
          @click="toggleDebug"
        >
          {{ debugMode ? t('header.debugToggleOn') : t('header.debugToggleOff') }}
        </button>
        <button
          v-if="devHost && debugMode"
          data-debug-panel-toggle
          :title="t('header.debugPanelTitle')"
          :aria-expanded="debugOpen"
          class="hidden shrink-0 rounded-full border px-2.5 py-1 text-[11px] backdrop-blur transition-colors sm:inline-block"
          :class="
            debugOpen
              ? 'border-accent-line bg-accent-soft/70 text-accent'
              : 'border-line/70 bg-surface/70 text-faint hover:text-muted'
          "
          @click="debugOpen = !debugOpen"
        >
          {{ t('header.debugPanel') }}
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
    </div>

    <!--
      窄 **且** 竖那一屏：横过来才能玩（与编辑器同一条闸门、同一套形状）。
      ⚠️ 它是**活媒体查询**、不是 `v-if`（见 player-screen.css 末尾那条 `@media`）—— 转屏就现形，不用刷新。
      ⚠️ 钩子叫 `data-play-rotate`、**不与编辑器那一块重名**（`EditorShell.vue:125` 的闸门用的那个属性）：
         玩家屏在 DOM 里更靠前 ⇒ 同名会让按那个属性取元素的人捞到这一块。
    -->
    <section data-play-rotate>
      <h2 class="text-[14px] font-semibold" v-text="t('play.rotateTitle')" />
      <p class="text-[12.5px] leading-relaxed" v-text="t('play.rotateBody')" />
    </section>

    <!--
      还没开始那一局：一张开场封面（卡的脸 + 一颗「开始这一局」）。
      🔴 它与下面那一屏是**互斥的两个兄弟**（`v-if` / `v-else`），不是"盖上去"——
         盖上会让屏上出现两个 `[data-status]`，`smoke.spec.ts` 那种 `toHaveText` 会撞严格模式。
      🔴 它挂的是**「还没有故事」这个事实**（`hasStory`），不是"进游戏"这个动作：
         玩到第 30 回合按一下刷新，`hasStory` 还是真 ⇒ 直接回到那一局，不给玩家再点一次开始。
    -->
    <StoryCover
      v-if="!hasStory"
      :name="currentCard.card.name"
      :summary="currentCard.card.summary"
      :configured="configured"
      :busy="busy"
      :status="status"
      :inert="belowCardModalInert"
      @configure="settingsOpen = true"
      @start="startFromCover"
    />

    <!-- 左栏 | 正文 | 右栏：三档共用这一份 DOM，六块每块只出现一次（见 <style> 那三档） -->
    <div v-else class="player-grid">
      <WorldPanel
        v-if="hasSides"
        side="left"
        :blocks="leftBlocks"
        :state="stateTree"
        :inert="belowCardModalInert"
      />

      <!-- 主线：正文（占满剩下的高度，只有它滚动） -->
      <StoryPanel data-story class="min-w-0" :rows="rows" :status="status" />

      <WorldPanel
        v-if="hasSides"
        side="right"
        :blocks="rightBlocks"
        :state="stateTree"
        :lead-name="leadName"
        :scene-seed="sceneSeed"
        :inert="belowCardModalInert"
      />
    </div>

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
      :inert="belowCardModalInert"
      @close="debugOpen = false"
    />

    <!-- 下带：输入卡片（在流里，但视觉上浮起）—— 与正文同生共死：封面在屏上时不给输入框 -->
    <GameComposer
      v-if="hasStory"
      class="player-composer"
      :disabled="busy"
      :configured="configured"
      :inert="belowCardModalInert"
      @submit="submitAction"
    />

    <SettingsDrawer
      v-model:open="settingsOpen"
      :language="languageMode"
      :theme="themeMode"
      :inert="belowCardModalInert"
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

<style scoped src="./components/player-screen.css"></style>
