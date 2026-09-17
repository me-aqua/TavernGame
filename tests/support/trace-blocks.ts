/**
 * 票 53 的共享夹具：把「发出去的请求」与「解析好的回复」交到两个测试文件手里。
 *
 * 为什么集中在这里：`tests/prompt-blocks.test.ts`（纯逻辑）与 `tests/trace-blocks-dom.test.ts`
 * （DOM）都要先装配一次**真请求**、再让引擎解析一次**真回复**（走 chat() 与假 fetch，一个真请求都不发）。
 * 各写一份必然走偏 —— 契约只认**发出去的那份请求体**，不认测试自己拼的对象。
 */
import { chat, type ChatReply } from '../../src/agent/llm'
import {
  buildNodeMessages,
  type BlockGroup,
  type BlockLine,
  type PromptBlock,
  type UpstreamOutput,
} from '../../src/agent/prompts'
import { saveConfig } from '../../src/agent/config'
import { toolSchemas } from '../../src/game/card-actions'
import { createInitialState } from '../../src/game/save'
import { i18n, t } from '../../src/i18n'
import { installFakeLlm, type FakeLlm, type FakeReply } from './fakeLlm'
import type { CardData } from '../../src/game/card'
import type { ChatMessage, GameEvent } from '../../src/types/state'

/** 假服务商的配置：chat() 的必填项，配好之后它才会真的拼请求体（请求由假 fetch 接住） */
export const TEST_PROVIDER = {
  provider: 'custom' as const,
  apiKey: 'k',
  apiBase: 'https://api.example.test/v1',
  model: 'm',
}

/** 玩家这一轮的原话（夹具，不是产品文案） */
export const PLAYER_WORDS = "Player's action: open the door"

/** 上游产出夹具：让 user 那条消息里出现「本轮上游」那一段 */
export const UPSTREAM_OUTPUT = 'UPSTREAM OUTPUT'

export const UPSTREAM: UpstreamOutput[] = [{ node: 'OUTLINE', output: UPSTREAM_OUTPUT }]

/**
 * 上一轮的一条故事事件（夹具）。
 *
 * ⚠️ 它非有不可：装配器**有条件**才写 `### 最近发生的事` 那一行（那一段是模型的记忆），
 *    events 空着的话「现在」块里一个小标题都没有 —— 断言会红，而红的原因是夹具空，
 *    不是被测行为错。
 */
export const EARLIER_STORY = 'EARLIER STORY LINE'

/** 一次用例里装了好几个假 fetch 时的登记簿 */
export interface FakeTracker {
  install(replies: FakeReply[]): FakeLlm
  restoreAll(): void
}

/**
 * 造一个假 fetch 登记簿。
 *
 * ⚠️ 还原必须**倒序**：第二次 install 存下的 original 是第一次那一份，
 *    只还原最后一个会把上一个假 fetch 留在 globalThis 上（下一条用例跑到别人的假响应上）。
 */
export function fakeTracker(): FakeTracker {
  const handles: FakeLlm[] = []
  return {
    /** 装一份假 fetch 并记在册上 */
    install(replies) {
      const handle = installFakeLlm(replies)
      handles.push(handle)
      return handle
    },
    /** 把这一条用例里装过的假 fetch 全部还原（倒序，见上） */
    restoreAll() {
      for (const handle of handles.reverse()) handle.restore()
      handles.length = 0
    },
  }
}

/** 假 fetch 记下来的**发出去的消息**（「拼回来逐字节相等」的另一边就是它） */
export function sentMessages(handle: FakeLlm, call: number): ChatMessage[] {
  const messages = handle.calls[call].body.messages
  if (!messages) throw new Error('the fake llm recorded no messages on call ' + call)
  return messages
}

/**
 * 把一次节点请求真的发一遍，返回**发出去的消息**与**那一行的原始文本**。
 *
 * 消息由 buildNodeMessages 装配（生产路径）、请求体由 chat() 拼（生产路径）、
 * 假 fetch 把它记下来 —— 断言拿到的就是模型真会读到的那份文本；
 * detail 与 stores/turn.ts 写痕迹时用的那份是同一个形状（请求体的缩进 JSON）。
 */
