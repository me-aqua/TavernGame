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
 * 注释有三种写法（`//`、`/*` 那种块注释、模板里的 `<!-- -->`），三种都算注释。
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** 非 ASCII 标识符字符（CJK 区；出现别的文字时再扩） */
const NON_ASCII_ID = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/
/** 真的在声明或赋值的非 ASCII 标识符 */
const DECLARATION = /(?:const|let|var|function|class|interface|type)\s+([^\s(=:]+)/
const ASSIGNMENT = /(?:^|[,{(\s])([^\s,(){}:=]+)\s*[=:]/

/**
 * 扫一份源码：去掉注释与字符串之后，还有哪些非 ASCII 标识符。
 *
 * ⚠️ 纯函数（只吃字符串、不碰磁盘）：判据在 `tests/identifiers-check.test.ts` 里直接调它 ——
 *    于是 import 本模块**不许有任何副作用**，干活的入口在文件末尾那道 guard 里。
 */
export function hitsOf(source) {
  const found = []
  stripCommentsAndStrings(source)
    .split('\n')
    .forEach((line, i) => {
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
        found.push({ line: i + 1, name: m[1] })
        break
      }
    })
  return found
}

/**
 * 命令行入口：实参是**暂存区的文件清单**，由 pre-commit 递过来。
 *
 * 读不到的文件直接跳过：`pre-commit` 递来的是本仓库里已暂存的文件。
 */
function main() {
  const files = process.argv.slice(2)
  const hits = []

  for (const file of files) {
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const hit of hitsOf(source)) {
      hits.push(`${file}:${hit.line} —— 标识符「${hit.name}」含非 ASCII 字符；标识符一律用英文`)
    }
  }

  if (hits.length) {
    console.error('\n✖ 存在非英文标识符，已阻止提交：\n')
    for (const h of hits) console.error('  ' + h)
    console.error('\n  中文只应出现在：prompts/*.md、给玩家看的文案、注释。')
    console.error('  变量/函数/参数/类型名一律英文。\n')
    process.exit(1)
  }
  console.log(`✓ 标识符均为英文（${files.length} 个文件）`)
}

/**
 * 去掉注释与字符串字面量，只留代码骨架。
 * 这样中文注释与中文文案都不会误报，而藏在字符串外的中文标识符一定会被抓到。
 *
 * ⚠️ 注释不是删掉、是**换成等量空格**：行结构与报错行号都要保持正确
 *    （`ascii.mjs` 那边同一支也是这个写法）。
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
    // HTML 注释（Vue 模板）：作者写在 `<!-- -->` 里的说明也是注释。
    // ⚠️ 不认它的话，模板注释里的中文会被当成标识符 —— 而本检查自己的报错信息
    //    就印着「中文只应出现在…注释」，同一份文件于是给出两个相反的答案；
    //    兄弟检查 ascii.mjs 认这一支，两者对同一份源码必须给同一个答案。
    if (c === '<' && src.startsWith('<!--', i)) {
      while (i < src.length && !src.startsWith('-->', i)) {
        out += src[i] === '\n' ? '\n' : ' '
        i += 1
      }
      out += '   '
      i += 3
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

// ---------- CLI 薄壳：只有直接跑本文件时才干活（import 它只是为了拿 hitsOf） ----------
// ⚠️ 这一句必须留在**文件最末**：模块求值走到这里时，前面所有函数都已就位。
//    没有这道 guard，被 import 时会拿**调用方的 argv** 干活（`vitest related` 那种调用下
//    它会去读别人的源码、命中就 process.exit(1)，整个测试进程当场死掉）。
if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
