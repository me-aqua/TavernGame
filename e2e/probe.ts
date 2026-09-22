/**
 * 页面结构检查 —— 在截图前后跑的那几条客观检查。
 *
 * visual.spec.ts（整页）与 stories.spec.ts（单组件）共用：
 * 判定标准只写一份，两边才不会各有一套阈值。
 * 只做能客观判定的三条；样式好不好看只能靠看图。
 */
import { expect } from '@playwright/test'

/** 在页面里求值的检查脚本（返回的结构见 Probe） */
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

/**
 * 字号三档（口径 7 · `src/styles/main.css` 的 `--fs1/2/3` = 14 / 12.5 / 11）。
 *
 * ⚠️ **阈值只写这一份**：整页矩阵（`visual.spec.ts` 的外壳文字）与组件故事（`stories.spec.ts`
 *    的中栏那张表）两处都拿它比 —— 两份阈值必然走偏。
 */
export const FONT_TIERS = ['11px', '12.5px', '14px']

/** 字号普查读出来的几样（`fontCensus` 的返回值） */
export interface FontCensus {
  /** "有文字、没有子节点"的元素用了几档字号（去重、排序） */
  sizes: string[]
  /** 其中 `<option>` 用的那几档（**单独报一份** —— 它就是那个"照不到就静默失效"的地方） */
  optionSizes: string[]
  /** 数到了几个"有文字、没有子节点"的元素（0 ⇒ 这一趟什么也没验） */
  leaves: number
  /** 这一片里有几个 `<select>` */
  selects: number
  /** 这一屏有几处 `[data-branch-form]`（＝中栏那张表在不在；不在就不是这条判据的地盘） */
  forms: number
}

/**
 * 字号普查（在页面里跑）—— **组件故事那一层的量具**。
 *
 * ⚠️ 与整页矩阵那次普查（`visual.spec.ts` 的 `SHELL_PROBE`）**同一套口径**：只数"有文字、
 *    没有子节点"的元素 ⇒ `<input>` / `<select>` 本身不进（它们没有文字），但 **`<option>` 进**。
 * ⚠️ 作用域收到中栏那张表里面（`#storybook-root [data-branch-form]`）：口径 7 管的是**编辑器那一屏
 *    的文字**，别的组件的故事各有各的尺度，不归它管。
 * 🔴 为什么这一层非要有它：整页矩阵那次普查**只在 `editor-open` 那一屏跑**，而那一屏**从不按「＋」**
 *    ⇒ 屏上 `select = 0 / option = 0` ⇒ 那条判据对 `<option>` **零信息量**（不是红也不是绿）。
 *    组件故事里 `Editing` / `Refused` 两个故事带着新行 ⇒ `<option>` 真在屏上。
 */
export function fontCensus(): FontCensus {
  const scope = document.querySelector('#storybook-root [data-branch-form]')
  const sizes: string[] = []
  const optionSizes: string[] = []
  let leaves = 0
  if (scope !== null) {
    for (const el of scope.querySelectorAll('*')) {
      if (el.children.length > 0 || (el.textContent ?? '').trim() === '') continue
      const size = getComputedStyle(el).fontSize
      leaves += 1
      sizes.push(size)
      if (el.tagName === 'OPTION') optionSizes.push(size)
    }
  }
  return {
    sizes: [...new Set(sizes)].sort(),
    optionSizes: [...new Set(optionSizes)].sort(),
    leaves,
    selects: scope === null ? 0 : scope.querySelectorAll('select').length,
    forms: document.querySelectorAll('#storybook-root [data-branch-form]').length,
  }
}

/**
 * 中栏那张表的文字只用三档字号（口径 7 + 裁决 13 —— 含 `<option>`）。
 *
 * ⚠️ 表不在屏上（`forms === 0`）时**这一条不适用**：别的组件的故事字号不归它管。
 * ⚠️ 反面控制写死了两条：**照到了文字**（`leaves > 0`）、**有下拉就必须照到它的 `<option>`**
 *    —— "照不到"既不是红也不是绿，整页那次就是这么漏掉 `<option>` 的。
 */
export function expectTierFonts(font: FontCensus, where: string): void {
  if (font.forms === 0) return
  expect(font.leaves, where + '：这一条要真的照到文字才作数').toBeGreaterThan(0)
  expect(
    font.sizes.filter((size) => !FONT_TIERS.includes(size)),
    where + '：中栏那张表的文字只许用三档字号（--fs1/2/3）',
  ).toEqual([])
  if (font.selects > 0) {
    expect(font.optionSizes, where + '：屏上有下拉，就必须照到它的 <option>（照不到 ≠ 通过）').not.toEqual([])
  }
}
