/**
 * src/agent/card-graph.ts —— 照卡里的图跑一轮：拓扑顺序、每个节点一段带工具的模型循环、
 * 上游 = 拓扑前缀（决定 #26）、redo 的部分回滚与重跑（决定 #45 那一组里的第 4.1 节）。
 *
 * ## 大原则：模型只能申请，不能直接改状态（决定 #46）
 *
 * 引擎要做的任何动作（推进时间、换地点、改状态……）只能来自模型的**原生工具调用**，
 * 工具表由卡的 actions 推导（game/card-actions.ts）。**绝不解析模型的文字**：
 * 文字只有两个用途 —— ① 当上游上下文 ② role: "story" 节点的文字就是本回合叙事。
 * 引擎**不认识卡里任何一个节点 id**：哪个节点管叙事由卡里的 role 说，哪个节点能用
 * 哪些工具由节点的 tools 白名单说。
 *
 * ## 快照与退回重来
 *
 * 每个节点**开跑之前**给工作副本（状态树 + 时间）拍一张快照。某个节点调用 redo 时：
 *   1. 把工作副本恢复到 from **开跑前**那张快照 —— 同时撤销 from、它之后的节点、
 *      以及调用者自己写下的东西；
 *   2. 把「哪里不对、谁要求重来」作为一条系统提示交给重跑的那个节点；
 *   3. 从 from 起照拓扑重跑到末尾；
 *   4. 一轮最多退回 MAX_REDO 次 —— 超过就整轮抛错（否则两个节点能互相退回把额度烧光）。
 *
 * ⚠️ 快照必须深拷（structuredClone）：工具是**原地改**状态树的，存引用等于没拍。
 * ⚠️ 调试痕迹（事件流）不属于工作副本，不参与回滚 —— 它记录的是发生过的事。
 */

import { chat } from './llm'
import { buildNodeMessages, type UpstreamOutput } from './prompts'
import { runAction, toolSchemas } from '../game/card-actions'
import { advanceTime } from '../game/state'
import { t } from '../i18n'
import type { CardData } from '../game/card'
import type { StateTree } from '../game/card-state'
import type { TimeValue } from '../game/card-calendar'
import type { GameData } from '../types/state'
import type { AgentEvent } from './agent'

/**
 * 一个节点内最多问模型几轮（工具往返也算一轮）。
 *
 * ⚠️ 上限的用途是**防呆**：模型可能拿工具当玩具 —— 反复用同一个参数调 advance_time，
 *    或者「我再确认一下」个没完。没有上限，一个节点就能把 API 额度烧光。
 * 3 = 一次正常调用 + 一次参数写错后的重试 + 一次富余；到顶还没写出文字就是这一轮失败。
 */
export const MAX_TOOL_ROUNDS = 3

/** 一轮里最多退回重来几次 —— 没有这个上限，两个节点可以互相退回把额度烧光 */
export const MAX_REDO = 2

/** 一个节点开跑前的那张快照：状态树 + 时间 */
interface Snapshot {
  state: StateTree
  time: TimeValue
}

/** 一个节点的产出：写出文字，或申请退回重来 */
type NodeOutcome = { kind: 'text'; text: string } | { kind: 'redo'; from: string; why: string }

/** 跑一轮要的东西 */
export interface CardGraphInput {
  card: CardData
  /** 这一轮的**工作副本**：工具改的就是它；提交与回滚由组合根负责 */
  data: GameData
  /**
   * 「最近发生的事」的分界：这一轮开始时事件流的长度。
   *
   * 本轮的事件（action）写在跑图之前，事件流顺序正确，但它不进历史那一段
   * （本轮原话在「## 玩家」里，重复一次会让模型以为玩家说了两遍）。
   */
  memoryUpTo: number
  /** 玩家这一轮的原话；开场时是引擎的开场指令 + 卡里的开局要求 */
  playerWords: string
  signal?: AbortSignal
  onEvent?: (evt: AgentEvent) => void
}

