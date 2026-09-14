/**
 * 结构探针 —— 在截图前后跑的那几条客观检查。
 *
 * visual.spec.ts（整页）与 stories.spec.ts（单组件）共用：
 * 判定标准只写一份，两边才不会各有一套阈值。
 * 只做能客观判定的三条；样式好不好看只能靠看图。
 */
import { expect } from '@playwright/test'

/** 在页面里求值的探针（返回的结构见 Probe） */
export const PROBE = `(() => {
  const vw = window.innerWidth
  const visible = (r) => r.width > 0.5 && r.height > 0.5
  const offenders = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (!visible(r)) continue
    if (r.right > vw + 1 || r.left < -1) {
      const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : ''
      offenders.push(el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']')
    }
  }
  const smallTargets = []
  for (const el of document.querySelectorAll('button, summary, a[href]')) {
    const r = el.getBoundingClientRect()
    if (!visible(r)) continue
    // WCAG 2.5.8 的 inline 例外：句子里的文字链接由行高决定大小，不算独立点按目标
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue
    if (r.height < 24 || r.width < 24) {
      smallTargets.push((el.textContent || '').trim().slice(0, 8) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
    }
  }
  // 遮挡检查：正文行与悬浮控件（状态浮层 / 设置 / 调试 / 输入卡片）不许相交
  const chrome = [...document.querySelectorAll('aside, [data-settings], [data-debug], .composer-row')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0.5 && r.height > 0.5)
  const overlaps = []
  /** 元素最近的滚动容器（滚动区外的部分在几何上仍有坐标，但视觉上被裁掉了） */
  const clipOf = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY
      if (oy === 'auto' || oy === 'scroll') return p.getBoundingClientRect()
    }
    return null
  }
  for (const el of document.querySelectorAll('.line, .trace')) {
    // ⚠️ 先按滚动容器裁剪：滚出视口的那部分不算「看得见」，否则会误报遮挡
    const clip = clipOf(el)
    const raw = el.getBoundingClientRect()
    const r = clip
      ? {
          left: Math.max(raw.left, clip.left),
          right: Math.min(raw.right, clip.right),
          top: Math.max(raw.top, clip.top),
          bottom: Math.min(raw.bottom, clip.bottom),
          get width() {
            return this.right - this.left
          },
          get height() {
            return this.bottom - this.top
          },
        }
      : raw
    if (!visible(r)) continue
    for (const c of chrome) {
      const hit = r.left < c.r.right - 1 && r.right > c.r.left + 1 && r.top < c.r.bottom - 1 && r.bottom > c.r.top + 1
      if (hit) {
        const name = c.el.tagName.toLowerCase() + (c.el.hasAttribute('data-settings') ? '[data-settings]' : '')
        overlaps.push((el.textContent || '').trim().slice(0, 12) + ' 被 ' + name + ' 压住')
      }
    }
  }
  return {
    horizontalOverflow: document.documentElement.scrollWidth - vw,
    offenders: [...new Set(offenders)].slice(0, 6),
    smallTargets: [...new Set(smallTargets)].slice(0, 6),
    overlaps: [...new Set(overlaps)].slice(0, 6),
    rows: document.querySelectorAll('.line').length,
    traces: document.querySelectorAll('.trace').length,
    notice: document.querySelector('[data-status]')?.textContent?.trim().slice(0, 40) ?? null,
  }
})()`

export interface Probe {
  /** scrollWidth - innerWidth：> 1 就是横向溢出 */
  horizontalOverflow: number
  /** 伸出视口左右边界的元素（去重后最多 6 条） */
  offenders: string[]
  /** 小于 24×24 的点按目标（WCAG 2.5.8 的最小尺寸） */
  smallTargets: string[]
  /** 被悬浮控件压住的正文行（遮挡 = 不可读，必须为零） */
  overlaps: string[]
  rows: number
  traces: number
  notice: string | null
}

/** 三条结构检查全过才算这一屏没坏 */
export function expectClean(probe: Probe): void {
  expect(probe.horizontalOverflow, '不能横向溢出').toBeLessThanOrEqual(1)
  expect(probe.offenders, '元素不能伸出视口').toEqual([])
  expect(probe.smallTargets, '点按目标不能小于 24px').toEqual([])
  expect(probe.overlaps, '正文不能被悬浮控件压住').toEqual([])
}
