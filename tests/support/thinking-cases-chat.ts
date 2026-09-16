/**
 * 这一票的六条用例（正常 2 / 边界 2 / 异常 2）。
 *
 * 断言与夹具见 `thinking-cases.ts`；这里只放用例本身 —— 按分类分文件是为了让每个
 * 函数保持在体积上限内（项目的提交钩子按大括号深度数函数长度，超了会拦下提交）。
 */
import { expect } from 'vitest'
import { runCardGraph } from '../../src/agent/card-graph'
import { createInitialState } from '../../src/game/save'
import { installFakeLlm } from './fakeLlm'
import { NIGHT_WATCH_CARD, loadCard } from './card-fixtures'
import { API_BASE, DISABLED_MESSAGE, THINKING_MESSAGE, TOOLS, chatReply } from './thinking-cases'
import type { CaseTools, ContractCase } from './thinking-cases'
import type { ChatMessage } from '../../src/types/state'

/** 引擎拼出来的那条 assistant 消息长什么样（契约 §3.3 的三个键，断言只认这三个） */
const ASSISTANT_KEYS = ['content', 'role', 'tool_calls']

/**
 * 引擎拼出来的那条 assistant 消息得是干净的那三个键。
 *
 * 判据是**整个键集**（排序后逐个比），不是"某个键在不在"：多一个键、少一个键、
 * `role` 写错，失败信息里都带着**引擎实际发的键**。
 *
 * @param message 请求体里的一条消息
 */
function expectCleanToolCallMessage(message: ChatMessage): void {
  const keys = Object.keys(message).sort()
  expect(keys, `keys on the wire: [${keys.join(', ')}]`).toEqual(ASSISTANT_KEYS)
}

/** 关思考与「预设显式声明」这两条主路径 */
export function buildNormalCases(tools: CaseTools): ContractCase[] {
  const { runChat, contract } = tools
  return [
    {
      id: 1,
      category: 'normal',
      title: 'thinking disabled: the request carries thinking:{type:"disabled"} and keeps tools',
      guards: 'main path of the ticket: disabled really goes on the wire, and tools survive it',
      /** 关思考时请求体的形状，以及 tools 没被挤掉 */
      run: async () => {
        const { body, url, reply } = await runChat([chatReply(DISABLED_MESSAGE)], {
          tools: TOOLS,
          thinking: false,
        })
        expect(body.thinking).toEqual({ type: 'disabled' })
        expect(url).toBe(`${API_BASE}/chat/completions`)
        // 配置里没写 model ⇒ 必须落到默认模型 deepseek-flash
        expect(body.model).toBe('deepseek-flash')
        expect(body.stream).toBe(false)
        expect(body.tools).toEqual(TOOLS)
        expect(body.tool_choice).toBe('auto')
        expect(reply.content).toBe(DISABLED_MESSAGE.content)
        expect(reply.toolCalls.map((call) => call.name)).toEqual(['add_place'])
      },
    },
    {
      id: 2,
      category: 'normal',
      title: 'the preset model list contains deepseek-flash as a plain string',
      guards: 'the model list silently keeps a retired name, or stops being a list of strings',
      /** 预设的模型列表里有 `deepseek-flash`，且它就是字符串 */
      run: async () => {
        const provider = contract.providers.deepseek as { models?: unknown[] } | undefined
        expect(provider, 'there is no deepseek provider in the presets').toBeTruthy()
        const models = provider?.models ?? []
        expect(Array.isArray(models) && models.length > 0).toBe(true)
        // 判据是「字符串直接比字符串」：模型名就是模型名，不认任何别的形态。
        // ⚠️ 写成 `typeof m === 'string' ? m : m.id` 会让字符串分支返回整个字符串，
        //    于是判据永远不匹配 —— 失败信息还会指向「没声明」这个假原因
        const flash = models.find((model) => model === 'deepseek-flash')
        expect(flash, 'the preset does not list deepseek-flash as a string').toBe('deepseek-flash')
      },
    },
  ]
}

