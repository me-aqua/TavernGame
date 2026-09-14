/**
 * 网络层测试 —— **唯一**的模型调用入口。
 *
 * 全部用假 fetch：不发真实请求。重点验证
 *   1. 请求拼装（apiBase、鉴权、工具声明）
 *   2. 回复解析成协议结构（content + toolCalls）
 *   3. 错误信息对排查有用（状态码 + 服务商返回的正文）
 */
import { afterEach, describe, expect, it } from 'vitest'
import { chat } from '../src/agent/llm'
import { saveConfig, clearConfig } from '../src/agent/config'
import { i18n, t } from '../src/i18n'
import { installFakeLlm, installFakeLlmError } from './support/fakeLlm'
import type { ChatMessage } from '../src/types/state'

// 钉住 locale：引擎文案走 i18n，断言必须知道期望哪种语言 —— 这里用英文
i18n.global.locale.value = 'en'

// 夹具：发出去的消息、假模型的回复，以及网络层必须暴露给玩家的错误体
const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]
const TEXT_REPLY = 'a reply'
const TIME_REPLY = 'I want to advance time.'
const GATEWAY_HTML = '<html><body>Bad Gateway</body></html>'
const PROVIDER_MESSAGE = 'Invalid API key'

let restore: (() => void) | null = null

afterEach(() => {
  restore?.()
  restore = null
  clearConfig()
})

describe('chat - request assembly', () => {
  it('uses the OpenAI-compatible path with Authorization and model', async () => {
    saveConfig({
      provider: 'custom',
      apiKey: 'sk-test',
      apiBase: 'https://api.example.test/v1',
      model: 'my-model',
    })
    const fake = installFakeLlm([TEXT_REPLY])
    restore = fake.restore

    const reply = await chat(messages)

    expect(reply.content).toBe(TEXT_REPLY)
    expect(reply.toolCalls).toEqual([])
    expect(fake.calls[0].url).toBe('https://api.example.test/v1/chat/completions')
    expect(fake.calls[0].headers['Authorization']).toBe('Bearer sk-test')
    expect(fake.calls[0].body.model).toBe('my-model')
  })

  it('omits the tools field when no tools are passed', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    await chat(messages)
    expect(fake.calls[0].body.tools).toBeUndefined()
  })

  it('sends the tool declarations and tool_choice when tools are passed', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    await chat(messages, {
      tools: [{ type: 'function', function: { name: 'x', description: 'd', parameters: {} } }],
    })
    expect(fake.calls[0].body.tools).toHaveLength(1)
    expect(fake.calls[0].body.tool_choice).toBe('auto')
  })

  it('does not append /chat/completions when the base URL already ends with it', async () => {
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

  it('joins the URL correctly when the base URL ends with a slash', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1/', model: 'm' })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    await chat(messages)
    expect(fake.calls[0].url).toBe('https://api.example.test/v1/chat/completions')
  })
})

describe('chat - reply parsing (protocol shape)', () => {
  it('preserves id / name / arguments from tool_calls', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([
      {
        content: TIME_REPLY,
        toolCalls: [{ id: 'call_abc', name: 'advance_time', arguments: '{"step":2}' }],
      },
    ])
    restore = fake.restore

    const reply = await chat(messages)

    expect(reply.content).toBe(TIME_REPLY)
    expect(reply.toolCalls).toEqual([{ id: 'call_abc', name: 'advance_time', arguments: '{"step":2}' }])
  })

  it('accepts a reply with only tool calls and no text (empty content)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([{ toolCalls: [{ name: 'advance_time' }] }])
    restore = fake.restore

    const reply = await chat(messages)
    expect(reply.content).toBe('')
    expect(reply.toolCalls).toHaveLength(1)
  })

  it('generates a missing id (downstream uses it to correlate results)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([{ toolCalls: [{ name: 'advance_time' }] }])
    restore = fake.restore
    const reply = await chat(messages)
    expect(reply.toolCalls[0].id).toMatch(/^call_/)
  })

  it('throws when there is neither text nor a tool call (no silent empty turn)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([{ content: '', toolCalls: [] }])
    restore = fake.restore
    await expect(chat(messages)).rejects.toThrow(t('llm.emptyResponse', { body: '' }).trimEnd())
  })

  it('reports a fragment of the raw body when choices is missing', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ weird: true }), { status: 200 })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }
    await expect(chat(messages)).rejects.toThrow(
      t('llm.badResponse', { body: JSON.stringify({ weird: true }) }),
    )
  })
})

describe('chat - config validation', () => {
  it('points at Settings when the key is missing instead of saying undefined', async () => {
    saveConfig({ provider: 'custom', apiKey: '', apiBase: 'https://api.example.test/v1', model: 'm' })
    await expect(chat(messages)).rejects.toThrow(t('llm.missingConfig', { items: t('llm.field.apiKey') }))
    await expect(chat(messages)).rejects.toThrow(t('settings.title'))
  })

  it('rejects a missing model name too', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: '' })
    await expect(chat(messages)).rejects.toThrow(t('llm.missingConfig', { items: t('llm.field.model') }))
  })
})

describe('chat - error branches', () => {
  it('includes the body of a non-JSON error page (gateway HTML 502)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    restore = installFakeLlmError(502, GATEWAY_HTML)
    await expect(chat(messages)).rejects.toThrow(
      t('llm.httpError', { status: 502, statusText: 'Error', detail: GATEWAY_HTML }),
    )
    await expect(chat(messages)).rejects.toThrow(/Bad Gateway/)
  })

  it('prefers the provider message from a JSON error body', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    restore = installFakeLlmError(401, JSON.stringify({ error: { message: PROVIDER_MESSAGE } }))
    await expect(chat(messages)).rejects.toThrow(
      t('llm.httpError', { status: 401, statusText: 'Error', detail: PROVIDER_MESSAGE }),
    )
  })

  it('gives an actionable hint on a CORS / network failure, keeping the original error', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm(['unused'])
    restore = fake.restore
    const networkError = new TypeError('Failed to fetch')
    fake.failNextWith(networkError)

    // 用 then 的失败分支取值：catch 的返回值会带上成功分支的类型，断言拿不到 Error 字段
    const err = await chat(messages).then(
      () => null,
      (e: unknown) => e as Error,
    )
    if (!err) throw new Error('expected chat() to reject')
    expect(err.message).toBe(t('llm.requestFailed', { url: 'https://api.example.test/v1/chat/completions' }))
    // 玩家看到的是「怎么修」，排查的人需要原始错误 —— 少了 cause 就只能靠猜
    expect(err.cause).toBe(networkError)
  })
})
