/**
 * mock 提供方（CONTRACT §7）—— 测试替身，**不发任何网络请求**。
 *
 * 为什么要有它：验收要在没有 Key、没有网络的机器上跑出「三回合流式 + 可中止 + 眼睛生效」。
 * 它走的是和真 provider **同一条**代码路径（chunk -> narration），不是另一条捷径 ——
 * 否则测试绿了、真路还是坏的。
 *
 * **工具调用跟真模型一样按 `writable` 覆盖到的值派生**（`toolsForNode`）：覆盖到时间就推进时间，
 * 覆盖到文字就写第一个文字值路径。节点类型只决定它吐不吐故事正文（只有 `output` 吐）。
 *
 * 输出格式是逐字可断言的（`[mock] turn 2: act two`），单测与 e2e 都靠它。
 */
import { elementOfPath, toolsForNode } from './schema'
import { pathsOf } from './statetree'
import type { Card, ChainNode, ProviderReply, ProviderToolCall } from './types'

/**
 * 把正文切成若干块：**每块 ≤8 字符、至少 3 块**。
 *
 * 块长取 `floor(len/6)`（夹到 1..8）：一句话就切成六到八块 —— 这样给 `mockChunkDelayMs`
 * 一个非零值时，「一段一段长出来」在界面上真的看得见（块太少的话几十毫秒就跑完了）。
 */
function chunksOf(text: string): string[] {
  if (text === '') return []
  const size = Math.max(1, Math.min(8, Math.floor(text.length / 6)))
  const chunks: string[] = []
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size))
  return chunks
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface MockArgs {
  card: Card
  node: ChainNode
  /** 本回合的回合号（从 1 开始） */
  turn: number
  action: string
  /** 只有 output 节点会拿到它 */
  onChunk?: (text: string) => void
  signal?: AbortSignal
  /** 块与块之间等多久（缺省 0） */
  delayMs?: number
}

// mock 的一节点响应：工具调用按 writable 覆盖到的值派生，output 节点边切块边回调
export async function mockReply({
  card,
  node,
  turn,
  action,
  onChunk,
  signal,
  delayMs = 0,
}: MockArgs): Promise<ProviderReply> {
  const tools = toolsForNode(card, node)
  const toolCalls: ProviderToolCall[] = []
  const time = card.state[0]
  if (tools.includes('advance_time') && time?.type === 'time') {
    // 每次推一天：`day` 在三种模式的单位表里都有，所以三种模式都发得出合法调用
    toolCalls.push({ name: 'advance_time', args: { amount: 1, unit: 'day' } })
  }
  // 一次只写一个值（测试要能断言写的是哪一个）：取 writable 覆盖到的第一个**文字**值路径
  const writePath = node.writable
    .flatMap((ref) => pathsOf(card.state, ref))
    .find((path) => elementOfPath(card.state, path)?.type === 'text')
  if (tools.includes('write_state') && writePath !== undefined) {
    toolCalls.push({ name: 'write_state', args: { path: writePath, value: `mock-t${turn}` } })
  }

  if (node.type !== 'output') return { text: '', reasoning: '', toolCalls, usage: null }

  const text = `[mock] turn ${turn}: ${action}`
  if (!onChunk) return { text, reasoning: '', toolCalls, usage: null }
  for (const [index, chunk] of chunksOf(text).entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs)
    if (signal?.aborted) break
    onChunk(chunk)
  }
  return { text, reasoning: '', toolCalls, usage: null }
}
