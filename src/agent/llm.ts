/**
 * src/agent/llm.ts —— 模型调用的**唯一入口**。
 *
 * 规则（用户 2026-09-14 定下、2026-09-15 重申的**大原则**）：
 *   1. **所有模型调用都经过这里的 chat()** —— 别处不允许直接 fetch
 *   2. **禁止解析模型输出**：引擎要做的动作只能来自**原生工具调用**（OpenAI 兼容的
 *      `tools` 协议），绝不去猜模型写在文字里的 JSON —— 模型写歪一点（少个反引号、
 *      参数写成中文）就整轮失败；原生 tool calling 把格式交给协议，出错时还能把
 *      结构化错误回传给它自己改。
 *
 * ⚠️ 这里是 src/agent/ 里**唯一**允许 JSON.parse 的地方（另一处是 config.ts 读
 *    localStorage）：解析的是 HTTP 响应体这个协议 JSON，不是模型的散文。
 *
 * 纯前端意味着请求直接从浏览器发往服务商；已实测主要服务商都返回 CORS 允许头。
 */

import { loadConfig, PRESETS } from './config'
import { t } from '../i18n'
import { connectionTestPrompt } from './prompts'
import type { ChatMessage } from '../types/state'

/** OpenAI 兼容的工具声明 */
export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/**
 * 一次工具调用的参数 —— 协议规定 `function.arguments` 是一个 JSON 字符串。
 *
 * ⚠️ 解析结果用带 ok 的联合而不是「可能为 null 的对象」：解析不出来时**不猜**，
 *    而是把结构化错误原样交给引擎回传给模型，让它自己改（原生 tool calling 的意义）。
 */
export type ToolArguments = { ok: true; value: Record<string, unknown> } | { ok: false; message: string }

/** 模型要求的一次工具调用 */
export interface ToolCallRequest {
  id: string
  name: string
  /** 参数字符串（协议原样；回传给模型的 assistant 消息必须一字不差） */
  arguments: string
  args: ToolArguments
}

/**
 * 实际发出去的请求体（OpenAI 兼容）。
 *
 * ⚠️ 只有这里拼得出来：模型名、温度、消息数组、工具声明都在这个函数里合成。
 *    调试模式要展示「模型原始输入」就得把它带出去 —— 在别处重拼一份 = 第二份真值。
 */
export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature: number
  stream: boolean
  tools?: ToolSchema[]
  tool_choice?: 'auto' | 'none' | 'required'
}

/** 一次模型回复：可能只有文字，也可能在协议层要求调工具 */
export interface ChatReply {
  /** 文字（可能为空 —— 模型这一步只调工具时就是这样） */
  content: string
  /** 模型要求调用的工具（可能为空数组） */
  toolCalls: ToolCallRequest[]
  request: ChatRequest
  /** 原始响应，供调试模式查看 */
  raw: unknown
}

interface ChatOptions {
  signal?: AbortSignal
  /** 声明可用工具；不传则模型不会调用任何工具 */
  tools?: ToolSchema[]
  /** 给模型看的服务商侧提示（一般不用） */
  toolChoice?: 'auto' | 'none' | 'required'
  /**
   * 请求**发出去之前**的回调：把真正要发的请求体交出去。
   *
   * ⚠️ 它是给调试用的：请求失败（网络断了 / 401 / 500）时没有响应可解析，
   *    只有这个回调能让人看见「发出去的到底是什么」。
   */
  onRequest?: (body: ChatRequest) => void
}

interface ApiErrorBody {
  error?: { message?: string }
  message?: string
}

/**
 * 解析一次工具调用的参数。
 *
 * ⚠️ 这是**协议字段**，不是模型的散文：解析器给出什么就是什么。
 *    不是合法 JSON 对象时返回给模型看的错误文案，绝不替它补一个默认值。
 */