/** 拷一张「状态树 + 时间」的快照（工具原地改状态树，存引用等于没拍） */
function snapshotOf(data: GameData): Snapshot {
  return { state: structuredClone(data.state), time: { ...data.time } }
}

/** 拓扑前缀的产出（按拓扑顺序，跳过还没有产出的节点）—— 上游 = 已经跑完的那些 */
function upstreamOf(card: CardData, outputs: string[], index: number): UpstreamOutput[] {
  const topology = card.graph.topology
  const upstream: UpstreamOutput[] = []
  for (let i = 0; i < index; i += 1) {
    const output = outputs[i]
    if (!output) continue
    upstream.push({ node: card.graph.nodes[topology[i]].name, output })
  }
  return upstream
}

/**
 * 照卡里的图跑一轮，返回拓扑各节点的产出（顺序 = 拓扑；被退回重跑过就是**最后一次**的结果）。
 *
 * 每个节点一段模型循环：带工具问 → 执行 → 回传 → 再问；**没有工具调用的那一次的文字**
 * 就是这个节点的产出（trim 后进上游）。
 */
export async function runCardGraph(input: CardGraphInput): Promise<string[]> {
  const { card, data } = input
  const topology = card.graph.topology
  const outputs: string[] = []
  /** 每个节点**开跑前**的快照（redo 回到 from 的那一张） */
  const snapshots = new Map<number, Snapshot>()
  /** 重跑节点要看到的系统提示（只对 from 那一次生效，用完即丢） */
  const hints = new Map<number, string>()
  /** 整张图的模型调用计数（工具往返也算一次）—— request / model 事件的 step 用它 */
  let calls = 0
  let redos = 0
  let index = 0

  /** 一个节点的一段模型循环：问模型 → 执行工具 → 回传 → 问到它写出文字（或申请退回重来） */
  async function runNode(id: string, upstream: UpstreamOutput[], hint?: string): Promise<NodeOutcome> {
    const messages = buildNodeMessages({
      card,
      node: id,
      state: data.state,
      time: data.time,
      // 每个节点请求前重新取一次事件流：模型记忆就在它这一轮之前的部分（刷新后仍在）
      events: data.events,
      memoryUpTo: input.memoryUpTo,
      playerWords: input.playerWords,
      upstream,
      hint,
    })

    for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
      if (input.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      calls += 1
      const step = calls
      input.onEvent?.({ type: 'thinking', step })
      const reply = await chat(messages, {
        signal: input.signal,
        tools: toolSchemas(card, id),
        // 请求体在发出去之前就报一次：这样调用失败（401 / 500 / 断网）时
        // 调试痕迹里也能看到我们到底发了什么
        onRequest: (body) => input.onEvent?.({ type: 'request', step, body }),
      })
      input.onEvent?.({ type: 'model', step, reply })

      // 没有工具调用 = 这个节点说完了：它的文字就是产出（不解析、不改写）
      if (!reply.toolCalls.length) return { kind: 'text', text: reply.content.trim() }

      // 只调工具、一个字都没写：提示一句，继续问（模型有时会偷懒）
      if (!reply.content.trim()) {
        input.onEvent?.({ type: 'warn', message: t('agent.toolsOnly', { step }) })
      }

      // 协议要求：先把模型这一步原样记进对话（id / name / arguments 一字不差），
      // 再把每个工具的结果以 role:'tool' 回传 —— 模型靠 tool_call_id 对上号。
      messages.push({
        role: 'assistant',
        content: reply.content,
        tool_calls: reply.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      })
      for (const call of reply.toolCalls) {
        input.onEvent?.({ type: 'tool', node: id, tool: call.name, args: call.arguments })
        // 参数不是合法 JSON 对象：把 llm.ts 给的结构化错误原样回传，让它自己改
        if (!call.args.ok) {
          input.onEvent?.({ type: 'toolResult', node: id, tool: call.name, result: call.args.message })
          messages.push({ role: 'tool', tool_call_id: call.id, content: call.args.message })
          continue
        }

        const outcome = runAction(card, data.state, call.name, call.args.value, id)
        // 校验不过**不抛错**：把结构化错误当工具结果回传，让模型自己改（决定 #46）
        if (!outcome.ok) {
          input.onEvent?.({ type: 'toolResult', node: id, tool: call.name, result: outcome.error })
          messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.error })
          continue
        }

        if (outcome.kind === 'redo') {
          const result = t('agent.redoAccepted', {
            node: card.graph.nodes[outcome.from].name,
            why: outcome.why,
          })
          input.onEvent?.({ type: 'toolResult', node: id, tool: call.name, result })
          // 退回重来：这个节点这一步就到此为止（这条对话与剩下的工具调用一起作废，
          // 调用方会回滚并从 from 重跑）
          return { kind: 'redo', from: outcome.from, why: outcome.why }
        }

        if (outcome.kind === 'time') {
          // 时间由引擎按这张卡的历法推进（minutes = 0 合法）；结果文案原样回传给模型
          const result = advanceTime(data, card.time.calendar, outcome.minutes, outcome.reason)
          input.onEvent?.({ type: 'stateChange', node: id, path: 'time', value: { ...data.time } })
          input.onEvent?.({ type: 'toolResult', node: id, tool: call.name, result })
          messages.push({ role: 'tool', tool_call_id: call.id, content: result })
          continue
        }

        input.onEvent?.({
          type: 'stateChange',
          node: id,
          path: outcome.change.path,
          value: outcome.change.value,
        })
        input.onEvent?.({ type: 'toolResult', node: id, tool: call.name, result: outcome.result })
        messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.result })
      }
    }

    // 到顶还在调工具 = 这个节点一个字都没写出来：不静默收场（决定 #27）
    input.onEvent?.({ type: 'warn', message: t('agent.stepLimit', { max: MAX_TOOL_ROUNDS }) })
    throw new Error(t('agent.nodeStepLimit', { node: card.graph.nodes[id].name, max: MAX_TOOL_ROUNDS }))
  }

  while (index < topology.length) {
    const id = topology[index]
    // ⚠️ 快照必须在节点开跑**之前**拍：redo 要回到的就是这一刻
    snapshots.set(index, snapshotOf(data))
    input.onEvent?.({ type: 'node', id })

    const hint = hints.get(index)
    hints.delete(index)
    const outcome = await runNode(id, upstreamOf(card, outputs, index), hint)

    if (outcome.kind === 'text') {
      outputs[index] = outcome.text
      index += 1
      continue
    }

    const from = topology.indexOf(outcome.from)
    if (redos >= MAX_REDO) {
      throw new Error(t('agent.redoLimit', { node: card.graph.nodes[outcome.from].name, max: MAX_REDO }))
    }
    redos += 1
    input.onEvent?.({ type: 'redo', from: outcome.from, why: outcome.why })

    // 把工作副本恢复到 from 开跑前：撤销 from、它之后的一切、以及调用者自己写下的东西。
    // ⚠️ 恢复时再拷一份 —— 快照本身要留给「同一个节点再被退回一次」那种局面。
    const snapshot = snapshots.get(from) as Snapshot
    data.state = structuredClone(snapshot.state)
    data.time = { ...snapshot.time }
    // 「哪里不对、谁要求重来」只交给重跑的那个节点（下游从它的新产出里读结论）
    hints.set(from, t('agent.redoHint', { node: card.graph.nodes[id].name, why: outcome.why }))
    index = from
  }

  return outputs
}

/**
 * 本回合的叙事 = 声明了 role: "story" 的那个节点的文字（trim 后）。
 *
 * ⚠️ 引擎只做「取出来 + 剁掉首尾空白」：没有 JSON、没有围栏、没有要解析的字段
 *    （决定 #46）。一个字都没有就抛错（一轮没有正文就不该提交，决定 #27）。
 */
export function narrationOf(card: CardData, outputs: string[]): string {
  const topology = card.graph.topology
  const index = topology.findIndex((id) => card.graph.nodes[id].role === 'story')
  const text = (outputs[index] ?? '').trim()
  if (!text) throw new Error(t('agent.noNarration', { node: card.graph.nodes[topology[index]].name }))
  return text
}
