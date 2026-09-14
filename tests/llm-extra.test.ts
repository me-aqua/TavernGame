/**
 * llm.ts 补充测试 —— 覆盖 testConnection 与回复解析的容错分支。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { chat, testConnection } from '../src/core/llm'
import { saveConfig, clearConfig } from '../src/core/config'
import { i18n } from '../src/i18n'
import { installFakeLlm } from './support/fakeLlm'
import type { ChatMessage } from '../src/types/state'

// Engine messages go through i18n; pin the locale so assertions are deterministic
i18n.global.locale.value = 'en'

const messages: ChatMessage[] = [{ role: 'user', content: '你好' }]
let restore: (() => void) | null = null

afterEach(() => {
  restore?.()
  restore = null
  clearConfig()
})

describe('配置校验 —— 缺接口地址', () => {
  it('缺 apiBase 时提示补配置', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: '   ', model: 'm' })
    // Field names are localized for the player — never the raw config key
    await expect(chat(messages)).rejects.toThrow(/base URL/)
  })
})

describe('错误体解析', () => {
  it('错误体是 JSON 且带 message → 展示该 message', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: '配额不足' }), { status: 429 })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }
    await expect(chat(messages)).rejects.toThrow(/配额不足/)
  })

  it('错误体是 JSON 但没有 message → 回落展示原文', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: 'X' }), { status: 500 })) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }
    await expect(chat(messages)).rejects.toThrow(/code/)
  })
})

describe('回复解析容错', () => {
  it('tool_calls 里缺 function.name 的条目被过滤掉', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '有文字',
                tool_calls: [{ id: 'a' }, { id: 'b', function: { name: 'advance_time', arguments: '{}' } }],
              },
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }

    const reply = await chat(messages)
    expect(reply.content).toBe('有文字')
    expect(reply.toolCalls).toHaveLength(1)
    expect(reply.toolCalls[0].name).toBe('advance_time')
  })

  it('content 不是字符串时当作空串；id 缺失时补 call_N；arguments 非字符串时给 {}', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 12345, tool_calls: [{ function: { name: 'advance_time' } }] } }],
        }),
        { status: 200 },
      )) as typeof fetch
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
  it('成功时返回 ok / ms / reply（reply 截到 40 字）', async () => {
    saveConfig({ provider: 'custom', apiKey: 'k', apiBase: 'https://api.example.test/v1', model: 'm' })
    const fake = installFakeLlm(['可'.repeat(60)])
    restore = fake.restore

    const result = await testConnection()
    expect(result.ok).toBe(true)
    expect(result.ms).toBeGreaterThanOrEqual(0)
    expect(result.reply).toHaveLength(40)
    // 用的是最省的请求：system + user 两条
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].body.messages).toHaveLength(2)
  })

  it('失败时把错误抛出去（不吞）', async () => {
    saveConfig({ provider: 'custom', apiKey: '', apiBase: 'https://api.example.test/v1', model: 'm' })
    await expect(testConnection()).rejects.toThrow(/Missing configuration/)
  })
})
