/**
 * src/agent/prompts.ts —— 提示词装配器
 *
 * ⚠️ **这里不放任何提示词内容**：
 *   · 卡里的提示词（五块设定 / 剧本 / 节点约定 / 生成器 / 逐节点）从卡取 —— 那才是作者改的地方；
 *   · 引擎自带的说明在 `prompts/<lang>/*.md`（构建期编码成虚拟模块）。
 * 本文件的职责只有五件：
 *   1. 把构建期编码的提示词解码成字符串
 *   2. **按当前界面语言选那一套**（模型语言跟随界面语言，见 doc/DESIGN.md 决定 #19）
 *   3. 按卡的声明拼出一次节点请求：system（设定 + 剧本 + 规矩 + 该节点点名的生成器）
 *      + user（现在 / 玩家 / 上游 / 该节点提示词）；「现在」里的最近发生的事就是模型的记忆
 *   4. 填占位符并**确认没有漏填**
 *   5. **把拼出去的消息按段交出来**（requestBlocks / blockText）—— 段的边界与行结构
 *      只在这里定义；调试界面按块渲染的就是它，界面自己一行都不切
 *
 * ⚠️ 引擎**不解析模型输出**（决定 #46）：这里只拼请求，不声明「节点该输出哪些键」——
 *    要引擎做的事一律走原生工具调用，工具的名字与说明由 toolSchemas() 经原生 tools
 *    协议交给模型，**提示词里不再重复一份**。
 *
 * ⚠️ 状态**每个节点请求前重新渲染**（工具会改状态，后面的节点就该看到最新的真相）；
 *    节点的 reads 决定它看得见哪几块状态（卡里的结构约束，不是提示词里的请求）。
 *
 * ⚠️ 卡是**已校验**的数据（game/card.ts 是唯一的形状边界），这里只读不判。
 */

// 提示词以 base64 随包发布：源文件 prompts/<lang>/*.md，由 vite-plugins/prompts.ts
// 在**构建期**转成虚拟模块（不产生中间文件，所以没有「忘了重新编码」这种失败模式）。
// 为什么编码：见 prompts/README.md —— 主要是**彻底避开转义坑**（反引号/换行/引号/中文）。
// ⚠️ 这是编码不是加密：客户端字符串永远拿得到，别把需要保密的东西放进来。
import { t, i18n, type Locale } from '../i18n'
import openingZh from 'virtual:prompt/zh-CN/opening'
import openingEn from 'virtual:prompt/en/opening'
import connectionTestZh from 'virtual:prompt/zh-CN/connection-test'
import connectionTestEn from 'virtual:prompt/en/connection-test'

import { format as formatCalendar, type TimeValue } from '../game/card-calendar'
import { renderState, type StateTree } from '../game/card-state'
import { isRecord, isStoryKind } from '../game/save'
import type { CardData, Generator } from '../game/card'
import type { ChatMessage, GameEvent } from '../types/state'

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
  opening: { 'zh-CN': decodePrompt(openingZh), en: decodePrompt(openingEn) },
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

/** 把若干段拼成给模型的一段文本：空段丢掉、连续空行折成一行 */
function joinSections(sections: string[]): string {
  return renderPrompt(sections.filter(Boolean).join('\n\n'))
}

