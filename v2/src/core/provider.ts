/**
 * 真 provider 的调用（CONTRACT §4.5）：浏览器直连，走 Vercel AI SDK。
 *
 * 一个节点一次请求（阶段 1 不做多步工具循环），`POST ${baseUrl}/chat/completions`、
 * `stream: true`、`Authorization: Bearer <key>`。Key 从 preset 里来，只住本机 localStorage，
 * 不进卡、不进日志、不进错误正文（错误正文只有中文，上游原文进 `detail.upstream`）。
 */
import { createOpenAI } from '@ai-sdk/openai'
import { jsonSchema, streamText, tool } from 'ai'
import { t } from '../i18n'
import { AppError } from './errors'
import type { Preset, ProviderReply, ProviderToolCall, TokenUsage } from './types'

/** 工具的参数形状交给模型看；名字与键名一律 ASCII（中文只在 locales/ 里） */
const TOOL_DEFINITIONS = {
  advance_time: {
    description: 'Advance the in-game clock by a whole number of hours.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: { hours: { type: 'integer', description: 'Hours to advance, may be negative.' } },
      required: ['hours'],
    }),
  },
  write_state: {
    description: 'Write one string into the state tree of the current scene.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: { path: { type: 'string' }, value: { type: 'string' } },
      required: ['path', 'value'],
    }),
  },
} as const

function toolSetOf(names: string[]) {
  const entries = names.map((name) => {
    const definition = TOOL_DEFINITIONS[name as keyof typeof TOOL_DEFINITIONS]
    return [name, tool(definition)] as const
  })
  return Object.fromEntries(entries)
}

/** 上游报文的可读文本（进 `detail`，给调试面板看；绝不当正文） */
function upstreamTextOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

function usageOf(
  raw: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
): TokenUsage | null {
  if (!raw) return null
  const input = raw.inputTokens ?? 0
  const output = raw.outputTokens ?? 0
  const total = raw.totalTokens ?? input + output
  if (input === 0 && output === 0 && total === 0) return null
  return { inputTokens: input, outputTokens: output, totalTokens: total }
}

export interface CallProviderArgs {
  preset: Preset
  prompt: string
  /** 这个节点允许调用的工具名 */
  tools: string[]
  /** 只有 output 节点会拿到它：流式增量 */
  onChunk?: (text: string) => void
  signal?: AbortSignal
}

// 调一次 provider：流式收正文与工具调用，任何失败都翻成中文的 AppError
export async function callProvider({
  preset,
  prompt,
  tools,
  onChunk,
  signal,
}: CallProviderArgs): Promise<ProviderReply> {
  if (preset.apiKey === '') {
    throw new AppError('E_PROVIDER', {
      message: t('error.provider.noKey'),
      nextStep: t('next.settings'),
      detail: { presetId: preset.id },
    })
  }

  const openai = createOpenAI({ baseURL: preset.baseUrl.replace(/\/+$/, ''), apiKey: preset.apiKey })
  let text = ''
  const toolCalls: ProviderToolCall[] = []

  try {
    const result = streamText({
      model: openai.chat(preset.model),
      messages: [{ role: 'user', content: prompt }],
      tools: toolSetOf(tools),
      abortSignal: signal,
      // 玩家就在屏幕前等：连不上就当场说，不替他静默重试三次（一次 2 秒起步）
      maxRetries: 0,
    })
    for await (const part of result.fullStream) {
      if (signal?.aborted) throw new AppError('E_ABORTED')
      if (part.type === 'text-delta') {
        text += part.text
        onChunk?.(part.text)
      } else if (part.type === 'tool-call') {
        toolCalls.push({ name: part.toolName, args: (part.input ?? {}) as Record<string, unknown> })
      } else if (part.type === 'error') {
        throw part.error
      }
    }
    return { text, toolCalls, usage: usageOf(await result.usage) }
  } catch (cause) {
    if (cause instanceof AppError) throw cause
    if (signal?.aborted) throw new AppError('E_ABORTED')
    throw new AppError('E_PROVIDER', {
      message: t('error.provider.failed'),
      nextStep: t('next.settings'),
      detail: { presetId: preset.id, upstream: upstreamTextOf(cause) },
      cause,
    })
  }
}
