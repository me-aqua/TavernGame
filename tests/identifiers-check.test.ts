/**
 * 票「协作者的两处检查」· **标识符检查自己的判据**：HTML 注释里的字不是代码。
 *
 * 缺陷（来历：`follow-ups.md` 2026-09-23 那一节，8c-① 的 S2 撞出来的）：这道检查只剥
 * 行注释与块注释，**不认 Vue 模板里的 HTML 注释** ⇒ 作者在模板注释里写「单位 = 天」
 * 这类说明，会被当成中文标识符、**提交当场被拦**（实测读数在
 * `.team/test/2026-10-10/probe1-run.log`：`html-comment.vue:6 —— 标识符「单位」含非 ASCII 字符`）。
 * **会误报的检查，迟早教人绕过检查** —— 所以这条判据盯的是「注释 == 注释」，
 * 而不是「让这道检查松一点」。
 *
 * 判据盯两头：
 *   · 该放行的必须放行（HTML 注释与行注释/块注释同等待遇）；
 *   · 不该放行的不许放（真的中文标识符照样拦，且行号不许被注释带偏）。
 *
 * ⚠️ 中文一律**码点构造**（`IDENT`）：本文件自己也要过这道检查 —— 它连 `tests/` 一起拦。
 * ⚠️ 用 `import * as`：脚本现在还没有那个导出 ⇒ 红要红在判据上，不许在收集阶段把整份文件炸掉。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import * as identifiersCheck from '../.githooks/checks/identifiers.mjs'

/** 中文标识符「单位」——夹具里的中文全从这里拼，本文件里不许出现真的中文 */
const IDENT = String.fromCharCode(0x5355, 0x4f4d)

/** 几行拼成一份「源码」 */
const source = (...lines: string[]) => lines.join('\n')

/** 被测的那个程序：项目里那份，pre-commit 递暂存区清单给它 */
const SCRIPT = '.githooks/checks/identifiers.mjs'

/** 夹具目录：系统临时目录里新建一个，跑完删掉（`tests/` 里不留东西） */
const FIXTURES = mkdtempSync(path.join(tmpdir(), 'identifiers-check-'))

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
  if (run.status === null) throw new Error('identifiers.mjs did not start: ' + String(run.error))
  return { status: run.status, out: run.stdout + run.stderr }
}

describe('identifiers check: an HTML comment is a comment, not code', () => {
  it('1 passes a template comment that holds Chinese and an equals sign', () => {
    const text = source('<!-- ' + IDENT + ' = day -->', 'const ok = 1')
    expect(identifiersCheck.hitsOf(text), 'an HTML comment must not be scanned as code').toEqual([])
  })

  it('2 passes a declaration written inside a template comment', () => {
    const text = source('<!-- const ' + IDENT + " = 'day' -->", 'const ok = 1')
    expect(identifiersCheck.hitsOf(text), 'the declaration route must treat it as a comment too').toEqual([])
  })

  it('3 passes a multi-line template comment and keeps the line of the code after it', () => {
    const text = source('const ok = 1', '<!--', '  ' + IDENT + ' = day', '-->', 'const ' + IDENT + ' = 1')
    expect(identifiersCheck.hitsOf(text), 'only the real identifier on line 5 may be reported').toEqual([
      { line: 5, name: IDENT },
    ])
  })
})

describe('identifiers check: what must keep being reported (do not loosen it)', () => {
  it('4 reports a Chinese declaration and a Chinese assignment outside comments', () => {
    expect(identifiersCheck.hitsOf('const ' + IDENT + ' = 1')).toEqual([{ line: 1, name: IDENT }])
    expect(identifiersCheck.hitsOf(source('const a = 1', IDENT + ' = 2'))).toEqual([{ line: 2, name: IDENT }])
  })

  it('5 reports a Chinese identifier on the line right after a template comment closes', () => {
    const text = source('<!-- ok -->', 'const ' + IDENT + ' = 1')
    expect(identifiersCheck.hitsOf(text), 'a comment ends at its closing marker').toEqual([
      { line: 2, name: IDENT },
    ])
  })
})

describe('identifiers check: the CLI itself (a green import does not mean it runs)', () => {
  it('6 exits 0 when the only Chinese of a file sits in an HTML comment', () => {
    const body =
      source('<template>', '  <!-- ' + IDENT + ' = day -->', '  <p>{{ ok }}</p>', '</template>') + '\n'
    const run = runCheck('html-comment.vue', body)
    expect(run.status, 'a comment must not block a commit: ' + run.out).toBe(0)
  })

  it('7 exits 1 and names the file and the line of a real Chinese identifier', () => {
    const run = runCheck('real-identifier.vue', 'const ' + IDENT + ' = 1\n')
    expect(run.status, 'a real Chinese identifier must still block the commit').toBe(1)
    expect(run.out, 'the report must point at the offending line').toContain('real-identifier.vue:1')
  })

  it('8 imports without running the check (the CLI only works when executed)', () => {
    const probe = path.join(FIXTURES, 'import-probe.vue')
    writeFileSync(probe, 'const ' + IDENT + ' = 1\n', 'utf8')
    const runner = path.join(FIXTURES, 'import-runner.mjs')
    // ⚠️ Windows 上动态 import 一个绝对路径要先变成 file:// URL（直接给 `F:\…` 是
    //    ERR_UNSUPPORTED_ESM_URL_SCHEME，红得像是判据的问题 —— 实测踩过一次）
    const moduleUrl = JSON.stringify(pathToFileURL(path.resolve(SCRIPT)).href)
    writeFileSync(runner, 'await import(' + moduleUrl + ")\nconsole.log('IMPORT-OK')\n", 'utf8')
    const run = spawnSync(process.execPath, [runner, probe], { encoding: 'utf8' })
    if (run.status === null) throw new Error('the import runner did not start: ' + String(run.error))
    const out = run.stdout + run.stderr
    expect(run.status, 'importing must not run the check: ' + out).toBe(0)
    expect(out).toContain('IMPORT-OK')
    expect(out, 'the check must not read the importing process arguments').not.toContain('import-probe.vue')
  })
})
