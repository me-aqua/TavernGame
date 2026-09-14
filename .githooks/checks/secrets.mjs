/**
 * Secret scan (runs on pre-commit).
 *
 * Why this must be automated: the project is **client-side with the player's own
 * API key**, so a real key can easily end up in the repo (pasted while debugging,
 * used as an example in docs). Once committed it stays in history — even if
 * deleted the next second (see the v0.5.3 AGENIA.md lesson).
 *
 * Detection is based on **known token formats**, not guesswork:
 *   sk-…             OpenAI / DeepSeek / SiliconFlow …
 *   sk-or-v1-…       OpenRouter
 *   sk-ant-…         Anthropic
 *   ghp_ / gho_ / ghs_ / github_pat_   GitHub
 *   AIza…            Google
 *   AKIA…            AWS
 *   private key headers
 *   long random string assigned to a key-ish variable name
 *
 * Note: the prefixes above are **rules**, not real keys; this file skips itself.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// First make sure the .md sources and their .b64 encodings are in sync —
// otherwise the bundle would ship stale prompts (the hardest kind of bug to notice)
try {
  execSync('npm run -s prompts:check', { stdio: 'pipe' })
} catch (err) {
  const out = Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8') : String(err.stdout ?? '')
  console.error('\n✖ ' + (out.trim() || 'prompts/*.b64 is out of sync with prompts/*.md'))
  console.error('  fix: npm run prompts:encode\n')
  process.exit(1)
}

const RULES = [
  { label: 'OpenAI / DeepSeek 风格', re: /\bsk-[A-Za-z0-9_-]{20,}/, hint: 'sk-' },
  { label: 'OpenRouter', re: /\bsk-or-v1-[a-f0-9]{32,}/, hint: 'sk-or-v1-' },
  { label: 'Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, hint: 'sk-ant-' },
  { label: 'GitHub token', re: /\b(ghp|gho|ghs|ghr)_[A-Za-z0-9]{30,}/, hint: 'gh*_' },
  { label: 'GitHub 细粒度 token', re: /\bgithub_pat_[A-Za-z0-9_]{30,}/, hint: 'github_pat_' },
  { label: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{30,}/, hint: 'AIza' },
  { label: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/, hint: 'AKIA' },
  { label: '私钥文件内容', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, hint: 'PRIVATE KEY' },
  {
    label: '带赋值的疑似密钥',
    re: /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/i,
    hint: 'assignment',
  },
]

const files = process.argv.slice(2)
const hits = []

for (const file of files) {
  if (file.endsWith('secrets.mjs')) continue // this file contains rules only
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // success path: file already deleted or changed mid-read (common with git staging)
    continue
  }
  text.split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        // Report location and kind only — never echo the value into logs/terminal
        hits.push(`${file}:${i + 1} —— 疑似 ${rule.label}（命中特征：${rule.hint}）`)
      }
    }
  })
}

if (hits.length) {
  console.error('\n✖ 疑似密钥，已阻止提交：\n')
  for (const h of hits) console.error('  ' + h)
  console.error('\n  ⚠️ 密钥一旦提交，历史里就留住了 —— 请先撤销改动，再重置该密钥。')
  console.error('  误报（例如文档里举例）时，把示例写成 sk-xxxx 这类明显占位。\n')
  process.exit(1)
}
console.log(`✓ 密钥扫描通过（${files.length} 个文件）`)
