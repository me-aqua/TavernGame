/**
 * src/stores/turn.ts —— 回合编排
 *
 * 只管 agent 循环与事件转译，**不认识领域的形状**：
 * 它需要的操作（写事件 / 报通知 / 结束回合 / 落盘）都由调用方传进来。
 * 这样它既能被 store 用（带响应式 + 存储），也能被离线脚本用（假存储）。
 *
 * ⚠️ 故事不在这里产生：叙事由引擎写进事件流，界面渲染的就是事件流的投影。
 *    这里只经手两样，都是**只有界面需要**的：
 *      · 调试痕迹（节点进度、模型输入输出、工具调用与状态写入）—— 调试模式才写，
 *        写进**同一个事件流**（同一个数组 = 顺序天然正确，痕迹就插在它发生的叙事之间）
 *      · 通知（保存失败、被取消、回合失败）—— 瞬态单槽，后一条覆盖前一条
 *
 * ⚠️ 重入保护的道理：一次只能跑一个回合。没有它的时候，模型正在写故事时
 *    点「重来」/「导入」，会同时跑两个回合 —— 旧回合的日志/时间/落盘
 *    全作用在**新游戏**上，于是新存档里混进旧剧情、回合数对不上。
 *
 * ⚠️ 回合的阶段是显式的（src/game/lifecycle.ts 的迁移表）：引擎事件翻译成迁移输入，
 *    提交与回滚是这里的时刻，非法转移会当场抛错。界面看到的状态行就是这个状态的投影。
 *
 * ⚠️ 一轮是一个事务（决定 #27/#39）：开跑前把权威数据深拷成**工作副本**，引擎、
 *    模型产出与调试痕迹全都只写副本；跑到终点的成功回合才把副本一次性写回权威状态
 *    （一次赋值 → 响应式一次触发）并落盘。失败与取消丢弃副本 —— 内存与存档都不留痕。
 *    redo 的重跑发生在**同一个事务里**（回滚的是工作副本的一个快照，不是这一轮）。
 *
 * ⚠️ 副本必须从 toRaw 上克隆：state.data 是 reactive 代理，而 structuredClone
 *    遇到 Proxy 会抛 DataCloneError。
 *
 * ⚠️ 写回发生在提交时，所以叙事是**整轮一起**出现在故事区的，不是每个节点实时出现。
 *
 * ⚠️ 落盘由这里在提交之后调用，引擎（agent.ts）不碰存储：数据不该知道怎么落盘。
 */

import { shallowRef, toRaw, type Ref, type ShallowRef } from 'vue'
import { t } from '../i18n'
import { runTurn, type AgentEvent } from '../agent/agent'
import { requestBlocks } from '../agent/prompts'
import { replyBlocks } from '../agent/llm'
import { advance, isRunning, type TurnEvent, type TurnState } from '../game/lifecycle'
import { nodeLabel } from '../game/display'
import type { CardData } from '../game/card'
import type { GameData, GameEvent } from '../types/state'
import type { GameState } from '../game/state'

/** 通知的严重程度（决定状态行的样式） */
export type NoticeLevel = 'info' | 'error'

/** 本轮写入清单里的一条：哪条路径、写成了什么（调试面板的投影） */
export interface StateWrite {
  path: string
  value: unknown
}

interface TurnDeps {
  /** 权威状态：回合只从它拷副本，成功提交时才写回它的 data */
  state: GameState
  /** 当前卡（调试痕迹要把节点 id 写成显示名） */
  card: CardData
  /** 往**目标数据**写一条事件：跑的时候传工作副本，故事与调试痕迹仍共用一个数组 */
  addEvent: (target: GameData, event: Omit<GameEvent, 'at'>) => void
  /** 报一条通知；传 null 清空。单槽 —— 后一条覆盖前一条 */
  notify: (text: string | null, level?: NoticeLevel) => void
  /** 目标数据的回合 +1 */
  endTurn: (target: GameData) => void
  /** 落盘；失败必须让玩家看到。它读的是权威状态，所以提交必须先于它 */
  save: () => boolean
  /** 回合的生命周期状态：界面据此决定状态行，回合入口据此挡住重入 */
  phase: Ref<TurnState>
  /** 调试模式：记录模型输入输出与节点进度 */
  debugMode: Ref<boolean>
}

/** 回合动作 + 两个只给调试面板的只读投影 */
export interface TurnRunner {
  runTurnAction: (action?: string) => Promise<void>
  abortRunningTurn: () => void
  /** 当前工作副本（草稿）—— 调试模式才有值，提交 / 回滚后消失 */
  draft: ShallowRef<GameData | null>
  /** 本轮写入清单（stateChange 序列）—— 调试模式才累积 */
  writes: ShallowRef<StateWrite[]>
}

