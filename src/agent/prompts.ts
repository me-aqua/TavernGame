/**
 * src/agent/prompts.ts —— 提示词装配器
 *
 * ⚠️ **这里不放任何提示词内容**，内容全部在 `prompts/<lang>/*.md`。本文件的职责只有三件：
 *   1. 把构建期编码的提示词（虚拟模块）解码成字符串
 *   2. **按当前界面语言选那一套**（模型语言跟随界面语言，见 doc/DESIGN.md 决定 #19）
 *   3. 把占位符填上，并**确认没有漏填**
 *
 * 提示词单独放文件是因为它就是本项目的「游戏逻辑」，改动频率不低于代码；
 * 混在字符串里没法评审、没法 diff。
 */

// 提示词以 base64 随包发布：源文件 prompts/<lang>/*.md，由 vite-plugins/prompts.ts
// 在**构建期**转成虚拟模块（不产生中间文件，所以没有「忘了重新编码」这种失败模式）。
// 为什么编码：见 prompts/README.md —— 主要是**彻底避开转义坑**（反引号/换行/引号/中文）。
// ⚠️ 这是编码不是加密：客户端字符串永远拿得到，别把需要保密的东西放进来。
import { t, i18n, type Locale } from '../i18n'
import systemZh from 'virtual:prompt/zh-CN/system'
import systemEn from 'virtual:prompt/en/system'
import toolsZh from 'virtual:prompt/zh-CN/tools'
import toolsEn from 'virtual:prompt/en/tools'
import calendarZh from 'virtual:prompt/zh-CN/calendar'
import calendarEn from 'virtual:prompt/en/calendar'
import openingZh from 'virtual:prompt/zh-CN/opening'
import openingEn from 'virtual:prompt/en/opening'
import forcedZh from 'virtual:prompt/zh-CN/forced-narration'
import forcedEn from 'virtual:prompt/en/forced-narration'
import noNarrationZh from 'virtual:prompt/zh-CN/tool-calls-without-narration'
import noNarrationEn from 'virtual:prompt/en/tool-calls-without-narration'
import connectionTestZh from 'virtual:prompt/zh-CN/connection-test'
import connectionTestEn from 'virtual:prompt/en/connection-test'

import type { ChatMessage } from '../types/state'
import type { AgentContext } from './agent'

/**
 * 解码提示词：虚拟模块导出的就是**纯 base64 字符串**（无注释、无包装）。
 *
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

/** 每种提示词的两种语言版本；取用时按当前界面语言选 */
const TEMPLATES = {
  system: { 'zh-CN': decodePrompt(systemZh), en: decodePrompt(systemEn) },
  tools: { 'zh-CN': decodePrompt(toolsZh), en: decodePrompt(toolsEn) },
  calendar: { 'zh-CN': decodePrompt(calendarZh), en: decodePrompt(calendarEn) },
  opening: { 'zh-CN': decodePrompt(openingZh), en: decodePrompt(openingEn) },
  forcedNarration: { 'zh-CN': decodePrompt(forcedZh), en: decodePrompt(forcedEn) },
  noNarration: { 'zh-CN': decodePrompt(noNarrationZh), en: decodePrompt(noNarrationEn) },
  connectionTest: { 'zh-CN': decodePrompt(connectionTestZh), en: decodePrompt(connectionTestEn) },
} satisfies Record<string, Record<Locale, string>>

function locale(): Locale {
  return (i18n.global.locale as unknown as { value: Locale }).value
}

/**
 * 填占位符。
 *
 * **填不干净就抛错** —— 宁可在这里失败，也不要把 `{{SNAPSHOT}}` 这种字样
 * 发给模型（那会让提示词静默失效，而且很难发现）。
 */
export function renderPrompt(template: string, values: Record<string, string> = {}): string {
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

export function toolsPrompt(): string {
  return renderPrompt(TEMPLATES.tools[locale()])
}

/**
 * 拼装完整的 system 提示词。
 *
 * 历法与工具说明都是动态的（换历法、加工具时不一样），所以在这里装配，
 * 而不是写死在提示词文件里。
 */
export function buildSystemPrompt(world: AgentContext, history: ChatMessage[] = []): string {
  const lang = locale()
  return renderPrompt(TEMPLATES.system[lang], {
    TOOLS: toolsPrompt(),
    CALENDAR: renderPrompt(TEMPLATES.calendar[lang]),
    SNAPSHOT: world.snapshot(history),
  })
}

export function openingInstruction(): string {
  return renderPrompt(TEMPLATES.opening[locale()])
}

export function forcedNarrationInstruction(): string {
  return renderPrompt(TEMPLATES.forcedNarration[locale()])
}

export function toolCallsWithoutNarration(): string {
  return renderPrompt(TEMPLATES.noNarration[locale()])
}

export function connectionTestPrompt(): string {
  return renderPrompt(TEMPLATES.connectionTest[locale()])
}

// 工具结果以 role:'tool' 的协议消息回传（协议自带 id 关联），
// 所以这里不需要任何「以下是工具执行结果」之类的包装文案。
