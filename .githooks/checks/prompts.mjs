/**
 * 提示词不许内联在代码里（pre-commit 跑）。
 *
 * 规则（用户明确要求）：**提示词住在 prompts/，绝不内联。** 理由不只是整洁：
 * 提示词是本项目的游戏逻辑（见 doc/DESIGN.md），内联进字符串字面量就没法评审、
 * 没法 diff，将来也没法被「卡」覆盖。
 *
 * 判据：src/ 里的**长中文字符串字面量**。为什么不匹配关键词：猜关键词既漏报又误报；
 * 「长中文字符串」简单、确定，而且本代码库本该一条都没有
 * （面向用户的 UI 文案很短，提示词在 prompts/）。
 *
 * ⚠️ ascii.mjs 更严，已经从另一侧覆盖同一片地。这条留着是因为它把失败说成
 *    「这看起来像提示词」而不是「这不是 ASCII」—— 后来的人需要读到的正是前者。
 *
 * 逃生口：确实需要一行中文 UI 文案时，在本行或前几行写 `// allow: 理由`。
 */
import { readFileSync } from 'node:fs'

/** 单个内联字符串字面量允许的中文字符上限 */
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
    // 允许标记可以在本行或上面几行 —— 多行调用表达式会把注释与字符串隔开
    const context = lines.slice(Math.max(0, i - 5), i + 1).join('\n')
    if (context.includes('// 允许：') || context.includes('// allow:')) return
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return // comments do not count

    // 本行的字符串字面量（单引号 / 双引号 / 反引号）
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
