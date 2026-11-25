/* global console, process */

/**
 * v2 文件长度闸（老板 2026-11-25 要求）：`v2/` 下的**手写文件**一律不超过 800 行。
 *
 * 为什么是一把闸而不是一句约定：800 行是「一个文件还读得完」的上界，而约定会在赶工时
 * 悄悄失效。闸的入口是 `npm run v2:lines`，`v2:build` 在 vite build **之前**先跑它 ——
 * 于是 CI / 部署那条路绕不过去。
 *
 * 口径：
 *   · **行数 = LF 的个数**（带尾换行的文件因此比 `split('\n').length` 少 1，与「CONTRACT.md
 *     604 行」这个读数同一把尺）；
 *   · 扫描 `v2/` 递归，跳过生成物目录（node_modules / dist / test-results /
 *     playwright-report / storybook-static）与 lockfile —— 那些不是手写的；
 *   · 违规逐个打印 `path: N lines (max 800)`，任一超限即退出码 1。
 *
 * 提示语用英文：这一份在 ascii 钩子的管辖范围内（钩子只管 `src/locales/` 与 doc 里的中文）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX = 800
const HERE = dirname(fileURLToPath(import.meta.url))
const V2 = join(HERE, '..')
const REPO = join(V2, '..')
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', 'storybook-static'])
const SKIP_FILES = new Set(['package-lock.json'])

/** LF 的个数就是这个文件的行数（口径写在文件头） */
function lineCount(file) {
  const text = readFileSync(file, 'utf8')
  return (text.match(/\n/g) ?? []).length
}

function walk(dir, found) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full, found)
      continue
    }
    if (!entry.isFile()) continue
    if (SKIP_FILES.has(entry.name)) continue
    found.push(full)
  }
  return found
}

const files = walk(V2, []).map((file) => ({ path: relative(REPO, file), lines: lineCount(file) }))
const offenders = files.filter((file) => file.lines > MAX)

if (offenders.length > 0) {
  for (const offender of offenders) {
    console.error(`${offender.path}: ${offender.lines} lines (max ${MAX})`)
  }
  console.error(
    `\n${offenders.length} file(s) over ${MAX} lines: split them up, or delete what is no longer needed.`,
  )
  process.exit(1)
}

const longest = files.reduce((top, file) => (file.lines > top.lines ? file : top), { path: '-', lines: 0 })
console.log(
  `OK v2 file length gate: ${files.length} files, longest ${longest.path} ${longest.lines} lines (max ${MAX})`,
)
