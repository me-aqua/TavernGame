/**
 * src/game/save.ts —— 一份存档的形状与校验
 *
 * 这个模块处理的都是**外部数据**（用户能手改、能从文件导入），
 * 按纪律只有系统边界才做校验，所以校验集中在这里；
 * state.ts 只管「校验通过之后」的行为。
 *
 * ⚠️ 只认当前格式。产品未发布，没有旧存档要兼容 ——
 *    形状不对就拒绝（抛错），不做字段改名、不做版本迁移。
 *
 * 这里的函数都是纯函数；localStorage 的读写与坏档备份在 utils/storage.ts。
 */

import { nowIso } from '../utils/calendar'
import { t } from '../i18n'
import type { GameData, LogEntry, TimelineEntry } from '../types/state'

/** 日志与时间线的保留上限（写时裁剪；读档时也用它裁剪） */
export const MAX_LOG = 80
export const MAX_TIMELINE = 40

/** 能安全取属性的普通对象（null / 数组都不算） */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 时刻必须能被 Date 解析，否则用当前时间（比让整局卡死好） */
function pickIso(v: unknown): string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : nowIso()
}

/** 数组里只保留普通对象；顺带补齐关键字段，避免渲染层或 snapshot 抛错 */
function sanitizeLog(list: unknown): LogEntry[] {
  if (!Array.isArray(list)) return []
  return list
    .filter(isRecord)
    .map((x) => ({
      kind: String(x.kind || 'narration') as LogEntry['kind'],
      text: String(x.text ?? ''),
      at: typeof x.at === 'string' ? x.at : nowIso(),
    }))
    .slice(-MAX_LOG)
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
    log: [],
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
    log: sanitizeLog(s.log),
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
