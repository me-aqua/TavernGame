/**
 * 应用级上下文：一份存储实例 + 把任意错误收成 `AppError` 的小工具。
 *
 * 存储实例**由 `main.ts` 注入**（`createStorage(localStorage)`）—— core 层自己不碰浏览器全局，
 * 页面则从这里拿同一份实例，免得每个页面各建一个。
 */
import { AppError } from './core/errors'
import type { Storage } from './core/storage'

let current: Storage | null = null

export function provideStorage(next: Storage): void {
  current = next
}

// 取那一份存储实例（页面与引擎都从这里拿，免得各建一个）
export function storage(): Storage {
  if (!current) throw new Error('storage not provided: main.ts must call provideStorage()')
  return current
}

/** 任何东西 -> AppError（已知的码原样留着，未知的进 E_UNKNOWN，原始信息进 detail） */
export function asAppError(cause: unknown): AppError {
  if (cause instanceof AppError) return cause
  return new AppError('E_UNKNOWN', {
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
  })
}
