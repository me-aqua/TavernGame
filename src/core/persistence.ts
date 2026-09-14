/**
 * src/core/persistence.ts —— 存档的读写与校验
 *
 * 这个模块存在的理由：**localStorage 是系统边界**，
 * 里面放的是外部数据（用户能手改、能从文件导入、可能是旧版本写的）。
 * 按纪律，只有系统边界才做校验 —— 所以校验全部集中在这里，
 * `state.ts` 只管「校验通过之后」的行为。
 */

import { nowIso, DEFAULT_CALENDAR_ID } from './calendar'
import { t } from '../i18n'
import type { GameData, LogEntry, TimelineEntry } from '../types/state'

export const SAVE_KEY = 'tavernGame.save.v3'
export const LEGACY_KEYS = ['tavernGame.save.v2', 'tavernGame.save.v1']
const MAX_LOG = 80
const MAX_TIMELINE = 40

/** 能安全取属性的普通对象（null / 数组都不算） */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 时刻必须能被 Date 解析，否则回退到当前时间（比让整局卡死好） */
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

/**
 * 补齐缺失字段（比如存档里没有 time.calendar）。
 * 比整套迁移更稳：大部分情况只是少了个别字段。
 */
export function normalize(saved: unknown, fresh: GameData = createInitialState()): GameData {
  const s: Record<string, unknown> = isRecord(saved) ? saved : {}
  const meta = isRecord(s.meta) ? s.meta : {}
  const player = isRecord(s.player) ? s.player : {}
  const scene = isRecord(s.scene) ? s.scene : {}
  const time = isRecord(s.time) ? s.time : {}

  return {
    meta: { ...fresh.meta, ...meta, version: 3, turn: pickTurn(meta.turn) },
    player: { name: typeof player.name === 'string' && player.name ? player.name : fresh.player.name },
    scene: {
      name: typeof scene.name === 'string' && scene.name ? scene.name : fresh.scene.name,
      description:
        typeof scene.description === 'string' && scene.description
          ? scene.description
          : fresh.scene.description,
    },
    time: {
      iso: pickIso(time.iso),
      calendar: typeof time.calendar === 'string' && time.calendar ? time.calendar : DEFAULT_CALENDAR_ID,
    },
    log: sanitizeLog(s.log),
    timeline: sanitizeTimeline(s.timeline),
  }
}

/**
 * 从 v1 / v2 存档迁移。
 * 旧版是「第 N 天 · 第 M 段」，新版是绝对时刻，无法精确换算 ——
 * 所以从今天重新计时，但保留场景、日志、turn。
 */
export function migrateLegacy(old: unknown, fresh: GameData = createInitialState()): GameData {
  const o: Record<string, unknown> = isRecord(old) ? old : {}
  const meta = isRecord(o.meta) ? o.meta : {}
  const player = isRecord(o.player) ? o.player : {}
  const scene = isRecord(o.scene) ? o.scene : {}

  return {
    meta: { ...fresh.meta, turn: pickTurn(meta.turn), version: 3 },
    player: { name: typeof player.name === 'string' && player.name ? player.name : fresh.player.name },
    scene: {
      name: typeof scene.name === 'string' && scene.name ? scene.name : fresh.scene.name,
      description:
        typeof scene.description === 'string' && scene.description
          ? scene.description
          : fresh.scene.description,
    },
    time: { iso: fresh.time.iso, calendar: DEFAULT_CALENDAR_ID },
    log: sanitizeLog(o.log),
    timeline: sanitizeTimeline(o.timeline),
  }
}

/** 从 localStorage 读原始 JSON。没有存档返回 null；损坏则抛错（不静默开新局） */
export function readSave(): unknown | null {
  const raw = localStorage.getItem(SAVE_KEY)
  if (raw) {
    // 包一层上下文：JSON.parse 自己的报错（"Expected property name…"）
    // 对玩家毫无意义，必须说清是「存档坏了」
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed) || !isRecord(parsed.player)) {
        throw new Error(t('save.missingPlayer'))
      }
      return parsed
    } catch (err) {
      throw new Error(t('save.corrupted', { message: (err as Error).message }), { cause: err })
    }
  }
  for (const key of LEGACY_KEYS) {
    const legacy = localStorage.getItem(key)
    if (legacy) {
      console.info(t('save.migrating', { key }))
      return { __legacy: JSON.parse(legacy) as unknown }
    }
  }
  return null
}

/** 写存档。失败返回 false —— 调用方必须让玩家看到 */
export function writeSave(data: GameData): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
    return true
  } catch (err) {
    console.warn('[persistence] save failed', err)
    return false
  }
}

/** 新游戏的初始状态 */
export function createInitialState(): GameData {
  return {
    meta: {
      version: 3,
      createdAt: new Date().toISOString(),
      turn: 0,
    },
    player: {
      name: t('player.defaultName'),
    },
    // ⚠️ Empty means "no scene yet" — the display name is supplied by the UI
    // layer (GameState.scene) so it follows the current language. Baking the
    // default in here froze it into the save: a game created in English kept
    // showing "Unknown place" after switching the UI to Chinese.
    scene: {
      name: '',
      description: '',
    },
    time: {
      iso: nowIso(),
      calendar: DEFAULT_CALENDAR_ID,
    },
    log: [],
    timeline: [],
  }
}

/** 启动读档的结果：没有存档时 data 为 null（调用方自己开新局） */
export function loadState(): { data: GameData | null; error: string | null } {
  try {
    const raw = readSave()
    if (raw === null) return { data: null, error: null }
    if (typeof raw === 'object' && raw !== null && '__legacy' in raw) {
      return {
        data: migrateLegacy((raw as { __legacy: unknown }).__legacy, createInitialState()),
        error: null,
      }
    }
    return { data: normalize(raw, createInitialState()), error: null }
  } catch (err) {
    // 存档存在但读不出来 = 数据受损。不静默开新局：
    // 把坏数据另存一份（玩家还有机会导出），把原因交给调用方去提示玩家。
    const broken = localStorage.getItem(SAVE_KEY)
    if (broken) {
      // 只保留最新一份备份：否则每次启动都新建一个键，会无限堆积把配额吃光
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i)
        if (k?.startsWith(`${SAVE_KEY}.broken-`)) localStorage.removeItem(k)
      }
      localStorage.setItem(`${SAVE_KEY}.broken-${Date.now()}`, broken)
    }
    return { data: null, error: (err as Error).message }
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
