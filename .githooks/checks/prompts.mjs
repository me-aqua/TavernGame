/**
 * Prompts must not be inlined in code (runs on pre-commit).
 *
 * Rule (explicit user requirement): **prompts live in prompts/, never inline.**
 * The reason is not just tidiness: prompts are this project's game logic
 * (see doc/DESIGN.md), so inlining them into string literals makes them
 * unreviewable, undiffable, and impossible for a future "card" to override.
 *
 * Heuristic: a long Chinese string literal inside src/ is blocked. Why not
 * match keywords: keyword guessing both misses and false-positives; the
 * "long Chinese string" rule is simple, deterministic, and this codebase
 * should not have any (user-facing UI text is short, prompts live in prompts/).
 *
 * ⚠️ ascii.mjs is the stricter rule that now covers the same ground from the
 * other side: no non-ASCII string literal belongs in src/ at all. This check
 * stays because it names the failure ("that looks like a prompt") instead of
 * just "that is not ASCII", which is what a future contributor needs to read.
 *
 * Escape hatch: for a genuine one-line Chinese UI string, add
 * `// allow: reason` on the line or within the previous few lines.
 */
import { readFileSync } from 'node:fs'

/** Max Chinese characters allowed in one inline string literal */
const MAX_CJK = 30

/** e2e 与 Storybook 故事里的中文是假数据，不是内联提示词（与 ascii.mjs 同一范围） */
const TEST_TOOL = /^e2e\/|\.stories\.ts$/

const files = process.argv.slice(2).filter((f) => !TEST_TOOL.test(f))
const hits = []

for (const file of files) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  const lines = text.split('\n')
  lines.forEach((line, i) => {
    // The allow marker may sit on the line or a few lines above —
    // multi-line call expressions separate the comment from the string
    const context = lines.slice(Math.max(0, i - 5), i + 1).join('\n')
    if (context.includes('// 允许：') || context.includes('// allow:')) return
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return // comments do not count

    // String literals on this line (single / double / backtick)
    for (const m of line.matchAll(/(['"`])([^'"`]*)\1/g)) {
      const value = m[2]
      const cjkCount = (value.match(/[\u4e00-\u9fff]/g) ?? []).length
      if (cjkCount >= MAX_CJK) {
        hits.push(`${file}:${i + 1} —— 内联了 ${cjkCount} 字的中文串；提示词请放 prompts/`)
        break // one report per line
      }
    }
  })
}

if (hits.length) {
  console.error('\n✖ 提示词内联在代码里，已阻止提交：\n')
  for (const h of hits) console.error('  ' + h)
  console.error('\n  做法：内容写进 prompts/*.md，代码里用 renderPrompt() 装配。')
  console.error('  确实只是短 UI 文案时，在该行末尾加 `// 允许：理由`。\n')
  process.exit(1)
}
console.log(`✓ 提示词未内联（${files.length} 个文件）`)
