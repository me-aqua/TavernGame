/**
 * src/game/save.ts —— 一份存档的形状、校验与卡的身份。
 *
 * 这里处理的都是**外部数据**（用户能手改、能从文件导入），按纪律只有系统边界
 * 才做校验，所以校验集中在这里；state.ts 只管「校验通过之后」的行为。
 *
 * 存档记的是 { meta: { turn, card }, state, events, timeline }：
 *   · state 就是卡的 instantiate() 那棵树（引擎不认识它的形状，只按卡的 schema 校验）——
 *     **这一局现在是几点也在里面**（`state.world.time`，R39：时刻是世界状态的一部分）；
 *   · card 是这一局的身份 —— 缺卡 / id / 版本 / 格式不同一律拒绝，不拿旧状态硬跑新卡。
 *
 * 事件流的分类与上限也在这一层：哪些 kind 算「故事」、哪些算「调试」、各留多少条
 * —— 这是形状的一部分，别处不许再写一份。
 *
 * 这里的函数都是纯函数；localStorage 的读写与坏档备份在 utils/storage.ts。
 */

import { nowIso } from '../utils/calendar'
import { checkSavedClock } from './card-time'
import { instantiate, validateValue, type StateTree } from './card-state'
import { at } from './card-read'
import { t } from '../i18n'
import type { CardData } from './card'
import type { BlockGroup, BlockLine, PromptBlock } from '../agent/prompts'
import type { CardIdentity, EventKind, GameData, GameEvent, StoryKind, TimelineEntry } from '../types/state'

/**
 * 调试痕迹的上限（写时裁剪；读档时也用它裁剪）。
 *
 * ⚠️ **只有调试这一路有上限**：故事事件一条都不裁 —— 它们同时是**模型的记忆**
 *    （用户 2026-09-18 拍板：从开局到现在的完整故事都留着，别管 token 成本），
 *    裁掉就等于模型失忆。见 trimEvents。
 */
export const MAX_DEBUG = 120
/** 时间线的上限（与事件流无关，本文件另一处用） */
export const MAX_TIMELINE = 40

/**
 * 全部已知的事件 kind。
 *
 * ⚠️ 写成 Record<EventKind, true> 而不是数组：漏掉一种 kind 编译器会当场报错
 *    （数组只能保证「写进来的都合法」，保证不了「该有的都在」）。
 */
const EVENT_KINDS: Record<EventKind, true> = {
  action: true,
  narration: true,
  node: true,
  thinking: true,
  request: true,
  model: true,
  tool: true,
  toolResult: true,
  stateChange: true,
  warn: true,
}

/**
 * 这是不是「故事」（玩家与模型该看到的那部分）。
 *
 * 故事 = 已经发生的事（玩家说了什么 + GM 写了什么）；调试 = 只有开发者在调试模式下
 * 要看的过程。界面投影、存档裁剪与模型记忆都用它 —— 判断标准只有这一处，别处不许再判。
 */
export function isStoryKind(kind: EventKind): kind is StoryKind {
  return kind === 'action' || kind === 'narration'
}

/**
 * 按类裁剪事件流：**只裁调试**，故事一条不动。
 *
 * ⚠️ 为什么故事不裁：它是**模型的记忆**（`trimEvents` 在写入与读档两条路上都跑），
 *    裁掉就等于模型忘了前面发生过什么。用户 2026-09-18 拍板留全部 ——
 *    压缩/摘要是以后的事，不是这里的上限该干的。
 *
 * ⚠️ 为什么调试仍要裁：调试开着时一个回合能产生十几条，不裁会把存档撑爆；
 *    而它**不许挤掉模型记忆**靠的就是「两路分开」——放宽故事 ≠ 顺手把调试也放宽。
 */
