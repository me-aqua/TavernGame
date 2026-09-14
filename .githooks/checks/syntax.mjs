/**
 * TypeScript / Vue 语法检查（pre-commit 跑，亚秒级）。
 *
 * 用 TypeScript 编译器 API 解析，**只报语法错误**（类型错误归 `typecheck`）。
 *
 * 为什么不 shell 出 `node --check`：那是 JavaScript 的检查器，解析不了 TypeScript，
 * 而且跨平台引号转义很容易出错（本项目被坑过）。
 */
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const files = process.argv.slice(2)
const errors = []

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  // .vue: only the <script> blocks — templates are handled by vue-eslint-parser / vue-tsc
  const code = file.endsWith('.vue') ? extractScriptBlocks(source) : source

  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const diagnostic of sourceFile.parseDiagnostics ?? []) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    errors.push(
      `${file}:${line + 1}:${character + 1} —— ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    )
  }
}

if (errors.length) {
  console.error('\n✖ 语法检查未通过：\n')
  for (const e of errors) console.error('  ' + e)
  console.error('')
  process.exit(1)
}
console.log(`✓ 语法检查通过（${files.length} 个文件）`)

function extractScriptBlocks(source) {
  return [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
}