/** 摘要行上留多少个字符：超出的部分折进那一行的可展开原文里（完整内容一个字节都不丢） */
const PREVIEW_LIMIT = 40

/**
 * 摘要用的预览：超过上限就取头部加省略号，没超过就原样给出。
 *
 * ⚠️ 判据是「**超出**才算截断」：正好等于上限时原样给出 —— 写成 `>=` 会平白多一个省略号。
 * ⚠️ 标记走 locale（`debug.previewCut`）：它是一条产品文案，`…` 写进代码会被 ASCII 检查拦下。
 */
function previewOf(source: string): string {
  return source.length <= PREVIEW_LIMIT ? source : source.slice(0, PREVIEW_LIMIT) + t('debug.previewCut')
}

/**
 * 拷一份工作副本：引擎、模型产出与调试痕迹都只改它，跑到终点才写回权威状态。
 *
 * ⚠️ 必须 toRaw 之后再 structuredClone：state.data 是 reactive 代理，
 *    structuredClone 不能克隆 Proxy（抛 DataCloneError）。
 */
function draftOf(source: GameState): GameState {
  return { ...source, data: structuredClone(toRaw(source.data)) }
}

/**
 * 把引擎事件翻译成状态机的输入。
 *
 * ⚠️ 只有真正换阶段的才翻译：叙事、模型 I/O、工具调用与节点进度都发生在某个阶段
 *    **里面**，不构成迁移 —— 九个节点各请求一次模型（工具往返还会多问一次），
 *    每次都喂一次 request-model，阶段在 prompting 里自环（表里那条自环就是为这件事留的）。
 */
function lifecycleEventOf(evt: AgentEvent): TurnEvent | null {
  if (evt.type === 'node') return { type: 'node', id: evt.id }
  return evt.type === 'thinking' ? { type: 'request-model' } : null
}

