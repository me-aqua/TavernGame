/**
 * src/agent/tools.ts —— 引擎的**动作白名单**。
 *
 * 大原则（用户 2026-09-14 定下、2026-09-15 重申）：
 * **引擎要做的任何动作（推进时间、换地点、改状态……）只能来自模型的原生工具调用。**
 * 模型只能**申请**，不能直接改世界状态：引擎执行它、把结果原样回传给模型。
 * 模型的文字只有两个用途 —— 当上游上下文、当故事正文；引擎不读它、不猜它、
 * 不据此判断任何事。
 *
 * 所以「新增一个动作」= 在这里加一个工具（声明 + 实现），
 * **不是**去解析某个节点写出的某段文字：解析模型输出等于猜格式，
 * 它写歪一点（漏个引号、参数写成中文）就整轮失败。
 *
 * 工具越少，模型越能把注意力放在「写故事」上 —— 每多一个工具，
 * 就多一次往返、多一分走神。所以这里**只保留一个**：时间推进。
 *
 * ⚠️ 工具只通过 **OpenAI 兼容的原生 tools 协议**声明给模型：没有文本协议、
 *    没有 JSON 代码块，也**没有解析器**。
 *    给模型看的**说明**（何时该调用）在 prompts/<lang>/tools.md；
 *    给模型看的**参数契约**在下面的 toolSchemas()（描述文字从 locales 取）。
 */

import { t } from '../i18n'
import { TIME_UNITS } from '../utils/calendar'
import { advanceTime } from '../game/state'
import type { GameState } from '../game/state'
import type { ToolCallRequest, ToolSchema } from './llm'

interface ToolDef {
  run(state: GameState, args: Record<string, unknown>): string
}

/** 工具的实现。说明文字在 prompts/，参数契约在下面的 toolSchemas()。 */
export const TOOLS: Record<string, ToolDef> = {
  advance_time: {
    /** 时间推进；参数把关在 utils/calendar.ts 的 advanceTime（系统边界） */
    run: (state, a) => advanceTime(state, a.step, a.unit, typeof a.reason === 'string' ? a.reason : ''),
  },
}

/**
 * 声明给模型的工具契约（OpenAI 兼容格式）。
 *
 * ⚠️ 描述文字是**给模型看的**，所以跟随界面语言（不需要 locale 文件之外的中文）——
 * 用 getter 而不是常量数组：locale 可以在运行时切换，常量只会在模块加载时求值一次。
 */
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
              // 单位表只有一处（utils/calendar.ts）：手写第二份就会和校验逻辑走偏
              enum: [...TIME_UNITS],
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
 * 执行模型申请的一次工具调用，返回**原样回传给模型**的结果文案。
 *
 * 参数来自协议字段（llm.ts 已把它解析成对象或一句结构化错误），所以这里只判两件事：
 * 工具存不存在、参数能不能用。出错时返回错误文案交给模型自己改 ——
 * 这正是原生 tool calling 的好处。
 */
export function runTool(state: GameState, call: ToolCallRequest): string {
  // ⚠️ 必须用 Object.hasOwn，不能写成 `const tool = TOOLS[name]` —— 那样
  // `constructor` / `toString` / `valueOf` / `__proto__` / `hasOwnProperty`
  // 会从 Object.prototype 上取到**真值**，绕过「没有这个工具」的判断，
  // 随后抛 TypeError；而这个异常会穿出 runTurn，让 endTurn/save/addLog 全不执行。
  if (!Object.hasOwn(TOOLS, call.name)) {
    return t('tools.unknown', { name: call.name, available: Object.keys(TOOLS).join(', ') })
  }
  // 参数不是合法 JSON 对象：把 llm.ts 给的结构化错误原样回传，让它自己改
  if (!call.args.ok) return call.args.message

  // 没有 try/catch：唯一的工具 advance_time 内部已把失败转成告警文案（见 game/state.ts 的
  // advanceTime），不会抛到这里。为「不可能发生」的场景写兜底违反项目纪律 —— 真抛了就让
  // 上层看见（turn.ts 会把它作为回合错误暴露，而不是静默变成一句工具输出）。
  return String(TOOLS[call.name].run(state, call.args.value))
}
