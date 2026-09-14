/**
 * src/stores/game.ts —— 界面与游戏之间的唯一桥梁
 *
 * 这里承担了原来 index.html 里那一大坨 <script> 的职责：
 *   - 持有 GameState 实例与对话历史
 *   - 跑回合（含重入保护、中止）
 *   - 把 agent 循环抛出的事件转成界面用的消息流
 *   - doExport / doImport / 重开
 *
 * 为什么用 shallowRef 包 GameState：
 *   GameState 内部是普通对象 + getter（日历、时间标签都是 getter），
 *   用 deep reactive 包会把整棵存档做成响应式代理，既慢又容易在
 *   深层嵌套上报错。只做「浅层替换 + 手动 triggerRef」最省事也最可控。
 */

import { computed, ref, shallowRef, triggerRef } from 'vue'
import { GameState } from '../core/state'
import { t } from '../i18n'
import { loadState, createInitialState } from '../core/persistence'
import { runTurn, type AgentEvent } from '../core/agent'
import type { ChatMessage } from '../types/state'

/** 叙事流里的一行 —— 界面直接 v-for 它 */
export interface StoryLine {
  id: number
  kind: 'narration' | 'action' | 'system' | 'tool' | 'warn' | 'error'
  text: string
  /** 调试模式下的模型原始输出（可折叠） */
  raw?: string
  rawBlocks?: number
}

let nextId = 0
function makeLine(kind: StoryLine['kind'], text: string, extra: Partial<StoryLine> = {}): StoryLine {
  return { id: ++nextId, kind, text, ...extra }
}

// ⚠️ GameState.load() 返回的**已经是 GameState 实例**，
//    不能再 `new GameState(...)` 包一层 —— 那样 this.data 会变成
//    { data: GameState }，所有 getter（timeLabel / calendar）全崩。
/**
 * 启动时读档。
 *
 * ⚠️ 存档损坏不让整页打不开（那样玩家连导出坏数据的机会都没有），
 *    但也**不静默开新局** —— 把坏数据的原文留一份，并让调用方拿到错误去提示玩家。
 */
function loadAtStartup(): { state: GameState; error: string | null } {
  const { data, error } = loadState()
  return { state: new GameState(data ?? createInitialState()), error }
}

const startupResult = loadAtStartup()
const state = shallowRef(startupResult.state)
const messages = ref<StoryLine[]>([])
const history = ref<ChatMessage[]>([])
const running = ref(false)
const debugMode = ref(false)
let controller: AbortController | null = null

export function useGame() {
  // ---------- 只读派生 ----------
  const timeLabel = computed(() => (state.value, state.value.timeLabel))
  const timeline = computed(() => (state.value, state.value.data.timeline.slice(-4)))
  const scene = computed(() => (state.value, state.value.data.scene))
  const turn = computed(() => (state.value, state.value.turn))

  // ---------- messages ----------
  function append(kind: StoryLine['kind'], text: string, extra: Partial<StoryLine> = {}) {
    messages.value.push(makeLine(kind, text, extra))
  }

  function clearMessages() {
    messages.value = []
  }

  /** 刷新页面后从日志恢复叙事与行动（system 类不恢复，避免重复提示） */
  function restoreLog(limit = 20) {
    for (const entry of state.value.data.log.slice(-limit)) {
      if (entry.kind !== 'narration' && entry.kind !== 'action') continue
      append(entry.kind, entry.text)
    }
  }

  // ---------- 回合 ----------

  /**
   * ⚠️ 重入保护：一次只能跑一个回合。
   * 没有它的时候，模型正在写故事时点「resetAll」/「doImport」，会同时跑两个回合 ——
   * 旧回合的 addLog/advanceTime/save 全都作用在**新游戏**上，
   * 于是新存档里混进旧剧情、回合数对不上。
   */
  function abortRunningTurn() {
    if (!controller) return
    controller.abort()
    controller = null
  }

  function handleEvent(evt: AgentEvent) {
    switch (evt.type) {
      case 'narration':
        append('narration', evt.text)
        break
      case 'raw':
        if (debugMode.value) {
          const callCount = evt.reply.toolCalls.length
          append('tool', t('store.rawReply', { count: callCount }), {
            raw: JSON.stringify(evt.reply.raw, null, 2),
          })
        }
        break
      case 'tool':
        // args 是协议原样给的 JSON 字符串，直接展示（它就是模型实际发出的内容）
        append('tool', t('toolbar.toolCall', { tool: evt.tool, args: evt.args }))
        break
      case 'toolResult':
        append('tool', `   → ${evt.result}`)
        break
      case 'warn':
        append('warn', `⚠ ${evt.message}`)
        break
      case 'thinking':
        break
    }
  }

  async function runTurnAction(action?: string): Promise<void> {
    if (running.value) return
    running.value = true
    if (action) append('action', action)

    controller = new AbortController()
    try {
      const result = await runTurn(state.value, {
        action,
        history: history.value,
        signal: controller.signal,
        onEvent: handleEvent,
      })
      history.value = result.history
      if (!result.text) append('system', t('store.noText'))
    } catch (err) {
      const e = err as Error
      if (e.name === 'AbortError') {
        append('system', t('store.cancelled'))
      } else {
        append('error', t('store.failed', { message: e.message }))
      }
      throw err // 交给调用方决定要不要提示
    } finally {
      controller = null
      running.value = false
      // ⚠️ 必须手动触发：GameState 是普通对象，改动不会自动被 Vue 感知
      triggerRef(state)
    }
  }

  // ---------- 换 state 的三个入口 ----------

  function resetGame() {
    abortRunningTurn()
    state.value.reset()
    history.value = []
    triggerRef(state)
    clearMessages()
  }

  function importSave(json: string) {
    abortRunningTurn()
    state.value.import(json)
    history.value = []
    triggerRef(state)
    clearMessages()
  }

  function exportSave(): string {
    return state.value.export()
  }

  return {
    /** 启动时读档失败的说明；null = 正常 */
    startupError: startupResult.error,
    // 状态
    timeLabel,
    timeline,
    scene,
    turn,
    messages,
    running,
    debugMode,
    // 动作
    append,
    restoreLog,
    runTurnAction,
    resetGame,
    importSave,
    exportSave,
  }
}

/** 界面初始化：读存档 → restoreLog（在 App.vue 的 onMounted 里调用） */
export function useGameState() {
  return useGame()
}
