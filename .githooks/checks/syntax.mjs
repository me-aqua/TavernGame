/**
 * TypeScript / Vue syntax check (runs on pre-commit, sub-second).
 *
 * Parses with the TypeScript compiler API and reports **syntax errors only**
 * (type errors are the job of `typecheck`).
 *
 * Why not shell out to `node --check`: that is JavaScript's checker, it cannot
 * parse TypeScript, and cross-platform quote escaping is error-prone
 * (this project has been bitten by that).
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
