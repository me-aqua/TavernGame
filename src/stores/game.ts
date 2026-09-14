/**
 * src/stores/game.ts —— 界面与游戏之间的唯一桥梁
 *
 *   - 持有 GameState 实例与对话历史
 *   - 跑回合（含重入保护、中止）
 *   - 把 agent 循环抛出的事件转成界面用的消息流
 *   - doExport / doImport / 重开
 *
 * 响应式边界在这里，不在引擎里：
 *   GameState 是普通类（src/core 不依赖 Vue，能在 Node 里直接测）。
 *   引擎改 this.data 的**内部**字段（addLog / advanceTime）能被追踪，
 *   是因为 store 把实例放进了 reactive 容器，由容器提供深响应式。
 *
 * 为什么用容器 object 而不是 shallowRef + triggerRef：
 *   存档会被整份替换（读档 / 重来 / 导入），替换也要能被追踪。
 *   容器里换属性会自然触发；shallowRef 则要靠每处调用点记得写 triggerRef，
 *   漏一处就是「界面不更新」这种最难查的 bug。
 */

import { computed, reactive, ref } from 'vue'
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

/** 造一行叙事流（id 单调递增，供 v-for 的 key 用） */
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
/**
 * 当前存档。深响应式由这个容器提供：引擎只管改数据，追踪交给 Vue。
 *
 * ⚠️ 不要退化成 shallowRef + triggerRef：那样每个改动点都得记得触发，
 *    而「忘了触发」的表现是界面不更新 —— 没有任何测试会因此变红。
 */
const store = reactive({ game: startupResult.state })
const messages = ref<StoryLine[]>([])
const history = ref<ChatMessage[]>([])
const running = ref(false)
const debugMode = ref(false)
let controller: AbortController | null = null

/** store 的唯一入口；模块级单例，所有界面共享同一份状态 */
export function useGame() {
  // ---------- 只读派生 ----------
  const timeLabel = computed(() => store.game.timeLabel)
  const timeline = computed(() => store.game.data.timeline.slice(-4))
  // ⚠️ state.scene（getter）而不是 state.data.scene：默认场景名/描述来自 locale，
  //    空值时由 getter 现取，所以切换语言时侧栏会跟着变。
  const scene = computed(() => store.game.scene)
  const turn = computed(() => store.game.turn)

  // ---------- messages ----------
  /** 往叙事流末尾追加一行 */
  function append(kind: StoryLine['kind'], text: string, extra: Partial<StoryLine> = {}) {
    messages.value.push(makeLine(kind, text, extra))
  }

  /** 清空叙事流（重来 / 导入后调用） */
  function clearMessages() {
    messages.value = []
  }

  /** 刷新页面后从日志恢复叙事与行动（system 类不恢复，避免重复提示） */
  function restoreLog(limit = 20) {
    for (const entry of store.game.data.log.slice(-limit)) {
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

  /** 把 agent 循环抛出的事件翻译成叙事流里的一行 */
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
        append('tool', t('store.toolResultLine', { result: evt.result }))
        break
      case 'warn':
        append('warn', t('store.warnLine', { message: evt.message }))
        break
      case 'thinking':
        break
    }
  }

  /**
   * 跑一个回合：把玩家输入交给引擎，事件实时转成界面消息。
   * @param action 玩家输入；不传表示开新游戏（开场）
   */
  async function runTurnAction(action?: string): Promise<void> {
    if (running.value) return
    running.value = true
    if (action) append('action', action)

    controller = new AbortController()
    try {
      const result = await runTurn(store.game, {
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
    }
  }

  // ---------- 换 state 的三个入口 ----------

  /**
   * 重来：清空存档与对话，并立刻落盘。
   *
   * ⚠️ store.game = store.game 看着多余，其实是「整体替换」的统一写法：
   * 换掉整份 state 时依赖方必须重算，ref 的 setter 负责通知。
   * 新实例的写法（store.game = new GameState(...)）走的是同一条路。
   */
  function resetGame() {
    abortRunningTurn()
    store.game.reset()
    history.value = []
    clearMessages()
  }

  /** 从文件导入存档：换掉整份 state，并让依赖方重算 */
  function importSave(json: string) {
    abortRunningTurn()
    store.game.import(json)
    history.value = []
    clearMessages()
  }

  /** 把当前存档序列化成 JSON 文本（导出文件用） */
  function exportSave(): string {
    return store.game.export()
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
