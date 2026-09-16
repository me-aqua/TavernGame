/**
 * 测试用的假 LLM。
 *
 * agent 循环与网络层都依赖 fetch，测试里必须能在**不联网**的情况下
 * 精确控制「模型返回什么」。
 *
 * ⚠️ 模型走**原生 tool calling**，所以假回复也只按协议形态给：
 *    `'一段叙事'`                        → 只写文字、不调工具
 *    `{ content, toolCalls: [...] }`     → 文字 + 协议层的工具调用
 *    `{ body }`（Envelope）              → 整份响应体逐字照发，字段一个不动
 * 没有「在文字里写 JSON 代码块」这种模拟。
 */
import type { ChatMessage } from '../../src/types/state'

/**
 * 模型回复。
 *
 * - 字符串 = 纯文字
 * - `{ content, toolCalls }` = 文字 + 协议层的工具调用
 * - `Envelope` = **整份响应体逐字照发**：要断言的是「响应形状本身」时用它
 *   （例如 `reasoning_content` 与空 `content` 并存）——
 *   上面那种简化形状表达不了「某个键不存在」，而**空着的东西和不存在的东西是两回事**
 */
export type FakeReply =
  | string
  | { content?: string; toolCalls?: Array<{ name: string; arguments?: string; id?: string }> }
  | Envelope

/** 逐字照发的响应体：字段的有无与嵌套形状都由调用方给全 */
export interface Envelope {
  status?: number
  headers?: Record<string, string>
  body: Record<string, unknown>
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

    // 逐字照发的信封：调用方给什么就回什么，一个键不加。
    // ⚠️ `typeof` 守卫不能少：`in` 对字符串（纯文字回复）会抛 TypeError，
    //    而纯文字回复是 FakeReply 里最常用的一种。
    if (typeof reply === 'object' && 'body' in reply) {
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...reply.headers },
      })
    }

    const message = chatMessage(reply)
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  return {
    calls,
    failNextWith(err) {
      failures.push(err)
    },
    /** 还原真实的 fetch（afterEach 必须调用） */
    restore() {
      globalThis.fetch = original
    },
  }
}

/**
 * 把简化的假回复拼成协议层的 message。
 *
 * `tool_calls` 只在工具调用非空时出现 —— 协议里它本就是可选字段，
 * 空数组会让「这条 assistant 消息带了什么」的断言失去判别力。
 */
function chatMessage(
  reply: string | { content?: string; toolCalls?: Array<{ name: string; arguments?: string; id?: string }> },
): Record<string, unknown> {
  if (typeof reply === 'string') return { content: reply }

  const message: Record<string, unknown> = { content: reply.content ?? '' }
  const toolCalls = reply.toolCalls ?? []
  if (toolCalls.length) {
    message.tool_calls = toolCalls.map((call, n) => ({
      id: call.id ?? `call_${n}`,
      type: 'function',
      function: { name: call.name, arguments: call.arguments ?? '{}' },
    }))
  }
  return message
}

/**
 * 假模型：前 replies.length 次调用按 replies 返回，之后交给 after。
 *
 * 用来制造「第一步已经改了状态、第二步才失败 / 挂起」——事务的中途失败与取消
 * 只有在这种局面下才走得到（replies 列表本身给不出「按序失败」与「挂住」）。
 *
 * @param after 第 replies.length + 1 次调用起由它接管：要么抛错，要么挂到被 abort
 * @returns 与 installFakeLlm 相同的句柄；restore() 会把整条链一起还原
 */
export function installFakeLlmThen(
  replies: FakeReply[],
  after: (init?: RequestInit) => Promise<Response>,
): FakeLlm {
  const fake = installFakeLlm(replies)
  const first = globalThis.fetch
  let used = 0
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    used += 1
    return used <= replies.length ? first(input, init) : after(init)
  }) as typeof fetch
  return fake
}

/** 造一个非 2xx 的假响应（测错误分支） */
export function installFakeLlmError(status: number, body: string): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(body, { status, statusText: 'Error' })) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}
