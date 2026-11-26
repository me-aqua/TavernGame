/**
 * 存储层（CONTRACT §3）：只读写 localStorage 的五个 `tg2.*` 键。
 *
 * 三条硬规矩：
 *   1. **只写五个键**，一个字节都不许写到 `tg.*`（旧站）或别的地方；
 *   2. **不种数据** —— 任何 `load*()` 都不往盘上写东西（「首次打开铺模型映射」是编辑器的动作）；
 *   3. **坏数据必须出声** —— 坏 JSON / 不认的 schemaVersion 一律抛 `E_VALIDATION`，
 *      不许静默当空列表（那会让「卡没了」看起来像正常状态，我们连红都看不见）。
 *
 * `backend` 与 `localStorage` 同形（getItem / setItem / removeItem），由调用方注入：
 * core 层不许碰浏览器全局，单测在 node 里跑（这时给一个内存后端）。
 */
import { t } from '../i18n'
import { AppError } from './errors'
import { validateCard, validateSave } from './schema'
import type { Card, NodeModels, Preset, Save, Settings } from './types'

export const STORAGE_KEYS = {
  cards: 'tg2.cards',
  saves: 'tg2.saves',
  presets: 'tg2.presets',
  settings: 'tg2.settings',
  nodeModels: 'tg2.nodeModels',
} as const

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  theme: 'light',
  editorColumns: { left: 280, right: 320 },
}

