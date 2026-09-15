/**
 * src/agent/llm.ts —— 模型调用的**唯一入口**。
 *
 * 规则：
 *   1. **所有模型调用都经过这里的 chat()** —— 别处不允许直接 fetch
 *   2. **这里不做任何输出解析**：节点产出的格式（JSON 代码块）由卡的节点约定约束，
 *      解析只发生在有消费者的地方（src/agent/card-graph.ts 的时间与叙事），
 *      解析不出来就抛错 —— 不猜格式、也不替模型修内容
 *
 * 纯前端意味着请求直接从浏览器发往服务商；已实测主要服务商都返回 CORS 允许头。
 */

import { loadConfig, PRESETS } from './config'
import { t } from '../i18n'
import { connectionTestPrompt } from './prompts'
import type { ChatMessage } from '../types/state'

/**
 * 实际发出去的请求体（OpenAI 兼容）。
 *
 * ⚠️ 只有这里拼得出来：模型名、温度、消息数组都在这个函数里合成。
 *    调试模式要展示「模型原始输入」就得把它带出去 —— 在别处重拼一份 = 第二份真值。
 */
export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature: number
  stream: boolean
}

/** 一次模型回复 */
export interface ChatReply {
  /** 模型返回的文本（节点产出原文） */
  content: string
  request: ChatRequest
  /** 原始响应，供调试模式查看 */
  raw: unknown
}

interface ChatOptions {
  signal?: AbortSignal
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
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const message = data?.choices?.[0]?.message
  if (!message) {
    throw new Error(t('llm.badResponse', { body: JSON.stringify(data).slice(0, 300) }))
  }

  const content = typeof message.content === 'string' ? message.content : ''
  if (!content) {
    throw new Error(t('llm.emptyResponse', { body: JSON.stringify(data).slice(0, 300) }))
  }

  return { content, request: body, raw: data }
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
