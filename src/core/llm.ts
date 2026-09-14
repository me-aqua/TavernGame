/**
 * src/core/llm.ts —— LLM 调用层
 *
 * 只做一件事：把消息发出去，把回复拿回来。
 * 不认识游戏规则，也不碰世界状态 —— 那些是 agent.ts 和 state.ts 的事。
 *
 * 纯前端意味着：请求直接从浏览器发往服务商。
 * 已实测主要服务商都返回 CORS 允许头，所以浏览器不会拦截。
 */

import { loadConfig, PRESETS } from './config'
import { CONNECTION_TEST_PROMPT } from './prompts'
import type { ChatMessage } from '../types/state'

export interface ChatOptions {
  /** 用于中途取消 */
  signal?: AbortSignal
}

/**
 * 调用对话接口。
 * @returns 模型回复的纯文本
 */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const cfg = loadConfig()
  const preset = PRESETS[cfg.provider]

  // 配置校验：给出「该去做什么」而不是一句 undefined 报错
  const missing: string[] = []
  if (!cfg.apiKey && !preset?.noKey) missing.push('API Key')
  if (!cfg.apiBase || !String(cfg.apiBase).trim()) missing.push('接口地址')
  if (!cfg.model || !String(cfg.model).trim()) missing.push('模型名称')
  if (missing.length) {
    throw new Error(`还缺少配置：${missing.join('、')}。\n请点右上角「⚙ 设置」补上。`)
  }

  // 拼接请求地址：兼容用户填带不带 /v1 的情况
  const base = cfg.apiBase.replace(/\/+$/, '')
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`

  const body = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    stream: false,
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
      throw new Error(
        `请求发不出去。可能原因：\n` +
          `• 该服务商不允许浏览器直连（CORS 拦截）\n` +
          `• 接口地址写错了：${url}\n` +
          `• 网络不通或需要代理`,
        // 带上原始错误：否则控制台里只剩我们这句话，看不到底层原因
        { cause: err },
      )
    }
    throw err
  }

  if (!res.ok) {
    // ⚠️ 顺序很重要：response body 只能读一次。
    // 先 res.json() 失败、再 res.text() 会抛「Body is unusable」，
    // 被 .catch 吞成空串 —— 于是网关返回 HTML 502 时，
    // 玩家只看到一行状态码、拿不到任何可用于排查的内容。
    // 所以先整体读成文本，再尝试从中解析 JSON。
    const raw = await res.text()
    let detail = ''
    try {
      const j = JSON.parse(raw) as { error?: { message?: string }; message?: string }
      detail = j?.error?.message || j?.message || ''
    } catch {
      // 成功路径：网关返回 HTML 错误页（502 等）时本来就不是 JSON
    }
    throw new Error(`接口返回 ${res.status} ${res.statusText}\n${detail || raw.slice(0, 300)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(`回复格式看不懂：${JSON.stringify(data).slice(0, 300)}`)
  }
  return content
}

export interface TestResult {
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
    { role: 'system', content: CONNECTION_TEST_PROMPT },
    { role: 'user', content: '只回复两个字：可用' },
  ])
  return {
    ok: true,
    ms: Date.now() - started,
    reply: reply.trim().slice(0, 40),
  }
}
