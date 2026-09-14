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
 *    给模型看的**说明**（何时该调用）在 prompts/<lang>/tools.md；
 *    给模型看的**参数契约**在这里，描述文字从 locales 取（见下）。
 */

import { t } from '../i18n'
import type { GameState } from './state'
import type { ToolSchema } from './llm'

interface ToolDef {
  run(state: GameState, args: Record<string, unknown>): string
}

/** 工具的实现。说明文字在 prompts/，参数契约在下面的 toolSchemas()。 */
export const TOOLS: Record<string, ToolDef> = {
  advance_time: {
    /** 时间推进；参数把关在 state.advanceTime（系统边界） */
    run: (state, a) => state.advanceTime(a.step, a.unit, typeof a.reason === 'string' ? a.reason : ''),
  },
}

/**
 * 声明给模型的工具契约（OpenAI 兼容格式）。
 *
 * ⚠️ 描述文字是**给模型看的**，所以跟随界面语言（不需要 locale 文件之外的中文）——
 * 用 getter 而不是常量数组：locale 可以在运行时切换，常量只会在模块加载时求值一次。
 */
/** 当前语言下的工具契约（描述文字来自 locale，随界面语言变） */
export function toolSchemas(): ToolSchema[] {
  return [
    {
      type: 'function',
      function: {
        name: 'advance_time',
        description: t('tools.advanceTime.description'),
        parameters: {
          type: 'object',
          properties: {
            step: { type: 'integer', description: t('tools.advanceTime.step'), minimum: 1 },
            unit: {
              type: 'string',
              description: t('tools.advanceTime.unit'),
              enum: ['segment', 'hour', 'day', 'week', 'month', 'year'],
            },
            reason: { type: 'string', description: t('tools.advanceTime.reason') },
          },
          required: [],
        },
      },
    },
  ]
}

/**
 * 执行一个工具。
 *
 * 参数来自模型的 `arguments`（JSON 字符串，协议原样给出），
 * 所以这里是**边界**：JSON 可能不合法、字段可能给错。出错时返回
 * 结构化错误交给模型自己改 —— 这正是原生 tool calling 的好处。
 */
/** 执行模型要求的工具调用，返回给模型看的结果（成功或错误文案） */
export function runTool(state: GameState, name: string, rawArguments: string): string {
  // ⚠️ 必须用 Object.hasOwn，不能写成 `const tool = TOOLS[name]` —— 那样
  // `constructor` / `toString` / `valueOf` / `__proto__` / `hasOwnProperty`
  // 会从 Object.prototype 上取到**真值**，绕过「没有这个工具」的判断，
  // 随后抛 TypeError；而这个异常会穿出 runTurn，让 endTurn/save/addLog 全不执行。
  if (!Object.hasOwn(TOOLS, name)) {
    return t('tools.unknown', { name, available: Object.keys(TOOLS).join(', ') })
  }

  let args: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(rawArguments || '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return t('tools.notJsonObject', { got: rawArguments.slice(0, 120) })
    }
    args = parsed as Record<string, unknown>
  } catch (err) {
    return t('tools.invalidJson', {
      message: (err as Error).message,
      got: rawArguments.slice(0, 120),
    })
  }

  // 没有 try/catch：唯一的工具 advance_time 内部已把失败转成告警文案（见 state.advanceTime），
  // 不会抛到这里。为「不可能发生」的场景写兜底违反项目纪律 —— 真抛了就让上层看见
  // （runTurn 会把它作为回合错误暴露，而不是静默变成一句工具输出）。
  return String(TOOLS[name].run(state, args))
}