export async function nodeRequest(
  track: FakeTracker,
  card: CardData,
  node: string,
  options: { hint?: string; upstream?: UpstreamOutput[] } = {},
): Promise<{ sent: ChatMessage[]; detail: string }> {
  saveConfig(TEST_PROVIDER)
  const handle = track.install(['ok'])
  const data = createInitialState(card)
  // 这一轮**之前**的事件流：装一条故事事件进去，「现在 → 最近发生的事」那一段才有东西可写
  // （memoryUpTo = 这一轮的起点，所以它算历史、不算这一轮）
  const events: GameEvent[] = [{ kind: 'narration', text: EARLIER_STORY, at: '' }]
  const messages = buildNodeMessages({
    card,
    node,
    state: data.state,
    time: data.time,
    events,
    memoryUpTo: events.length,
    playerWords: PLAYER_WORDS,
    upstream: options.upstream ?? UPSTREAM,
    hint: options.hint,
  })
  await chat(messages, { tools: toolSchemas(card, node) })
  return { sent: sentMessages(handle, 0), detail: JSON.stringify(handle.calls[0].body, null, 2) }
}

/** 把一份响应体原样喂给 chat()，返回引擎解析好的回复（分块读的是它，不是手写的对象） */
export async function replyFrom(track: FakeTracker, envelope: Record<string, unknown>): Promise<ChatReply> {
  saveConfig(TEST_PROVIDER)
  track.install([{ body: envelope }])
  return chat([{ role: 'user', content: 'go' }])
}

/**
 * 取一条界面文案。
 *
 * ⚠️ key 不存在时 t() 会把 key 名原样打出来 —— 那样「中英两套都成立」这类断言会**静默变真**。
 *    所以这里当场停，失败信息直接点名缺哪个 key。
 */
export function label(key: string, named?: Record<string, string | number>): string {
  const text = named === undefined ? t(key) : t(key, named)
  if (text === key) throw new Error('locale key is missing: ' + key)
  return text
}

/** 切界面语言（tests/setup.ts 在每个用例前钉回 zh-CN，所以用例内切完不用还原） */
export function setLocale(locale: 'zh-CN' | 'en'): void {
  ;(i18n.global.locale as unknown as { value: string }).value = locale
}

/** 一行的原文：小标题要把 `### ` 标记补回来（原文里那一行就是这么写的） */
export function lineText(line: BlockLine): string {
  return line.kind === 'subhead' ? '### ' + line.text : line.text
}

/**
 * 一段的原文文本（各行按 `\n` 拼回来）。
 *
 * ⚠️ 这是**测试自己的拼法**：实现里那份 `prompts.blockText()` 是给界面算字数用的，
 *    拿它来做「拼回来 === 发出去的那条消息」就变成自己证明自己了。
 */
export function linesText(block: PromptBlock): string {
  return block.lines.map(lineText).join('\n')
}

/** 一段里的小标题（原文以 `### ` 开头的那几行），顺序 = 原文顺序，标题**不带**标记 */
export function subheads(block: PromptBlock): string[] {
  return block.lines.filter((line) => line.kind === 'subhead').map((line) => line.text)
}

/** 按块名取那一块；取不到当场停（返回 undefined 会让后面的断言静默变成假通过） */
export function blockNamed(groups: BlockGroup[], title: string): PromptBlock {
  const found = groups.flatMap((group) => group.blocks).find((block) => block.title === title)
  if (!found) throw new Error('no block titled ' + title)
  return found
}

/**
 * 把块拼回原文 —— 拼法就是**装配器的写法**：`## ` + 块名 + 换行 + 正文（`### ` 那层由 lineText 补回），
 * 段间一个空行；原文里没有标题行的那一段直接就是它的正文。
 * 与发出去的那条消息逐字节相等 = 「块的边界与行结构都只声明一次」的证明。
 */
export function reassemble(blocks: PromptBlock[]): string {
  return blocks
    .map(
      (block) =>
        (block.level === 0 ? '' : '#'.repeat(block.level) + ' ' + block.title + '\n') + linesText(block),
    )
    .join('\n\n')
}
