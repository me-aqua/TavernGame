/**
 * src/agent/llm.ts —— 模型调用的**唯一入口**
 *
 * 规则（用户 2026-09-14 明确要求）：
 *   1. **所有模型调用都经过这里的 chat()** —— 别处不允许直接 fetch
 *   2. **禁止解析模型输出**。工具调用走 OpenAI 兼容的原生 `tools` 协议，
 *      由模型在协议层声明「我要调哪个工具、参数是什么」，
 *      我们不再用正则去猜它写在文本里的 JSON。
 *
 * 为什么这条很重要：文本协议时代，模型格式一飘（少个反引号、参数写中文、
 * 把工具块单独发一条消息）就会静默失败；当时要靠「防呆」去兜。
 * 原生 tool calling 把这些交给协议，模型有契约可依，出错时我们能把
 * 结构化错误回传，让它自己改。
 *
 * 纯前端意味着：请求直接从浏览器发往服务商。已实测主要服务商都返回
 * CORS 允许头，所以浏览器不会拦截。
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

/** 模型要求调用某个工具 */
export interface ToolCallRequest {
  id: string
  name: string
  /** 参数是 JSON 字符串（协议原样），由调用方解析 */
  arguments: string
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

/** 一次模型回复：可能只有文字，也可能要求调工具 */
export interface ChatReply {
  /** 叙事文字（可能为空——只调工具时就是这样） */
  content: string
  /** 模型要求的工具调用（可能为空数组） */
  toolCalls: ToolCallRequest[]
  /** 发给模型的请求体（调试模式展示「模型输入」用） */
  request: ChatRequest
  /** 原始响应，供调试模式查看 */
  raw: unknown
}

interface ChatOptions {
  /** 用于中途取消 */
  signal?: AbortSignal
  /** 声明可用工具；不传则模型不会调用任何工具 */
  tools?: ToolSchema[]
  /** 给模型看的服务商侧提示（一般不用） */
  toolChoice?: 'auto' | 'none' | 'required'
}

/** 接口返回的错误体形状（OpenAI 兼容） */
interface ApiErrorBody {
  error?: { message?: string }
  message?: string
}

/**
 * 调用对话接口。**这是项目里唯一发请求给模型的地方。**
 */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatReply> {
  const cfg = loadConfig()
  const preset = PRESETS[cfg.provider]

  // 配置校验：给出「该去做什么」而不是一句 undefined 报错
  // Field names are localized for the player: "Missing configuration: base URL",
  // never the raw key "apiBase".
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
    .map((c, i) => ({
      id: typeof c.id === 'string' ? c.id : `call_${i}`,
      name: String(c.function?.name),
      arguments: typeof c.function?.arguments === 'string' ? c.function.arguments : '{}',
    }))

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
