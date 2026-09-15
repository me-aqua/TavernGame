/**
 * src/agent/prompts.ts —— 提示词装配器
 *
 * ⚠️ **这里不放任何提示词内容**：
 *   · 卡里的提示词（五块设定 / 剧本 / 节点约定 / 逐节点）从卡取 —— 那才是作者改的地方；
 *   · 引擎自带的说明在 `prompts/<lang>/*.md`（构建期编码成虚拟模块）。
 * 本文件的职责只有四件：
 *   1. 把构建期编码的提示词解码成字符串
 *   2. **按当前界面语言选那一套**（模型语言跟随界面语言，见 doc/DESIGN.md 决定 #19）
 *   3. 按卡的约定拼出一次节点请求：公共部分 + 本轮上游 + 该节点提示词
 *      （第四节「节点之间的数据流」、决定 #26/#36）
 *   4. 填占位符并**确认没有漏填**
 *
 * ⚠️ 卡是**已校验**的数据（game/card.ts 是唯一的形状边界），这里只读不判。
 */

// 提示词以 base64 随包发布：源文件 prompts/<lang>/*.md，由 vite-plugins/prompts.ts
// 在**构建期**转成虚拟模块（不产生中间文件，所以没有「忘了重新编码」这种失败模式）。
// 为什么编码：见 prompts/README.md —— 主要是**彻底避开转义坑**（反引号/换行/引号/中文）。
// ⚠️ 这是编码不是加密：客户端字符串永远拿得到，别把需要保密的东西放进来。
import { t, i18n, type Locale } from '../i18n'
import calendarZh from 'virtual:prompt/zh-CN/calendar'
import calendarEn from 'virtual:prompt/en/calendar'
import openingZh from 'virtual:prompt/zh-CN/opening'
import openingEn from 'virtual:prompt/en/opening'
import connectionTestZh from 'virtual:prompt/zh-CN/connection-test'
import connectionTestEn from 'virtual:prompt/en/connection-test'
import outputZh from 'virtual:prompt/zh-CN/output'
import outputEn from 'virtual:prompt/en/output'

import * as K from '../game/card-keys'
import { isRecord } from '../game/save'
import { upstreamText, type UpstreamOutput } from '../game/state'
import type { CardData } from '../game/card'
import type { ChatMessage } from '../types/state'

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
  calendar: { 'zh-CN': decodePrompt(calendarZh), en: decodePrompt(calendarEn) },
  opening: { 'zh-CN': decodePrompt(openingZh), en: decodePrompt(openingEn) },
  connectionTest: { 'zh-CN': decodePrompt(connectionTestZh), en: decodePrompt(connectionTestEn) },
  output: { 'zh-CN': decodePrompt(outputZh), en: decodePrompt(outputEn) },
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

/** 把若干段拼成给模型的一段文本：空段丢掉、连续空行折成一行 */
function joinSections(sections: string[]): string {
  return renderPrompt(sections.filter(Boolean).join('\n\n'))
}

/**
 * 把卡里的一段值摊成模型读得懂的文本：字符串原样、数组一项一行、对象逐键缩进。
 *
 * ⚠️ 不认任何一篇内容的具体字段：卡里出现没见过的形状也照样摊得开
 *    （渲染器不该知道某一篇内容的形状）。
 */
function renderCardValue(value: unknown, level = 0): string {
  const pad = '  '.repeat(level)
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, item]) => pad + key + K.PUNCT_COLON + '\n' + renderCardValue(item, level + 1))
      .join('\n')
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        // 标量项跟在 "- " 后面；对象 / 数组项缩进一层再摊
        if (isRecord(item) || Array.isArray(item)) return pad + '-\n' + renderCardValue(item, level + 1)
        return pad + '- ' + String(item)
      })
      .join('\n')
  }
  // 走到这里的只剩标量（字符串 / 数字 / 布尔 / null）：String() 就是它们的文本形态
  return String(value)
}

/** 卡的五块设定：每块一节，顺序由 card-keys 的 SETTING_BLOCKS 固定 */
export function settingsPrompt(card: CardData): string {
  const prompts = card[K.KEY_PROMPT] as Record<string, unknown>
  const setting = prompts[K.KEY_SETTING] as Record<string, string[]>
  const blocks = K.SETTING_BLOCKS.map((block) => `### ${block}\n${setting[block].join('\n')}`)
  return `## ${K.KEY_SETTING}\n${blocks.join('\n\n')}`
}