/** 「思考开关得真的是开关」与「不传就照预设走」这一组 */
export function buildBoundaryCases(tools: CaseTools): ContractCase[] {
  const { runChat } = tools
  return [
    {
      id: 3,
      category: 'boundary',
      title: 'asking for thinking sends no thinking key at all',
      guards: 'the switch must be a switch, not a hard-coded disabled',
      /** 声明要思考时，请求体里不许出现 thinking 键 */
      run: async () => {
        const { body } = await runChat([chatReply(THINKING_MESSAGE)], {
          tools: TOOLS,
          thinking: true,
        })
        expect(Object.hasOwn(body, 'thinking')).toBe(false)
        expect(body.tools).toEqual(TOOLS)
        expect(body.stream).toBe(false)
      },
    },
    {
      id: 4,
      category: 'boundary',
      title: 'omitting the thinking option falls back to the provider preset',
      guards: 'a new model forgets the declaration: the failure direction must be "less thinking"',
      /** 不传 thinking 时按服务商预设的声明走（deepseek 声明了 false） */
      run: async () => {
        const { body } = await runChat([chatReply(DISABLED_MESSAGE)], {
          tools: TOOLS,
          thinking: undefined,
        })
        expect(body.thinking).toEqual({ type: 'disabled' })
      },
    },
  ]
}

/** 思维链的两条防线：解析不崩、永不回传 */
export function buildErrorCases(tools: CaseTools): ContractCase[] {
  const { runChat, seedConfig } = tools
  return [
    {
      id: 5,
      category: 'error',
      title: 'reasoning_content arriving while thinking is off: no crash, never treated as prose',
      guards: 'speak up when reality disagrees with the environment; the chain of thought is not the story',
      /** 收到思维链时不崩，也不把它当成正文 */
      run: async () => {
        const { reply } = await runChat([chatReply(THINKING_MESSAGE)], {
          tools: TOOLS,
          thinking: false,
        })
        expect(reply.toolCalls.map((call) => call.name)).toEqual(['add_place'])
        expect(String(reply.content ?? '')).not.toContain('I should comply with the instruction')
        expect(Object.hasOwn(reply, 'reasoning_content')).toBe(false)
        expect(Object.hasOwn(reply, 'reasoning')).toBe(false)
      },
    },
    {
      id: 6,
      category: 'error',
      title: 'the outgoing request never carries reasoning_content (second round included)',
      guards: 'keeps a chain-of-thought store from growing back: once echoed, the context only grows',
      /** 两轮下来，发出去的请求体里都不许有 reasoning_content */
      run: async () => {
        seedConfig()
        // 上下文从生产路径长出来：真跑一遍 card-graph 的工具循环
        // （节点请求 → 模型要求调工具 → 引擎执行工具 → **引擎自己把那条 assistant 消息拼回上下文**
        //  → 带着它再问一轮）。用例不自造上下文 —— 被断言的那条消息由引擎拼。
        const card = loadCard(NIGHT_WATCH_CARD)
        const fake = installFakeLlm([chatReply(DISABLED_MESSAGE), 'The time node wrote this.'])
        try {
          await runCardGraph({
            card,
            data: createInitialState(card),
            memoryUpTo: 0,
            playerWords: 'It is night.',
          })
        } finally {
          fake.restore()
        }
        // 守卫：核心断言读的是 `calls[1]`，所以必须先证明**它不是别的请求** ——
        // 第二份请求里得带着引擎回传的工具结果（`role:"tool"`），那是「执行完工具又回来问了一轮」的铁证。
        // ⚠️ 只数请求总数是假的：这张卡有两个节点，没发生工具往返时下游节点照样会再发一次（总数也 >1）。
        const secondRound = fake.calls[1]?.body.messages ?? []
        const toolResults = secondRound.filter((message) => message.role === 'tool')
        expect(
          toolResults.length,
          `request #2 is not the tool-loop comeback: ${fake.calls.length} request(s) total, ` +
            `#2 carries ${secondRound.length} message(s), none with role:"tool"`,
        ).toBeGreaterThan(0)
        // 逐字看整份请求体：思维链一旦被拼回去，就在这里现形
        expect(JSON.stringify(fake.calls[1].body)).not.toContain('reasoning_content')
        const sent = fake.calls[1].body.messages
        // 先断数组形态：messages 缺失时，下面那句「引擎没拼回消息」会指向假原因
        expect(Array.isArray(sent), `messages is not an array: ${typeof sent}`).toBe(true)
        // `as ChatMessage[]` 只把联合类型里的 undefined 窄化掉 —— 消息形状取自源头
        //（`FakeCall.body.messages` 就是 `ChatMessage[]`），不在这里另抄一份
        const assistants = (sent as ChatMessage[]).filter((message) => message.role === 'assistant')
        // 第二轮的上下文里恰好那条被拼回去的 assistant 消息 —— 引擎自己拼的，不是用例造的
        expect(assistants, 'the engine did not put an assistant message back into the context').toHaveLength(
          1,
        )
        expectCleanToolCallMessage(assistants[0])
        // 第一轮也不能带（那条请求里还没有 assistant 消息）
        expect(JSON.stringify(fake.calls[0].body)).not.toContain('reasoning_content')
      },
    },
  ]
}
