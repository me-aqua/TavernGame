/**
 * 测试用的假 LLM。
 *
 * agent 循环与网络层都依赖 fetch，测试里必须能在**不联网**的情况下
 * 精确控制「模型返回什么」。
 *
 * ⚠️ 模型走**原生 tool calling**，所以假回复也只按协议形态给：
 *    `'一段叙事'`                        → 只写文字、不调工具
 *    `{ content, toolCalls: [...] }`     → 文字 + 协议层的工具调用
 * 没有「在文字里写 JSON 代码块」这种模拟。
 */
import type { ChatMessage } from '../../src/types/state'

/** 模型回复：字符串 = 纯文字；对象 = 带协议层工具调用 */
export type FakeReply =
  | string
  | {
      content?: string
      toolCalls?: Array<{ name: string; arguments?: string; id?: string }>
    }

export interface FakeCall {
  url: string
  headers: Record<string, string>
  body: {
    model?: string
    messages?: ChatMessage[]
    tools?: unknown[]
    tool_choice?: string
  }
}

export interface FakeLlm {
  /** 每次调用记录下来的请求详情（断言用） */
  calls: FakeCall[]
  /** 让下一次调用抛出指定错误 */
  failNextWith(err: Error): void
  restore(): void
}

/** 造一个假 fetch：按 replies 顺序返回模型回复 */
export function installFakeLlm(replies: FakeReply[]): FakeLlm {
  const original = globalThis.fetch
  const calls: FakeCall[] = []
  const failures: Array<Error | null> = []
  let i = 0

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = JSON.parse(String(init?.body ?? '{}')) as FakeCall['body']
    calls.push({ url, headers, body })

    const err = failures.shift()
    if (err) throw err

    const reply = replies[Math.min(i, replies.length - 1)]
    i += 1

    const message =
      typeof reply === 'string'
        ? { content: reply }
        : {
            content: reply.content ?? '',
            tool_calls: (reply.toolCalls ?? []).map((c, n) => ({
              id: c.id ?? `call_${n}`,
              type: 'function',
              function: { name: c.name, arguments: c.arguments ?? '{}' },
            })),
          }

    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  return {
    calls,
    /** 让下一次请求以这个错误失败 */
    failNextWith(err) {
      failures.push(err)
    },
    /** 还原真实的 fetch（afterEach 必须调用） */
    restore() {
      globalThis.fetch = original
    },
  }
}

/** 造一个非 2xx 的假响应（测错误分支） */
export function installFakeLlmError(status: number, body: string): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(body, { status, statusText: 'Error' })) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}