/** 卡的剧本：AI 知道、玩家不知道的那部分世界真相 */
export function scriptPrompt(card: CardData): string {
  const prompts = card[K.KEY_PROMPT] as Record<string, unknown>
  return `## ${K.KEY_SCRIPT}\n${renderCardValue(prompts[K.KEY_SCRIPT])}`
}

/** 节点约定：每个节点都要知道自己在图里的位置（决定 #26：它也进上下文） */
export function conventionPrompt(card: CardData): string {
  const prompts = card[K.KEY_PROMPT] as Record<string, unknown>
  const lines = prompts[K.KEY_CONVENTION] as string[]
  return `## ${K.KEY_CONVENTION}\n${lines.join('\n')}`
}

/** 历法与时间单位的写法（引擎的历法知识，不是卡里的内容） */
export function calendarPrompt(): string {
  return renderPrompt(TEMPLATES.calendar[locale()])
}

/** 该节点自己的提示词：标题用卡给它起的显示名 */
export function nodePrompt(card: CardData, id: string): string {
  const decl = card[K.KEY_DECL] as Record<string, unknown>
  const graph = decl[K.KEY_GRAPH] as Record<string, unknown>
  const nodes = graph[K.KEY_NODES] as Record<string, Record<string, unknown>>
  const prompts = (card[K.KEY_PROMPT] as Record<string, unknown>)[K.KEY_NODES] as Record<string, string[]>
  return `## ${nodes[id][K.KEY_NODE_NAME] as string}\n${prompts[id].join('\n')}`
}

/**
 * 公共部分的 system 消息：五块设定 + 剧本 + 历法 + 节点约定。
 *
 * ⚠️ **所有节点逐字相同**（决定 #26）：上游与逐节点提示词都不在这里。
 */
export function cardSystemPrompt(card: CardData): string {
  return joinSections([settingsPrompt(card), scriptPrompt(card), calendarPrompt(), conventionPrompt(card)])
}

/** 一次节点请求的输入：公共部分的三样（快照 / 历史 / 玩家原话）+ 本轮上游 + 节点 id */
export interface NodeRequestInput {
  card: CardData
  /** 世界状态快照（game/state.ts 的 snapshot / contextFor 那一套） */
  snapshot: string
  /** 全部历史（引擎手上那份，组合根负责它的窗口） */
  history: ChatMessage[]
  /** 玩家这一轮的原话；开场时是开场指令 */
  playerWords: string
  /** 排在本节点前面的节点本轮产出，按拓扑顺序 */
  upstream: UpstreamOutput[]
  /** 本节点的 id */
  node: string
}

/**
 * 该节点**必须输出哪些键**（卡的 `声明.图.节点[id].输出`）。
 *
 * ⚠️ 少了这一段，模型只知道「输出是一个 JSON 代码块」（节点约定），不知道键名 ——
 *    实测的直接后果：开场那一轮里 `story` 节点回一段散文，引擎解析「正文」失败、
 *    整轮回滚，玩家看到「生成开场失败」。键名是卡声明的，这里只负责把它念给模型听。
 */
export function nodeOutputPrompt(card: CardData, id: string): string {
  const decl = card[K.KEY_DECL] as Record<string, unknown>
  const graph = decl[K.KEY_GRAPH] as Record<string, unknown>
  const nodes = graph[K.KEY_NODES] as Record<string, Record<string, unknown>>
  return renderPrompt(TEMPLATES.output[locale()], {
    FIELDS: renderCardValue(nodes[id][K.KEY_OUTPUT]),
  })
}

/**
 * 拼出一次节点请求的消息列表：system（公共部分的设定/剧本/历法/约定）
 * → 全部历史 → user（当前状态快照 + 玩家原话 + 本轮上游 + 该节点提示词 + 它该输出的键）。
 *
 * ⚠️ 上游只含**已经跑完**的节点（决定 #26）；拿不到就不编（上游文本自己会跳过空产出）。
 */
export function buildNodeMessages(input: NodeRequestInput): ChatMessage[] {
  const task = joinSections([
    upstreamText(input.upstream),
    nodePrompt(input.card, input.node),
    nodeOutputPrompt(input.card, input.node),
  ])
  const user = joinSections([input.snapshot, input.playerWords, task])
  return [
    { role: 'system', content: cardSystemPrompt(input.card) },
    ...input.history,
    { role: 'user', content: user },
  ]
}

export function openingInstruction(): string {
  return renderPrompt(TEMPLATES.opening[locale()])
}

export function connectionTestPrompt(): string {
  return renderPrompt(TEMPLATES.connectionTest[locale()])
}
