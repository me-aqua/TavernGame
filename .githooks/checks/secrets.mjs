/**
 * 密钥扫描（提交前）。
 *
 * 为什么必须自动化：这个项目是**纯前端、玩家自带 API key**，
 * 所以仓库里出现真 key 的概率不低（调试时顺手粘进文件、写进文档举例）。
 * 一旦提交上去，就算下一秒删掉，历史里也还在（参见 v0.5.3 删掉 AGENIA.md 的教训）。
 *
 * 判据基于**已知格式前缀**，不是猜：
 *   sk-…             OpenAI / DeepSeek / 硅基流动等
 *   sk-or-v1-…       OpenRouter
 *   sk-ant-…         Anthropic
 *   ghp_ / gho_ / ghs_ / github_pat_  GitHub
 *   AIza…            Google
 *   AKIA…            AWS
 *   私钥头            -----BEGIN … PRIVATE KEY-----
 *   长随机串 + key 语义变量名
 *
 * 注意：本文件里出现的前缀都是**规则**，不是真 key；扫描时会跳过自己。
 */
import { readFileSync } from 'node:fs'

const 规则 = [
  { 名: 'OpenAI / DeepSeek 风格', re: /\bsk-[A-Za-z0-9_-]{20,}/, 线索: 'sk-' },
  { 名: 'OpenRouter', re: /\bsk-or-v1-[a-f0-9]{32,}/, 线索: 'sk-or-v1-' },
  { 名: 'Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, 线索: 'sk-ant-' },
  { 名: 'GitHub token', re: /\b(ghp|gho|ghs|ghr)_[A-Za-z0-9]{30,}/, 线索: 'gh*_' },
  { 名: 'GitHub 细粒度 token', re: /\bgithub_pat_[A-Za-z0-9_]{30,}/, 线索: 'github_pat_' },
  { 名: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{30,}/, 线索: 'AIza' },
  { 名: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/, 线索: 'AKIA' },
  { 名: '私钥文件内容', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, 线索: 'PRIVATE KEY' },
  {
    名: '带赋值的疑似密钥',
    re: /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/i,
    线索: '赋值',
  },
]

const files = process.argv.slice(2)
const 命中 = []

for (const f of files) {
  if (f.endsWith('secrets.mjs')) continue // 本文件只有规则
  let 内容
  try {
    内容 = readFileSync(f, 'utf8')
  } catch {
    // 成功路径：文件已删或读到一半被改（git 暂存场景常见），跳过即可
    continue
  }
  内容.split('\n').forEach((行, i) => {
    for (const r of 规则) {
      if (r.re.test(行)) {
        // 只报位置与类型，**不回显内容**（免得把密钥打到日志/终端里）
        命中.push(`${f}:${i + 1} —— 疑似 ${r.名}（命中特征：${r.线索}）`)
      }
    }
  })
}

if (命中.length) {
  console.error('\n✖ 疑似密钥，已阻止提交：\n')
  for (const h of 命中) console.error('  ' + h)
  console.error('\n  ⚠️ 密钥一旦提交，历史里就留住了 —— 请先撤销改动，再重置该密钥。')
  console.error('  误报（例如文档里举例）时，把示例写成 sk-xxxx 这类明显占位。\n')
  process.exit(1)
}
console.log(`✓ 密钥扫描通过（${files.length} 个文件）`)
