/**
 * src/agent/agent.ts —— agent 循环：玩家输入 → 拼装提示词 → 问模型（带 tools 声明）→
 * 模型写故事收尾，或在协议层要求调用工具 → 引擎执行工具改状态 → 把结构化结果回传 →
 * 重复直到模型不再调工具，或达到步数上限。
 *
 * 关键点：
 *   - **引擎持有一切事实**。模型只能申请，不能直接改。
 *   - **禁止解析模型输出**（用户 2026-09-14 明确要求）：工具调用走 OpenAI 兼容的
 *     原生 `tools` 协议，我们不猜它写在文字里的 JSON。
 *   - **出错就回传，让模型自己改**：参数不合法、单位不认识、时间倒退都作为工具结果
 *     回传，引擎只拦「绝不能发生」的事，不做静默纠正。
 *   - **步数有上限**，防止模型陷入死循环把 API 额度烧光。
 *   - **一轮 = 执行一张图**（src/agent/graph.ts，决定 #25/#37）：默认图只有一个节点，
 *     那唯一的节点就是下面这个循环；卡里的九个节点、卡到图的翻译都还没接。
 */

import { t } from '../i18n'
import { executeGraph, type Graph } from './graph'
import { chat } from './llm'
import { runTool, toolSchemas } from './tools'
import {
  buildSystemPrompt,
  openingInstruction,
  forcedNarrationInstruction,
  toolCallsWithoutNarration,
} from './prompts'
import { loadConfig } from './config'
import type { ChatMessage, StoryKind } from '../types/state'
import type { GameState } from '../game/state'
import type { ChatReply, ToolCallRequest, ToolSchema } from './llm'

/**
 * 引擎干活需要的东西：**纯数据** + 几个领域动作。
 *
 * ⚠️ 故意不接「类」也不接存储：
 *   · state 是纯数据（game/state.ts 的 GameState），工具要改它（advanceTime）
 *   · 三个动作由调用方注入 —— 引擎不知道叙事流怎么存、更不知道存档怎么写
 * 这样同一个引擎既能在界面里跑（响应式代理 + 真 localStorage），
 * 也能在脚本里跑（手写数据 + 假存储）。
 */
export interface AgentContext {
  state: GameState
  /** 把故事写进事件流（引擎只写故事类；调试痕迹由界面侧写） */
  addEvent: (kind: StoryKind, text: string) => void
  /** 回合 +1 */
  endTurn: () => void
  /** 世界状态快照，拼提示词用 */
  snapshot: (history: ChatMessage[]) => string
}

/** agent 循环里抛给界面的事件（界面据此实时渲染） */
export type AgentEvent =
  /** 图执行器进入了哪个节点（进度的来源；写不写成痕迹由界面侧决定，见决定 #38） */
  | { type: 'node'; id: string }
  | { type: 'thinking'; step: number }
  /** 模型这一步的输入与输出（调试模式展示用；输入是实际发出去的请求体） */
  | { type: 'model'; step: number; reply: ChatReply }
  | { type: 'narration'; text: string }
  | { type: 'tool'; tool: string; args: string }
  | { type: 'toolResult'; tool: string; result: string }
  | { type: 'warn'; message: string }

interface TurnResult {
  /** 本回合的全部叙事（多步之间用空行连接） */
  text: string
  /** 每一步的工具执行结果，供调试与展示 */
  toolResults: string[]
  steps: number
  /** 供下一回合拼接的对话历史 */
  history: ChatMessage[]
}

interface TurnOptions {
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
 * system 消息交给 prompts.buildSystemPrompt —— 历法说明是动态的，不便在这里写死。
 */
function buildMessages(ctx: AgentContext, history: ChatMessage[], userContent: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(ctx, history) }]

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
 * 用带 type 的联合而不是布尔，避免「有没有工具调用」这类模糊判断。
 */
type StepOutcome =
  { kind: 'done'; narration: string } | { kind: 'tools'; narration: string; calls: ToolCallRequest[] }

