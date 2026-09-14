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

const files = process.argv
  .slice(2)
  .filter(
    (f) =>
      FILE_EXT.test(f) &&
      !SKIP.test(f) &&
      !LOCALES.test(f) &&
      !STATIC_CONTENT.test(f) &&
      !TEST_TOOL.test(f) &&
      !DEV_TOOL.test(f),
  )
const hits = []

for (const file of files) {
  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  const skeleton = stripComments(source)
  const lines = skeleton.split('\n')
  lines.forEach((line, i) => {
    if (!NON_ASCII.test(line)) return
    const chars = [...line].filter((c) => NON_ASCII.test(c)).join('')
    hits.push(`${file}:${i + 1} —— 代码里出现非 ASCII 字符「${chars}」`)
  })
}

if (hits.length) {
  console.error('\n✖ 代码里出现了非 ASCII 字符，已阻止提交：\n')
  for (const h of hits) console.error('  ' + h)
  console.error('\n  中文只允许出现在：src/locales/*.json、prompts/*.md、注释、doc/。')
  console.error("  文案一律走 t('some.key')，然后加进 locale 文件。\n")
  process.exit(1)
}
console.log(`✓ 代码均为 ASCII（${files.length} 个文件）`)

/**
 * 只去掉注释 —— 字符串字面量保留，因为代码里的中文字面量正是这条检查要抓的。
 *
 * 行注释替换成一个空格（不是删掉），这样行结构与报错行号保持正确。
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
    // 含 '//' 的字符串不能被当成注释，而且字面量本身要留在输出里等着被检查
    if (c === '"' || c === "'" || c === "'") {
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
        // 模板字面量没闭合：继续扫，真正的错误由语法检查报
        i += 1
      }
      continue
    }
    out += c
    i += 1
  }
  return out
}
