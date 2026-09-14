/**
 * src/core/tools.ts —— 工具定义与执行
 *
 * 设计原则（重要）：
 *   工具越少，模型越能把注意力放在「写故事」上。
 *   每多一个工具，就要多输出一段 JSON、多一次往返、多一分走神。
 *
 * 所以这里**只保留一个**：时间推进。
 *
 * ⚠️ 2026-09-14 起：工具通过 **OpenAI 兼容的原生 tools 协议** 声明给模型，
 *    不再有「文本协议 + JSON 代码块」，也**没有解析器**了。
 *    理由见 llm.ts 顶部注释：解析模型输出本质上是在猜格式，
 *    而工具调用应该是协议层的契约。
 *    给模型看的**说明**（何时该调用）在 prompts/tools.md；
 *    给模型看的**参数契约**就是下面的 TOOL_SCHEMAS。
 */

import type { GameState } from './state'
import type { ToolSchema } from './llm'

export interface ToolDef {
  run(state: GameState, args: Record<string, unknown>): string
}

/** 工具的实现。说明文字在 prompts/，参数契约在下面的 TOOL_SCHEMAS。 */
export const TOOLS: Record<string, ToolDef> = {
  advance_time: {
    run: (state, a) => state.advanceTime(a.step, a.unit, typeof a.reason === 'string' ? a.reason : ''),
  },
}

/**
 * 声明给模型的工具契约（OpenAI 兼容格式）。
 *
 * 描述文字是**游戏语言**的一部分（会直接影响模型对世界的理解），
 * 所以这里是中文；将来做 i18n 时按语言取不同的一份。
 */
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'advance_time',
      description:
        '推进故事内的时间。只在剧情确实经过了一段时间时才调用' +
        '（赶路、交谈很久、睡了一觉、等到天黑、修养数日）。' +
        '如果这一回合只是几句话、几个动作，就不要调用。跨度没有上限。',
      parameters: {
        type: 'object',
        properties: {
          step: { type: 'integer', description: '推进的数量，正整数。默认 1', minimum: 1 },
          unit: {
            type: 'string',
            description: '时间单位。默认 segment（一个时段，约 4 小时）',
            enum: ['segment', 'hour', 'day', 'week', 'month', 'year'],
          },
          reason: { type: 'string', description: '为什么时间会流逝（会记录在时间线里）' },
        },
        required: [],
      },
    },
  },
]

/**
 * 执行一个工具。
 *
 * 参数来自模型的 `arguments`（JSON 字符串，协议原样给出），
 * 所以这里是**边界**：JSON 可能不合法、字段可能给错。出错时返回
 * 结构化错误交给模型自己改 —— 这正是原生 tool calling 的好处。
 */
export function runTool(state: GameState, name: string, rawArguments: string): string {
  // ⚠️ 必须用 Object.hasOwn，不能写成 `const tool = TOOLS[name]` —— 那样
  // `constructor` / `toString` / `valueOf` / `__proto__` / `hasOwnProperty`
  // 会从 Object.prototype 上取到**真值**，绕过「没有这个工具」的判断，
  // 随后抛 TypeError；而这个异常会穿出 runTurn，让 endTurn/save/addLog 全不执行。
  if (!Object.hasOwn(TOOLS, name)) {
    return `❌ 没有名为「${name}」的工具。可用工具：${Object.keys(TOOLS).join('、')}`
  }

  let args: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(rawArguments || '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return `❌ 参数必须是 JSON 对象，收到的是：${rawArguments.slice(0, 120)}`
    }
    args = parsed as Record<string, unknown>
  } catch (err) {
    return `❌ 参数不是合法 JSON（${(err as Error).message}）。你给的是：${rawArguments.slice(0, 120)}`
  }

  try {
    return String(TOOLS[name].run(state, args))
  } catch (err) {
    return `❌ 工具执行出错：${(err as Error).message}`
  }
}

/** 工具名列表，供测试与错误提示用 */
export const TOOL_NAMES = Object.keys(TOOLS)