/** 跑一个回合：执行一张只有一个节点的图，那唯一的节点就是 agent 循环（决定 #25/#37） */
export async function runTurn(ctx: AgentContext, opts: TurnOptions = {}): Promise<TurnResult> {
  const { action, history = [], signal, onEvent = () => {}, tools = toolSchemas() } = opts
  const cfg = loadConfig()
  const maxSteps = Math.max(1, cfg.maxAgentSteps || 8)

  const userContent = action
    ? t('agent.playerAction', { action })
    : t('agent.gameStart', { instruction: openingInstruction() })

  // 先把玩家的行动记入日志。
  // 必须在拼装消息之前做 —— snapshot() 会读日志，这样模型就能看到
  // 玩家刚说了什么（而不是只看到一堆历史数值）。
  ctx.addEvent(action ? 'action' : 'system', action || t('agent.newAdventure'))

  const messages = buildMessages(ctx, history, userContent)
  const toolResults: string[] = []
  const narrations: string[] = []
  let stepCount = 0

  /**
   * 收下一段叙事。
   *
   * ⚠️ 写日志与「通知界面」是同一件事的两面：界面渲染的故事就是日志的投影，
   *    所以叙事一产生就得进日志（不然要等回合结束才看得见），
   *    也没有第二个数组需要同步。
   */
  function record(text: string) {
    narrations.push(text)
    ctx.addEvent('narration', text)
    onEvent({ type: 'narration', text })
  }

  /**
   * 默认图 = 1 个节点：这唯一的节点就是整个 agent 循环，产出是本回合的叙事正文。
   * 将来接卡里的九个节点时，节点各自产出短 JSON，由执行器按顺序累加进上游。
   *
   * ⚠️ 执行器的 node 事件**原样转发**给调用方（决定 #38）：引擎不认识调试模式，
   *    也不该认识 —— 「谁能看到」由界面侧的投影决定（决定 #22）。它只是瞬态的进度，
   *    不写日志、不改状态：调试关掉时，事件流与玩家看到的东西一个字节都不变。
   */
  const graph: Graph = {
    nodes: [
      {
        id: 'agent-loop',
        /** 这唯一的节点：跑完整的 agent 循环，产出本回合的叙事正文 */
        run: async ({ signal: turnSignal }) => {
          while (stepCount < maxSteps) {
            if (turnSignal?.aborted) throw new DOMException('aborted', 'AbortError')
            stepCount += 1
            onEvent({ type: 'thinking', step: stepCount })

            const reply = await chat(messages, { signal: turnSignal, tools })
            onEvent({ type: 'model', step: stepCount, reply })

            const outcome = classifyStep(reply, onEvent, stepCount)
            if (outcome.narration) record(outcome.narration)
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
              const result = executeToolCall(ctx.state, call, onEvent)
              toolResults.push(`[${call.name}] ${result}`)
              // 工具结果必须以 role:'tool' + tool_call_id 回传，模型才能对应上
              messages.push({ role: 'tool', tool_call_id: call.id, content: result })
            }
          }

          if (stepCount >= maxSteps && toolResults.length > 0) {
            onEvent({ type: 'warn', message: t('agent.stepLimit', { max: maxSteps }) })
          }

          // ---------- 兜底：一整个回合一个字都没写 ----------
          // 实测会发生的真实情况：模型把步数全花在调用工具上，一次叙事都没输出，
          // 玩家看到的是一片空白。所以这里强制再要一次 —— **不给它工具**，
          // 它就只能写文字（协议层面保证，而不是靠提示词请求它自觉）。
          if (!narrations.length) {
            const text = await forceNarration(messages, turnSignal, onEvent)
            if (text) record(text)
          }

          ctx.endTurn()
          return narrations.join('\n\n')
        },
      },
    ],
  }

  await executeGraph(graph, { signal, onEvent })

  const text = narrations.join('\n\n')
  const appended: ChatMessage[] = [
    { role: 'user', content: userContent },
    { role: 'assistant', content: text },
  ]
  const newHistory: ChatMessage[] = [...history.slice(-6), ...appended].slice(-8)

  return { text, toolResults, steps: stepCount, history: newHistory }
}

/** 判断模型这一步是「说完了」还是要调工具 */
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
      ? toolCallsWithoutNarration()
      : forcedNarrationInstruction(),
  })

  const reply = await chat(messages, { signal }) // 不传 tools
  const text = reply.content.trim()
  if (!text) {
    onEvent({ type: 'warn', message: t('agent.stillNoText') })
    return null
  }
  return text
}
