/**
 * 网络层测试 —— 此前 0% 覆盖。
 *
 * 全部用假 fetch：不发真实请求。重点验证**错误信息对排查有用**
 * （状态码 + 服务商返回的正文，而不是一句 undefined）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { chat } from '../src/core/llm'
import { saveConfig, clearConfig } from '../src/core/config'
import { installFakeLlm, installFakeLlmError } from './support/fakeLlm'
import type { ChatMessage } from '../src/types/state'

const 消息: ChatMessage[] = [{ role: 'user', content: '你好' }]
let restore: (() => void) | null = null

afterEach(() => {
  restore?.()
  restore = null
  clearConfig()
})

describe('chat —— 请求拼装', () => {
  it('走 OpenAI 兼容路径，带 Authorization 与 model', async () => {
    saveConfig({ provider: 'custom', apiKey: 'sk-test', apiBase: 'https://api.example.test/v1', model: 'my-model' })
    const fake = installFakeLlm(['回复'])
    restore = fake.restore

    const reply = await chat(消息)

    expect(reply).toBe('回复')
    expect(fake.calls[0].url).toBe('https://api.example.test/v1/chat/completions')
    expect(fake.calls[0].headers['Authorization']).toBe('Bearer sk-test')
    expect(fake.calls[0].body.model).toBe('my-model')
    expect(fake.calls[0].body.messages).toEqual(消息)
  })

  it('接口地址已经以 /chat/completions 结尾时不再重复拼', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1/chat/completions', model: 'm' })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    await chat(消息)
    expect(fake.calls[0].url).toBe('https://api.example.test/v1/chat/completions')
  })

  it('地址末尾带斜杠也能正确拼接', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1/', model: 'm' })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    await chat(消息)
    expect(fake.calls[0].url).toBe('https://api.example.test/v1/chat/completions')
  })
})

describe('chat —— 配置校验', () => {
  it('缺 key 时给出「去设置里补」的提示，而不是 undefined', async () => {
    saveConfig({ provider: 'custom', apiKey: '', apiBase: 'https://api.example.test/v1', model: 'm' })
    await expect(chat(消息)).rejects.toThrow(/还缺少配置：API Key/)
    await expect(chat(消息)).rejects.toThrow(/⚙ 设置/)
  })

  it('缺模型名也会被拦下', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: '' })
    await expect(chat(消息)).rejects.toThrow(/模型名称/)
  })
})

describe('chat —— 错误分支', () => {
  it('非 JSON 的错误页（网关 HTML 502）也要把正文带出来', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    restore = installFakeLlmError(502, '<html><body>Bad Gateway</body></html>')
    await expect(chat(消息)).rejects.toThrow(/接口返回 502/)
    await expect(chat(消息)).rejects.toThrow(/Bad Gateway/)
  })

  it('JSON 格式的错误体优先展示服务商给的 message', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    restore = installFakeLlmError(401, JSON.stringify({ error: { message: 'Invalid API key' } }))
    await expect(chat(消息)).rejects.toThrow(/Invalid API key/)
  })

  it('CORS / 网络层失败给出可行动的提示', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm(['unused'])
    restore = fake.restore
    fake.failNextWith(new TypeError('Failed to fetch'))
    await expect(chat(消息)).rejects.toThrow(/CORS/)
  })

  it('回复结构看不懂时报出原文片段', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ weird: true }), { status: 200 })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }
    await expect(chat(消息)).rejects.toThrow(/回复格式看不懂/)
  })
})
