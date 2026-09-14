/**
 * src/agent/agent.ts —— agent 循环（项目的灵魂）
 *
 * 一次「回合」的完整流程：
 *
 *   玩家输入 → 拼装提示词 → 问模型（带 tools 声明）
 *          → 模型要么写故事收尾，要么**在协议层**要求调用工具
 *          → 引擎执行工具、改状态 → 把**结构化结果**回传
 *          → 模型据此继续 → 重复直到它不再调工具，或达到步数上限 → 回合结束
 *
 * 关键点：
 *   - **引擎持有一切事实**。模型只能申请，不能直接改。
 *   - **禁止解析模型输出**（用户 2026-09-14 明确要求）：工具调用走
 *     OpenAI 兼容的原生 `tools` 协议，我们不猜它写在文字里的 JSON。
 *   - **出错就回传，让模型自己改**：参数不合法、单位不认识、时间倒退 ——
 *     这些都作为工具结果回传，模型有契约可依、可以重试正确的一次。
 *     引擎只拦「绝不能发生」的事，不做静默纠正。
 *   - **步数有上限**，防止模型陷入死循环把 API 额度烧光。
 *   - **可以中途取消**，玩家点了停止就真的停下。
 */

import { t } from '../i18n'
import { chat } from './llm'
import { runTool, toolSchemas } from './tools'
import {
  buildSystemPrompt,
  OPENING_INSTRUCTION,
  FORCED_NARRATION_INSTRUCTION,
  TOOL_CALLS_WITHOUT_NARRATION,
} from './prompts'
import { loadConfig } from './config'
import type { ChatMessage } from '../types/state'
import type { GameState } from '../game/GameState'
import type { ChatReply, ToolCallRequest, ToolSchema } from './llm'

/** agent 循环里抛给界面的事件（界面据此实时渲染） */
export type AgentEvent =
  | { type: 'thinking'; step: number }
  | { type: 'raw'; reply: ChatReply }
  | { type: 'narration'; text: string }
  | { type: 'tool'; tool: string; args: string }
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
  /** 覆盖可用工具；默认是项目唯一的 advance_time */
  tools?: ToolSchema[]
}

/**
 * 拼装发给模型的消息列表。
 * system 消息交给 prompts.buildSystemPrompt —— 因为历法说明是动态的
 * （玩家用哪套历法，说明就不同），不便在这里写死。
 */
function buildMessages(state: GameState, history: ChatMessage[], userContent: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(state, history) }]

  // 最近几轮对话，提供连贯性
  for (const h of history.slice(-6)) {
    messages.push(h)
  }
  messages.push({ role: 'user', content: userContent })
  return messages
}

/**
 * 执行一次模型要求的工具调用。
 * 参数是协议原样给的 JSON 字符串，所以 runTool 会处理「JSON 不合法」
 * 这类边界，并把错误文案作为结果返回 —— 模型据此重试。
 */
function executeToolCall(
  state: GameState,
  call: ToolCallRequest,
  onEvent: (evt: AgentEvent) => void,
): string {
  onEvent({ type: 'tool', tool: call.name, args: call.arguments })
  const result = runTool(state, call.name, call.arguments)
  onEvent({ type: 'toolResult', tool: call.name, result })
  return result
}

/**
 * 模型一步返回后的处理结果。
 * 用带 type 的联合而不是布尔，避免「有没有工具调用」这类模糊判断。
 */
type StepOutcome =
  { kind: 'done'; narration: string } | { kind: 'tools'; narration: string; calls: ToolCallRequest[] }

/**
 * 跑一个回合。
 */