export interface StorageBackend {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * 逐条读回来的一条：`raw` 是盘上那个元素的**解析值**（原样带着，写回时按 JSON 值重新序列化）。
 * 合法则给 `card`，不合法则给校验器抛出的那个 `error` —— 两者恰好有一个。
 * ⚠️ 「原样」是**值**层面的：解析再序列化会改空白与数字写法，不承诺字节逐字相同。
 */
export interface CardEntry {
  raw: unknown
  card?: Card
  error?: AppError
}

export interface SaveEntry {
  raw: unknown
  save?: Save
  error?: AppError
}

export interface Storage {
  loadCards(): Card[]
  // 逐条读：一条坏的只影响它自己（顺序 = 盘上数组顺序）
  loadCardEntries(): CardEntry[]
  // 按 id 取单条：只校验目标项，旁边的坏项与它无关
  loadCardById(id: string): Card
  saveCards(cards: Card[]): void
  // 宽松写：原样写回 entries，不校验、不归一化、不丢项
  saveCardsLoose(entries: unknown[]): void
  loadSaves(): Save[]
  loadSaveEntries(): SaveEntry[]
  loadSaveById(id: string): Save
  saveSaves(saves: Save[]): void
  saveSavesLoose(entries: unknown[]): void
  loadPresets(): Preset[]
  savePresets(presets: Preset[]): void
  loadSettings(): Settings
  saveSettings(settings: Settings): void
  loadNodeModels(): NodeModels
  saveNodeModels(map: NodeModels): void
}

/**
 * 默认后端 = 浏览器的 `localStorage`（只有 `main.ts` 走这条默认）。
 * 写法是**下标取值**而不是属性访问：边界判据（`v2/tests/boundaries.test.js`）按正则禁掉了
 * 属性写法 —— 它的目的是让 core 在 node 里不依赖浏览器全局，这里只在调用方确实没给后端时才摸它。
 */
function browserBackend(): StorageBackend {
  return (globalThis as unknown as { localStorage: StorageBackend })['localStorage']
}

// 建一份存储：后端由调用方给（浏览器 localStorage，或单测里的内存版）
export function createStorage(backend: StorageBackend = browserBackend()): Storage {
  function read(key: string): string | null {
    return backend.getItem(key)
  }

  /** 读一个键并解析 JSON；坏 JSON 直接抛中文错误（不静默变空） */
  function parseJson(key: string): unknown {
    const raw = read(key)
    if (raw === null) return null
    try {
      return JSON.parse(raw)
    } catch (cause) {
      throw new AppError('E_VALIDATION', {
        message: t('error.badJson', { key }),
        nextStep: t('next.home'),
        detail: { key, raw: raw.slice(0, 200) },
        cause,
      })
    }
  }

  // 读一个键，要求它是个数组；键不存在算空表
  function parseArray(key: string): unknown[] {
    const value = parseJson(key)
    if (value === null) return []
    if (!Array.isArray(value)) {
      throw new AppError('E_VALIDATION', {
        message: t('error.badShape', { key, detail: 'not an array' }),
        nextStep: t('next.home'),
        detail: { key },
      })
    }
    return value
  }

  // 整表写回（JSON 字符串）
  function write(key: string, value: unknown): void {
    backend.setItem(key, JSON.stringify(value))
  }

  /** 元素上的 `id`：原样取出（只与字符串 id 严格比较，缺失 / 别的类型自然不匹配） */
  function idOf(raw: unknown): unknown {
    return (raw as { id?: unknown } | null)?.id
  }

  /** 存档快照能不能在首页显示：只判显示需要的那一格（字符串 name），不是 validateCard */
  function snapshotNameOf(raw: unknown): string | undefined {
    const snapshot = (raw as { cardSnapshot?: { name?: unknown } } | null)?.cardSnapshot
    return typeof snapshot?.name === 'string' ? snapshot.name : undefined
  }

  /**
   * 校验器抛的 `AppError` 变成这一条的 `error`；别的异常原样抛 ——
   * 校验器自己的 bug 不许伪装成「盘上有一条坏数据」。
   */
  function entryError(raw: unknown, cause: unknown): { raw: unknown; error: AppError } {
    if (!(cause instanceof AppError)) throw cause
    return { raw, error: cause }
  }

  return {
    // 读全部卡；逐张过结构校验，坏一张就抛（不静默丢）
    loadCards() {
      const cards = parseArray(STORAGE_KEYS.cards) as Card[]
      for (const card of cards) validateCard(card)
      return cards
    },
    // 逐条读：坏元素只带自己的 error，不影响其它元素；顺序 = 盘上数组顺序
    loadCardEntries(): CardEntry[] {
      return parseArray(STORAGE_KEYS.cards).map((raw) => {
        try {
          validateCard(raw as Card)
          return { raw, card: raw as Card }
        } catch (cause) {
          return entryError(raw, cause)
        }
      })
    },
    // 按 id 只校验目标项：不存在 ⇒ 中文 E_VALIDATION；目标自己坏了 ⇒ 校验器那个错（中文）
    loadCardById(id) {
      const target = parseArray(STORAGE_KEYS.cards).find((raw) => idOf(raw) === id)
      if (target === undefined) {
        throw new AppError('E_VALIDATION', {
          message: t('error.missingCard'),
          nextStep: t('next.home'),
        })
      }
      validateCard(target as Card)
      return target as Card
    },
    saveCards(cards) {
      write(STORAGE_KEYS.cards, cards)
    },
    // 宽松写：原样序列化 entries（JSON 值不变；空白 / 数字写法会按 JSON.stringify 重排）
    saveCardsLoose(entries) {
      write(STORAGE_KEYS.cards, entries)
    },
    // 读全部存档；逐份过结构校验
    loadSaves() {
      const saves = parseArray(STORAGE_KEYS.saves) as Save[]
      for (const save of saves) validateSave(save)
      return saves
    },
    // 逐条读：校验存档自己那一半；快照必须是一张**合法卡**（首页显示 / 进游戏都靠它）——
    // 卡不在盘上不要紧（跑的是快照），但快照本身坏了就是坏项
    loadSaveEntries(): SaveEntry[] {
      return parseArray(STORAGE_KEYS.saves).map((raw) => {
        try {
          validateSave(raw as Save)
          if (snapshotNameOf(raw) === undefined) {
            throw new AppError('E_VALIDATION', {
              message: t('error.snapshotMissing'),
              nextStep: t('next.home'),
            })
          }
          validateCard((raw as { cardSnapshot: Card }).cardSnapshot)
          return { raw, save: raw as Save }
        } catch (cause) {
          return entryError(raw, cause)
        }
      })
    },
    // 按 id 只校验目标项：不存在 ⇒ 中文 E_VALIDATION；目标自己坏了 ⇒ 校验器那个错（中文）
    loadSaveById(id) {
      const target = parseArray(STORAGE_KEYS.saves).find((raw) => idOf(raw) === id)
      if (target === undefined) {
        throw new AppError('E_VALIDATION', {
          message: t('error.missingSave'),
          nextStep: t('next.home'),
        })
      }
      validateSave(target as Save)
      return target as Save
    },
    saveSaves(saves) {
      write(STORAGE_KEYS.saves, saves)
    },
    saveSavesLoose(entries) {
      write(STORAGE_KEYS.saves, entries)
    },
    loadPresets() {
      return parseArray(STORAGE_KEYS.presets) as Preset[]
    },
    savePresets(presets) {
      write(STORAGE_KEYS.presets, presets)
    },
    // 读设置：没键给默认值，有键按默认值深合并（未知字段保留）
    loadSettings() {
      const stored = parseJson(STORAGE_KEYS.settings)
      if (stored === null) return structuredClone(DEFAULT_SETTINGS)
      if (typeof stored !== 'object' || Array.isArray(stored)) {
        throw new AppError('E_VALIDATION', {
          message: t('error.badShape', { key: STORAGE_KEYS.settings, detail: 'not an object' }),
          nextStep: t('next.reload'),
          detail: { key: STORAGE_KEYS.settings },
        })
      }
      const partial = stored as Partial<Settings> & { editorColumns?: Partial<Settings['editorColumns']> }
      return {
        ...DEFAULT_SETTINGS,
        ...partial,
        schemaVersion: 1,
        editorColumns: { ...DEFAULT_SETTINGS.editorColumns, ...partial.editorColumns },
      }
    },
    saveSettings(settings) {
      write(STORAGE_KEYS.settings, settings)
    },
    // 读模型映射：必须是「对象套对象套字符串」，形状不对就抛（不许静默当空）
    loadNodeModels() {
      const stored = parseJson(STORAGE_KEYS.nodeModels)
      if (stored === null) return {}
      // 形状坏了：同一个错误措辞在多处要用，包成一个小工厂
      const broken = (detail: string) =>
        new AppError('E_VALIDATION', {
          message: t('error.badShape', { key: STORAGE_KEYS.nodeModels, detail }),
          nextStep: t('next.reload'),
          detail: { key: STORAGE_KEYS.nodeModels },
        })
      if (typeof stored !== 'object' || Array.isArray(stored)) throw broken('not an object of objects')
      const map: NodeModels = {}
      for (const [cardId, slice] of Object.entries(stored as Record<string, unknown>)) {
        if (typeof slice !== 'object' || slice === null || Array.isArray(slice))
          throw broken('not a node map')
        map[cardId] = {}
        for (const [nodeId, presetId] of Object.entries(slice as Record<string, unknown>)) {
          if (typeof presetId !== 'string') throw broken('preset id is not a string')
          map[cardId][nodeId] = presetId
        }
      }
      return map
    },
    saveNodeModels(map) {
      write(STORAGE_KEYS.nodeModels, map)
    },
  }
}
