/**
 * 错误码与 `AppError`（CONTRACT §6）。
 *
 * 规矩只有一条：**面向玩家/作者的错误必须是这个类的实例**，而且一定带中文的
 * `message`（哪一步坏了）与中文的 `nextStep`（下一步点哪儿）。
 * 英文原文只准进 `detail`（调试面板用），不许当正文。
 */
import { t } from '../i18n'

export const CODES = ['E_PROVIDER', 'E_VALIDATION', 'E_CHAIN', 'E_UNKNOWN', 'E_ABORTED'] as const

export type ErrorCode = (typeof CODES)[number]

export interface AppErrorOptions {
  /** 中文，一句话说清哪一步坏了；不给就用 `error.<code>.message` */
  message?: string
  /** 中文，下一步点哪儿；不给就用 `error.<code>.nextStep` */
  nextStep?: string
  /** 调试用的细节（可能是上游英文原文） */
  detail?: unknown
  cause?: unknown
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly nextStep: string
  readonly detail: unknown

  constructor(code: ErrorCode, { message, nextStep, detail, cause }: AppErrorOptions = {}) {
    super(message ?? t(`error.${code}.message`), { cause })
    this.name = 'AppError'
    this.code = code
    this.nextStep = nextStep ?? t(`error.${code}.nextStep`)
    this.detail = detail
  }
}
