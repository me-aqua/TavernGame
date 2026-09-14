/**
 * src/utils/storage.ts —— localStorage 适配
 *
 * 存档是**外部数据**（用户能手改、能从文件导入），所以校验与备份都在这一层：
 * 解析失败时把原文留一份（玩家还有机会导出抢救），并只保留最新一份 ——
 * 否则每次启动都新建一个键，会无限堆积把配额吃光。
 *
 * 键名集中在这里：存档 / 配置 / 主题 / 语言四处的键都由这里定义。
 */

import { t } from '../i18n'
import type { GameData } from '../types/state'

/** 浏览器存储的最小接口（测试可传垫片） */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  length: number
  key(index: number): string | null
}

/** 存档键。不带版本号：格式变了靠形状校验拒绝，不靠键名 */
export const SAVE_KEY = 'tavernGame.save'

/** 落盘的最小接口：领域动作只依赖它，不依赖整个读写器 */
export interface SaveStore {
  /** 写存档：返回是否成功（失败必须让玩家看到） */
  save(data: GameData): boolean
}

/** 完整的存档读写器（读档 + 落盘） */
export interface GameStore extends SaveStore {
  /** 读存档：没有返回 null；存在但读不出来抛错（调用方提示玩家） */
  load(): unknown | null
  /** 写存档：返回是否成功（失败必须让玩家看到） */
  save(data: GameData): boolean
}

/** 用 localStorage 建一个存档读写器 */
export function localStorageStore(storage: StorageLike): GameStore {
  return {
    /** 读存档；JSON 坏或形状不对都抛错（调用方提示玩家） */
    load(): unknown | null {
      const raw = storage.getItem(SAVE_KEY)
      if (!raw) return null

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        // 包一层上下文：JSON.parse 自己的报错（"Expected property name…"）
        // 对玩家毫无意义，必须说清是「存档坏了」
        throw new Error(t('save.corrupted', { message: (err as Error).message }), { cause: err })
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(t('save.notValid'))
      }
      return parsed
    },

    /** 写存档；失败返回 false（配额满 / 隐私模式） */
    save(data: GameData): boolean {
      try {
        storage.setItem(SAVE_KEY, JSON.stringify(data))
        return true
      } catch (err) {
        console.warn('[storage] save failed', err)
        return false
      }
    },
  }
}

/**
 * 丢档时把原文留一份（供玩家导出抢救）。
 * 只在「存档读不出来」的路径上调用。
 */
export function backupBrokenSave(storage: StorageLike): void {
  const broken = storage.getItem(SAVE_KEY)
  if (!broken) return

  for (let i = storage.length - 1; i >= 0; i -= 1) {
    const k = storage.key(i)
    if (k?.startsWith(SAVE_KEY + '.broken-')) storage.removeItem(k)
  }
  storage.setItem(SAVE_KEY + '.broken-' + Date.now(), broken)
}
