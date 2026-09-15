/**
 * src/stores/turn.ts —— 回合编排
 *
 * 只管 agent 循环与事件转译，**不认识领域数据的形状**：
 * 它需要的操作（写事件 / 报通知 / 结束回合 / 出快照 / 落盘）都由调用方传进来。
 * 这样它既能被 store 用（带响应式 + 存储），也能被离线脚本用（假存储）。
 *
 * ⚠️ 故事不在这里产生：叙事由引擎写进事件流，界面渲染的就是事件流的投影。
 *    这里只经手两样，都是**只有界面需要**的：
 *      · 调试痕迹（节点进度、模型输入输出）—— 调试模式才写，
 *        写进**同一个事件流**（同一个数组 = 顺序天然正确，痕迹就插在它发生的叙事之间）
 *      · 通知（保存失败、被取消、回合失败）—— 瞬态单槽，后一条覆盖前一条
 *
 * ⚠️ 重入保护的道理：一次只能跑一个回合。没有它的时候，模型正在写故事时
 * 点「重来」/「导入」，会同时跑两个回合 —— 旧回合的日志/时间/落盘
 * 全作用在**新游戏**上，于是新存档里混进旧剧情、回合数对不上。
 *
 * ⚠️ 回合的阶段是显式的（src/game/lifecycle.ts 的迁移表）：引擎事件翻译成迁移输入，
 *    提交与回滚是这里的时刻，非法转移会当场抛错。「回合在飞」不再靠一个手写赋值的变量，
 *    界面看到的状态行就是这个状态的投影（决定 #22）。
 *
 * ⚠️ 一轮是一个事务（决定 #27/#39）：开跑前把权威数据深拷成**工作副本**，引擎、
 * 模型产出与调试痕迹全都只写副本；跑到终点的成功回合才把副本一次性写回权威状态
 * （一次赋值 → 响应式一次触发）并落盘。失败与取消丢弃副本 —— 内存与存档都不留痕，
 * 下一次成功回合的 save() 也就没有「半个回合」可以持久化。
 *
 * ⚠️ 副本必须从 toRaw 上克隆：state.data 是 reactive 代理，而 structuredClone
 * 遇到 Proxy 会抛 DataCloneError。
 *
 * ⚠️ 写回发生在提交时，所以叙事是**整轮一起**出现在故事区的，不是每个节点实时出现：
 * 实时写等于把未提交的改动先给玩家看 —— 那正是事务要挡住的东西（决定 #39）。
 *
 * ⚠️ 落盘由这里在提交之后调用，引擎（agent.ts）不碰存储：数据不该知道怎么落盘。
 */

import { toRaw, type Ref } from 'vue'
import { t } from '../i18n'
import { runTurn, type AgentEvent } from '../agent/agent'
import { advance, isRunning, type TurnEvent, type TurnState } from '../game/lifecycle'
import type { ChatMessage, EventKind } from '../types/state'
import type { GameState } from '../game/state'

/** 通知的严重程度（决定状态行的样式） */
export type NoticeLevel = 'info' | 'error'

