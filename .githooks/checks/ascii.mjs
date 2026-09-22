/**
 * 代码必须 ASCII（pre-commit 跑）。
 *
 * 规则（用户 2026-09-14 明确要求）：除 locale 文件与 doc/ 之外，**一切都是 ASCII** ——
 * 标识符、对象键、字符串字面量。中文住在 src/locales/*.json 与 doc/*.md，别处没有。
 *
 * 为什么值得一个钩子：混排源码是工具链隐患 —— 换个说法的人 grep 不到，
 * 每次把中文文案复制进代码都是一次注定被遗忘的翻译。
 *
 * 中文**注释**放行（注释不进产物，本项目的论证就是用中文写的）；
 * 提示词内容也放行（它在 prompts/*.md 里）。检查前只去掉注释：
 * 字符串字面量保留，因为代码里的中文字面量正是要抓的东西。
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * 非 ASCII 检测器。
 *
 * ⚠️ 两端都在运行时构造。直接写字面量会踩 ESLint 的 no-control-regex；
 *    换成「ASCII 串 + indexOf」的取巧写法更糟：多字符串上 indexOf 永远不为 0，
 *    于是每一行都被报成非 ASCII —— 静默失效的检查和通过的检查长得一模一样。
 */
const RANGE_START = String.fromCharCode(0)
const RANGE_END = String.fromCharCode(0x7f)
const NON_ASCII = new RegExp('[^' + RANGE_START + '-' + RANGE_END + ']')
const FILE_EXT = /\.(ts|tsx|vue|css|html|js|mjs|cjs)$/
/** 生成物与第三方目录，不该我们修 */
const SKIP = /(^|\/)(node_modules|dist|coverage)\//
/** locale 表是唯一允许中文常住的地方 */
const LOCALES = /^src\/locales\//
/**
 * 转 Vue 之前的静态页，仍与应用一起发布。它是内容不是代码，和 doc/ 一样用中文写；
 * 与其让工具去改作者的文本，不如排除在检查外。
 */
const STATIC_CONTENT = /^public\/.*\.html$/
/**
 * 测试与工作台代码：e2e spec 与 Storybook 故事。
 *
 * 它们里面的中文是**假数据与失败信息**，不是产品文案（产品文案只能由 src/locales/
 * 经 t() 给出）。用户 2026-09-14：「用正常的中文在新写的 e2e 里」——
 * 所以这两处不按源码那套 ASCII 规则查。
 */
const TEST_TOOL = /^e2e\/|\.stories\.ts$/
/**
 * 开发者工具与工作台：钩子自己的检查脚本、卡渲染器、Storybook 配置。
 *
 * 它们的中文是**给开发者看的输出**（和 doc/ 同类），不进产品产物 —— 所以 e2e/故事
 * 一样放行。⚠️ 这份清单要跟目录结构一起维护：新开一个 dev-only 目录就把它加进来，
 * 否则要么突然被拦，要么反过来 —— 把产品代码放进这些目录就绕过了检查。
 */
const DEV_TOOL = /^(\.githooks\/|tools\/|\.storybook\/)/

/**
 * 扫一份源码：去掉注释之后逐行找非 ASCII，报出**行号与那些字符**。
 *
 * ⚠️ 纯函数（只吃字符串、不碰磁盘）：判据在 `tests/ascii-check.test.ts` 里直接调它 ——
 *    于是 import 本模块**不许有任何副作用**，干活的入口在文件末尾那道 guard 里。
 */
export function hitsOf(source) {
  return stripComments(source)
    .split('\n')
    .map((line, i) => ({ line: i + 1, chars: [...line].filter((c) => NON_ASCII.test(c)).join('') }))
    .filter((hit) => hit.chars !== '')
}

/** 这一次该查哪些文件：locale / 静态页 / 测试工具 / 开发工具都不查 */
function targetsOf(paths) {
  return paths.filter(
    (f) =>
      FILE_EXT.test(f) &&
      !SKIP.test(f) &&
      !LOCALES.test(f) &&
      !STATIC_CONTENT.test(f) &&
      !TEST_TOOL.test(f) &&
      !DEV_TOOL.test(f),
  )
}

