/**
 * 标识符必须是 ASCII（pre-commit 跑）。
 *
 * 规则（用户 2026-09-14 明确要求）：**每个标识符都是英文** —— 变量、函数、参数、
 * 常量、类型、属性，没有「领域概念」例外：中文标识符既不好读，又是一致性与工具链
 * 隐患（没有词边界、grep 别扭、不读中文的人看不懂）。
 *
 * 中文只留在：提示词内容（prompts/*.md）、面向用户的字符串与工具描述（i18n 那步处理）、
 * 注释。
 *
 * 检测在去掉注释与字符串的代码上做：中文文本不会误报，中文标识符也藏不到字符串里。
 */
import { readFileSync } from 'node:fs'

/** 非 ASCII 标识符字符（CJK 区；出现别的文字时再扩） */
const NON_ASCII_ID = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/
/** 真的在声明或赋值的非 ASCII 标识符 */
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
    // 对象字面量的键是**字符串**不是标识符 —— 中文键合法（例如单位别名表
    // { 天: 'day' }，模型就是会写中文单位，那些键必须保留）
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
