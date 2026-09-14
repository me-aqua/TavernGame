/**
 * 把 prompts/*.md 编码成 prompts/*.md.b64，供代码在**构建期**导入。
 *
 * 为什么编码而不是直接内联 Markdown 原文：
 *   1. 产物里不再是可读明文（前端做不到加密，但至少不是一眼可见）
 *   2. **彻底避开转义坑** —— 提示词里有大量换行、引号、反引号、
 *      Markdown 围栏（```）与中文字符；直接内联进 JS 字符串时，
 *      任何一个反引号都可能截断模板字面量（本项目踩过三次）
 *   3. 解码只发生一次（模块加载时），无运行时开销
 *
 * ⚠️ 这是**编码不是加密**：base64 可逆，客户端字符串永远拿得到。
 *    真正要保密的东西（API key）绝不能进产物。
 *
 * 用法：
 *   node scripts/encode-prompts.mjs         # 生成/更新
 *   node scripts/encode-prompts.mjs --check # 只校验是否同步（钩子与测试用）
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const 目录 = 'prompts'
const 只校验 = process.argv.includes('--check')

/** 生成一个 .b64 文件的内容（带生成标记，提醒人别手改） */
function 生成(md路径, md内容) {
  const b64 = Buffer.from(md内容, 'utf8').toString('base64')
  return [
    '// ⚠️ 自动生成，请勿手改 —— 源文件是 ' + md路径 + '，改完跑 npm run prompts:encode',
    'export default ' + JSON.stringify(b64),
    '',
  ].join('\n')
}

const md文件 = readdirSync(目录).filter((f) => f.endsWith('.md') && f !== 'README.md')
let 不同步 = 0

for (const f of md文件) {
  const md路径 = join(目录, f)
  const b64路径 = md路径 + '.b64'
  const 期望 = 生成(md路径, readFileSync(md路径, 'utf8'))

  if (只校验) {
    let 现有 = ''
    try {
      现有 = readFileSync(b64路径, 'utf8')
    } catch {
      // 文件还不存在 → 视作不同步
    }
    if (现有 !== 期望) {
      console.error(`✖ ${b64路径} 与 ${md路径} 不同步`)
      不同步 += 1
    }
  } else {
    writeFileSync(b64路径, 期望)
    console.log(`✓ ${b64路径}`)
  }
}

if (只校验) {
  if (不同步) {
    console.error('\n  改过 prompts/*.md 之后要跑：npm run prompts:encode\n')
    process.exit(1)
  }
  console.log(`✓ 提示词编码与源文件同步（${md文件.length} 个）`)
}