/** 命令行入口：实参是**暂存区的文件清单**，由 pre-commit 递过来 */
function main() {
  const files = targetsOf(process.argv.slice(2))
  const hits = []

  for (const file of files) {
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const hit of hitsOf(source)) {
      hits.push(`${file}:${hit.line} —— 代码里出现非 ASCII 字符「${hit.chars}」`)
    }
  }

  if (hits.length) {
    console.error('\n✖ 代码里出现了非 ASCII 字符，已阻止提交：\n')
    for (const h of hits) console.error('  ' + h)
    console.error('\n  中文只允许出现在：src/locales/*.json、prompts/*.md、注释、doc/。')
    console.error("  文案一律走 t('some.key')，然后加进 locale 文件。\n")
    process.exit(1)
  }
  console.log(`✓ 代码均为 ASCII（${files.length} 个文件）`)
}

/**
 * 表达式位置上的 `/` 才是正则字面量的开头。
 *
 * 判据是**上一个有意义的字符**：跟在值后面（标识符、数字、`)`、`]`、引号）的是除号，
 * 跟在 `(` / `,` / `=` / `:` / 关键字这些后面的是正则。
 * ⚠️ `<` 刻意不在这一列里：Vue 模板里的 `</div>` 会被当成正则的开头，白白吞掉半行。
 */
const REGEX_AFTER =
  /(?:^|[([{,;:!&|?}+\-*%=~^>]|\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await))$/

/** 从已经写出的骨架往回看：这个位置能不能开一个正则字面量 */
function regexCanStart(out) {
  return REGEX_AFTER.test(out.replace(/[ \t\r\n]+$/, ''))
}

/**
 * 正则字面量的收尾 `/` 在哪儿；**本行找不到就返回 -1**。
 *
 * ⚠️ 正则字面量不能跨行 ⇒ 找不到收尾就当它是除号。吞下去的话后面几行会被
 *    当成字符串，注释里的中文又会被当成代码报出来（实测栽过一次）。
 */
function regexEnd(src, start) {
  let i = start + 1
  let inClass = false
  while (i < src.length && src[i] !== '\n') {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) return i
    i += 1
  }
  return -1
}

/**
 * 只去掉注释 —— 字符串与正则字面量都保留，因为代码里的中文字面量正是这条检查要抓的。
 *
 * 行注释替换成一个空格（不是删掉），这样行结构与报错行号保持正确。
 * ⚠️ 三种引号都要认：单引号、双引号、**模板串**。模板串自己会跨行，
 *    里面出现的引号不是字符串的开头 —— 漏了它，`//` 之后的中文会永远抓不到。
 */
function stripComments(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]

    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
      out += ' '
      continue
    }
    // HTML 注释（Vue 模板）：不处理的话 `-->` 会被当成代码，
    // 让后面的块注释重新锚定，行号就全偏了
    if (c === '<' && src.startsWith('<!--', i)) {
      while (i < src.length && !src.startsWith('-->', i)) {
        out += src[i] === '\n' ? '\n' : ' '
        i += 1
      }
      out += '   '
      i += 3
      continue
    }
    if (c === '/' && next === '*') {
      out += '  ' // keep the offset so line numbers stay correct
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '
        i += 1
      }
      out += '  '
      i += 2
      continue
    }
    // 正则字面量里的引号**不是**字符串的开头（`/['"]/g` 这种写法到处都是）。
    // 认错一次就一路错位，把后面几行的注释当成代码报出来
    if (c === '/' && regexCanStart(out)) {
      const end = regexEnd(src, i)
      if (end !== -1) {
        while (i <= end) {
          out += src[i]
          i += 1
        }
        continue
      }
    }
    // 含 '//' 的字符串不能被当成注释，而且字面量本身要留在输出里等着被检查
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += c
      i += 1
      while (i < src.length) {
        out += src[i]
        if (src[i] === '\\') {
          out += src[i + 1] ?? ''
          i += 2
          continue
        }
        if (src[i] === quote) {
          i += 1
          break
        }
        // 字符串没闭合：继续扫，真正的错误由语法检查报
        i += 1
      }
      continue
    }
    out += c
    i += 1
  }
  return out
}

// ---------- CLI 薄壳：只有直接跑本文件时才干活（import 它只是为了拿 hitsOf） ----------
// ⚠️ 这一句必须留在**文件最末**：模块求值走到这里时，前面所有 const 都已初始化。
//    放在中段会踩 TDZ —— 直接跑崩掉，而 import 它的判据照样全绿（实测栽过）。
if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
