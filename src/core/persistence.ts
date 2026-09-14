/**
 * src/core/persistence.ts —— 存档的进出与校验
 *
 * 这个模块处理的都是**外部数据**（用户能手改、能从文件导入），
 * 按纪律只有系统边界才做校验，所以校验集中在这里；
 * state.ts 只管「校验通过之后」的行为。
 *
 * ⚠️ 只认当前格式。产品未发布，没有旧存档要兼容 ——
 *    形状不对就拒绝（返回 null 或抛错），不做字段改名、不做版本迁移。
 */

import { nowIso } from './calendar'
import { t } from '../i18n'
import type { GameData, LogEntry, TimelineEntry } from '../types/state'

export const SAVE_KEY = 'tavernGame.save'

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
    meta: { createdAt: new Date().toISOString(), turn: 0 },
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

/**
 * 读存档：没有返回 null；存在但读不出来抛错（调用方负责提示玩家）。
 *
 * ⚠️ 两种失败要分开报：JSON 解析不了 = 存档坏了（附上解析器的原话），
 * 解析得出来但形状不对 = 缺 player 字段。混成一条会让玩家看不懂是哪种。
 */
export function readSave(): unknown | null {
  const raw = localStorage.getItem(SAVE_KEY)
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(t('save.corrupted', { message: (err as Error).message }), { cause: err })
  }
  if (!isRecord(parsed) || !isRecord(parsed.player)) {
    throw new Error(t('save.missingPlayer'))
  }
  return parsed
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

/** 启动读档的结果：没有存档时 data 为 null（调用方自己开新局） */
export function loadState(): { data: GameData | null; error: string | null } {
  try {
    const raw = readSave()
    if (raw === null) return { data: null, error: null }
    return { data: normalize(raw, createInitialState()), error: null }
  } catch (err) {
    // 存档存在但读不出来 = 数据受损。不静默开新局：
    // 把坏数据另存一份（玩家还有机会导出），把原因交给调用方去提示玩家。
    const broken = localStorage.getItem(SAVE_KEY)
    if (broken) {
      // 只保留最新一份备份：否则每次启动都新建一个键，会无限堆积把配额吃光
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i)
        if (k?.startsWith(SAVE_KEY + '.broken-')) localStorage.removeItem(k)
      }
      localStorage.setItem(SAVE_KEY + '.broken-' + Date.now(), broken)
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
