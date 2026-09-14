/**
 * src/stores/game.ts —— 界面与领域之间的薄层（响应式边界 + 组合根）
 *
 * 领域逻辑在 game/state.ts 的**纯函数**里（它们只认数据，不认 Vue、不认存储）。
 * 这里负责三件界面侧的事：
 *   1. 把纯数据包成 reactive（响应式边界在界面侧）
 *   2. 持有跨回合的对话历史（引擎要用，但不属于存档）
 *   3. 编排动作：把代理交给领域函数、决定什么时候落盘
 *
 * ⚠️ 传出去的必须是**这个代理**：领域函数原地改它，Vue 才能建立依赖。
 *    传原对象（toRaw）不会报错，但界面不会更新 —— 这类静默失败由
 *    tests/store.test.ts 的「改数据 → DOM 更新」用例守着。
 */

import { computed, reactive, ref } from 'vue'
import * as game from '../game/state'
import { createTurnRunner } from './turn'
import { localStorageStore, type GameStore } from '../utils/storage'
import { initialState } from '../game/state'
import type { ChatMessage } from '../types/state'

export type { StoryLine } from '../game/state'

/** 存档读写器（模块级建一次） */
const saveStore: GameStore = localStorageStore(localStorage)

/** 组合根：先算初始局，再让读档覆盖它（读档失败的说明留在 state.loadError） */
const state = reactive(initialState())
game.hydrateFromSave(state, localStorage)

const history = ref<ChatMessage[]>([])
const running = ref(false)
const debugMode = ref(false)

/** store 的唯一入口；模块级单例，所有界面共享同一份状态 */
export function useGame() {
  // ---------- 只读派生（读代理 → 自动响应） ----------
  const timeLabel = computed(() => game.timeLabel(state))
  const timeline = computed(() => state.data.timeline.slice(-4))
  // ⚠️ sceneOf 而不是 state.data.scene：默认场景名/描述来自 locale，
  //    空值时现取，所以切换语言时侧栏会跟着变。
  const scene = computed(() => game.sceneOf(state))
  const turn = computed(() => game.turn(state))
  const messages = computed(() => state.messages)

  // ---------- 叙事流（转发给领域函数） ----------

  /** 往叙事流末尾追加一行 */
  const append = (kind: game.StoryLine['kind'], text: string, extra?: Partial<game.StoryLine>) =>
    game.appendMessage(state, kind, text, extra)

  /** 刷新页面后从日志恢复叙事与行动 */
  const restoreLog = (limit = 20) => game.restoreMessages(state, limit)

  // ---------- 回合（编排在 stores/turn.ts） ----------
  const { runTurnAction, abortRunningTurn } = createTurnRunner({
    // 领域动作：turn.ts 只认这些函数，不认识存储与叙事流的细节
    state,
    addLog: (kind, text) => game.addLog(state, kind, text),
    appendMessage: (kind, text, extra) => game.appendMessage(state, kind, text, extra),
    endTurn: () => void game.endTurn(state),
    snapshot: (h) => game.snapshot(state, h),
    save: () => game.save(state, saveStore),
    history,
    running,
    debugMode,
  })

  // ---------- 换 state 的两个入口 ----------

  /** 重来：重置数据与叙事流，并立刻落盘（由领域函数负责） */
  function resetGame() {
    abortRunningTurn()
    game.reset(state, saveStore)
    history.value = []
  }

  /** 从文件导入存档：换掉整份 data，清空叙事流并落盘 */
  function importSave(json: string) {
    abortRunningTurn()
    game.importFile(state, json, saveStore)
    history.value = []
  }

  /** 把当前存档序列化成 JSON 文本（导出文件用） */
  const exportSave = () => game.exportFile(state)

  return {
    /** 启动时读档失败的说明；null = 正常 */
    startupError: state.loadError,
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
