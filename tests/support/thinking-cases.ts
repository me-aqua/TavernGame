/**
 * 「默认模型 deepseek-flash + 默认不思考」这一票：契约面、固定夹具与人手。
 *
 * 六条用例分三类（正常 2 / 边界 2 / 异常 2），跑手在 `tests/thinking.test.ts`。
 *
 * 为什么集中在这里：每条用例都要「不发真请求、但要看到引擎到底发了什么」，
 * 分散写会出现六份几乎相同的拦截与断言样板，改一次形状要改六处。
 *
 * ⚠️ 夹具是**真 API 响应**的逐字形状（只换 id 与文案，字段的有无一个没动）：
 *    模拟得比真实宽松，是假通过的第一来源。假模型走**原生 tool calling**，
 *    所以回复按协议形态给 tool_calls，没有「在文字里写 JSON 代码块」这种模拟。
 *
 * ⚠️ 用例标题与失败信息是**英文字符串字面量**：代码卫生要求除 locale 之外的一切
 *    字符串都是 ASCII，中文注释例外、中文文案不例外。
 */
import { expect } from 'vitest'
import { installFakeLlm } from './fakeLlm'
import type { Envelope } from './fakeLlm'
import type { ChatReply, ToolSchema } from '../../src/agent/llm'
import type { ChatMessage } from '../../src/types/state'
import { buildBoundaryCases, buildErrorCases, buildNormalCases } from './thinking-cases-chat'

/** 引擎默认的发往地址（配置里的 apiBase 不带 /v1） */
export const API_BASE = 'https://api.deepseek.com'

/** 明显不是真 key 的占位串：假 fetch 之下永远不会发给真服务商 */
export const FAKE_API_KEY = 'sk-FAKE-KEY-FOR-TESTS-ONLY'

/**
 * 固定输入。
 *
 * 消息数组标了 `ChatMessage[]`：`role` 是联合类型，裸数组字面量里的 `'user'`
 * 会被推成 `string`，那样传给 `chat()` 是类型错误。
 */
export const USER_TURN: ChatMessage[] = [
  { role: 'user', content: 'Call add_place with name "Inn". Use the tool.' },
]

// ⚠️ `tools` 的类型是引擎自己的 `ToolSchema[]`，不是 `unknown[]` ——
//    写成 unknown[] 的话契约面与生产的 `chat()` 签名对不上（typecheck 会红在接线处），
//    而那种红是**接线错**，不是被测行为错。
export const TOOLS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'add_place',
      description: 'record a place the player visited',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
]

/** 关思考的回复（真 API 探针一）：message 里**没有** reasoning_content 这个键 */
export const DISABLED_MESSAGE = {
  role: 'assistant',
  content: 'Adding the place now.',
  tool_calls: [
    {
      index: 0,
      id: 'call_00_DLDOlT1MAZvKy7q60Vad8329',
      type: 'function',
      function: { name: 'add_place', arguments: '{"name": "Inn"}' },
    },
  ],
}

/** 开思考的回复（真 API 探针二）：reasoning_content 与空 content 并存 */
export const THINKING_MESSAGE = {
  role: 'assistant',
  content: '',
  reasoning_content:
    'The user asks "Where am I?" and then instructs to call add_place with name "Inn". I should comply with the instruction. The tool call records a place. Let me call it.',
  tool_calls: [
    {
      index: 0,
      id: 'call_00_uqaF76MbI5It3wmpyCnh1784',
      type: 'function',
      function: { name: 'add_place', arguments: '{"name": "Inn"}' },
    },
  ],
}

/**
 * 把一条真响应里的 message 包成完整响应体，外层字段逐字照真 API 给
 * @param message 真响应的 `choices[0].message`
 */
export function chatReply(message: Record<string, unknown>): Envelope {
  return {
    body: {
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      created: 1789526729,
      model: 'deepseek-flash',
      choices: [{ index: 0, message, logprobs: null, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 279, completion_tokens: 46, total_tokens: 325 },
      system_fingerprint: 'aeb56401ca74e127821c4f9126dcb669',
    },
  }
}

/** 这一票的用例分三类 —— 少一类不算交 */
export const categories = ['normal', 'boundary', 'error'] as const

export type CaseCategory = (typeof categories)[number]

export interface ContractCase {
  id: number
  category: CaseCategory
  title: string
  /** 这条用例在防什么 —— 以后改断言的人得先看见它 */
  guards: string
  run: () => Promise<void>
}

/** 引擎与配置层的契约面：这一票要求实现满足的接口 */
export interface ThinkingContract {
  chat: (
    messages: ChatMessage[],
    options?: { tools?: ToolSchema[]; thinking?: boolean },
  ) => Promise<ChatReply>
  saveConfig: (patch: Record<string, unknown>) => unknown
  providers: Record<string, unknown>
}

/** 各分类的用例建造函数共用的一手：接线 + 契约面本身 */
export interface CaseTools {
  /** 契约面本身 —— 用例 2 / 6 要直接摸预设与 `chat()` */
  contract: ThinkingContract
  /**
   * 把配置写进引擎真正读的地方（localStorage）。
   *
   * ⚠️ 故意**不写 model**：默认模型是这一票的一部分，让引擎自己去取默认值。
   * ⚠️ 不走「给 chat() 传配置」那条路：配置的来源是存储，传参不生效，
   *    那样红的是接线不是被测行为。
   */
  seedConfig: () => void
  /** 跑一次 chat，返回这次真正发出去的请求体、地址与解析后的回复 */
  runChat: (
    replies: Envelope[],
    options: { tools?: ToolSchema[]; thinking?: boolean },
  ) => Promise<{ body: Record<string, unknown>; url: string; reply: ChatReply }>
}

/** 造出这一手，交给各分类的建造函数用 */
export function createTools(contract: ThinkingContract): CaseTools {
  const { chat, saveConfig } = contract

  /** 把配置写进引擎真正读的地方（localStorage），故意不写 model */
  function seedConfig() {
    saveConfig({
      provider: 'deepseek',
      apiBase: API_BASE,
      apiKey: FAKE_API_KEY,
      temperature: 0.7,
    })
  }

  /** 跑一次 chat，返回这次真正发出去的请求体、地址与解析后的回复 */
  async function runChat(
    replies: Envelope[],
    options: { tools?: ToolSchema[]; thinking?: boolean },
  ): Promise<{ body: Record<string, unknown>; url: string; reply: ChatReply }> {
    seedConfig()
    const fake = installFakeLlm(replies)
    try {
      const reply = await chat(USER_TURN, options)
      // 空测试的防线：请求没发出去时，下面所有断言都会「通过」
      expect(fake.calls, 'the request was never sent').toHaveLength(1)
      return { body: fake.calls[0].body as Record<string, unknown>, url: fake.calls[0].url, reply }
    } finally {
      fake.restore()
    }
  }

  return { contract, seedConfig, runChat }
}

/** 造出这一票的六条用例（三类齐全） */
export function createCases(contract: ThinkingContract): ContractCase[] {
  const tools = createTools(contract)
  const built = [...buildNormalCases(tools), ...buildBoundaryCases(tools), ...buildErrorCases(tools)]
  // 编号是契约的一部分：报告里按编号对回用例清单，重复或跳号都是接线错误
  for (const [index, testCase] of built.entries()) {
    if (testCase.id !== index + 1) {
      throw new Error(`case numbering broke at position ${index + 1}: id ${testCase.id}`)
    }
  }
  return built
}
