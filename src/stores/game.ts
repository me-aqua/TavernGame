/**
 * src/stores/game.ts —— 界面与领域之间的薄层（响应式边界 + 组合根）
 *
 * 领域逻辑在 game/ 的**纯函数**里（只认数据，不认 Vue、不认存储）。这里负责：
 *   1. 把纯数据包成 reactive（响应式边界在界面侧）
 *   2. 把事件流**投影**成界面要渲染的行 —— 显示是派生值，不是状态
 *   3. 持有两样瞬态：对话历史、通知（单槽）
 *   4. 编排动作：把权威数据交给回合事务（stores/turn.ts：拷副本 → 跑 → 提交 → 落盘）
 *
 * ⚠️ 界面更新来自**提交时的一次整体赋值**（回合把工作副本写回 `state.data`），
 *    不是来自引擎的原地修改：引擎拿到的是副本（纯数据），它在哪儿改都与依赖无关。
 *
 * ⚠️ 这里**没有**「叙事流数组」：界面渲染的是 `data.events` 的投影（rows）。故事与
 *    调试痕迹在**同一个数组**里，顺序天然正确；谁看得到由投影决定：玩家看故事、
 *    开发者看调试。进行中看 phase、一次性提示进 notice，两者都由 computed 算出来。
 *
 * ⚠️ 状态树与时间都是**卡驱动**的：时间标签走卡里的历法、场景读 `state.world.location`，
 *    引擎不写死任何一段（决定 #45）。
 */

import { computed, reactive, ref } from 'vue'
import * as game from '../game/state'
import { initialState } from '../game/state'
import { clockIn } from '../game/card-time'
import { isRecord, isStoryKind } from '../game/save'
import { IDLE, isRunning, runningNodeOf, statusKeyOf, type TurnState } from '../game/lifecycle'
import { nodeLabel, spotOf } from '../game/display'
import { cardStartup, currentCard } from '../game/current-card'
import { createTurnRunner, type NoticeLevel, type StateWrite } from './turn'

export type { StateWrite }
import { localStorageStore, type GameStore } from '../utils/storage'
import { t } from '../i18n'
import type { BlockGroup } from '../agent/prompts'
import type { EventKind, GameData, GameEvent, StoryKind } from '../types/state'

/** 界面能渲染的故事行 kind（引擎只写叙事这一种） */
export type StoryRowKind = StoryKind

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
      /**
       * 可折叠的原始内容（模型请求体 / 响应体 / 工具参数与结果）。
       *
       * ⚠️ 写入那一行的原文不在痕迹里 —— 它是从结构化的 `value` 现写的（见 detailOf）。
       */
      detail?: string
      /**
       * 这一行的分块清单（模型输入 / 原始回复两条有）—— 块与行的边界写在痕迹上，
       * 界面不切文本。旧痕迹没有这个字段，那一行就按原始文本显示。
       */
      blocks?: BlockGroup[]
      debug: true
    }

export interface Status {
  kind: 'busy' | NoticeLevel
  text: string
}

/**
 * 调试面板里的**一次工具调用** —— 事件流的投影（tool → stateChange* → toolResult）。
 *
 * 节点 id / 工具名 / 写入路径读的是痕迹上的**结构化字段**（写痕迹的 stores/turn.ts 带上
 * 它们）—— 不反解渲染好的文案：那种读法换语言、改文案都会断（决定 #46 的同一个道理）。
 * 一局很旧、痕迹里没有这几个字段时按「没有节点 / 没有路径」显示，不猜。
 */
export interface ToolCall {
  /** 发出这次调用的节点 id；痕迹里没带就是 null */
  node: string | null
  /** 工具名（卡里 actions 的键） */
  tool: string
  /** 协议原样给的参数 JSON */
  args: string
  /** 引擎回传的结果（还没回传时是 null） */
  result: string | null
  /** 这次调用写下的状态，按发生顺序 */
  writes: StateWrite[]
  /** 引擎回的是结构化错误（参数不合法 / 无效 JSON）：图上要标红 */
  failed: boolean
  /** 退回重来：这次调用要求从哪个节点重跑（别的调用是 null） */
  redoFrom: string | null
}

/**
 * 一行调试痕迹的**展开体**（给人看的原始文本）。
 *
 * ⚠️ 写入那一行的原文从结构化 `value` **现写**：痕迹里只存真值，不存第二份文本
 *    （存两份的话，存档里那份就成了「必须是合法 JSON」的隐藏契约，读它的人得自己防一手）。
 *    旧痕迹里可能只有 detail、没有 value —— 那就没有展开体，不猜。
 */
function detailOf(event: GameEvent): string | undefined {
  if (event.kind !== 'stateChange') return event.detail
  return event.value === undefined ? undefined : JSON.stringify(event.value, null, 2)
}

/** 参数 JSON 里的 from —— 参数是**模型给的**外部数据，必须是卡里拓扑中的一个节点 id */
function redoFromOf(args: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    // 参数不是合法 JSON：引擎已经把结构化错误回传给它了，这里没有 from 可读
    return null
  }
  if (!isRecord(parsed)) return null
  const from = parsed.from
  return currentCard.graph.topology.find((id) => id === from) ?? null
}

/** 最近一轮的痕迹：从最后一条玩家行动算起（开场没有行动，整段都算这一轮） */
function lastRound(events: GameEvent[]): GameEvent[] {
  let start = 0
  events.forEach((event, index) => {
    if (event.kind === 'action') start = index
  })
  return events.slice(start)
}

