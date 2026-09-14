/**
 * 测试用的假 LLM。
 *
 * agent 循环与网络层都依赖 fetch，测试里必须能在**不联网**的情况下
 * 精确控制「模型返回什么」。这里把 fetch 换成按调用次序取回复的假实现。
 */
import type { ChatMessage } from '../../src/types/state'

export interface FakeCall {
  url: string
  headers: Record<string, string>
  body: { model?: string; messages?: ChatMessage[] }
}

export interface FakeLlm {
  /** 每次调用记录下来的请求详情（断言用） */
  calls: FakeCall[]
  /** 让第 n 次调用抛出网络错误 */
  failNextWith(err: Error): void
  restore(): void
}

/** 造一个假 fetch：按 replies 顺序返回模型回复 */
export function installFakeLlm(replies: string[]): FakeLlm {
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

    const content = replies[Math.min(i, replies.length - 1)] ?? ''
    i += 1
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  return {
    calls,
    failNextWith(err) {
      failures.push(err)
    },
    restore() {
      globalThis.fetch = original
    },
  }
}

/** 造一个非 2xx 的假响应（测错误分支） */
export function installFakeLlmError(status: number, body: string): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(body, { status, statusText: 'Error' })) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}
