/**
 * src/stores/game.ts —— 界面与领域之间的薄层（响应式边界 + 组合根）
 *
 * 领域逻辑在 game/state.ts 的**纯函数**里（只认数据，不认 Vue、不认存储）。这里负责：
 *   1. 把纯数据包成 reactive（响应式边界在界面侧）
 *   2. 把事件流**投影**成界面要渲染的行 —— 显示是派生值，不是状态
 *   3. 持有两样瞬态：对话历史、通知（单槽）
 *   4. 编排动作：把权威数据交给回合事务（stores/turn.ts：拷副本 → 跑 → 提交 → 落盘）
 *
 * ⚠️ 界面更新来自**提交时的一次整体赋值**（回合把工作副本写回 `state.data`，
 *    见 stores/turn.ts），不是来自引擎的原地修改：引擎拿到的是副本（纯数据），
 *    它在哪儿改都与依赖无关。这条性质由 tests/store.test.ts 的「改数据 → DOM 更新」守着。
 *
 * ⚠️ 这里**没有**「叙事流数组」：界面渲染的是 `data.events` 的投影（rows）。故事与
 *    调试痕迹在**同一个数组**里，顺序天然正确（痕迹就插在它发生的那段叙事之间）；
 *    谁看得到由投影决定：玩家看故事、模型看快照、开发者看调试。进行中看 phase、
 *    一次性提示进 notice，两者都由 computed 算出来 —— 没有哪一行需要谁记得删掉。
 */

import { computed, reactive, ref } from 'vue'
import * as game from '../game/state'
import { initialState } from '../game/state'
import { isStoryKind } from '../game/save'
import { IDLE, isRunning, statusKeyOf, type TurnState } from '../game/lifecycle'
import { createTurnRunner, type NoticeLevel } from './turn'
import { localStorageStore, type GameStore } from '../utils/storage'
import { t } from '../i18n'
import type { ChatMessage, EventKind, StoryKind } from '../types/state'

/** 界面能渲染的故事行 kind（system 是给模型看的回合标记，不列出来） */
export type StoryRowKind = Exclude<StoryKind, 'system'>

/** 界面能渲染的调试行 kind（只有打开调试模式才会出现在列表里） */
export type DebugRowKind = Exclude<EventKind, StoryKind>

/**
 * 界面要渲染的一行 —— 事件流的投影。
 *
 * 故事行与调试行在**同一个列表**里，靠 debug 判别字段区分样式，顺序即发生顺序。
 */
export type Row =
  | {
      /** key 用：事件在数组里的下标（事件流只追加、按类裁剪，不重排） */
      id: number
      kind: StoryRowKind
      text: string
      debug: false
    }
  | {
      id: number
      kind: DebugRowKind
      text: string
      /** 可折叠的原始内容（模型请求体 / 响应体） */
      detail?: string
      debug: true
    }

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

/** 调试开关的存储键：显式选过就记住，刷新后不再自己打开 */
const DEBUG_KEY = 'tavernGame.debug'

/**
 * 读回显式的调试选择。
 * @returns true / false = 玩家的显式选择；null = 没选过（由域名决定默认值）
 */
export function readStoredDebug(): boolean | null {
  try {
    const raw = localStorage.getItem(DEBUG_KEY)
    if (raw === 'on') return true
    if (raw === 'off') return false
    return null
  } catch {
    // 隐私模式下读不到：当作没选过，默认值照旧按域名算
    return null
  }
}

/**
 * 初始调试状态：**显式选择优先**，没选过才看域名（本机开发默认打开）。
 *
 * 这就是「本地默认开、但关掉之后刷新仍然关着」这条规则的唯一实现处 ——
 * 入口只负责把 location 与存储读进来。
 */
export function resolveDebug(stored: boolean | null, devHost: boolean): boolean {
  return stored ?? devHost
}

/** 记住显式的调试选择。写不进去只影响「刷新后还记不记得」，开关本身照常 */
export function storeDebug(on: boolean): void {
  try {
    localStorage.setItem(DEBUG_KEY, on ? 'on' : 'off')
  } catch (err) {
    // 配额满 / 隐私模式：记不住就算了（这不是玩家数据）
    console.warn('[store] debug flag save failed', err)
  }
}

