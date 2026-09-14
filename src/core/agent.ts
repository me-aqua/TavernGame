/**
 * src/core/agent.ts —— agent 循环（项目的灵魂）
 *
 * 一次「回合」的完整流程：
 *
 *   玩家输入 → 拼装提示词 → 问模型 → 模型回复 + 申请调用工具
 *          → 引擎执行工具、改状态 → 把结果回传模型 → 模型再回复
 *          → 重复直到模型不再申请工具，或达到步数上限 → 回合结束
 *
 * 关键点：
 *   - **引擎持有一切事实**。模型只能申请，不能直接改。
 *   - **步数有上限**，防止模型陷入死循环把 API 额度烧光。
 *   - **可以中途取消**，玩家点了停止就真的停下。
 */

import { chat } from './llm'
import { runTool, parseToolCalls } from './tools'
import { buildSystemPrompt, OPENING_INSTRUCTION } from './prompts'
import { loadConfig } from './config'
import type { GameState } from './state'
import type { ChatMessage } from '../types/state'

/** agent 循环里抛给界面的事件（界面据此实时渲染） */
export type AgentEvent =
  | { type: 'thinking'; step: number }
  | { type: 'raw'; text: string; blocks: number; narrationLength: number; replyLength: number }
  | { type: 'narration'; text: string }
  | { type: 'tool'; tool: string; args: Record<string, unknown> }
  | { type: 'toolResult'; tool: string; result: string }
  | { type: 'warn'; message: string }

/** 一次回合的产物 */
export interface TurnResult {
  /** 本回合的全部叙事（多步之间用空行连接） */
  text: string
  /** 每一步的工具执行结果，供调试与展示 */
  toolResults: string[]
  steps: number
  /** 供下一回合拼接的对话历史 */
  history: ChatMessage[]
}

export interface TurnOptions {
  /** 玩家输入；不传表示开新游戏 */
  action?: string
  history?: ChatMessage[]
  signal?: AbortSignal
  onEvent?: (evt: AgentEvent) => void
}

/**
 * 拼装发给模型的消息列表。
 * system 消息交给 prompts.buildSystemPrompt —— 因为历法说明是动态的
 * （玩家用哪套历法，说明就不同），不便在这里写死。
 */
function buildMessages(
  state: GameState,
  history: ChatMessage[],
  userContent: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(state, history) },
  ]

  // 最近几轮对话，提供连贯性
  for (const h of history.slice(-6)) {
    messages.push(h)
  }

  messages.push({ role: 'user', content: userContent })
  return messages
}

/**
 * 一整个回合一个字都没写时，强制再要一次叙事。
 *
 * 实测会发生的真实情况：模型把步数全花在调用工具上，一次叙事都没输出，
 * 玩家看到的是一片空白。所以这里明确禁止它继续调工具，只能写文字。
 */
async function 补写叙事(
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  onEvent: (evt: AgentEvent) => void,
): Promise<string | null> {
  onEvent({ type: 'warn', message: '这一回合没有产生叙事文字，正在要求 GM 补写…' })
  messages.push({
    role: 'user',
    content:
      '你刚才只调用了工具，没有输出任何叙事文字，玩家现在看到的是一片空白。\n\n' +
      '请**只写叙事**，不要再调用任何工具。\n' +
      '基于已经发生的事，把这个场景写给玩家看：他身处何处、看到什么、' +
      '听到什么、有什么处境。两到三段。',
  })

  const forced = await chat(messages, { signal })
  const text = parseToolCalls(forced).clean || forced.trim()
  if (!text) {
    onEvent({ type: 'warn', message: 'GM 依然没有输出文字' })
    return null
  }
  onEvent({ type: 'narration', text })
  return text
}