export async function runTurn(state: GameState, opts: TurnOptions = {}): Promise<TurnResult> {
  const { action, history = [], signal, onEvent = () => {}, tools = toolSchemas() } = opts
  const cfg = loadConfig()
  const maxSteps = Math.max(1, cfg.maxAgentSteps || 8)

  const userContent = action
    ? t('agent.playerAction', { action })
    : t('agent.gameStart', { instruction: OPENING_INSTRUCTION })

  // 先把玩家的行动记入日志。
  // 必须在拼装消息之前做 —— snapshot() 会读日志，这样模型就能看到
  // 玩家刚说了什么（而不是只看到一堆历史数值）。
  state.addLog(action ? 'action' : 'system', action || t('agent.newAdventure'))

  const messages = buildMessages(state, history, userContent)
  const toolResults: string[] = []
  const narrations: string[] = []
  let stepCount = 0

  while (stepCount < maxSteps) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    stepCount += 1
    onEvent({ type: 'thinking', step: stepCount })

    const reply = await chat(messages, { signal, tools })
    onEvent({ type: 'raw', reply })

    const outcome = classifyStep(reply, onEvent, stepCount)
    if (outcome.narration) {
      narrations.push(outcome.narration)
      onEvent({ type: 'narration', text: outcome.narration })
    }
    if (outcome.kind === 'done') break

    // 模型这一步要求调工具：先把它自己的输出记进对话（协议要求），
    // 再逐个执行、把结构化结果回传。
    messages.push({
      role: 'assistant',
      content: reply.content,
      // 原样回传模型给的 tool_calls（协议要求 id 与 name 一字不差）
      tool_calls: reply.toolCalls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.arguments },
      })),
    })

    for (const call of outcome.calls) {
      const result = executeToolCall(state, call, onEvent)
      toolResults.push(`[${call.name}] ${result}`)
      // 工具结果必须以 role:'tool' + tool_call_id 回传，模型才能对应上
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  // 步数用尽
  if (stepCount >= maxSteps && toolResults.length > 0) {
    onEvent({ type: 'warn', message: t('agent.stepLimit', { max: maxSteps }) })
  }

  // ---------- 兜底：一整个回合一个字都没写 ----------
  // 实测会发生的真实情况：模型把步数全花在调用工具上，一次叙事都没输出，
  // 玩家看到的是一片空白。所以这里强制再要一次 —— **不给它工具**，
  // 它就只能写文字（协议层面保证，而不是靠提示词请求它自觉）。
  if (!narrations.length) {
    const text = await forceNarration(messages, signal, onEvent)
    if (text) narrations.push(text)
  }

  // 把本回合的叙事写进日志，供刷新后恢复。
  // 没有这一步的话，存档只有数值、没有故事 —— 刷新页面就只剩一个裸的状态栏。
  if (narrations.length) {
    state.addLog('narration', narrations.join('\n\n'))
  }

  state.endTurn()
  if (!state.save()) {
    onEvent({ type: 'warn', message: t('agent.saveFailed') })
  }

  // 维护对话历史（供下一回合拼接）
  const appended: ChatMessage[] = [
    { role: 'user', content: userContent },
    { role: 'assistant', content: narrations.join('\n\n') },
  ]
  const newHistory: ChatMessage[] = [...history.slice(-6), ...appended].slice(-8)

  return { text: narrations.join('\n\n'), toolResults, steps: stepCount, history: newHistory }
}

/** 判断模型这一步是「说完了」还是「要调工具」，并顺手处理异常情况 */
function classifyStep(reply: ChatReply, onEvent: (evt: AgentEvent) => void, stepCount: number): StepOutcome {
  const narration = reply.content.trim()

  if (!reply.toolCalls.length) {
    return { kind: 'done', narration }
  }
  // 只调工具、不写叙事时提示一句（提示词要求先叙事，模型有时会偷懒）
  if (!narration) {
    onEvent({ type: 'warn', message: t('agent.toolsOnly', { step: stepCount }) })
  }
  return { kind: 'tools', narration, calls: reply.toolCalls }
}

/**
 * 强制模型补写叙事。
 *
 * ⚠️ 这一轮**不提供 tools** —— 协议层保证它无法再调工具，
 * 比在提示词里请求它「不要再调用工具」可靠得多。
 */
async function forceNarration(
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  onEvent: (evt: AgentEvent) => void,
): Promise<string | null> {
  onEvent({ type: 'warn', message: t('agent.forcingNarration') })
  messages.push({
    role: 'user',
    content: messages.some((m) => m.tool_call_id)
      ? TOOL_CALLS_WITHOUT_NARRATION
      : FORCED_NARRATION_INSTRUCTION,
  })

  const reply = await chat(messages, { signal }) // 不传 tools
  const text = reply.content.trim()
  if (!text) {
    onEvent({ type: 'warn', message: t('agent.stillNoText') })
    return null
  }
  onEvent({ type: 'narration', text })
  return text
}
