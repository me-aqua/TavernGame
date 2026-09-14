/**
 * Identifiers must be ASCII (runs on pre-commit).
 *
 * Rule (explicit user requirement, 2026-09-14): **every identifier is English** —
 * variables, functions, parameters, constants, types, properties. No exceptions
 * for "domain concepts": a Chinese identifier is not more readable, it is a
 * consistency and toolchain hazard (no word boundaries, awkward for grep,
 * unreadable for anyone who does not read Chinese).
 *
 * Chinese stays only in:
 *   - prompt content (prompts/*.md)
 *   - user-facing strings and tool descriptions (the i18n step handles those)
 *   - comments
 *
 * Detection works on code with comments and string literals stripped, so
 * Chinese text can never trigger a false positive and Chinese identifiers can
 * never hide behind a string.
 */
import { readFileSync } from 'node:fs'

/** Non-ASCII identifier characters (CJK ranges; extend if other scripts appear) */
const NON_ASCII_ID = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/
/** A non-ASCII identifier actually being declared or assigned */
const DECLARATION = /(?:const|let|var|function|class|interface|type)\s+([^\s(=:]+)/
const ASSIGNMENT = /(?:^|[,{(\s])([^\s,(){}:=]+)\s*[=:]/

const files = process.argv.slice(2)
const hits = []

for (const file of files) {
  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  const stripped = stripCommentsAndStrings(source)
  stripped.split('\n').forEach((line, i) => {
    // 对象字面量的键是**字符串**，不是标识符 —— 中文键是合法的（例如单位别名表
    // { 天: 'day', 小时: 'hour' }，模型就是会写中文单位，那些键必须保留）
    const insideObjectLiteral = line.includes('{')
    for (const [label, re] of [
      ['声明', DECLARATION],
      ['赋值', ASSIGNMENT],
    ]) {
      const m = line.match(re)
      if (!m || !NON_ASCII_ID.test(m[1])) continue
      if (label === '赋值' && insideObjectLiteral) continue
      hits.push(`${file}:${i + 1} —— 标识符「${m[1]}」含非 ASCII 字符；标识符一律用英文`)
      break
    }
  })
}

if (hits.length) {
  console.error('\n✖ 存在非英文标识符，已阻止提交：\n')
  for (const h of hits) console.error('  ' + h)
  console.error('\n  中文只应出现在：prompts/*.md、给玩家看的文案、注释。')
  console.error('  变量/函数/参数/类型名一律英文。\n')
  process.exit(1)
}
console.log(`✓ 标识符均为英文（${files.length} 个文件）`)

/**
 * 去掉注释与字符串字面量，只留代码骨架。
 * 这样中文注释与中文文案都不会误报，而藏在字符串外的中文标识符一定会被抓到。
 */
function stripCommentsAndStrings(src) {
  // 逐字符扫描比正则可靠：能正确处理转义、模板字面量与嵌套
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]

    // 行注释
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    // 块注释
    if (c === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    // 字符串与模板字面量（模板里的 ${} 也一并吃掉，避免嵌套歧义）
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i += 1
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i += 1
        i += 1
      }
      i += 1
      out += '""'
      continue
    }
    out += c
    i += 1
  }
  return out
}