/** 存档读写器（模块级建一次） */
const saveStore: GameStore = localStorageStore(localStorage)

/** 组合根：先算初始局，再让读档覆盖它（读档失败的说明留在 state.loadError） */
const state = reactive(initialState())
game.hydrateFromSave(state, localStorage)

/** 跨回合的对话历史（引擎要用，但不属于存档） */
const history = ref<ChatMessage[]>([])
/** 回合的生命周期状态：空闲表示没有回合在飞（重入判据与状态行都由它派生） */
const phase = ref<TurnState>(IDLE)
/** 单槽通知：后一条覆盖前一条，回合开始即清空 —— 它不会堆积 */
const notice = ref<{ text: string; level: NoticeLevel } | null>(null)
/**
 * 调试模式：把模型输入输出与工具调用也渲染出来。
 *
 * ⚠️ 初始值由入口（main.ts）决定：显式选择优先，没选过就按域名
 *    （本机开发默认打开）。这样「浏览器事实」留在入口，store 只持有状态，
 *    纯逻辑测试不需要 location。
 */
const debugMode = ref(false)

/** 当前是不是本机开发地址 —— 只有它为真时，顶栏才给调试开关 */
const devHost = ref(false)

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
   * 界面要渲染的行 —— 事件流的投影。
   *
   * 故事（叙事 / 玩家行动）始终显示；调试痕迹只在调试模式显示，
   * system 是给模型看的回合标记，谁都不显示。刷新后不需要「恢复」：渲染的本来就是事件流。
   */
  const rows = computed<Row[]>(() =>
    state.data.events.flatMap((event, id): Row[] => {
      if (event.kind === 'narration' || event.kind === 'action') {
        return [{ id, kind: event.kind, text: event.text, debug: false }]
      }
      // system 是给模型看的回合标记，不进界面
      if (event.kind === 'system') return []
      if (!debugMode.value) return []
      return [{ id, kind: event.kind, text: event.text, detail: event.detail, debug: true }]
    }),
  )

  /** 事件流里有没有故事（界面与 store 用它区分「全新的一局」与「已经玩过」） */
  const hasStory = computed(() => state.data.events.some((event) => isStoryKind(event.kind)))

  /** 有回合在飞：输入框禁用，也是重入保护的唯一判据 */
  const busy = computed(() => isRunning(phase.value))

  /**
   * 底部状态行。进行中优先于通知 —— 回合一跑起来，上一条通知就过时了。
   * 两者都是**算出来的**：进行中那一条是生命周期状态的投影（文案键由状态给出，
   * 见 game/lifecycle.ts），没有哪一行需要谁记得删掉。
   */
  const status = computed<Status | null>(() => {
    const key = statusKeyOf(phase.value)
    if (key) return { kind: 'busy', text: t(key) }
    return notice.value ? { kind: notice.value.level, text: notice.value.text } : null
  })

  // ---------- 瞬态写入 ----------

  /** 报一条通知；传 null 清空。单槽 —— 后一条覆盖前一条 */
  const notify = (text: string | null, level: NoticeLevel = 'info') => {
    notice.value = text === null ? null : { text, level }
  }

  // ---------- 回合（编排在 stores/turn.ts） ----------
  const { runTurnAction, abortRunningTurn } = createTurnRunner({
    state,
    addEvent: (target, kind, text, detail) => game.addEvent(target, kind, text, detail),
    notify,
    endTurn: (target) => void game.endTurn(target),
    snapshot: (target, h) => game.snapshot(target, h),
    save: () => game.save(state, saveStore),
    history,
    phase,
    debugMode,
  })

  // ---------- 换一局的两个入口 ----------

  /** 换局前先收尾：在飞的回合中止，上一局的历史与通知都不该跟过来 */
  function resetSession() {
    abortRunningTurn()
    history.value = []
    notify(null)
  }

  /** 重来：重置数据（事件流跟着换新）并立刻落盘 */
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
    rows,
    hasStory,
    status,
    busy,
    debugMode,
    devHost,
    // 动作
    notify,
    runTurnAction,
    resetGame,
    importSave,
    exportSave,
  }
}
