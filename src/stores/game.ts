/**
 * src/stores/game.ts —— 界面与 GameState 之间的薄层
 *
 * GameState 自己管数据、叙事流与存档；这里只做三件事：
 *   1. 把它装进 reactive 容器（响应式边界在界面侧，core 不依赖 Vue）
 *   2. 持有跨回合的对话历史（引擎每回合要用，但不属于存档）
 *   3. 把回合编排、导入导出暴露成界面用的动作
 *
 * 为什么用容器 object 而不是 shallowRef + triggerRef：
 *   存档会被整份替换（读档 / 重来 / 导入），替换也要能被追踪。
 *   容器里换属性会自然触发；shallowRef 要靠每处调用点记得写 triggerRef，
 *   漏一处就是「界面不更新」这种最难查的 bug。
 */

import { computed, reactive, ref } from 'vue'
import { GameState, type StoryLine } from '../game/GameState'
import { createTurnRunner } from './turn'
import type { ChatMessage } from '../types/state'

export type { StoryLine }

/**
 * 当前这一局。GameState 自己读档（存档坏了把原因挂在 error 上，不抛错）；
 * reactive 容器提供深响应式 —— 引擎改 this.data 的字段，界面自动跟着变。
 */
const store = reactive({ game: GameState.open(localStorage) })
const history = ref<ChatMessage[]>([])
const running = ref(false)
const debugMode = ref(false)

/** store 的唯一入口；模块级单例，所有界面共享同一份状态 */
export function useGame() {
  // ---------- 只读派生 ----------
  const timeLabel = computed(() => store.game.timeLabel)
  const timeline = computed(() => store.game.data.timeline.slice(-4))
  // ⚠️ store.game.scene（getter）而不是 store.game.data.scene：默认场景名/描述
  //    来自 locale，空值时由 getter 现取，所以切换语言时侧栏会跟着变。
  const scene = computed(() => store.game.scene)
  const turn = computed(() => store.game.turn)

  // ---------- messages（叙事流由 GameState 持有，这里只转发） ----------

  /** 往叙事流末尾追加一行 */
  const append = (kind: StoryLine['kind'], text: string, extra: Partial<StoryLine> = {}) =>
    store.game.appendMessage(kind, text, extra)

  /** 清空叙事流（重来 / 导入后调用） */
  const clearMessages = () => store.game.clearMessages()

  /** 刷新页面后从日志恢复叙事与行动 */
  const restoreLog = (limit = 20) => store.game.restoreMessages(limit)

  // ---------- 回合（编排在 stores/turn.ts） ----------
  const { runTurnAction, abortRunningTurn } = createTurnRunner({
    game: () => store.game,
    append,
    history,
    running,
    debugMode,
  })

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
    store.game.importFile(json)
    history.value = []
    clearMessages()
  }

  /** 把当前存档序列化成 JSON 文本（导出文件用） */
  function exportSave(): string {
    return store.game.exportFile()
  }

  return {
    /** 启动时读档失败的说明；null = 正常 */
    startupError: store.game.error,
    // 状态
    timeLabel,
    timeline,
    scene,
    turn,
    messages: computed(() => store.game.messages),
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