export function trimEvents(events: GameEvent[]): void {
  let count = events.filter((e) => !isStoryKind(e.kind)).length
  for (let i = 0; count > MAX_DEBUG && i < events.length;) {
    if (isStoryKind(events[i].kind)) {
      i += 1
    } else {
      events.splice(i, 1)
      count -= 1
    }
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ---------- 卡的身份 ----------

/** 一张卡的身份 —— 存档认亲用（名字只给人看，判亲只比 id / 版本 / 格式） */
export function identityOf(card: CardData): CardIdentity {
  return {
    id: card.card.id,
    name: card.card.name,
    version: card.card.version,
    format: card.card.format,
  }
}

/** 身份写成一行给人看的文本（报错信息里两边各说一次） */
function describeCard(identity: CardIdentity): string {
  return identity.id + '@' + identity.version + ' (' + identity.format + ')'
}

/**
 * 存档认亲：缺卡 / id / 版本 / 格式不同都抛错。
 *
 * 为什么不「尽力兼容」：存档里的 state 是按**另一张卡的 schema** 长的，
 * 拿它硬跑新卡就是拿一份形状对不上的数据去写界面与提示词 —— 拒绝并说明，
 * 玩家还能导出旧存档抢救（调用方负责备份）。
 */
function checkIdentity(saved: unknown, card: CardData): void {
  if (!isRecord(saved)) throw new Error(t('save.cardMissing'))
  const savedId = saved.id
  const savedVersion = saved.version
  const savedFormat = saved.format
  if (typeof savedId !== 'string' || typeof savedVersion !== 'string' || typeof savedFormat !== 'string') {
    throw new Error(t('save.cardMissing'))
  }
  const identity = identityOf(card)
  if (savedId !== identity.id || savedVersion !== identity.version || savedFormat !== identity.format) {
    const other = { id: savedId, name: savedId, version: savedVersion, format: savedFormat }
    throw new Error(t('save.cardMismatch', { saved: describeCard(other), current: describeCard(identity) }))
  }
}

// ---------- 新游戏的第一帧 ----------

/**
 * 新游戏的第一帧：状态树来自卡的 state（初值也在卡里，**时刻也在树里**）、
 * 身份来自卡的 card。引擎不写死任何一样（决定 #42）。
 */
export function createInitialState(card: CardData): GameData {
  return {
    meta: { turn: 0, card: identityOf(card) },
    state: instantiate(card),
    events: [],
    timeline: [],
  }
}

// ---------- 读档 ----------

/** 回合数必须是数字：字符串会被 endTurn 拼成 "51" */
function pickTurn(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/**
 * 存档里的时刻必须落在这张卡的历法里（月 13、时 24 都由 checkTime 拦下）。
 *
 * ⚠️ 时刻住在状态树里（`state.world.time`），所以这一道紧跟在 `pickState` 之后：
 *    形状由 schema 守（只认五个整数），**历法**那一道由这里补 —— 少了它，手改过的存档
 *    能带着月 13 进来，之后每一次念时刻都是一句胡话。
 * ⚠️ 缺那一格也拒（`clockIn` 抛）：那不是"少显示一行"，而是引擎没有时刻可用。
 */
function checkClock(card: CardData, state: StateTree): void {
  try {
    checkSavedClock(card.time.calendar, state)
  } catch (err) {
    throw new Error(t('save.badTime', { message: (err as Error).message }), { cause: err })
  }
}

/** 状态树按卡的 schema 校验：认不出的分支与对不上的值都拒绝（卡认亲之后 schema 就是同一份） */
function pickState(card: CardData, value: unknown): StateTree {
  if (!isRecord(value)) throw new Error(t('save.badState', { message: 'state must be an object' }))
  for (const [branch, branchValue] of Object.entries(value)) {
    const schema = card.state[branch]
    if (schema === undefined) {
      throw new Error(t('save.badState', { message: at('state', branch) + ': unknown branch' }))
    }
    const problem = validateValue(schema, branchValue, 'state.' + branch, true)
    if (problem !== null) throw new Error(t('save.badState', { message: problem }))
  }
  return value as StateTree
}

/**
 * 事件流的边界清洗：kind 不认识就丢掉（手改过的存档里什么都可能有），
 * text 缺失补空串，detail / node / tool / path 只收字符串，value 只收 stateChange 的。
 * 最后按类裁剪到上限。
 *
 * ⚠️ node / tool / path / blocks 是调试面板的结构化字段，必须跟着存档来回 ——
 *    丢了它们，面板就只能回去反解文案。
 */
function sanitizeEvents(list: unknown): GameEvent[] {
  if (!Array.isArray(list)) return []
  const events: GameEvent[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    if (typeof item.kind !== 'string' || !Object.hasOwn(EVENT_KINDS, item.kind)) continue
    const kind = item.kind as EventKind
    const event: GameEvent = {
      kind,
      text: String(item.text ?? ''),
      at: typeof item.at === 'string' ? item.at : nowIso(),
    }
    if (typeof item.detail === 'string') event.detail = item.detail
    if (typeof item.node === 'string') event.node = item.node
    if (typeof item.tool === 'string') event.tool = item.tool
    if (typeof item.path === 'string') event.path = item.path
    if (typeof item.failed === 'boolean') event.failed = item.failed
    if (kind === 'stateChange' && Object.hasOwn(item, 'value')) event.value = item.value
    if (Array.isArray(item.blocks)) {
      const blocks = item.blocks.filter(isBlockGroup)
      if (blocks.length) event.blocks = blocks
    }
    events.push(event)
  }
  trimEvents(events)
  return events
}

/** 一行能不能画：不认得的行整组丢掉，界面退回按原始文本显示（它总比画崩强） */
function isBlockLine(value: unknown): value is BlockLine {
  return (
    isRecord(value) && typeof value.text === 'string' && (value.kind === 'text' || value.kind === 'subhead')
  )
}

/** 一块能不能画：标题 + 层级 + 每一行 */
function isPromptBlock(value: unknown): value is PromptBlock {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    (value.level === 0 || value.level === 2) &&
    Array.isArray(value.lines) &&
    value.lines.every(isBlockLine)
  )
}

/** 一组能不能画：角色 + 组标签 + 每一块 */
function isBlockGroup(value: unknown): value is BlockGroup {
  const role = isRecord(value) ? value.role : undefined
  return (
    isRecord(value) &&
    (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') &&
    typeof value.title === 'string' &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isPromptBlock)
  )
}

/** 时间线数组的边界清洗（外部数据，逐项校验） */
function sanitizeTimeline(list: unknown): TimelineEntry[] {
  if (!Array.isArray(list)) return []
  return list
    .filter(isRecord)
    .map((x) => ({
      from: String(x.from ?? ''),
      to: String(x.to ?? ''),
      reason: String(x.reason ?? ''),
      minutes: Number.isFinite(Number(x.minutes)) && Number(x.minutes) >= 0 ? Number(x.minutes) : 0,
      at: typeof x.at === 'string' ? x.at : nowIso(),
    }))
    .slice(-MAX_TIMELINE)
}

/**
 * 把一份来路不明的存档整理成 GameData。
 *
 * 身份与形状是硬门槛（对不上就抛错，由调用方走坏存档路径：备份 + 说清 + 空白开局）；
 * 缺失的软字段（回合数 / 事件流 / 时间线）用自己的默认值补上。
 */
export function normalize(saved: unknown, card: CardData): GameData {
  if (!isRecord(saved)) throw new Error(t('save.notValid'))
  const meta = isRecord(saved.meta) ? saved.meta : {}
  checkIdentity(meta.card, card)
  const state = pickState(card, saved.state)
  checkClock(card, state)
  return {
    meta: { turn: pickTurn(meta.turn), card: identityOf(card) },
    state,
    events: sanitizeEvents(saved.events),
    timeline: sanitizeTimeline(saved.timeline),
  }
}

/** 解析导入的存档文本。不是有效存档（或不属于当前卡）就抛错。 */
export function parseSave(json: string, card: CardData): GameData {
  const parsed: unknown = JSON.parse(json)
  return normalize(parsed, card)
}
