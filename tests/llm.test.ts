/**
 * 网络层测试 —— **唯一**的模型调用入口。
 *
 * 全部用假 fetch：不发真实请求。重点验证
 *   1. 请求拼装（地址、鉴权、工具声明）
 *   2. 回复解析成协议结构（content + toolCalls）
 *   3. 错误信息对排查有用（状态码 + 服务商返回的正文）
 */
import { afterEach, describe, expect, it } from 'vitest'
import { chat } from '../src/core/llm'
import { saveConfig, clearConfig } from '../src/core/config'
import { installFakeLlm, installFakeLlmError } from './support/fakeLlm'
import type { ChatMessage } from '../src/types/state'

const messages: ChatMessage[] = [{ role: 'user', content: '你好' }]
let restore: (() => void) | null = null

afterEach(() => {
  restore?.()
  restore = null
  clearConfig()
})

describe('chat —— 请求拼装', () => {
  it('走 OpenAI 兼容路径，带 Authorization 与 model', async () => {
    saveConfig({
      provider: 'custom',
      apiKey: 'sk-test',
      apiBase: 'https://api.example.test/v1',
      model: 'my-model',
    })
    const fake = installFakeLlm(['回复'])
    restore = fake.restore

    const reply = await chat(messages)

    expect(reply.content).toBe('回复')
    expect(reply.toolCalls).toEqual([])
    expect(fake.calls[0].url).toBe('https://api.example.test/v1/chat/completions')
    expect(fake.calls[0].headers['Authorization']).toBe('Bearer sk-test')
    expect(fake.calls[0].body.model).toBe('my-model')
  })

  it('不传 tools 时请求里没有 tools 字段', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    await chat(messages)
    expect(fake.calls[0].body.tools).toBeUndefined()
  })

  it('传了 tools 就带上声明与 tool_choice', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    await chat(messages, {
      tools: [{ type: 'function', function: { name: 'x', description: 'd', parameters: {} } }],
    })
    expect(fake.calls[0].body.tools).toHaveLength(1)
    expect(fake.calls[0].body.tool_choice).toBe('auto')
  })

  it('接口地址已经以 /chat/completions 结尾时不再重复拼', async () => {
    saveConfig({
      provider: 'custom',
      apiKey: 'k',
      apiBase: 'https://api.example.test/v1/chat/completions',
      model: 'm',
    })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    await chat(messages)
    expect(fake.calls[0].url).toBe('https://api.example.test/v1/chat/completions')
  })

  it('地址末尾带斜杠也能正确拼接', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1/', model: 'm' })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    await chat(messages)
    expect(fake.calls[0].url).toBe('https://api.example.test/v1/chat/completions')
  })
})

describe('chat —— 回复解析（协议结构）', () => {
  it('解析出 tool_calls：id / name / arguments 原样保留', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([
      {
        content: '想推进时间。',
        toolCalls: [{ id: 'call_abc', name: 'advance_time', arguments: '{"step":2}' }],
      },
    ])
    restore = fake.restore

    const reply = await chat(messages)

    expect(reply.content).toBe('想推进时间。')
    expect(reply.toolCalls).toEqual([{ id: 'call_abc', name: 'advance_time', arguments: '{"step":2}' }])
  })

  it('只有工具调用、没有文字也合法（content 为空串）', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([{ toolCalls: [{ name: 'advance_time' }] }])
    restore = fake.restore

    const reply = await chat(messages)
    expect(reply.content).toBe('')
    expect(reply.toolCalls).toHaveLength(1)
  })

  it('缺 id 时自动补一个（下游要用它关联结果）', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([{ toolCalls: [{ name: 'advance_time' }] }])
    restore = fake.restore
    const reply = await chat(messages)
    expect(reply.toolCalls[0].id).toMatch(/^call_/)
  })

  it('既没文字也没工具调用 → 报错（避免静默的空回合）', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([{ content: '', toolCalls: [] }])
    restore = fake.restore
    await expect(chat(messages)).rejects.toThrow(/既没有文字也没有工具调用/)
  })

  it('缺少 choices 时报出原文片段', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ weird: true }), { status: 200 })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }
    await expect(chat(messages)).rejects.toThrow(/回复格式看不懂/)
  })
})

describe('chat —— 配置校验', () => {
  it('缺 key 时给出「去设置里补」的提示，而不是 undefined', async () => {
    saveConfig({ provider: 'custom', apiKey: '', apiBase: 'https://api.example.test/v1', model: 'm' })
    await expect(chat(messages)).rejects.toThrow(/还缺少配置：API Key/)
    await expect(chat(messages)).rejects.toThrow(/⚙ 设置/)
  })

  it('缺模型名也会被拦下', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: '' })
    await expect(chat(messages)).rejects.toThrow(/模型名称/)
  })
})

describe('chat —— 错误分支', () => {
  it('非 JSON 的错误页（网关 HTML 502）也要把正文带出来', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    restore = installFakeLlmError(502, '<html><body>Bad Gateway</body></html>')
    await expect(chat(messages)).rejects.toThrow(/接口返回 502/)
    await expect(chat(messages)).rejects.toThrow(/Bad Gateway/)
  })

  it('JSON 格式的错误体优先展示服务商给的 message', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    restore = installFakeLlmError(401, JSON.stringify({ error: { message: 'Invalid API key' } }))
    await expect(chat(messages)).rejects.toThrow(/Invalid API key/)
  })

  it('CORS / 网络层失败给出可行动的提示，并带上原始错误', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm(['unused'])
    restore = fake.restore
    fake.failNextWith(new TypeError('Failed to fetch'))
    await expect(chat(messages)).rejects.toThrow(/CORS/)
  })
})
