/**
 * src/game/save.ts —— 一份存档的形状与校验
 *
 * 这里处理的都是**外部数据**（用户能手改、能从文件导入），按纪律只有系统边界
 * 才做校验，所以校验集中在这里；state.ts 只管「校验通过之后」的行为。
 *
 * ⚠️ 只认当前格式。产品未发布，没有旧存档要兼容 —— 形状不对就拒绝（抛错），
 *    不做字段改名、不做版本迁移。
 *
 * 事件流的分类与上限也在这一层：哪些 kind 算「故事」、哪些算「调试」、各留多少条
 * —— 这是形状的一部分，别处不许再写一份。
 *
 * 这里的函数都是纯函数；localStorage 的读写与坏档备份在 utils/storage.ts。
 */

import { nowIso } from '../utils/calendar'
import { t } from '../i18n'
import type { EventKind, GameData, GameEvent, StoryKind, TimelineEntry } from '../types/state'

/** 事件流的两类上限（写时裁剪；读档时也用它裁剪）—— 分别计数，见 trimEvents */
export const MAX_STORY = 80
export const MAX_DEBUG = 120
export const MAX_TIMELINE = 40

/**
 * 全部已知的事件 kind。
 *
 * ⚠️ 写成 Record<EventKind, true> 而不是数组：漏掉一种 kind 编译器会当场报错
 *    （数组只能保证「写进来的都合法」，保证不了「该有的都在」）。
 */
const EVENT_KINDS: Record<EventKind, true> = {
  narration: true,
  action: true,
  system: true,
  request: true,
  reply: true,
  tool: true,
  toolResult: true,
  warn: true,
}

/**
 * 这是不是「故事」（玩家与模型该看到的那部分）。
 *
 * 故事 = 已经发生的事；调试 = 只有开发者在调试模式下要看的过程。
 * 界面投影与模型快照都用它筛选 —— 判断标准只有这一处，别处不许再判一次。
 */
export function isStoryKind(kind: EventKind): kind is StoryKind {
  return kind === 'narration' || kind === 'action' || kind === 'system'
}

/**
 * 按类裁剪事件流：故事与调试**各算各的上限**。
 *
 * ⚠️ 这就是「调试噪声不许挤掉模型记忆」的实现：如果只按总条数裁，
 *    调试开着时一个回合能产生十几条调试事件，几十个回合后模型能看到的
 *    故事就只剩最近几百字了。
 */
export function trimEvents(events: GameEvent[]): void {
  trimKind(events, isStoryKind, MAX_STORY)
  trimKind(events, (kind) => !isStoryKind(kind), MAX_DEBUG)
}

/** 把某一类裁到上限（丢最旧的），其余条目的相对顺序不变 */
function trimKind(events: GameEvent[], pick: (kind: EventKind) => boolean, max: number): void {
  let count = events.filter((e) => pick(e.kind)).length
  for (let i = 0; count > max && i < events.length;) {
    if (pick(events[i].kind)) {
      events.splice(i, 1)
      count -= 1
    } else {
      i += 1
    }
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 时刻必须能被 Date 解析，否则用当前时间（比让整局卡死好） */
function pickIso(v: unknown): string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : nowIso()
}

/**
 * 事件流的边界清洗：kind 不认识就丢掉（手改过的存档里什么都可能有），
 * text 缺失补空串，detail 只接受字符串。最后按类裁剪到上限。
 */
function sanitizeEvents(list: unknown): GameEvent[] {
  if (!Array.isArray(list)) return []
  const events = list
    .filter(isRecord)
    .filter((x) => typeof x.kind === 'string' && Object.hasOwn(EVENT_KINDS, x.kind))
    .map((x) => ({
      kind: x.kind as EventKind,
      text: String(x.text ?? ''),
      ...(typeof x.detail === 'string' ? { detail: x.detail } : {}),
      at: typeof x.at === 'string' ? x.at : nowIso(),
    }))
  trimEvents(events)
  return events
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
      elapsedMs: Number.isFinite(Number(x.elapsedMs)) ? Number(x.elapsedMs) : 0,
      at: typeof x.at === 'string' ? x.at : nowIso(),
    }))
    .slice(-MAX_TIMELINE)
}

/** 回合数必须是数字：字符串会被 endTurn 拼成 "51" */
function pickTurn(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** 新游戏的初始状态（场景名与描述留空，由界面按当前语言现取） */
export function createInitialState(): GameData {
  return {
    meta: { turn: 0 },
    player: { name: t('player.defaultName') },
    scene: { name: '', description: '' },
    time: { iso: nowIso() },
    events: [],
    timeline: [],
  }
}

/**
 * 把一份来路不明的数据整理成 GameData。
 * 缺失的字段用 fresh 补上（手改坏一个字段不该让整局打不开）。
 */
export function normalize(saved: unknown, fresh: GameData = createInitialState()): GameData {
  const s: Record<string, unknown> = isRecord(saved) ? saved : {}
  const meta = isRecord(s.meta) ? s.meta : {}
  const player = isRecord(s.player) ? s.player : {}
  const scene = isRecord(s.scene) ? s.scene : {}
  const time = isRecord(s.time) ? s.time : {}

  return {
    meta: { ...fresh.meta, ...meta, turn: pickTurn(meta.turn) },
    player: { name: typeof player.name === 'string' && player.name ? player.name : fresh.player.name },
    scene: {
      name: typeof scene.name === 'string' ? scene.name : fresh.scene.name,
      description: typeof scene.description === 'string' ? scene.description : fresh.scene.description,
    },
    time: { iso: pickIso(time.iso) },
    events: sanitizeEvents(s.events),
    timeline: sanitizeTimeline(s.timeline),
  }
}

/** 解析导入的存档文本。不是有效存档就抛错。 */
export function parseSave(json: string): GameData {
  const parsed: unknown = JSON.parse(json)
  // 至少要是个对象、且 player 是对象 —— 只判 player 会放过 {"player": 1}
  if (!isRecord(parsed) || !isRecord(parsed.player)) {
    throw new Error(t('save.notValid'))
  }
  return normalize(parsed, createInitialState())
}
