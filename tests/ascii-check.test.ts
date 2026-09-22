/**
 * 票 70 · **ASCII 检查自己的判据**：去掉注释之后，代码里还剩哪些非 ASCII。
 *
 * 这道检查为什么需要判据：它一天里连着栽了两个跟头，两个都出在
 * `.githooks/checks/ascii.mjs` 的 `stripComments` 那一段词法上 ——
 *
 *   · 不认**正则字面量** ⇒ `s.replace(/"/g, ...)` 里那个引号被当成了字符串的开头，
 *     扫描位置一路错位，后面几行的**注释**被当成代码报出来。实测读数：一笔合法的提交
 *     被拦下，32 行命中**全是注释**（`tests/branch-tree-selfcheck.test.ts:82` 起）。
 *   · **模板串那一支写成了一个重复的单引号** ⇒ 模板串里的中文只要跟在 `//` 后面
 *     **永远抓不到**：这道检查比它自己声称的松。**漏报是这条纪律最危险的方向**。
 *
 * 判据盯两头：**该报的必须报**（修这道检查最容易出的事，就是顺手把它改松），
 * **不该报的不许报**（注释里写中文是规矩允许的，别去拦合法提交）。
 *
 * ⚠️ 末尾那两条是**接线**判据，不是词法判据：前面七条在**进程内**调 `hitsOf()`，
 *    脚本自己崩在启动那一刻它们也照样全绿 —— 真崩过一次（CLI 那道 guard 留在文件中段，
 *    它调用的函数用到的 `const` 声明在文件尾部 ⇒ TDZ）。所以 CLI 要**真的起一次**，
 *    看退出码，也看它有没有把「查了几个文件」印出来。
 *
 * ⚠️ 中文一律**码点构造**（`CN`）：本文件自己也要过这道检查，而它连 `tests/` 一起拦，
 *    `describe` / `it` 标题里的中文同样 `exit=1` ⇒ 标题一律 ASCII 英文。
 * ⚠️ 用 `import * as`：脚本还不存在时也别在收集阶段把整份文件炸掉（红要红在判据上）。
 *    这一行 import 本身也是判据：`ascii.mjs` 只在**直接跑**时才干活，import 它不许有副作用。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as asciiCheck from '../.githooks/checks/ascii.mjs'

/** 中文两个字：夹具里的中文全从这里拼，本文件里不许出现真的中文 */
const CN = String.fromCharCode(0x4e2d, 0x6587)
/** 几行拼成一份「源码」 */
const source = (...lines: string[]) => lines.join('\n')
/** 被报出来的行号 —— 报错文案里有中文，不在这里抄第二份 */
const hitLines = (text: string) => asciiCheck.hitsOf(text).map((hit: { line: number }) => hit.line)

/** 被测的那个程序：项目里那份，pre-commit 递暂存区清单给它 */
const SCRIPT = '.githooks/checks/ascii.mjs'
/** 夹具目录：系统临时目录里新建一个，跑完删掉（`tests/` 里不留东西） */
const FIXTURES = mkdtempSync(path.join(tmpdir(), 'ascii-check-'))

afterAll(() => rmSync(FIXTURES, { recursive: true, force: true }))

/**
 * 写一份夹具，再让脚本**真的起一次**。
 *
 * ⚠️ `status === null` = 子进程根本没跑起来（沙箱拒了 `spawn`），那**不算用例失败**，
 *    当场抛出来说清 —— 否则「没跑」会被读成「通过了」。
 */
function runCheck(name: string, body: string) {
  const file = path.join(FIXTURES, name)
  writeFileSync(file, body, 'utf8')
  const run = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' })
  if (run.status === null) throw new Error('ascii.mjs did not start: ' + String(run.error))
  return { status: run.status, out: run.stdout + run.stderr }
}

describe('ascii check: the two defects that bit it on 2026-09-22', () => {
  it('1 keeps a comment a comment when a regex literal holds a quote', () => {
    const text = source(
      "const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/</g, '&lt;')",
      `// ${CN}`,
      'const after = 1',
    )
    expect(hitLines(text)).toEqual([])
  })

  it('2 keeps a comment a comment when a template literal holds a quote', () => {
    const text = source("const s = `it's fine`", `// ${CN}`, 'const after = 1')
    expect(hitLines(text)).toEqual([])
  })

  it('3 reports Chinese hiding behind // inside a template literal', () => {
    const text = source('const s = `// ' + CN + '`')
    expect(hitLines(text)).toEqual([1])
  })

  it('4 reports Chinese after a regex literal that holds an escaped slash', () => {
    const text = source("const re = /\\// ; const s = '" + CN + "'")
    expect(hitLines(text)).toEqual([1])
  })
})

describe('ascii check: what must keep being reported (do not loosen it)', () => {
  it('5 reports Chinese in a string literal and in an identifier', () => {
    expect(hitLines(source(`const a = '${CN}'`))).toEqual([1])
    expect(hitLines(source('const ' + CN + ' = 1'))).toEqual([1])
  })

  it('6 reports Chinese in a template literal', () => {
    expect(hitLines(source('const a = `' + CN + '`'))).toEqual([1])
  })
})

describe('ascii check: comments are allowed to be Chinese', () => {
  it('7 passes line, block and HTML comments without reporting anything', () => {
    const text = source(`// ${CN}`, `/* ${CN} */`, `<!-- ${CN} -->`, 'const a = 1')
    expect(hitLines(text)).toEqual([])
  })
})

describe('ascii check: the CLI itself (import green does not mean it runs)', () => {
  it('8 exits 1 and names the file when a checked file really holds Chinese', () => {
    const run = runCheck('violation.ts', "export const a = '" + CN + "'\n")
    expect(run.status).toBe(1)
    expect(run.out).toContain('violation.ts')
  })

  it('9 exits 0 and reports how many files it checked when they are clean', () => {
    const body = source('// ' + CN, 'export const esc = (s: string) => s.replace(/"/g, "&quot;")')
    const run = runCheck('clean.ts', body + '\n')
    expect(run.status).toBe(0)
    expect(run.out).toContain('ASCII')
  })
})
