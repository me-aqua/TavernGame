/**
 * 组件故事的结构检查（真实浏览器里跑的评价函数 + 断言）。
 *
 * 四类结构判据（SPEC §6 点名的那四条）+ 一条字号：
 *   1. **横向溢出**：`scrollWidth - innerWidth` ≤ 1；
 *   2. **出界**：没有元素伸出视口左右边界（截断由元素自己的宽度负责，不是溢出）；
 *   3. **点按目标**：`button / a[href] / input / textarea / select / summary` 都 ≥24×24（WCAG 2.5.8）；
 *   4. **遮挡**：两个可交互控件不许互相压住（压住 = 有一个点不到）；
 *   5. **三档字号**：屏上每个「有文字的元素」与每个表单控件只用 14 / 12.5 / 11px 三档。
 *
 * ⚠️ `PROBE` 是**字符串**：它会被整段丢进页面里 eval，所以里面不许引用这个模块的任何东西。
 * ⚠️ 这一层**不建像素基线**（组件改动频繁，基线会变成天天刷新的噪音）；像素回归在整页巡检那一层。
 * ⚠️ 断言文案用英文：这一份在 ascii 钩子的管辖范围内（钩子只放行 locale / doc 里的中文）。
 */
import { expect } from '@playwright/test'

/** 页面里跑：把五类判据要的读数一次收齐 */
export const PROBE = `(() => {
  const vw = window.innerWidth
  const visible = (r) => r.width > 0.5 && r.height > 0.5
  const root = document.querySelector('#storybook-root') || document.body
  const nameOf = (el) => {
    const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '')
  }

  const offenders = []
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (!visible(r)) continue
    if (r.right > vw + 1 || r.left < -1) {
      offenders.push(nameOf(el) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']')
    }
  }

  const interactive = []
  const smallTargets = []
  for (const el of root.querySelectorAll('button, a[href], input, textarea, select, summary')) {
    const r = el.getBoundingClientRect()
    if (!visible(r)) continue
    // WCAG 2.5.8: inline links inside a sentence are sized by the line box, not by themselves
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue
    interactive.push({ el, r })
    if (r.height < 24 || r.width < 24) {
      smallTargets.push(nameOf(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
    }
  }

  const overlaps = []
  for (let i = 0; i < interactive.length; i += 1) {
    for (let j = i + 1; j < interactive.length; j += 1) {
      const a = interactive[i].r
      const b = interactive[j].r
      const hit = a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1
      if (hit) overlaps.push(nameOf(interactive[i].el) + ' / ' + nameOf(interactive[j].el))
    }
  }

  const sizes = new Set()
  let leaves = 0
  for (const el of root.querySelectorAll('*')) {
    if (el.children.length > 0) continue
    if ((el.textContent || '').trim() === '') continue
    leaves += 1
    sizes.add(getComputedStyle(el).fontSize)
  }
  // Form controls keep their text in .value, so the leaf rule above cannot see them
  for (const el of root.querySelectorAll('input, textarea, select')) {
    leaves += 1
    sizes.add(getComputedStyle(el).fontSize)
  }

  return {
    overflow: document.documentElement.scrollWidth - vw,
    offenders: [...new Set(offenders)].slice(0, 8),
    smallTargets: [...new Set(smallTargets)].slice(0, 8),
    overlaps: [...new Set(overlaps)].slice(0, 8),
    sizes: [...sizes].sort(),
    leaves,
    interactive: interactive.length,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
  }
})()`

/** 三档字号的阈值（与 `src/styles/main.css` 的 --fs1/2/3 同一份） */
export const FONT_TIERS = ['11px', '12.5px', '14px']

export function expectClean(probe) {
  expect(probe.overflow, 'no horizontal overflow').toBeLessThanOrEqual(1)
  expect(probe.offenders, 'nothing may stick out of the viewport').toEqual([])
  expect(probe.smallTargets, 'click targets must be at least 24x24').toEqual([])
  expect(probe.overlaps, 'interactive controls must not overlap').toEqual([])
}

export function expectTierFonts(probe, where) {
  expect(probe.leaves, where + ': this check must actually see some text').toBeGreaterThan(0)
  expect(
    probe.sizes.filter((size) => !FONT_TIERS.includes(size)),
    where + ': only the three font tiers are allowed',
  ).toEqual([])
}