interface TurnDeps {
  /** 权威状态：回合只从它拷副本，成功提交时才写回它的 data */
  state: GameState
  /** 往**目标状态**写一条事件：跑的时候传工作副本，故事与调试痕迹仍共用一个数组 */
  addEvent: (target: GameState, kind: EventKind, text: string, detail?: string) => void
  /** 报一条通知；传 null 清空。单槽 —— 后一条覆盖前一条 */
  notify: (text: string | null, level?: NoticeLevel) => void
  /** 目标状态的回合 +1 */
  endTurn: (target: GameState) => void
  /** 目标状态的世界状态快照（拼提示词用） */
  snapshot: (target: GameState) => string
  /** 落盘；失败必须让玩家看到。它读的是权威状态，所以提交必须先于它 */
  save: () => boolean
  /** 对话历史（回合间共享） */
  history: Ref<ChatMessage[]>
  /** 回合的生命周期状态：界面据此决定状态行，回合入口据此挡住重入 */
  phase: Ref<TurnState>
  /** 调试模式：记录模型输入输出与节点进度 */
  debugMode: Ref<boolean>
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

/** 造一组回合动作（闭包持有中止用的 controller） */
export function createTurnRunner(deps: TurnDeps): {
  runTurnAction: (action?: string) => Promise<void>
  abortRunningTurn: () => void
} {
  const { state, addEvent, notify, endTurn, snapshot, save, history, phase, debugMode } = deps
  let controller: AbortController | null = null
  /** 本轮已经写下的调试痕迹（失败时要留下来 —— 见失败分支里的那条例外） */
  let roundTraces: Array<{ kind: EventKind; text: string; detail?: string }> = []

  /** 中止在飞的回合；没有则什么也不做 */
  function abortRunningTurn() {
    if (!controller) return
    controller.abort()
    controller = null
  }

  /**
   * 先把引擎事件按迁移表推进一步，再（调试模式下）把它翻译成调试痕迹写进**目标状态**
   * （本轮是工作副本）。
   *
   * 叙事不在这里处理 —— 引擎已经把它写进目标状态的事件流了（界面渲染的就是它）。
   * 调试关掉时一条痕迹都不产生：玩家不该在故事里看到节点进度与原始 JSON。
   *
   * ⚠️ 每写一行都往 roundTraces 里记一份：这一轮万一失败，副本整个被丢掉，
   *    而「发出去的到底是什么」正是那时最需要看的东西（见 catch 里的例外）。
   */
  function handleEvent(target: GameState, evt: AgentEvent) {
    const step = lifecycleEventOf(evt)
    if (step) phase.value = advance(phase.value, step)
    if (!debugMode.value) return

    /** 写一条调试痕迹：既进副本（成功时随提交一起留下），也记进本轮的痕迹清单 */
    const trace = (kind: EventKind, text: string, detail?: string) => {
      addEvent(target, kind, text, detail)
      roundTraces.push({ kind, text, detail })
    }

    switch (evt.type) {
      case 'node':
        // 图执行器的进度：每进一个节点一行，位置就在它发生的地方（本轮第一个事件）
        trace('node', t('store.nodeLine', { node: evt.id }))
        break
      case 'request':
        // 请求在发出去之前就写成一行：调用失败时这也是唯一能看到的输入
        trace(
          'request',
          t('store.rawRequest', { count: (evt.body as { messages?: unknown[] }).messages?.length ?? 0 }),
          JSON.stringify(evt.body, null, 2),
        )
        break
      case 'model':
        trace('reply', t('store.rawReply'), JSON.stringify(evt.reply.raw, null, 2))
        break
      case 'tool':
        // args 是协议原样给的 JSON 字符串，直接展示（它就是模型实际发出的内容）
        trace('tool', t('toolbar.toolCall', { tool: evt.tool, args: evt.args }))
        break
      case 'toolResult':
        trace('toolResult', t('store.toolResultLine', { result: evt.result }))
        break
      case 'warn':
        trace('warn', t('store.warnLine', { message: evt.message }))
        break
      default:
        break
    }
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
    try {
      // 事务开始：这一轮的一切写入都落在副本上，权威状态在提交前一个字节都不动
      const draft = draftOf(state)
      const result = await runTurn(
        {
          state: draft,
          addEvent: (kind, text) => addEvent(draft, kind, text),
          endTurn: () => endTurn(draft),
          snapshot: () => snapshot(draft),
        },
        {
          action,
          history: history.value,
          signal: controller.signal,
          onEvent: (evt) => handleEvent(draft, evt),
        },
      )
      // 收尾文字到手 —— 只有这个阶段允许提交
      phase.value = advance(phase.value, { type: 'closing-text' })
      // 提交：一次赋值 → 响应式一次触发；随后的 save() 读到的就是刚写回的副本
      state.data = draft.data
      history.value = result.history
      phase.value = advance(phase.value, { type: 'commit' })
      if (!save()) notify(t('agent.saveFailed'), 'error')
    } catch (err) {
      // 失败与取消都在这里丢弃副本：不写回也不落盘，内存与存档一个字节都不变。
      //
      // ⚠️ 唯一的例外是**调试痕迹**（决定 #39 的补充）：一轮失败时最需要看的就是
      //    「发出去的是什么、模型回了什么」，而副本一丢这些就没了 —— 调试模式打开时，
      //    把这一轮写下的痕迹追加到权威状态（只追加，不动故事 / 时间 / 回合数 / 存档）。
      //    它们不是游戏状态：投影只把它们给开发者看，模型快照也只认故事类事件。
      for (const line of roundTraces) addEvent(state, line.kind, line.text, line.detail)
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
      phase.value = advance(phase.value, { type: 'reset' })
    }
  }

  return { runTurnAction, abortRunningTurn }
}
