/**
 * src/agent/prompts.ts —— 提示词装配器
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

// 提示词以 base64 随包发布：源文件是 prompts/*.md，由 vite-plugins/prompts.ts
// 在**构建期**转成虚拟模块（不产生中间文件，所以没有「忘了重新编码」这种失败模式）。
// 为什么编码：见 prompts/README.md —— 主要是**彻底避开转义坑**
// （反引号/换行/引号/中文）。
// ⚠️ 这是编码不是加密：客户端字符串永远拿得到，别把需要保密的东西放进来。
//
// 模块 id 约定：virtual:prompt/<lang>/<name>（语言段来自 prompts/<lang>/ 目录名）。
// 当前固定取 zh-CN；i18n 那一步会按玩家语言在 zh-CN / en 之间选。
import { t } from '../i18n'
import systemTemplateB64 from 'virtual:prompt/zh-CN/system'
import toolsTemplateB64 from 'virtual:prompt/zh-CN/tools'
import openingInstructionB64 from 'virtual:prompt/zh-CN/opening'
import forcedNarrationInstructionB64 from 'virtual:prompt/zh-CN/forced-narration'
import toolCallsWithoutNarrationB64 from 'virtual:prompt/zh-CN/tool-calls-without-narration'
import connectionTestB64 from 'virtual:prompt/zh-CN/connection-test'
import calendarNoteB64 from 'virtual:prompt/zh-CN/calendar'

/**
 * 解码提示词：虚拟模块导出的就是**纯 base64 字符串**（无注释、无包装）。
 *
 * 浏览器与 Node 18+ 都有 atob / TextDecoder，所以不需要任何 Node 专用 API。
 * base64 → bytes → UTF-8：中文必须走这一步，直接 atob 得到的是乱码。
 */
function decodePrompt(b64: string): string {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new Error(t('prompts.badBase64'))
  }
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

import { SEGMENTS } from '../utils/calendar'
import type { GameState } from '../game/GameState'
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
    throw new Error(t('prompts.unfilled', { names: [...new Set(unfilled)].join(', ') }))
  }
  // 折叠连续空行：各提示词文件自带末尾换行，拼接后会留下 \n\n\n 这类空隙。
  // 发给模型的东西要干净（也省 token）—— 这是装配层的职责，不必要求每个文件都精确收尾。
  return filled.replace(/\n{3,}/g, '\n\n').trim()
}

/** 工具说明（含调用格式与示例） */
export function toolsPrompt(): string {
  return renderPrompt(toolsTemplate, { SEGMENTS: SEGMENTS.join(t('tools.segmentListSeparator')) })
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

// 工具结果以 role:'tool' 的协议消息回传（协议自带 id 关联），
// 所以这里不需要任何「以下是工具执行结果」之类的包装文案。
