/**
 * src/stores/turn.ts —— 回合编排
 *
 * 把「跑一个回合」从 store 里拆出来：它只管 agent 循环与事件转译，
 * 不持有状态（状态都从参数传进来）。
 *
 * ⚠️ 重入保护的道理：一次只能跑一个回合。没有它的时候，模型正在写故事时
 * 点「重来」/「导入」，会同时跑两个回合 —— 旧回合的 addLog/advanceTime/save
 * 全作用在**新游戏**上，于是新存档里混进旧剧情、回合数对不上。
 */

import { t } from '../i18n'
import { runTurn, type AgentEvent } from '../agent/agent'
import type { GameState } from '../game/GameState'
import type { ChatMessage } from '../types/state'
import type { Ref } from 'vue'
import type { StoryLine } from './game'

interface TurnDeps {
  /** 当前存档（读的是 store 的响应式代理） */
  game: () => GameState
  /** 往叙事流追加一行 */
  append: (kind: StoryLine['kind'], text: string, extra?: Partial<StoryLine>) => void
  /** 对话历史（回合间共享） */
  history: Ref<ChatMessage[]>
  /** 是否有回合在飞 */
  running: Ref<boolean>
  /** 调试模式：把模型原始响应也显示出来 */
  debugMode: Ref<boolean>
}

/** 造一组回合动作（闭包持有中止用的 controller） */
export function createTurnRunner({ game, append, history, running, debugMode }: TurnDeps): {
  runTurnAction: (action?: string) => Promise<void>
  abortRunningTurn: () => void
} {
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
        append('narration', evt.text)
        break
      case 'raw':
        if (debugMode.value) {
          const count = evt.reply.toolCalls.length
          append('tool', t('store.rawReply', { count }), {
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
      const result = await runTurn(game(), {
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

  return { runTurnAction, abortRunningTurn }
}