/** 把最近一轮的事件流投影成工具调用清单（哪条痕迹属于哪次调用，全靠顺序） */
function toolCallsOf(events: GameEvent[]): ToolCall[] {
  const calls: ToolCall[] = []
  /** 上一次还没等到结果的调用 —— 它中间写下的状态都算它的 */
  let open: ToolCall | null = null
  for (const event of lastRound(events)) {
    if (event.kind === 'tool') {
      open = {
        node: event.node ?? null,
        tool: event.tool ?? '',
        args: event.detail ?? '',
        result: null,
        writes: [],
        failed: false,
        redoFrom: null,
      }
      calls.push(open)
      continue
    }
    if (event.kind === 'stateChange') {
      open?.writes.push({ path: event.path ?? '', value: event.value })
      continue
    }
    if (event.kind === 'toolResult' && open) {
      const effect = currentCard.actions[open.tool]?.effect
      open.result = event.detail ?? ''
      // 打没打回由引擎说了算（痕迹上的 failed）。**别从「有没有写入」反推**：
      // 成功的 redo 也不写状态，两个一起被放过（被拒的 redo 就成了看不见的失败）
      open.failed = event.failed === true
      if (effect === 'redo') open.redoFrom = redoFromOf(open.args)
      open = null
    }
  }
  return calls
}

/** 图例与面板要标红的节点：被 redo 退回过、或工具调用失败过的那些（去重、按拓扑序） */
function failedNodesOf(calls: ToolCall[]): string[] {
  const marked = new Set<string>()
  for (const call of calls) {
    if (call.redoFrom !== null) marked.add(call.redoFrom)
    if (call.failed && call.node !== null) marked.add(call.node)
  }
  return currentCard.graph.topology.filter((id) => marked.has(id))
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
  /** 时间标签：读**状态树里那一格**（R39），按卡的历法渲染 —— 树一动它就动 */
  const timeLabel = computed(() => game.timeText(currentCard.time.calendar, clockIn(state.data.state)))
  const timeline = computed(() => state.data.timeline.slice(-4))
  /** 当前场景：读状态树的 world.location（卡没声明这一段时是三个空串） */
  const scene = computed(() => spotOf(state.data.state))
  const turn = computed(() => game.turn(state))
  /** 这一局的完整状态树（调试面板与将来的界面读它） */
  const stateTree = computed(() => state.data.state)
  /** 正在跑的那个节点（活卡图的高亮靠它）—— 图没在跑就是 null */
  const runningNode = computed(() => runningNodeOf(phase.value))
  /** 最近一轮的工具调用清单（调试面板的「工具调用」那一页） */
  const debugTools = computed(() => toolCallsOf(state.data.events))
  /** 活卡图上要标红的节点：被 redo 退回过、或工具调用失败过的 */
  const debugFailedNodes = computed(() => failedNodesOf(debugTools.value))

  /**
   * 界面要渲染的行 —— 事件流的投影。
   *
   * 叙事始终显示；调试痕迹只在调试模式显示。刷新后不需要「恢复」：渲染的本来就是事件流。
   */
  const rows = computed<Row[]>(() =>
    state.data.events.flatMap((event, id): Row[] => {
      if (isStoryKind(event.kind)) {
        return [{ id, kind: event.kind, text: event.text, debug: false }]
      }
      if (!debugMode.value) return []
      return [
        {
          id,
          kind: event.kind,
          text: event.text,
          detail: detailOf(event),
          blocks: event.blocks,
          debug: true,
        },
      ]
    }),
  )

  /** 事件流里有没有故事（界面与 store 用它区分「全新的一局」与「已经玩过」） */
  const hasStory = computed(() => state.data.events.some((event) => isStoryKind(event.kind)))

  /** 有回合在飞：输入框禁用，也是重入保护的唯一判据 */
  const busy = computed(() => isRunning(phase.value))

  /**
   * 底部状态行。进行中优先于通知 —— 回合一跑起来，上一条通知就过时了。
   * 两者都是**算出来的**：进行中那一条是生命周期状态的投影（文案键由状态给出）。
   *
   * ⚠️ 跑到哪个节点就写哪个节点的显示名（卡的 graph.nodes[id].name）：
   *    「正在跑「故事大纲」…」比「思考中…」有用得多 —— 九个节点卡在哪一个一眼看得到。
   */
  const status = computed<Status | null>(() => {
    const node = runningNodeOf(phase.value)
    if (node) {
      const key = phase.value.mode === 'opening' ? 'app.openingNodeRunning' : 'story.nodeRunning'
      return { kind: 'busy', text: t(key, { node: nodeLabel(currentCard, node) }) }
    }
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
  const { runTurnAction, abortRunningTurn, draft, writes } = createTurnRunner({
    state,
    card: currentCard,
    addEvent: (target: GameData, event) => game.addEvent(target, event),
    notify,
    endTurn: (target: GameData) => game.endTurn(target),
    save: () => game.save(state, saveStore),
    phase,
    debugMode,
  })

  // ---------- 换一局的两个入口 ----------

  /** 换局前先收尾：在飞的回合中止，上一局的通知不该跟过来（故事在事件流里，跟着换） */
  function resetSession() {
    abortRunningTurn()
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
    stateTree,
    rows,
    hasStory,
    status,
    busy,
    // 卡（图、声明与启动信息都由界面读它）
    card: currentCard,
    cardStartup,
    debugMode,
    devHost,
    // 调试投影（只给调试面板；面板只在调试模式渲染，发布版不带）
    runningNode,
    debugDraft: draft,
    debugWrites: writes,
    debugTools,
    debugFailedNodes,
    // 动作
    notify,
    runTurnAction,
    resetGame,
    importSave,
    exportSave,
  }
}