/** 跑一个回合 */
export async function runTurn(state: GameState, opts: TurnOptions = {}): Promise<TurnResult> {
  const { action, history = [], signal, onEvent = () => {} } = opts
  const cfg = loadConfig()
  const maxSteps = Math.max(1, cfg.maxAgentSteps || 8)

  const userContent = action
    ? `玩家的行动：${action}`
    : `【游戏开始】\n${OPENING_INSTRUCTION}`

  // 先把玩家的行动记入日志。
  // 必须在拼装消息之前做 —— snapshot() 会读日志，这样模型就能看到
  // 玩家刚说了什么（而不是只看到一堆历史数值）。
  state.addLog(action ? 'action' : 'system', action || '（新的冒险开始了）')

  const messages = buildMessages(state, history, userContent)

  const toolResults: string[] = []
  const narrations: string[] = []
  let stepCount = 0

  // ---------- agent 循环 ----------
  while (stepCount < maxSteps) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    stepCount += 1

    onEvent({ type: 'thinking', step: stepCount })

    const reply = await chat(messages, { signal })

    const { blocks, clean, errors } = parseToolCalls(reply)

    // 把原始回复透出去，供调试模式查看。
    // 排查「模型为什么不按格式输出」时，这是唯一的一手证据。
    onEvent({
      type: 'raw',
      text: reply,
      blocks: blocks.length,
      narrationLength: clean.length,
      replyLength: reply.length,
    })

    // 模型只调工具、不写叙事时提示一句。
    // 这不该发生（提示词要求先叙事），但模型有时候会偷懒。
    if (!clean && blocks.length > 0) {
      onEvent({ type: 'warn', message: `模型这一步只调用了工具，没有写叙事文字（第 ${stepCount} 步）` })
    }

    for (const e of errors) {
      console.warn('[工具解析]', e)
      onEvent({ type: 'warn', message: e })
    }

    if (clean) {
      narrations.push(clean)
      onEvent({ type: 'narration', text: clean })
    }

    // 没有工具调用 → 这一回合说完了
    if (blocks.length === 0) {
      // 让最后一步的叙事留在历史里，供下一回合参考
      messages.push({ role: 'assistant', content: reply })
      break
    }

    // 把模型这一轮的输出记入对话
    messages.push({ role: 'assistant', content: reply })

    // 逐个执行工具（顺序执行，保证「先掷骰再叙事」这类依赖成立）
    const resultLines: string[] = []
    for (const call of blocks) {
      onEvent({ type: 'tool', tool: call.tool, args: call.args })

      const result = runTool(state, call.tool, call.args)
      toolResults.push(`[${call.tool}] ${result}`)
      resultLines.push(`### ${call.tool}\n${result}`)

      onEvent({ type: 'toolResult', tool: call.tool, result })
    }

    // 把真实执行结果回传给模型，让它据此继续写
    messages.push({
      role: 'user',
      content:
        `以下是工具的实际执行结果（这是真实数据，请以此为准继续叙事）：\n\n` +
        resultLines.join('\n\n') +
        `\n\n请继续描写接下来发生的事。如果还有需要改变的状态，继续调用工具；` +
        `如果本回合已经写完，就不要再输出工具块。`,
    })
  }

  // 步数用尽
  if (stepCount >= maxSteps && toolResults.length > 0) {
    onEvent({ type: 'warn', message: `达到步数上限（${maxSteps}），本回合结束` })
  }

  if (!narrations.length) {
    const extra = await 补写叙事(messages, signal, onEvent)
    if (extra) narrations.push(extra)
  }

  // 把本回合的叙事写进日志，供刷新后恢复。
  // 没有这一步的话，存档只有数值、没有故事 —— 刷新页面就只剩一个裸的状态栏。
  if (narrations.length) {
    state.addLog('narration', narrations.join('\n\n'))
  }

  // 记录回合数并落盘
  state.endTurn()
  if (!state.save()) {
    onEvent({ type: 'warn', message: '存档写入失败（可能是隐私模式或空间已满）—— 这一回合的进度重启后会丢失' })
  }

  // 维护对话历史（供下一回合拼接）
  const appended: ChatMessage[] = [
    { role: 'user', content: userContent },
    { role: 'assistant', content: narrations.join('\n\n') },
  ]
  const newHistory: ChatMessage[] = [...history.slice(-6), ...appended].slice(-8)

  return {
    text: narrations.join('\n\n'),
    toolResults,
    steps: stepCount,
    history: newHistory,
  }
}