/** 造一组回合动作（闭包持有中止用的 controller 与两个调试投影） */
export function createTurnRunner(deps: TurnDeps): TurnRunner {
  const { state, card, addEvent, notify, endTurn, save, phase, debugMode } = deps
  let controller: AbortController | null = null
  /** 本轮已经写下的调试痕迹（失败时要留下来 —— 见失败分支里的那条例外） */
  let roundTraces: Array<Omit<GameEvent, 'at'>> = []

  /** 只给调试面板的两个投影（发布版不渲染面板，这两个 ref 也就一直是空的） */
  const draft = shallowRef<GameData | null>(null)
  const writes = shallowRef<StateWrite[]>([])

  /** 中止在飞的回合；没有则什么也不做 */
  function abortRunningTurn() {
    if (!controller) return
    controller.abort()
    controller = null
  }

  /**
   * 先把引擎事件按迁移表推进一步，调试模式下再把它翻译成调试痕迹写进**工作副本**。
   *
   * 叙事不在这里处理 —— 引擎已经把它写进工作副本的事件流了（界面渲染的就是它）。
   * 调试关掉时一条痕迹都不产生：玩家不该在故事里看到节点进度与原始 JSON。
   *
   * ⚠️ 每写一行都往 roundTraces 里记一份：这一轮万一失败，副本整个被丢掉，
   *    而「发出去的是什么、模型回了什么」正是那时最需要看的东西。
   */
  function handleEvent(working: GameState, evt: AgentEvent) {
    const step = lifecycleEventOf(evt)
    if (step) phase.value = advance(phase.value, step)
    if (!debugMode.value) return

    /**
     * 写一条调试痕迹：既进副本（成功时随提交一起留下），也记进本轮的痕迹清单。
     *
     * ⚠️ node / tool / path 是**结构化字段**（调试面板按它们分组与筛选）——
     *    面板不该从渲染好的文案里反解，那会在换语言或改文案时断掉。
     */
    const trace = (kind: GameEvent['kind'], text: string, extra: Partial<GameEvent> = {}) => {
      const event: Omit<GameEvent, 'at'> = { kind, text, ...extra }
      addEvent(working.data, event)
      roundTraces.push(event)
    }

    switch (evt.type) {
      case 'node':
        // 图执行器的进度：每进一个节点一行，位置就在它发生的地方（本轮第一个事件）
        trace('node', t('store.nodeLine', { node: nodeLabel(card, evt.id) }), { node: evt.id })
        break
      case 'request':
        // 请求在发出去之前就写成一行：调用失败时这也是唯一能看到的输入。
        // 分块清单在这里算好（块的边界只由装配器说了算），界面拿到的是结构、不是一段文本
        trace('request', t('store.rawRequest', { count: evt.body.messages.length }), {
          detail: JSON.stringify(evt.body, null, 2),
          blocks: requestBlocks(evt.body.messages),
        })
        break
      case 'model':
        trace('model', t('store.rawReply'), {
          detail: JSON.stringify(evt.reply.raw, null, 2),
          blocks: replyBlocks(evt.reply),
        })
        break
      case 'tool':
        // args 是协议原样给的 JSON 字符串：摘要只放头部预览，原样的那一份进 detail（折叠体读它）
        trace('tool', t('toolbar.toolCall', { tool: evt.tool, args: previewOf(evt.args) }), {
          node: evt.node,
          tool: evt.tool,
          detail: evt.args,
        })
        break
      case 'toolResult':
        trace('toolResult', t('store.toolResultLine', { result: evt.result }), {
          node: evt.node,
          tool: evt.tool,
          detail: evt.result,
        })
        break
      case 'stateChange':
        trace('stateChange', t('store.stateChangeLine', { path: evt.path }), {
          node: evt.node,
          path: evt.path,
          detail: JSON.stringify(evt.value, null, 2),
        })
        writes.value = [...writes.value, { path: evt.path, value: evt.value }]
        break
      case 'redo':
        // 「退回重来」那一行：detail 给 why，node 给**被退回的那个节点**（面板据此标红）
        trace('warn', t('store.redoLine', { node: nodeLabel(card, evt.from), why: evt.why }), {
          detail: evt.why,
          node: evt.from,
        })
        break
      case 'warn':
        trace('warn', t('store.warnLine', { message: evt.message }))
        break
      default:
        break
    }
    // 草稿投影：换一个外层引用，让调试面板在回合进行中就能看到工作副本在变
    draft.value = { ...working.data }
  }

  /**
   * 跑一个回合：把玩家输入交给引擎 —— 引擎只改工作副本，跑到终点才提交。
   * @param action 玩家输入；不传表示开新游戏（开场）
   */
  async function runTurnAction(action?: string): Promise<void> {
    // 重入保护：一次只能跑一个回合，状态机只接受从空闲起步
    if (isRunning(phase.value)) return
    phase.value = advance(phase.value, { type: 'start', mode: action ? 'turn' : 'opening' })
    // 回合一开始，上一条通知就过时了（「继续游戏」「导出完成」都不该跨回合存在）
    notify(null)

    controller = new AbortController()
    roundTraces = []
    draft.value = null
    writes.value = []
    try {
      // 事务开始：这一轮的一切写入都落在副本上，权威状态在提交前一个字节都不动
      const working = draftOf(state)
      await runTurn(
        {
          data: working.data,
          card,
          addEvent: (kind, text) => addEvent(working.data, { kind, text }),
          endTurn: () => endTurn(working.data),
        },
        {
          action,
          signal: controller.signal,
          onEvent: (evt) => handleEvent(working, evt),
        },
      )
      // 收尾文字到手 —— 只有这个阶段允许提交
      phase.value = advance(phase.value, { type: 'closing-text' })
      // 提交：一次赋值 → 响应式一次触发；随后的 save() 读到的就是刚写回的副本
      state.data = working.data
      phase.value = advance(phase.value, { type: 'commit' })
      if (!save()) notify(t('agent.saveFailed'), 'error')
    } catch (err) {
      // 失败与取消都在这里丢弃副本：不写回也不落盘，内存与存档一个字节都不变。
      //
      // ⚠️ 唯一的例外是**调试痕迹**（决定 #39 的补充）：一轮失败时最需要看的就是
      //    「发出去的是什么、模型回了什么」，而副本一丢这些就没了 —— 调试模式打开时，
      //    把这一轮写下的痕迹追加到权威状态（只追加，不动故事 / 时间 / 回合数 / 存档）。
      //    它们不是游戏状态：投影只把它们给开发者看，模型的历史里也不含它们。
      for (const line of roundTraces) addEvent(state.data, line)
      roundTraces = []
      phase.value = advance(phase.value, { type: 'rollback' })
      const e = err as Error
      if (e.name === 'AbortError') {
        notify(t('store.cancelled'))
      } else {
        notify(t('store.failed', { message: e.message }), 'error')
      }
      throw err // 交给调用方决定要不要提示
    } finally {
      controller = null
      // 工作副本只活在回合里：提交 / 回滚之后调试面板看不到它（写入清单留着当记录）
      draft.value = null
      phase.value = advance(phase.value, { type: 'reset' })
    }
  }

  return { runTurnAction, abortRunningTurn, draft, writes }
}
