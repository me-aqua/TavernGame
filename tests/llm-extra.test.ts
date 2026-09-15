/**
 * llm.ts 补充测试 —— 覆盖 testConnection 与请求/错误体的边角分支。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { chat, testConnection } from '../src/agent/llm'
import { saveConfig, clearConfig } from '../src/agent/config'
import { i18n, t } from '../src/i18n'
import { installFakeLlm } from './support/fakeLlm'
import type { ChatMessage } from '../src/types/state'

// 引擎文案走 i18n；钉住 locale，断言才稳定
i18n.global.locale.value = 'en'

const messages: ChatMessage[] = [{ role: 'user', content: 'Hello there' }]

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
    // 字段名用玩家看得懂的说法，不用原始配置 key
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

describe('tool call parsing - the protocol fields the provider may omit', () => {
  it('falls back to a generated id and empty arguments when the provider omits them', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    // 有些兼容网关只给 name，不给 id / arguments；协议字段缺了也不许猜内容
    const body = {
      choices: [
        { message: { content: '', tool_calls: [{ type: 'function', function: { name: 'advance_time' } }] } },
      ],
    }
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }

    const reply = await chat(messages, {
      tools: [{ type: 'function', function: { name: 'advance_time', description: 'x', parameters: {} } }],
    })
    expect(reply.toolCalls).toEqual([
      {
        id: 'call_0',
        name: 'advance_time',
        arguments: '{}',
        args: { ok: true, value: {} },
      },
    ])
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