/** 一段带标题的文本（标题走 locale：模型语言跟随界面语言）—— 内容为空时整段不存在 */
function section(title: string, body: string): string {
  return body ? '## ' + title + '\n' + body : ''
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
      .map(([key, item]) => pad + key + ':\n' + renderCardValue(item, level + 1))
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

/**
 * 卡的五块设定里，**这个节点**读得到的那几块：每块一节，顺序 = 卡里声明的顺序
 * （世界 / 核心 / 常见 / 风格 / 主控）。
 *
 * 节点的 `settings` 声明要哪几块（不写 = 五块全发）—— 这里是**筛**，不重排：
 * 用户写的顺序不影响块的先后（见 doc/DESIGN.md 决定 #52）。
 *
 * 块的标题走 locale —— 卡里的键是 ASCII，给模型看的名字不该是一串机器标识符。
 */
export function settingsPrompt(card: CardData, node: string): string {
  const keys = card.graph.nodes[node].settings ?? Object.keys(card.settings)
  const blocks = Object.entries(card.settings)
    .filter(([key]) => keys.includes(key))
    .map(([key, lines]) => '### ' + t('prompts.settingBlock.' + key) + '\n' + lines.join('\n'))
  return section(t('prompts.setting'), blocks.join('\n\n'))
}

/** 卡的剧本：AI 知道、玩家不知道的那部分世界真相 */
export function scriptPrompt(card: CardData): string {
  return section(t('prompts.script'), renderCardValue(card.script))
}

/** 节点约定：每个节点都要知道自己在图里的位置与输出规矩（决定 #26：它也进上下文） */
export function conventionPrompt(card: CardData): string {
  return section(t('prompts.convention'), card.convention.join('\n'))
}

/**
 * 该节点 uses 点名的生成器（不写 = 不带生成器）。
 *
 * 生成器是**给模型的指令**（「没长出来的东西怎么长」），不是状态 —— 所以它不进状态快照，
 * 只给点名的节点。
 */
export function generatorsPrompt(card: CardData, node: string): string {
  const names = card.graph.nodes[node].uses
  if (names === undefined || names.length === 0) return ''
  const byName = new Map(card.generators.map((generator) => [generator.name, generator]))
  const parts = names.map((name) => {
    // uses 的名字在卡校验期已经确认存在（card.ts 的 checkUses），这里直接读
    const generator = byName.get(name) as Generator
    const principles = generator.principles.map((line) => '- ' + line).join('\n')
    return (
      '### ' +
      generator.name +
      '\n' +
      t('prompts.generatorApplies', { text: generator.applies }) +
      '\n' +
      principles
    )
  })
  return section(t('prompts.generators'), parts.join('\n\n'))
}

/** 该节点自己的提示词：标题用卡给它起的显示名 */
export function nodePrompt(card: CardData, id: string): string {
  const node = card.graph.nodes[id]
  return section(node.name, node.prompt.join('\n'))
}

/**
 * 公共部分的 system 消息：该节点读得到的设定块 + 剧本 + 节点约定 + 该节点点名的生成器。
 *
 * ⚠️ **所有节点各自一份**（决定 #26）：上游与逐节点提示词都不在这里；
 *    工具的名字与说明也不在这里 —— 它们只走原生 tools 协议。
 * ⚠️ 设定块按节点自己的声明筛（决定 #52）：引擎不认识任何节点名，
 *    「谁读哪几块」只由卡说了算。
 */
export function cardSystemPrompt(card: CardData, node: string): string {
  return joinSections([
    settingsPrompt(card, node),
    scriptPrompt(card),
    conventionPrompt(card),
    generatorsPrompt(card, node),
  ])
}

/** 上游节点**本轮**的产出：节点显示名 + 它的产出原文 */
export interface UpstreamOutput {
  /** 产出它的节点显示名（拼进段落标题） */
  node: string
  /** 该节点本轮的产出原文 —— 原样累加，引擎不改写 */
  output: string
}

/**
 * 把本轮上游产出拼成一段文本：每段一条标题 + 产出原文，顺序就是调用方给的顺序。
 *
 * ⚠️ 空产出 / 缺字段 = 这个节点本轮没有结论可传：跳过它，而不是替它编一段
 *    （「拿不到的就别猜」是决定 #26 那条纪律）。
 */
export function upstreamText(upstream: UpstreamOutput[] = []): string {
  const parts: string[] = []
  for (const item of upstream) {
    if (!item?.node || !item?.output) continue
    parts.push('### ' + t('prompts.upstreamNode', { node: item.node }) + '\n' + item.output)
  }
  return parts.length ? section(t('prompts.upstream'), parts.join('\n\n')) : ''
}

/**
 * 「最近发生的事」取事件流尾部多少条故事事件（action + narration）。
 *
 * 8 ≈ 最近四轮（一轮 = 一条 action + 一条 narration）：够接上前文的口吻与正在进行的
 * 那件事，又不至于把四轮 300–800 字的正文都塞进**九个节点各自**的请求里。
 *
 * ⚠️ 它是**模型唯一的长期记忆**：事件流进存档，内存里的东西一概不留 —— 刷新之后
 *    模型仍然读得到前面发生过什么（旧实现靠内存里的对话历史，刷新即失忆）。
 */
export const RECENT_STORY = 8

/**
 * 历史里最近的故事事件，一行一条：玩家说了什么、GM 写了什么。
 *
 * ⚠️ 只看 `memoryUpTo` **之前**的事件：这一轮的原话（action）在事件流里已经写下了
 *    （顺序必须正确），但它同时就在「## 玩家」那一段里 —— 再出现在历史里，模型会以为
 *    玩家说了两遍。
 */
function renderRecent(events: GameEvent[], memoryUpTo: number): string {
  return events
    .slice(0, memoryUpTo)
    .filter((event) => isStoryKind(event.kind))
    .slice(-RECENT_STORY)
    .map((event) => {
      const who = event.kind === 'action' ? t('prompts.player') : t('prompts.gm')
      return t('prompts.recentLine', { who, text: event.text.replace(/\s+/g, ' ') })
    })
    .join('\n')
}

/** 一次节点请求的输入：这一局的真相 + 模型要的全部上下文 */
export interface NodeRequestInput {
  card: CardData
  /** 本节点的 id */
  node: string
  /** 工作副本里的状态树（**每个节点请求前重新渲染**） */
  state: StateTree
  /** 工作副本里的时刻（按卡的历法渲染） */
  time: TimeValue
  /**
   * 工作副本里的事件流 —— 模型记忆的唯一来源。
   *
   * ⚠️ 每个节点请求前**重新渲染**：工具改状态、本轮前面节点的结论都不在事件流里，
   *    但「玩家刚说了什么」在本轮开始时就已经写进去了，于是每个节点都看得到。
   */
  events: GameEvent[]
  /**
   * 渲染「最近发生的事」时的分界：只看这个下标**之前**的事件。
   *
   * 它是这一轮开始时事件流的长度 —— 历史只给这一轮之前的事，这一轮的原话在「## 玩家」里。
   */
  memoryUpTo: number
  /** 玩家这一轮的原话；开场时是引擎的开场指令 + 卡里的开局要求 */
  playerWords: string
  /** 排在本节点前面的节点本轮产出，按拓扑顺序 */
  upstream: UpstreamOutput[]
  /** redo 之后重跑这个节点时的系统提示（哪里不对、谁要求重来）；不传 = 正常跑 */
  hint?: string
}

/**
 * 拼出一次节点请求的消息列表：system（设定 / 剧本 / 规矩 / 生成器）
 * → （重跑时的系统提示）→ user（现在 / 玩家 / 上游 / 该节点提示词）。
 *
 * 「现在」= 时间（按卡的历法）+ 状态树（按节点的 reads 裁）+ 最近发生的事（这一轮之前）。
 *
 * ⚠️ 上游只含**已经跑完**的节点（决定 #26）；拿不到就不编（上游文本自己会跳过空产出）。
 */
export function buildNodeMessages(input: NodeRequestInput): ChatMessage[] {
  const node = input.card.graph.nodes[input.node]
  const recent = renderRecent(input.events, input.memoryUpTo)
  const now = section(
    t('prompts.now'),
    [
      t('prompts.timeLine', { time: formatCalendar(input.card.time.calendar, input.time) }),
      renderState(input.state, { reads: node.reads }),
      recent ? '### ' + t('prompts.recent') + '\n' + recent : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
  const user = joinSections([
    now,
    section(t('prompts.player'), input.playerWords),
    upstreamText(input.upstream),
    nodePrompt(input.card, input.node),
  ])
  const messages: ChatMessage[] = [{ role: 'system', content: cardSystemPrompt(input.card, input.node) }]
  // 重跑：把「哪里不对、谁要求重来」作为一条系统提示交给它（就放在这一轮的任务之前）
  if (input.hint) messages.push({ role: 'system', content: input.hint })
  messages.push({ role: 'user', content: user })
  return messages
}

/**
 * 块正文的一行。
 *
 * ⚠️ 行结构由**装配器**交出：界面一行都不许自己切提示词 —— 切错了不会报错，
 *    只会静默显示成另一副样子（本文件的 `## ` 与 `### ` 才是这两种行的定义处）。
 */
export interface BlockLine {
  /** subhead = 原文里以 `### ` 开头的那一行（小标题） */
  kind: 'text' | 'subhead'
  /** text：这一行的逐字原文（**空行就是空串**）；subhead：标题（**不含** `### `） */
  text: string
}

/** 提示词里的一段：`section()` 写出来的 `## ` 段（level 2），或一条没有标题行的消息整体（level 0） */
export interface PromptBlock {
  title: string
  /** 原文标题行的 `#` 个数：2 = `## `；0 = 这一段在原文里没有标题行 */
  level: 0 | 2
  /** 正文按行交出，顺序 = 原文顺序；空行也是一行 */
  lines: BlockLine[]
}

/** 一条消息的分块结果（调试界面按组分节显示） */
export interface BlockGroup {
  role: ChatMessage['role']
  /** 组标签：标签是**数据**，界面不自己按角色猜 */
  title: string
  blocks: PromptBlock[]
}

/** 一行按结构交出去：原文里以 `### ` 开头的那一行是小标题（标题不带标记） */
const lineOf = (text: string): BlockLine =>
  text.startsWith('### ') ? { kind: 'subhead', text: text.slice(4) } : { kind: 'text', text }

/** 一行的原文：小标题要把 `### ` 标记补回去（`lineOf` 的反向） */
const textOf = (line: BlockLine): string => (line.kind === 'subhead' ? '### ' + line.text : line.text)

/**
 * 把一条消息的正文切回它被装配时的那几段。
 *
 * 段的边界 = `section()` 写出来的 `## ` 标题行，而两段之间隔着一个**空行**
 * （joinSections 的 '\n\n'）—— 所以只有「消息的第一行」与「紧跟空行的那一行」才是段头。
 * 玩家原话里自己写的 `## ` 行因此不另起一段，它前后一个字节都不会丢。
 *
 * 一条**没有** `## ` 段的消息（重跑提示 / assistant / tool）整体是一块，块名用组标签。
 */
function blocksOf(content: string, fallbackTitle: string): PromptBlock[] {
  if (content === '') return []
  const lines = content.split('\n')
  const starts = [0]
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i - 1] === '' && lines[i].startsWith('## ')) starts.push(i)
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length
    const heading = lines[start].startsWith('## ') ? lines[start].slice(3) : null
    const body = lines.slice(heading === null ? start : start + 1, end)
    // 段间那个空行是**分隔符**：拼回去时由 joinSections 的 '\n\n' 负责，正文里不再留一份
    if (end < lines.length && body[body.length - 1] === '') body.pop()
    return { title: heading ?? fallbackTitle, level: heading === null ? 0 : 2, lines: body.map(lineOf) }
  })
}

