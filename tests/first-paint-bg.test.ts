/**
 * 防白闪：`index.html` 里那段内联底色 == `src/styles/main.css` 的两个页面底色 token。
 *
 * **为什么这一条必须存在**：那两个色值非写成**字面量**不可 —— 它要赶在 main.css 到达之前生效，
 * 而那时 `var(--color-page)` 还没定义。于是同一件事有了两份写法：
 *   · `index.html` 的 `html { background: … }` / `html.dark { background: … }`
 *   · `src/styles/main.css` 的 `:root { --color-page: … }` / `.dark { --color-page: … }`
 * 两份写法跑起来谁也不报错，只会**各走各的**：配色票改 `--color-page` 那天，内联那两行照旧铺
 * 老色 ⇒ 「白闪」变成「色闪」（先铺旧色、挂载时跳成新色）。这一条把那份耦合钉成红的。
 *
 * 分工：**值**由这一条钉（纯文本，不需要浏览器）；**第一帧真的用这个色**由真浏览器那两条钉
 * （`e2e/smoke.spec.ts` 的「防白闪」）—— jsdom 没有真首屏，组件层判不到这件事。
 *
 * ⚠️ 取值一律**按块取**（`:root {}` / `.dark {}` 各是一块）：一把抓 `--color-page:` 会连
 *    `@theme inline` 里那句 `var(--color-page)` 一起捞进来 —— 那是转口，不是取值。
 * ⚠️ 选择器认**整行**（去掉缩进后恰好是 `选择器 {`）：撞不上注释里提到的同名片段，
 *    也撞不上缩进在 `@media` 里的同名块；**同一个选择器有几块是允许的**
 *    （`main.css` 里 `:root` 就有两块：配色一块、编辑器尺度一块）⇒ 认的是**声明了这条属性的那一块**。
 * ⚠️ 用例名与断言消息一律英文：`ascii.mjs` 只管**代码**里的非 ASCII（注释放行），而 `tests/`
 *    不在它的豁免名单里（豁免的是 `e2e/` 与 `*.stories.ts`，见 `.githooks/checks/ascii.mjs:44`）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** 内联底色的家与页面底色 token 的家 */
const HTML = join(ROOT, 'index.html')
const CSS = join(ROOT, 'src', 'styles', 'main.css')

/** 取值归一：只比"是不是同一个颜色"，不比大小写与空白 */
function norm(value: string): string {
  return value.trim().toLowerCase()
}

/** 一段 CSS 里整行等于 `选择器 {` 的那些块，各按花括号配对取到闭合那一行 */
function cssBlocks(css: string, selector: string): string[] {
  const lines = css.split('\n')
  const opens = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => entry.line === selector + ' {')
  return opens.map((open) => {
    let depth = 0
    const block: string[] = []
    for (let i = open.index; i < lines.length; i += 1) {
      depth += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length
      block.push(lines[i])
      if (depth === 0) return block.join('\n')
    }
    throw new Error(`the block of ${selector} is not closed`)
  })
}

/** 这条声明在这一块里吗 */
function declares(block: string, property: string): boolean {
  return new RegExp('(?:^|[\\s;{])' + property + '\\s*:').test(block)
}

/**
 * 一个选择器里某条声明的值。
 *
 * ⚠️ 一个选择器**可以有好几块**（`main.css` 里 `:root` 就有两块：配色一块、编辑器尺度一块）
 *    ⇒ 要的是**声明了这条属性的那一块**，并且它得**正好一块**：两块都声明 = 同一件事两个值，
 *    那是当场就该红的事，不是"取第一块"能糊过去的。
 */
function valueOf(css: string, selector: string, property: string): string {
  const found = cssBlocks(css, selector).filter((block) => declares(block, property))
  expect(found, `${selector} must declare ${property} in exactly one block`).toHaveLength(1)
  const value = found[0].match(new RegExp('(?:^|[\\s;{])' + property + '\\s*:\\s*([^;{}]+)'))?.[1]
  expect(value, `that block must carry a value for ${property}`).toBeTruthy()
  return norm(value!)
}

/** `index.html` 里那段内联 `<style>` 的内容 —— 开闭标签都按整行认，并钉住它在 `<head>` 里 */
function inlineStyle(html: string): string {
  const lines = html.split('\n')
  const tag = (text: string) =>
    lines.map((line, index) => ({ line: line.trim(), index })).filter((entry) => entry.line === text)
  const opens = tag('<style>')
  const closes = tag('</style>')
  expect(opens, 'index.html must hold exactly one <style> on its own line').toHaveLength(1)
  expect(closes, 'index.html must hold exactly one </style> on its own line').toHaveLength(1)
  expect(closes[0].index, '</style> must come after <style>').toBeGreaterThan(opens[0].index)
  // 它得在 <head> 里：放到 body 末尾就赶不上第一帧了
  const head = lines.findIndex((line) => line.trim() === '</head>')
  expect(opens[0].index, 'the inline style must sit before </head>').toBeLessThan(head)
  return lines.slice(opens[0].index + 1, closes[0].index).join('\n')
}

/** 两档主题：内联那边的选择器 ↔ main.css 那边持有 `--color-page` 的块 */
const THEMES = [
  { name: 'light', selector: 'html', token: ':root' },
  { name: 'dark', selector: 'html.dark', token: '.dark' },
]

describe('the anti-flash inline background and the page color token', () => {
  for (const theme of THEMES) {
    it(`${theme.name}: the background index.html lays down first is --color-page`, () => {
      // ⚠️ 两份材料在**用例里**现读：`index.html` 里那几行真被删了的时候，红的要是这两条用例
      //    自己（"独立成行的 <style> 只有一个"），而不是收集阶段把整个文件变成 `no tests` ——
      //    "no tests" 读起来像跑不起来，不像判据红。
      const style = inlineStyle(readFileSync(HTML, 'utf8'))
      const css = readFileSync(CSS, 'utf8')
      expect(valueOf(style, theme.selector, 'background')).toBe(valueOf(css, theme.token, '--color-page'))
    })
  }
})
