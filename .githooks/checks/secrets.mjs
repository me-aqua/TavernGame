/**
 * 密钥扫描（pre-commit 跑）。
 *
 * 为什么必须自动化：项目是**纯前端 + 玩家自己的 API key**，真 key 很容易进仓库
 * （调试时粘贴、写进文档当例子）。一旦提交就留在历史里 —— 哪怕下一秒删掉
 *（见 v0.5.3 的 AGENIA.md 教训）。
 *
 * 检测基于**已知 token 格式**，不靠猜：
 *   sk-…             OpenAI / DeepSeek / SiliconFlow …
 *   sk-or-v1-…       OpenRouter
 *   sk-ant-…         Anthropic
 *   ghp_ / gho_ / ghs_ / github_pat_   GitHub
 *   AIza…            Google
 *   AKIA…            AWS
 *   private key headers
 *   long random string assigned to a key-ish variable name
 *
 * 注：上面的前缀是**规则**不是真 key；本文件跳过自己。
 */
import { readFileSync } from 'node:fs'

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
    // 成功路径：文件已被删除或读取途中被改（git staging 时常见）
    continue
  }
  text.split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        // 只报位置与种类 —— 绝不把值回显到日志/终端
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