/** 一段没有标题行的正文（回复那一侧的三块都是这种）：块名由调用方给 */
export function textBlock(title: string, body: string): PromptBlock {
  return { title, level: 0, lines: body.split('\n').map(lineOf) }
}

/**
 * 把一次请求里的消息切成分块清单（调试界面用）。
 *
 * 一条消息一组，顺序 = 数组顺序；块名与组名走 locale —— 界面切英文时它们跟着换，
 * 因为模型读到的提示词本来就跟着界面语言走（决定 #19）。
 */
export function requestBlocks(messages: ChatMessage[]): BlockGroup[] {
  return messages.map((message, index) => {
    // 第二条 system 消息是重跑提示：装配器只在带 hint 时插它（见 buildNodeMessages）
    const hinted = message.role === 'system' && messages.slice(0, index).some((m) => m.role === 'system')
    const title = t(hinted ? 'debug.role.redoHint' : 'debug.role.' + message.role)
    return { role: message.role, title, blocks: blocksOf(message.content, title) }
  })
}

/**
 * 这一段拼回原文的文本（各行按 `\n` 拼回来，小标题补回 `### `）。
 *
 * ⚠️ 界面拿它算字数，于是不必自己知道标记该补在哪一行。
 */
export function blockText(block: PromptBlock): string {
  return block.lines.map(textOf).join('\n')
}

/** 引擎自带的开场指令（卡里的开局要求由调用方接在它后面） */
export function openingInstruction(): string {
  return renderPrompt(TEMPLATES.opening[locale()])
}

export function connectionTestPrompt(): string {
  return renderPrompt(TEMPLATES.connectionTest[locale()])
}
