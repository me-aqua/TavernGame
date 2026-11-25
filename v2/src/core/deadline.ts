/**
 * 「别再等了」的 deadline（60 秒硬上限）。
 *
 * 为什么单独一个模块、而且**静态** import：这颗定时器必须在**发起请求的那一刻**就存在，
 * 不能挂在「按需加载的 provider 块」后面 —— 否则「超时」这件事要等 chunk 下载完才开始计时，
 * 单测里也就没法用假时钟把它推着走（实测过：动态 import 之后再起的定时器推不动）。
 *
 * ⚠️ 用普通的 `setTimeout`，不用 `AbortSignal.timeout`：只有前者是假时钟能推进的那一类定时器。
 * 超时不自动重试 —— 把决定权留给玩家（重发 / 换设置都行）。
 */

/** 一次 provider 调用的硬上限（毫秒） */
export const PROVIDER_TIMEOUT_MS = 60_000

export interface Deadline {
  /** 到点会 abort；调用方把它与玩家自己的 signal 合流后交给网络层 */
  signal: AbortSignal
  /** 这次 abort 是不是 deadline 干的（合流之后分不出来，所以要留一个读数） */
  expired(): boolean
  /** 摘掉定时器（正常收尾也要摘，否则一颗 60 秒的定时器会拖着页面） */
  clear(): void
}

// 起一颗 deadline：到点先置读数、再 abort
export function startDeadline(ms: number): Deadline {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, ms)
  return {
    signal: controller.signal,
    expired: () => timedOut,
    clear: () => clearTimeout(timer),
  }
}
