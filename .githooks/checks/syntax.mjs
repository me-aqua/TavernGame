/**
 * TypeScript / Vue 语法检查（提交前，秒级）。
 *
 * 用 TS 编译器 API 直接解析，只报**语法错误**（不查类型 —— 类型由 typecheck 负责）。
 * 为什么不用 shell 拼 `node --check`：那是 JS 的检查器，解析不了 TS 语法，
 * 而且跨平台引号转义很容易出错（本项目踩过）。
 */
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const files = process.argv.slice(2)
const 错误 = []

for (const f of files) {
  const 源码 = readFileSync(f, 'utf8')
  // .vue 只取 <script> 块——模板部分由 vue-eslint-parser / vue-tsc 负责
  const 待查 = f.endsWith('.vue') ? 取脚本块(源码) : 源码

  const sf = ts.createSourceFile(f, 待查, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const d of sf.parseDiagnostics ?? []) {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0)
    错误.push(`${f}:${line + 1}:${character + 1} —— ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
  }
}

if (错误.length) {
  console.error('\n✖ 语法检查未通过：\n')
  for (const e of 错误) console.error('  ' + e)
  console.error('')
  process.exit(1)
}
console.log(`✓ 语法检查通过（${files.length} 个文件）`)

function 取脚本块(源码) {
  return [...源码.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
}
