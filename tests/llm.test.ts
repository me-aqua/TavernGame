/**
 * 网络层测试 —— **唯一**的模型调用入口。
 *
 * 全部用假 fetch：不发真实请求。重点验证
 *   1. 请求拼装（apiBase、鉴权、模型名；给了工具就声明 tools）
 *   2. 回复解析成 { content, toolCalls, request, raw } —— 含**协议参数**的解析
 *      （arguments 是 JSON 字符串；解析不出来只标记，不抛错，交给模型自己改）
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
    expect(fake.calls[0].url).toBe('https://api.example.test/v1/chat/completions')
    expect(fake.calls[0].headers['Authorization']).toBe('Bearer sk-test')
    expect(fake.calls[0].body.model).toBe('my-model')
  })

  it('declares the tools it was given, with tool_choice auto (native tool calling)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    const tools = [
      {
        type: 'function' as const,
        function: { name: 'advance_time', description: 'advance it', parameters: { type: 'object' } },
      },
    ]
    await chat(messages, { tools })
    expect(fake.calls[0].body.tools).toEqual(tools)
    expect(fake.calls[0].body.tool_choice).toBe('auto')
  })

  it('omits tools when none are declared (the connection test sends a plain request)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm(['ok'])
    restore = fake.restore
    await chat(messages)
    expect(fake.calls[0].body.tools).toBeUndefined()
    expect(fake.calls[0].body.tool_choice).toBeUndefined()
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

describe('chat - reply parsing', () => {
  it('takes the text of the first choice and keeps the request it sent', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([TEXT_REPLY])
    restore = fake.restore

    const reply = await chat(messages)

    expect(reply.content).toBe(TEXT_REPLY)
    expect(reply.request.messages).toEqual(messages)
    expect(reply.raw).toMatchObject({ choices: [{ message: { content: TEXT_REPLY } }] })
  })

  it('parses tool_calls: id / name / raw arguments / parsed args (no text required)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([
      {
        content: '',
        toolCalls: [{ id: 'call_9', name: 'advance_time', arguments: '{"step":2,"unit":"week"}' }],
      },
    ])
    restore = fake.restore

    const reply = await chat(messages)

    // 只调工具、一个字都没写是合法的一步（不是空回复）
    expect(reply.content).toBe('')
    expect(reply.toolCalls).toEqual([
      {
        id: 'call_9',
        name: 'advance_time',
        arguments: '{"step":2,"unit":"week"}',
        args: { ok: true, value: { step: 2, unit: 'week' } },
      },
    ])
  })

  it('marks arguments that are not valid JSON (never throws: the model gets to fix them)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([{ toolCalls: [{ name: 'advance_time', arguments: '{"step": 2, ' }] }])
    restore = fake.restore

    const reply = await chat(messages)

    expect(reply.toolCalls[0].args.ok).toBe(false)
    if (reply.toolCalls[0].args.ok) throw new Error('the arguments must not have parsed')
    // 错误文案带着模型自己写的那串参数，它才改得动
    expect(reply.toolCalls[0].args.message).toContain('{"step": 2, ')
    // 标记从 locale 表派生（第一个占位符之前那段）—— 换语言也认得出
    const table = i18n.global.getLocaleMessage(i18n.global.locale.value) as {
      tools: Record<string, string>
    }
    expect(reply.toolCalls[0].args.message).toContain(table.tools.invalidJson.split('{')[0].trim())
  })

  it('rejects an arguments payload that is not a JSON object (array / literal)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([
      { toolCalls: [{ name: 'advance_time', arguments: '[1,2]' }] },
      { toolCalls: [{ name: 'advance_time', arguments: '"a string"' }] },
    ])
    restore = fake.restore

    const array = await chat(messages)
    expect(array.toolCalls[0].args).toEqual({
      ok: false,
      message: t('tools.notJsonObject', { got: '[1,2]' }),
    })

    const literal = await chat(messages)
    expect(literal.toolCalls[0].args).toEqual({
      ok: false,
      message: t('tools.notJsonObject', { got: '"a string"' }),
    })
  })

  it('treats an empty arguments string as {} (a tool with no required parameters)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([{ toolCalls: [{ name: 'advance_time', arguments: '' }] }])
    restore = fake.restore

    const reply = await chat(messages)
    expect(reply.toolCalls[0].args).toEqual({ ok: true, value: {} })
  })

  it('throws on an empty reply (no silent empty turn)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([{ content: '' }])
    restore = fake.restore
    await expect(chat(messages)).rejects.toThrow(t('llm.emptyResponse', { body: '' }).trimEnd())
  })

  it('treats non-string content as empty and throws', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 12345 } }] }), {
        status: 200,
      })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }
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
