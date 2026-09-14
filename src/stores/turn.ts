/**
 * src/stores/turn.ts —— 回合编排
 *
 * 只管 agent 循环与事件转译，**不认识领域数据的形状**：
 * 它需要的五种操作（记日志 / 追加消息 / 结束回合 / 出快照 / 落盘）都由调用方传进来。
 * 这样它既能被 store 用（带响应式 + 存储），也能被离线脚本用（假存储）。
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
import type { ChatMessage } from '../types/state'
import type { GameState, StoryLine } from '../game/state'
import type { Ref } from 'vue'

interface TurnDeps {
  /** 当前这一局的数据（引擎与工具会原地改它） */
  state: GameState
  /** 记一条日志 */
  addLog: (kind: 'action' | 'narration' | 'system', text: string) => void
  /** 往叙事流追加一行 */
  appendMessage: (kind: StoryLine['kind'], text: string, extra?: Partial<StoryLine>) => void
  /** 回合 +1 */
  endTurn: () => void
  /** 世界状态快照（拼提示词用） */
  snapshot: (history: ChatMessage[]) => string
  /** 落盘；失败必须让玩家看到 */
  save: () => boolean
  /** 对话历史（回合间共享） */
  history: Ref<ChatMessage[]>
  /** 是否有回合在飞 */
  running: Ref<boolean>
  /** 调试模式：把模型原始响应也显示出来 */
  debugMode: Ref<boolean>
}

/** 造一组回合动作（闭包持有中止用的 controller） */
export function createTurnRunner(deps: TurnDeps): {
  runTurnAction: (action?: string) => Promise<void>
  abortRunningTurn: () => void
} {
  const { state, addLog, appendMessage, endTurn, snapshot, save, history, running, debugMode } = deps
  let controller: AbortController | null = null

  /** 中止在飞的回合；没有则什么也不做 */
  function abortRunningTurn() {
    if (!controller) return
    controller.abort()
    controller = null
  }

  /** 把 agent 循环抛出的事件翻译成叙事流里的一行 */
  function handleEvent(evt: AgentEvent) {
    switch (evt.type) {
      case 'narration':
        appendMessage('narration', evt.text)
        break
      case 'raw':
        if (debugMode.value) {
          const count = evt.reply.toolCalls.length
          appendMessage('tool', t('store.rawReply', { count }), {
            raw: JSON.stringify(evt.reply.raw, null, 2),
          })
        }
        break
      case 'tool':
        // args 是协议原样给的 JSON 字符串，直接展示（它就是模型实际发出的内容）
        appendMessage('tool', t('toolbar.toolCall', { tool: evt.tool, args: evt.args }))
        break
      case 'toolResult':
        appendMessage('tool', t('store.toolResultLine', { result: evt.result }))
        break
      case 'warn':
        appendMessage('warn', t('store.warnLine', { message: evt.message }))
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
    if (action) appendMessage('action', action)

    controller = new AbortController()
    try {
      const result = await runTurn(
        { state, addLog, endTurn, snapshot },
        { action, history: history.value, signal: controller.signal, onEvent: handleEvent },
      )
      history.value = result.history
      if (!result.text) appendMessage('system', t('store.noText'))
      if (!save()) appendMessage('warn', t('agent.saveFailed'))
    } catch (err) {
      const e = err as Error
      if (e.name === 'AbortError') {
        appendMessage('system', t('store.cancelled'))
      } else {
        appendMessage('error', t('store.failed', { message: e.message }))
      }
      throw err // 交给调用方决定要不要提示
    } finally {
      controller = null
      running.value = false
    }
  }

  return { runTurnAction, abortRunningTurn }
}
