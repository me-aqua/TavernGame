/**
 * Encodes prompts/*.md into prompts/*.md.b64 for build-time import.
 *
 * Why encode instead of inlining raw Markdown:
 *   1. The bundle no longer contains readable plaintext (client-side code can
 *      never be truly secret, but it should not be trivially greppable)
 *   2. **It sidesteps escaping entirely** — prompts contain newlines, quotes,
 *      backticks, Markdown fences and Chinese text; inlining them into JS
 *      string literals risks a stray backtick truncating the literal
 *      (this project has been bitten by that three times)
 *   3. Decoding happens once at module load; there is no runtime cost
 *
 * ⚠️ This is **encoding, not encryption**: base64 is reversible and client-side
 *    strings are always obtainable. Never put anything truly secret in a bundle.
 *
 * Usage:
 *   node scripts/encode-prompts.mjs         # write/update
 *   node scripts/encode-prompts.mjs --check # verify in sync (hook and tests)
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'prompts'
const checkOnly = process.argv.includes('--check')

/** Build one .b64 file body (with a generated-by header) */
function render(mdPath, mdText) {
  const b64 = Buffer.from(mdText, 'utf8').toString('base64')
  return [
    '// ⚠️ 自动生成，请勿手改 —— 源文件是 ' + mdPath + '，改完跑 npm run prompts:encode',
    'export default ' + JSON.stringify(b64),
    '',
  ].join('\n')
}

const mdFiles = readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md')
let outOfSync = 0

for (const file of mdFiles) {
  const mdPath = join(DIR, file)
  const b64Path = mdPath + '.b64'
  const expected = render(mdPath, readFileSync(mdPath, 'utf8'))

  if (checkOnly) {
    let current = ''
    try {
      current = readFileSync(b64Path, 'utf8')
    } catch {
      // file does not exist yet → treated as out of sync
    }
    if (current !== expected) {
      console.error(`✖ ${b64Path} 与 ${mdPath} 不同步`)
      outOfSync += 1
    }
  } else {
    writeFileSync(b64Path, expected)
    console.log(`✓ ${b64Path}`)
  }
}

if (checkOnly) {
  if (outOfSync) {
    console.error('\n  改过 prompts/*.md 之后要跑：npm run prompts:encode\n')
    process.exit(1)
  }
  console.log(`✓ 提示词编码与源文件同步（${mdFiles.length} 个）`)
}
