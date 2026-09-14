/**
 * src/core/prompts.ts —— 提示词装配器
 *
 * ⚠️ **这里不放任何提示词内容。** 内容全部在 `prompts/*.md`。
 * 这个文件的职责只有两件：
 *   1. 用 Vite 的 `?raw` 在构建期把提示词读成字符串（无运行时请求）
 *   2. 把占位符填上，并**确认没有漏填**
 *
 * 为什么单独放文件：提示词是这个项目的"游戏逻辑"（见 doc/DESIGN.md），
 * 改动的频率与重要性不低于代码；混在字符串里没法评审、没法 diff，
 * 而且 `\n` 拼接的排版远不如 Markdown 干净。
 */

// 提示词以 base64 形式随包发布（源文件是 prompts/*.md，由 npm run prompts:encode 生成）。
// 为什么编码：见 prompts/README.md —— 主要是**彻底避开转义坑**
// （反引号/换行/引号/中文），同时产物里不再是可读明文。
// ⚠️ 这是编码不是加密：客户端字符串永远拿得到，别把需要保密的东西放进来。
import systemTemplateB64 from '../../prompts/system.md.b64?raw'
import toolsTemplateB64 from '../../prompts/tools.md.b64?raw'
import openingInstructionB64 from '../../prompts/opening.md.b64?raw'
import forcedNarrationInstructionB64 from '../../prompts/forced-narration.md.b64?raw'
import toolCallsWithoutNarrationB64 from '../../prompts/tool-calls-without-narration.md.b64?raw'
import connectionTestB64 from '../../prompts/connection-test.md.b64?raw'
import calendarNoteB64 from '../../prompts/calendar.md.b64?raw'

/**
 * .b64 文件是「带注释的一小段 JS」，真实载荷是导出的字符串。
 * 这里只取引号之间的内容，避免依赖 eval / import 副作用。
 */
function decodePrompt(原始: string): string {
  const m = 原始.match(/"([\s\S]*)"/)
  if (!m) throw new Error('提示词编码文件格式不对（找不到 base64 字符串）')
  const b64 = m[1]
  // 浏览器与 Node 18+ 都有 atob / TextDecoder，所以不需要任何 Node 专用 API。
  // base64 → bytes → UTF-8：中文必须走这一步，直接 atob 得到的是乱码。
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

const systemTemplate = decodePrompt(systemTemplateB64)
const toolsTemplate = decodePrompt(toolsTemplateB64)
const calendarNote = decodePrompt(calendarNoteB64)

/** 开场指令（代码里引用它，内容在 prompts/opening.md） */
export const OPENING_INSTRUCTION = decodePrompt(openingInstructionB64)
/** 一整个回合没写叙事时的补写指令（prompts/forced-narration.md） */
export const FORCED_NARRATION_INSTRUCTION = decodePrompt(forcedNarrationInstructionB64)
/** 连接测试用的最小 system 提示词（prompts/connection-test.md） */
export const CONNECTION_TEST_PROMPT = decodePrompt(connectionTestB64)
/** 模型只调工具、不写叙事时的催稿指令（prompts/tool-calls-without-narration.md） */
export const TOOL_CALLS_WITHOUT_NARRATION = decodePrompt(toolCallsWithoutNarrationB64)

import { SEGMENTS } from './calendar'
import type { GameState } from './state'
import type { ChatMessage } from '../types/state'

/**
 * 填占位符。
 *
 * **填不干净就抛错** —— 宁可在这里失败，也不要把 `{{SNAPSHOT}}` 这种字样
 * 发给模型（那会让提示词静默失效，而且很难发现）。
 */
export function renderPrompt(template: string, values: Record<string, string>): string {
  let filled = template
  for (const [key, value] of Object.entries(values)) {
    filled = filled.replaceAll(`{{${key}}}`, value)
  }
  // 匹配任意 {{...}}：占位符名字不该有格式限制，漏填才是要拦的事
  const unfilled = filled.match(/\{\{[^{}]+\}\}/g)
  if (unfilled) {
    throw new Error(`提示词有未填的占位符：${[...new Set(unfilled)].join('、')}`)
  }
  // 折叠连续空行：各提示词文件自带末尾换行，拼接后会留下 \n\n\n 这类空隙。
  // 发给模型的东西要干净（也省 token）—— 这是装配层的职责，不必要求每个文件都精确收尾。
  return filled.replace(/\n{3,}/g, '\n\n').trim()
}

/** 工具说明（含调用格式与示例） */
export function toolsPrompt(): string {
  return renderPrompt(toolsTemplate, { SEGMENTS: SEGMENTS.join(' → ') })
}

/**
 * 拼装完整的 system 提示词。
 *
 * 历法与工具说明都是动态的（换历法、加工具时不一样），
 * 所以在这里装配，而不是写死在提示词文件里。
 */
export function buildSystemPrompt(state: GameState, history: ChatMessage[] = []): string {
  return renderPrompt(systemTemplate, {
    TOOLS: toolsPrompt(),
    CALENDAR: calendarNote,
    SNAPSHOT: state.snapshot(history),
  })
}

// 注：原生 tool calling 之后，工具结果以 role:'tool' 的协议消息回传，
// 不再需要「以下是工具的实际执行结果…」这类外套文案，相关提示词文件已删除。