function parseToolArguments(raw: string): ToolArguments {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || '{}')
  } catch (err) {
    return {
      ok: false,
      message: t('tools.invalidJson', { message: (err as Error).message, got: raw.slice(0, 120) }),
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: t('tools.notJsonObject', { got: raw.slice(0, 120) }) }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

/**
 * 调用对话接口。**这是项目里唯一发请求给模型的地方。**
 */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatReply> {
  const cfg = loadConfig()
  const preset = PRESETS[cfg.provider]

  // 配置校验：给出「该去做什么」而不是一句 undefined 报错。
  // 字段名用玩家看得懂的说法（"Missing configuration: base URL"），不用 apiBase 这类原始 key
  const missing: string[] = []
  if (!cfg.apiKey && !preset?.noKey) missing.push(t('llm.field.apiKey'))
  if (!cfg.apiBase || !String(cfg.apiBase).trim()) missing.push(t('llm.field.apiBase'))
  if (!cfg.model || !String(cfg.model).trim()) missing.push(t('llm.field.model'))
  if (missing.length) {
    throw new Error(t('llm.missingConfig', { items: missing.join(', ') }))
  }

  // 拼接请求地址：兼容用户填带不带 /v1 的情况
  const base = cfg.apiBase.replace(/\/+$/, '')
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`

  const body: ChatRequest = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    stream: false,
  }
  if (options.tools?.length) {
    body.tools = options.tools
    body.tool_choice = options.toolChoice ?? 'auto'
  }
  options.onRequest?.(body)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal ?? null,
    })
  } catch (err) {
    // 网络层失败最常见的原因就是 CORS —— 给一句能指导行动的提示
    if (err instanceof TypeError) {
      throw new Error(t('llm.requestFailed', { url }), { cause: err })
    }
    throw err
  }

  if (!res.ok) {
    // ⚠️ 顺序很重要：response body 只能读一次。
    // 先 res.json() 失败、再 res.text() 会抛「Body is unusable」，
    // 被 .catch 吞成空串 —— 于是网关返回 HTML 502 时，
    // 玩家只看到一行状态码、拿不到任何可用于排查的内容。
    const raw = await res.text()
    let detail = ''
    try {
      const parsed = JSON.parse(raw) as ApiErrorBody
      detail = parsed?.error?.message || parsed?.message || ''
    } catch {
      // 成功路径：网关返回 HTML 错误页（502 等）时本来就不是 JSON
    }
    throw new Error(
      t('llm.httpError', {
        status: res.status,
        statusText: res.statusText,
        detail: detail || raw.slice(0, 300),
      }),
    )
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown
        tool_calls?: Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }>
      }
    }>
  }
  const message = data?.choices?.[0]?.message
  if (!message) {
    throw new Error(t('llm.badResponse', { body: JSON.stringify(data).slice(0, 300) }))
  }

  const content = typeof message.content === 'string' ? message.content : ''
  const toolCalls: ToolCallRequest[] = (message.tool_calls ?? [])
    .filter((c) => typeof c?.function?.name === 'string')
    .map((c, i) => {
      const rawArguments = typeof c.function?.arguments === 'string' ? c.function.arguments : '{}'
      return {
        id: typeof c.id === 'string' ? c.id : `call_${i}`,
        name: String(c.function?.name),
        arguments: rawArguments,
        args: parseToolArguments(rawArguments),
      }
    })

  // 文字与工具调用都没有 = 这一步什么都没发生：不静默当成「空产出」收下
  if (!content && !toolCalls.length) {
    throw new Error(t('llm.emptyResponse', { body: JSON.stringify(data).slice(0, 300) }))
  }

  return { content, toolCalls, request: body, raw: data }
}

interface TestResult {
  ok: true
  ms: number
  reply: string
}

/**
 * 测试当前配置能否跑通。
 * 用一个最省的请求验证：能拿到回复就算成功。
 */
export async function testConnection(): Promise<TestResult> {
  const started = Date.now()
  const reply = await chat([
    { role: 'system', content: connectionTestPrompt() },
    { role: 'user', content: 'OK' },
  ])
  return {
    ok: true,
    ms: Date.now() - started,
    reply: reply.content.trim().slice(0, 40),
  }
}
