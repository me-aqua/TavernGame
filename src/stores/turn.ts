/**
 * src/stores/turn.ts —— 回合编排
 *
 * 只管 agent 循环与事件转译，**不认识领域数据的形状**：
 * 它需要的操作（写事件 / 报通知 / 结束回合 / 出快照 / 落盘）都由调用方传进来。
 * 这样它既能被 store 用（带响应式 + 存储），也能被离线脚本用（假存储）。
 *
 * ⚠️ 故事不在这里产生：叙事由引擎写进事件流，界面渲染的就是事件流的投影。
 *    这里只经手两样，都是**只有界面需要**的：
 *      · 调试痕迹（模型输入输出、工具调用与结果）—— 调试模式才写，
 *        写进**同一个事件流**（同一个数组 = 顺序天然正确，痕迹就插在它发生的叙事之间）
 *      · 通知（保存失败、被取消、回合失败）—— 瞬态单槽，后一条覆盖前一条
 *
 * ⚠️ 重入保护的道理：一次只能跑一个回合。没有它的时候，模型正在写故事时
 * 点「重来」/「导入」，会同时跑两个回合 —— 旧回合的日志/时间/落盘
 * 全作用在**新游戏**上，于是新存档里混进旧剧情、回合数对不上。
 *
 * ⚠️ 落盘在回合**成功之后**由这里调用，引擎（agent.ts）不碰存储：
 * 数据不该知道怎么落盘。取消/失败时内存里的改动不落盘，与原有语义一致。
 */

import { t } from '../i18n'
import { runTurn, type AgentEvent } from '../agent/agent'
import type { ChatMessage, EventKind } from '../types/state'
import type { GameState } from '../game/state'
import type { Ref } from 'vue'

/** 回合阶段：null = 空闲。界面据此决定状态行写「正在生成开场…」还是「思考中…」 */
export type Phase = 'opening' | 'turn' | null

/** 通知的严重程度（决定状态行的样式） */
export type NoticeLevel = 'info' | 'error'

interface TurnDeps {
  /** 当前这一局的数据（引擎与工具会原地改它） */
  state: GameState
  /** 写一条事件：故事与调试痕迹共用这一个数组，顺序即发生顺序 */
  addEvent: (kind: EventKind, text: string, detail?: string) => void
  /** 报一条通知；传 null 清空。单槽 —— 后一条覆盖前一条 */
  notify: (text: string | null, level?: NoticeLevel) => void
  /** 回合 +1 */
  endTurn: () => void
  /** 世界状态快照（拼提示词用） */
  snapshot: (history: ChatMessage[]) => string
  /** 落盘；失败必须让玩家看到 */
  save: () => boolean
  /** 对话历史（回合间共享） */
  history: Ref<ChatMessage[]>
  /** 回合阶段：非 null 表示有回合在飞 */
  phase: Ref<Phase>
  /** 调试模式：记录模型输入输出与工具调用 */
  debugMode: Ref<boolean>
}

/** 造一组回合动作（闭包持有中止用的 controller） */
export function createTurnRunner(deps: TurnDeps): {
  runTurnAction: (action?: string) => Promise<void>
  abortRunningTurn: () => void
} {
  const { state, addEvent, notify, endTurn, snapshot, save, history, phase, debugMode } = deps
  let controller: AbortController | null = null

  /** 中止在飞的回合；没有则什么也不做 */
  function abortRunningTurn() {
    if (!controller) return
    controller.abort()
    controller = null
  }

  /**
   * 把 agent 循环抛出的事件翻译成调试痕迹，写进同一个事件流。
   *
   * 叙事不在这里处理 —— 引擎已经把它写进事件流了（界面渲染的就是它）。
   * 调试关掉时一条痕迹都不产生：玩家不该在故事里看到工具调用与原始 JSON。
   */
  function handleEvent(evt: AgentEvent) {
    if (!debugMode.value) return
    switch (evt.type) {
      case 'model':
        // 输入与输出成对写：先请求体，再响应体 —— 顺序就是这次调用的顺序
        addEvent(
          'request',
          t('store.rawRequest', { count: evt.reply.request.messages.length }),
          JSON.stringify(evt.reply.request, null, 2),
        )
        addEvent(
          'reply',
          t('store.rawReply', { count: evt.reply.toolCalls.length }),
          JSON.stringify(evt.reply.raw, null, 2),
        )
        break
      case 'tool':
        // args 是协议原样给的 JSON 字符串，直接展示（它就是模型实际发出的内容）
        addEvent('tool', t('toolbar.toolCall', { tool: evt.tool, args: evt.args }))
        break
      case 'toolResult':
        addEvent('toolResult', t('store.toolResultLine', { result: evt.result }))
        break
      case 'warn':
        addEvent('warn', t('store.warnLine', { message: evt.message }))
        break
      default:
        break
    }
  }

  /**
   * 跑一个回合：把玩家输入交给引擎。
   * @param action 玩家输入；不传表示开新游戏（开场）
   */
  async function runTurnAction(action?: string): Promise<void> {
    if (phase.value) return
    phase.value = action ? 'turn' : 'opening'
    // 回合一开始，上一条通知就过时了（「继续游戏」「导出完成」都不该跨回合存在）
    notify(null)

    controller = new AbortController()
    try {
      const result = await runTurn(
        { state, addEvent, endTurn, snapshot },
        {
          action,
          history: history.value,
          signal: controller.signal,
          onEvent: handleEvent,
        },
      )
      history.value = result.history
      if (!result.text) notify(t('store.noText'))
      if (!save()) notify(t('agent.saveFailed'), 'error')
    } catch (err) {
      const e = err as Error
      if (e.name === 'AbortError') {
        notify(t('store.cancelled'))
      } else {
        notify(t('store.failed', { message: e.message }), 'error')
      }
      throw err // 交给调用方决定要不要提示
    } finally {
      controller = null
      phase.value = null
    }
  }

  return { runTurnAction, abortRunningTurn }
}
