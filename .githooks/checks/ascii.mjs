/**
 * Code is ASCII (runs on pre-commit).
 *
 * Rule (explicit user requirement, 2026-09-14): outside the locale files and the
 * docs, **everything is ASCII**. Identifiers, object keys, string literals —
 * Chinese lives in src/locales/*.json (and doc/*.md), nowhere else.
 *
 * Why it is worth a hook: mixed-script source is a toolchain hazard. It breaks
 * grep for people who type the term differently, it makes diffs unreadable for
 * anyone who does not read Chinese, and every copy-paste of a Chinese literal
 * into code is a translation that will be forgotten.
 *
 * Chinese **comments** pass: a comment is not shipped, the reasoning in this
 * project is written in Chinese, and translating comments would lose nuance.
 * Prompt content passes: it lives in prompts/*.md, not in code.
 *
 * The check runs on the code skeleton (comments and string literals removed),
 * so it catches non-ASCII in strings and identifiers while ignoring comments.
 */
import { readFileSync } from 'node:fs'

/**
 * Non-ASCII detector.
 *
 * ⚠️ The two ends are built at runtime. Writing them literally trips ESLint's
 * no-control-regex, and a clever one-liner that avoids the \x00 instead (an
 * ASCII string plus indexOf) is worse: on a multi-character string indexOf can
 * never return 0, so every line gets reported as non-ASCII — a check that
 * silently stops working looks exactly like a check that passes.
 */
const RANGE_START = String.fromCharCode(0)
const RANGE_END = String.fromCharCode(0x7f)
const NON_ASCII = new RegExp('[^' + RANGE_START + '-' + RANGE_END + ']')
const FILE_EXT = /\.(ts|tsx|vue|css|html)$/
/** Generated or vendored files that are not ours to fix */
const SKIP = /(^|\/)(node_modules|dist|coverage)\//
/** The locale tables are the one place Chinese is allowed to live */
const LOCALES = /^src\/locales\//
/**
 * Pre-Vue static page, still served next to the app. It is content, not code,
 * and is written in Chinese like doc/. Kept out of the check rather than
 * translated by a tool that should not be rewriting the author's text.
 */
const STATIC_CONTENT = /^public\/.*\.html$/
/**
 * Test and workbench code: e2e specs and Storybook stories.
 *
 * Their Chinese is **fake data and failure messages**, never product copy
 * (product copy can only come from src/locales/ through t()). User 2026-09-14:
 * 「用正常的中文在新写的 e2e 里」—— 所以这两个地方不按源码那套 ASCII 规则查。
 */
const TEST_TOOL = /^e2e\/|\.stories\.ts$/

const files = process.argv
  .slice(2)
  .filter(
    (f) =>
      FILE_EXT.test(f) &&
      !SKIP.test(f) &&
      !LOCALES.test(f) &&
      !STATIC_CONTENT.test(f) &&
      !TEST_TOOL.test(f),
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
 * Remove comments only — string literals are kept, because a Chinese literal
 * inside code is exactly what this check is for.
 *
 * A line comment is replaced by a space (not deleted) so the line structure,
 * and therefore the reported line numbers, stay correct.
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
    // HTML comments (Vue templates). Without this the `-->` terminator gets
    // read as code and can re-anchor a later block comment, shifting line numbers.
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
    // A string that contains '//' must not be mistaken for a comment, and the
    // literal itself must survive into the output so it gets checked.
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
        // Unterminated template literal: keep scanning, the syntax check will
        // report the real error.
        i += 1
      }
      continue
    }
    out += c
    i += 1
  }
  return out
}
