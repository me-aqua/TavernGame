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
  /** 正文的可见纵向范围：被**所有**祖先滚动/裁剪容器取交集后的上下界（可能嵌套两层） */
  const clipOf = (el) => {
    let top = -Infinity
    let bottom = Infinity
    let found = false
    for (let p = el.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'hidden') continue
      const r = p.getBoundingClientRect()
      top = Math.max(top, r.top)
      bottom = Math.min(bottom, r.bottom)
      found = true
    }
    if (!found) return null
    const raw = el.getBoundingClientRect()
    return { left: raw.left, right: raw.right, top: Math.max(raw.top, top), bottom: Math.min(raw.bottom, bottom) }
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
  /** 这一屏有几处中栏那张表的根（四种形态之一；一个都不在 ⇒ 不是这条判据的地盘） */
  forms: number
}

/**
 * 字号普查（在页面里跑）—— **组件故事那一层的量具**。
 *
 * ⚠️ 与整页矩阵那次普查（`visual.spec.ts` 的 `SHELL_PROBE`）**同一套口径**：只数"有文字、
 *    没有子节点"的元素 ⇒ `<input>` / `<select>` 本身不进（它们没有文字），但 **`<option>` 进**。
 * ⚠️ 作用域是中栏那张表的**四种形态**的根（一步 · 字段表 · 「编一块显示」·「编公共提示词」）
 *    —— 见函数体第一条注释。
 * 🔴 为什么这一层非要有它：整页矩阵那次普查**只在 `editor-open` 那一屏跑**，而那一屏**从不按「＋」**
 *    ⇒ 屏上 `select = 0 / option = 0` ⇒ 那条判据对 `<option>` **零信息量**（不是红也不是绿）。
 *    组件故事里 `Editing` / `Refused` 两个故事带着新行 ⇒ `<option>` 真在屏上。
 */
export function fontCensus(): FontCensus {
  // 🔴 这条选择器**必须写在这个函数体里**（不许抽成模块作用域的常量）：`page.evaluate(fontCensus)`
  //    把这个函数**序列化成源码**再在页面里 eval ⇒ 引用模块作用域的任何东西在那边都是 `undefined`
  //    （2026-09-26 真炸过一次：`ReferenceError: FORM_SCOPE is not defined`，整层故事全红）。
  // ⚠️ 中栏**四种形态**都要收：形态互斥 ⇒ 屏上只会有一个；**少收一个，那一屏就是"照不到"**
  //    （`forms === 0` ⇒ 当场 early return）。漏收的代价实测过两次：8d-① 那个新形态的下拉，
  //    与 8d-② 的第四形态（`[data-prompt-form]`，它的根就是中栏那张表的第四个根）。
  // 🔴 这一条是**普查的作用域**，不是判据本身：多收一个根不会放宽任何阈值 ——
  //    它照到的文字照样只许用 `--fs1/2/3` 三档（`expectTierFonts`）。
  const scopes = [
    ...document.querySelectorAll(
      '#storybook-root [data-branch-form], #storybook-root [data-display-form], #storybook-root [data-prompt-form]',
    ),
  ]
  const sizes: string[] = []
  const optionSizes: string[] = []
  let leaves = 0
  let selects = 0
  for (const scope of scopes) {
    selects += scope.querySelectorAll('select').length
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
    selects,
    forms: scopes.length,
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

/** 剪影动效普查读出来的（`sigilCensus` 的返回值） */
export interface SigilCensus {
  /** 这一屏上有几个 `.scene-sigil`（0 ⇒ 这一条对这一幕不适用） */
  sigils: number
  /** 它们的 `animation-name`（去重、排序） */
  animations: string[]
}

/**
 * 剪影动效普查（在页面里跑）。
 *
 * ⚠️ 与 `fontCensus` 同一条注意：`page.evaluate` 把这个函数**序列化成源码**再在页面里 eval
 *    ⇒ 函数体里不许引用模块作用域的任何东西。
 */
export function sigilCensus(): SigilCensus {
  const all = [...document.querySelectorAll('.scene-sigil')]
  return {
    sigils: all.length,
    animations: [...new Set(all.map((el) => getComputedStyle(el).animationName))].sort(),
  }
}

/**
 * 剪影在 reduced motion 下静止（`SceneSigil.vue` 的文件头写的就是这一条）。
 *
 * 🔴 **为什么只能在这一层量**：jsdom 的 `matchMedia` 恒为 `false`（媒体查询永远不匹配）
 *    ⇒ 组件层那件判据看不见它；截图那一步又带 `animations: 'disabled'`（Playwright 会把
 *    动画冻住）⇒ 看图也看不出。只有**真浏览器 + 两个动效上下文对撞**能看见。
 * 🔴 **正反两半都要断** —— 少了后半，「样式根本没加载」与「样式加载了且静止」长得一模一样：
 *    ① `reduce` 上下文里 `animation-name` 必须是 `none`；
 *    ② `no-preference` 上下文里必须**不是** `none`（它就是①的反面控制）。
 * ⚠️ 屏上没有剪影 ⇒ 这一条不适用，返回 `false`；调用方要累计它，
 *    **整趟一条都没照到**得报出来 —— "照不到"既不是红也不是绿。
 */
export function expectSigilStill(reduce: SigilCensus, animated: SigilCensus, where: string): boolean {
  if (reduce.sigils === 0) return false
  expect(animated.sigils, where + '：两个上下文该照到同样多的剪影').toBe(reduce.sigils)
  expect(reduce.animations, where + '：reduced motion 下剪影必须静止（animation-name 该是 none）').toEqual([
    'none',
  ])
  expect(
    animated.animations,
    where + '：不 reduce 时它得真的在动 —— 否则是样式根本没加载，不是它变静了',
  ).not.toEqual(['none'])
  return true
}
