/**
 * src/stores/game.ts —— 界面与领域之间的薄层（响应式边界 + 组合根）
 *
 * 领域逻辑在 game/state.ts 的**纯函数**里（它们只认数据、不认 Vue、不认存储）。
 * 这里负责四件界面侧的事：
 *   1. 把纯数据包成 reactive（响应式边界在界面侧）
 *   2. 把日志**投影**成故事区要渲染的那串行 —— 显示是派生值，不是状态
 *   3. 持有三样瞬态：对话历史、调试痕迹、通知（单槽）
 *   4. 编排动作：把代理交给领域函数、决定什么时候落盘
 *
 * ⚠️ 传出去的必须是**这个代理**：领域函数原地改它，Vue 才能建立依赖。
 *    传原对象（toRaw）不会报错，但界面不会更新 —— 这类静默失败由
 *    tests/store.test.ts 的「改数据 → DOM 更新」用例守着。
 *
 * ⚠️ 这里**没有**「叙事流数组」这种东西：故事是 data.log 的投影（lines）。
 *    进行中看 phase、一次性提示进 notice，两者都由 computed 算出来 ——
 *    没有任何一行需要谁记得删掉，也就不可能「永久停在正在生成开场」。
 */

import { computed, reactive, ref } from 'vue'
import * as game from '../game/state'
import { initialState } from '../game/state'
import { createTurnRunner, type NoticeLevel, type Phase, type TraceKind } from './turn'
import { localStorageStore, type GameStore } from '../utils/storage'
import { t } from '../i18n'
import type { ChatMessage } from '../types/state'

/** 故事区的一行：日志的投影 */
export interface StoryLine {
  /** key 用：日志里的下标（日志只追加、裁头，行不会重排） */
  id: number
  kind: 'narration' | 'action'
  text: string
}

/** 调试痕迹里的一行（模型输入输出 / 工具调用与结果） */
export interface TraceLine {
  id: number
  kind: TraceKind
  text: string
  /** 模型原始响应的 JSON（界面折叠显示） */
  raw?: string
}

/** 底部状态行：进行中，或最近一条通知 */
export interface Status {
  kind: 'busy' | NoticeLevel
  text: string
}

/**
 * 本机开发地址。发布到 GitHub Pages 的域名不会命中，
 * 所以「本地自动开调试」不会漏到线上玩家那里。
 */
export function isDevHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

/** 存档读写器（模块级建一次） */
const saveStore: GameStore = localStorageStore(localStorage)

/** 组合根：先算初始局，再让读档覆盖它（读档失败的说明留在 state.loadError） */
const state = reactive(initialState())
game.hydrateFromSave(state, localStorage)

/** 跨回合的对话历史（引擎要用，但不属于存档） */
const history = ref<ChatMessage[]>([])
/** 回合阶段：非 null 表示有回合在飞 */
const phase = ref<Phase>(null)
/** 单槽通知：后一条覆盖前一条，回合开始即清空 —— 它不会堆积 */
const notice = ref<{ text: string; level: NoticeLevel } | null>(null)
/** 调试痕迹：只在调试模式产生，不进存档、刷新即空 */
const trace = ref<TraceLine[]>([])
let nextTraceId = 0
/**
 * 调试模式：记录模型输入输出与工具调用。
 *
 * ⚠️ 默认值由入口（main.ts）按当前域名决定 —— 「本机开发默认打开」这条规则
 *    住在浏览器入口，store 只持有这个状态，于是纯逻辑测试不需要 location。
 */
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

  /**
   * 故事区的行 —— 日志的投影。
   * system 是给模型看的回合标记（「新冒险」「第 N 回合」），不给玩家看。
   * 刷新后不需要「恢复」：渲染的本来就是日志。
   */
  const lines = computed<StoryLine[]>(() =>
    state.data.log.flatMap((entry, id) =>
      entry.kind === 'system' ? [] : [{ id, kind: entry.kind, text: entry.text }],
    ),
  )

  /** 有回合在飞：输入框禁用，也是重入保护的唯一判据 */
  const busy = computed(() => phase.value !== null)

  /**
   * 底部状态行。进行中优先于通知 —— 回合一跑起来，上一条通知就过时了。
   * 两者都是**算出来的**：没有哪一行需要谁记得删掉。
   */
  const status = computed<Status | null>(() => {
    if (phase.value) {
      return {
        kind: 'busy',
        text: phase.value === 'opening' ? t('app.generatingOpening') : t('story.thinking'),
      }
    }
    return notice.value ? { kind: notice.value.level, text: notice.value.text } : null
  })

  // ---------- 瞬态写入 ----------

  /** 报一条通知；传 null 清空。单槽 —— 后一条覆盖前一条 */
  const notify = (text: string | null, level: NoticeLevel = 'info') => {
    notice.value = text === null ? null : { text, level }
  }

  /** 追加一行调试痕迹（回合编排调用） */
  const addTrace = (kind: TraceKind, text: string, raw?: string) => {
    trace.value.push({ id: ++nextTraceId, kind, text, raw })
  }

  // ---------- 回合（编排在 stores/turn.ts） ----------
  const { runTurnAction, abortRunningTurn } = createTurnRunner({
    state,
    addLog: (kind, text) => game.addLog(state, kind, text),
    addTrace,
    notify,
    endTurn: () => void game.endTurn(state),
    snapshot: (h) => game.snapshot(state, h),
    save: () => game.save(state, saveStore),
    history,
    phase,
    debugMode,
  })

  // ---------- 换一局的两个入口 ----------

  /** 换局前先收尾：在飞的回合中止，上一局的历史/痕迹/通知都不该跟过来 */
  function resetSession() {
    abortRunningTurn()
    history.value = []
    trace.value = []
    notify(null)
  }

  /** 重来：重置数据与日志，并立刻落盘（由领域函数负责） */
  function resetGame() {
    resetSession()
    game.reset(state, saveStore)
  }

  /** 从文件导入存档：换掉整份 data 并落盘 */
  function importSave(json: string) {
    resetSession()
    game.importFile(state, json, saveStore)
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
    lines,
    trace,
    status,
    busy,
    debugMode,
    // 动作
    notify,
    runTurnAction,
    resetGame,
    importSave,
    exportSave,
  }
}
