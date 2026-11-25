/**
 * mock 提供方（CONTRACT §7）—— 测试替身，**不发任何网络请求**。
 *
 * 为什么要有它：阶段 1 的验收要在没有 Key、没有网络的机器上跑出「三回合流式 + 可中止 +
 * 眼睛生效」。它走的是和真 provider **同一条**代码路径（chunk -> narration），
 * 不是另一条捷径 —— 否则测试绿了、真路还是坏的。
 *
 * 输出格式是逐字可断言的（`[mock] turn 2: act two`），单测与 e2e 都靠它。
 */
import type { ChainNode, ProviderReply } from './types'

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

// mock 的一节点响应：按节点类型回确定的文本与工具调用，output 边切块边回调
export async function mockReply({
  node,
  turn,
  action,
  onChunk,
  signal,
  delayMs = 0,
}: MockArgs): Promise<ProviderReply> {
  if (node.type === 'time') {
    return { text: '', toolCalls: [{ name: 'advance_time', args: { hours: 1 } }], usage: null }
  }
  if (node.type === 'normal') {
    if (node.writable.length === 0) return { text: '', toolCalls: [], usage: null }
    return {
      text: '',
      toolCalls: [{ name: 'write_state', args: { path: node.writable[0], value: `mock-t${turn}` } }],
      usage: null,
    }
  }
  if (node.type === 'proof') {
    return { text: `[mock] proof turn ${turn} ok`, toolCalls: [], usage: null }
  }

  const text = `[mock] turn ${turn}: ${action}`
  if (!onChunk) return { text, toolCalls: [], usage: null }
  for (const [index, chunk] of chunksOf(text).entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs)
    if (signal?.aborted) break
    onChunk(chunk)
  }
  return { text, toolCalls: [], usage: null }
}
