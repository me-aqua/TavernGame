/**
 * 提示词不得内联在代码里（提交前）。
 *
 * 规则（用户明确要求）：**prompt 必须放在 prompts/ 文件夹，禁止嵌进代码。**
 * 理由不只是整洁：提示词是这个项目的"游戏逻辑"（doc/DESIGN.md），
 * 内联在字符串里没法评审、没法 diff、也没法被将来的"卡"覆盖。
 *
 * 判据：src/ 下出现「长的中文字符串字面量」就拦。**为什么不按关键词猜**：
 * 猜关键词既漏报又误报；长中文串这条规则简单、确定，且这个代码库
 * 本来就不该有长中文串（比「OK」长的界面文案都是提示词或该进提示词）。
 *
 * 逃生口：确实需要一行中文 UI 文案时，行尾写 `// 允许：说明理由`。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// 先确认 .md 与 .b64 同步 —— 不同步就说明改了源文件却忘了 npm run prompts:encode，
// 那样产物里会是旧提示词（最难发现的一类 bug）
try {
  execSync('npm run -s prompts:check', { stdio: 'pipe' })
} catch (err) {
  const 输出 = Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8') : String(err.stdout ?? '')
  console.error('\n✖ ' + (输出.trim() || '提示词编码与源文件不同步'))
  console.error('  修：npm run prompts:encode\n')
  process.exit(1)
}

/** 中文串长度上限（不含引号）。比这个长就要求放进 prompts/ */
const 上限 = 30

const files = process.argv.slice(2)
const 命中 = []

for (const f of files) {
  let 内容
  try {
    内容 = readFileSync(f, 'utf8')
  } catch {
    continue
  }

  const 所有行 = 内容.split('\n')
  所有行.forEach((行, i) => {
    // 豁免标记可以写在当行，也可以写在上面几行 ——
    // 多行函数调用（onEvent({\n  message: '…'\n})）会把注释与字符串隔开好几行
    const 附近 = 所有行.slice(Math.max(0, i - 5), i + 1).join('\n')
    if (附近.includes('// 允许：')) return
    if (行.trimStart().startsWith('//') || 行.trimStart().startsWith('*')) return // 注释不算

    // 取该行里的字符串字面量（单/双/反引号都算）
    for (const m of 行.matchAll(/(['"`])([^'"`]*)\1/g)) {
      const 文 = m[2]
      const 中文数 = (文.match(/[\u4e00-\u9fff]/g) ?? []).length
      if (中文数 >= 上限) {
        命中.push(`${f}:${i + 1} —— 内联了 ${中文数} 字的中文串；提示词请放 prompts/`)
        break // 一行只报一次
      }
    }
  })
}

if (命中.length) {
  console.error('\n✖ 提示词内联在代码里，已阻止提交：\n')
  for (const h of 命中) console.error('  ' + h)
  console.error('\n  做法：内容写进 prompts/*.md，代码里用 renderPrompt() 装配。')
  console.error('  确实只是短 UI 文案时，在该行末尾加 `// 允许：理由`。\n')
  process.exit(1)
}
console.log(`✓ 提示词未内联（${files.length} 个文件）`)
