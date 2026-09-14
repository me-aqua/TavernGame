/**
 * llm.ts 补充测试 —— 覆盖 testConnection 与回复解析的容错分支。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { chat, testConnection } from '../src/agent/llm'
import { saveConfig, clearConfig } from '../src/agent/config'
import { i18n, t } from '../src/i18n'
import { installFakeLlm } from './support/fakeLlm'
import type { ChatMessage } from '../src/types/state'

// Engine messages go through i18n; pin the locale so assertions are deterministic
i18n.global.locale.value = 'en'

/** 假玩家消息（fixture） */
const messages: ChatMessage[] = [{ role: 'user', content: 'Hello there' }]

/** 假模型回复的文字部分（fixture） */
const NARRATION = 'The tavern is quiet tonight.'

/** 假模型回复：第一条 tool_call 缺 function.name，应被过滤掉 */
const REPLY_WITH_BROKEN_TOOL_CALL = {
  choices: [
    {
      message: {
        content: NARRATION,
        tool_calls: [{ id: 'a' }, { id: 'b', function: { name: 'advance_time', arguments: '{}' } }],
      },
    },
  ],
}

/** 假模型回复：content 不是字符串、id 缺失、arguments 不是字符串 */
const REPLY_WITH_SLOPPY_FIELDS = {
  choices: [{ message: { content: 12345, tool_calls: [{ function: { name: 'advance_time' } }] } }],
}

/** 假服务商错误体：JSON 且带 message（外部接口文案，不是产品文案） */
const PROVIDER_ERROR_BODY = { message: 'quota exceeded' }

/** 假服务商错误体：JSON 但没有 message，应回落展示原文 */
const OPAQUE_ERROR_BODY = { code: 'X' }

/** 60 字符的假模型回复，用来验证 testConnection 截到 40 */
const LONG_REPLY = 'a'.repeat(60)

let restore: (() => void) | null = null

afterEach(() => {
  restore?.()
  restore = null
  clearConfig()
})

describe('config validation - missing base URL', () => {
  it('asks for the missing field when apiBase is blank', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: '   ', model: 'm' })
    // Field names are localized for the player - never the raw config key
    await expect(chat(messages)).rejects.toThrow(t('llm.missingConfig', { items: t('llm.field.apiBase') }))
  })
})

describe('error body parsing', () => {
  it('shows the provider message when the error body is JSON with a message field', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(PROVIDER_ERROR_BODY), { status: 429 })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }
    await expect(chat(messages)).rejects.toThrow(
      t('llm.httpError', { status: 429, statusText: '', detail: PROVIDER_ERROR_BODY.message }),
    )
  })

  it('falls back to the raw body when the error body is JSON without a message field', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(OPAQUE_ERROR_BODY), { status: 500 })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }
    await expect(chat(messages)).rejects.toThrow(
      t('llm.httpError', { status: 500, statusText: '', detail: JSON.stringify(OPAQUE_ERROR_BODY) }),
    )
  })
})

describe('reply parsing tolerance', () => {
  it('drops tool_calls entries missing function.name', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(REPLY_WITH_BROKEN_TOOL_CALL), { status: 200 })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }

    const reply = await chat(messages)
    expect(reply.content).toBe(NARRATION)
    expect(reply.toolCalls).toHaveLength(1)
    expect(reply.toolCalls[0].name).toBe('advance_time')
  })

  it('treats non-string content as empty, fills a missing id with call_N, and uses {} for non-string arguments', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(REPLY_WITH_SLOPPY_FIELDS), { status: 200 })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }

    const reply = await chat(messages)
    expect(reply.content).toBe('')
    expect(reply.toolCalls[0].id).toMatch(/^call_/)
    expect(reply.toolCalls[0].arguments).toBe('{}')
  })
})

describe('testConnection', () => {
  it('returns ok / ms / reply on success (reply truncated to 40 chars)', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm([LONG_REPLY])
    restore = fake.restore

    const result = await testConnection()
    expect(result.ok).toBe(true)
    expect(result.ms).toBeGreaterThanOrEqual(0)
    expect(result.reply).toHaveLength(40)
    // 用的是最省的请求：system + user 两条
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].body.messages).toHaveLength(2)
  })

  it('propagates the error on failure (does not swallow it)', async () => {
    saveConfig({ provider: 'custom', apiKey: '', apiBase: 'https://api.example.test/v1', model: 'm' })
    await expect(testConnection()).rejects.toThrow(t('llm.missingConfig', { items: t('llm.field.apiKey') }))
  })
})
