/**
 * 票 54 · **接线判据**：把 `.githooks/commit-msg` 这个程序**真的起一次**，断言退出码与输出。
 *
 * 与 `tests/changelog-check.test.ts` 的分工：那一份测 `judge()` 这个**纯函数**（判定逻辑），
 * 这一份测**接线**（谁去调它、传什么）。两个反例正好说明为什么必须分开：
 *
 *   · `.githooks/commit-msg:30` 那一行必须是 **Node 能解析的代码**：写成 shell 的
 *     `node …changelog.mjs --message "$1" --merge-head`（`$1` 在 shell 里是第一个实参、在 Node 里不是标识符）
 *     ⇒ 解析器当场停住（`';' expected.` / `Unexpected identifier 'message'`）⇒ **钩子起不来、每一次提交都被拒**。
 *   · 那一行**不许无条件传 `--merge-head`**：`changelog.mjs:174` 是
 *     `mergeHead: asked || gitText('rev-parse -q --verify MERGE_HEAD') !== ''`
 *     ⇒ 一给开关就恒为真 ⇒ `judge` 第一句就放行 ⇒ **判定被整个关掉**；合并与否由 CLI 自己问 `MERGE_HEAD`。
 *
 * 三十几条纯函数判据对这两件事**全绿**：旧的第 20 / 24 条只 `toContain('--message')` 地**读源码文本**，
 * 判的是「CLI 认得这两个记号」，**没有一条把这个程序起起来过**。**接线断了，全绿。**
 *
 * ⚠️ **用例编号接着 `tests/changelog-check.test.ts` 往下排：这份文件里是 30–33**（那边是 1–29 与 34）。
 *    两边的局部编号会撞车（这份文件里第一个 `it` 不是「用例 1」而是「用例 30」）⇒ 用**全局编号**，
 *    让「30」在契约 / 日志 / 报告里只有一个意思。历史留档（`.tools/leader54-wiring-*.log`）里
 *    印的还是当时的局部编号 1–4，**读的时候 +29** 就是这里的号。
 *
 * ⚠️ **夹具要像这个项目的一次真检出** —— 这一档为此刻意返工过四次，四次红得都像判据：
 *   ① 父目录没人建（`mkdtemp` 只给仓库根）⇒ `writeFileSync` ENOENT；
 *   ② 缺**钩子链第一环**要的 `commitlint.config.js`（它找配置是**从 cwd 往上搜**的）⇒ 钩子走不到判定那一段；
 *   ③ 缺 `doc/CHANGELOG.md` ⇒ 判定那条链读不到它，**以「检查自己出错了」拦住提交**（`chore` 也拿不到 0）；
 *   ④ `dir` 是**相对路径** ⇒ 交给子进程的消息文件路径也跟着相对，它按夹具去解 ⇒ 读不到 ⇒ 退 1 且正文空白。
 *   ⇒ 四条都补上（①②③ 是夹具该有的东西，④ 是**交给子进程的路径形态**），并且**夹具自检走在被测行为之前**
 *   （缺什么就以夹具失败的样子炸）；四次各自的读数见 `.team/test/2026-09-17/wiring-54-red-readings.md` 一–七节。
 *
 * ⚠️ **必须 `spawnSync`**：`execFileSync` 在**成功**时只返回 stdout，stderr 要么被继承、要么被丢掉；
 *   而**提醒正是打到 stderr 上的** ⇒ 拿它测「有没有提醒」会把「打了但没看见」读成「没打」。
 * ⚠️ **`status` 是 `null` ⇒ 子进程根本没跑起来**（`spawnSync … EPERM`），那**不算失败**，
 *   当场抛出来说清（契约 §9 那条「报警的东西先怀疑它自己」）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'
import { ESCAPE_WORD } from './support/changelog-cases'

/** 被测的那个程序：`.githooks/commit-msg`（**项目里那份** —— 夹具只提供"被操作的仓库"） */
const HOOK = '.githooks/commit-msg'

/** 项目根：钩子与配置都从这里取（vitest 的 cwd 就是它） */
const ROOT = process.cwd()

/** Windows 上不能直接起无扩展名的脚本，统一经 node 起 */
const NODE = process.execPath

/**
 * 临时仓库放哪儿：**项目内的 `node_modules/.cache/`**，不是系统临时目录。
 *
 * ⚠️ 放进项目内同时解决两件事：`commitlint` 从 cwd 往上搜**找得到**配置；
 *    `npx` 用的是**本地装的那一份**，不会去网上取（项目规矩：测试里的网络一律用假响应）。
 * ✅ `node_modules/` 被 git 忽略（`.gitignore:8`，实测 `git check-ignore` 命中）⇒ 不会脏了仓库。
 */
const REPO_PARENT = path.join('node_modules', '.cache')

/** 夹具要抄进仓库的、**项目里被跟踪**的那几份文件（不手写第二份：源头改了这条链跟着走） */
const FIXTURE_FILES = ['commitlint.config.js']

/** 这一轮造出来的临时仓库（每个用例一个；收工逐个删掉，别留一地垃圾） */
const repos: string[] = []

/** 跑一条 git（用 `-C` 定位临时仓库，不靠 cwd） */
function git(args: string[], cwd: string): string {
  return String(execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }))
}

/**
 * 造一个临时仓库：真检出该有的那几样都放进去。
 *
 * 三样缺一不可：`commitlint` 的配置（**第一环**）、`doc/CHANGELOG.md`（**判定那条链要读它**）、
 * 以及**项目里那份钩子**（它不在夹具里 —— `runHook` 用绝对路径起它）。
 *
 * ⚠️ **`dir` 必须是绝对路径**：子进程的 cwd 设成夹具，**任何交给子进程的路径都得是绝对的**。
 *    相对路径的交出去，钩子（与它里面的 `commitlint`）就按**夹具**去解那段路径 ⇒ 读不到消息文件
 *    ⇒ 非零退出、而且它的报错走 `String(err.stdout || err.message)`（**空 Buffer 为真**）⇒ 打出来一片空白。
 *    实测的一对对照（同一个夹具、同一个钩子，只差消息路径怎么写）：
 *    `node <钩子> "F:\…\node_modules\.cache\rel-probe\m.txt"` → **exit 0**（放行 + 提醒）；
 *    `node <钩子> "node_modules/.cache/rel-probe/m.txt"` → **exit 1**，报错正文是空的。
 */
function makeRepo(): string {
  const parent = path.join(ROOT, REPO_PARENT)
  mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(path.join(parent, 'hook-'))
  expect(path.isAbsolute(dir), 'the fixture path must be absolute: child processes get it as cwd').toBe(true)
  git(['init'], dir)
  git(['config', 'user.email', 'hook@test.local'], dir)
  git(['config', 'user.name', 'hook probe'], dir)
  for (const name of FIXTURE_FILES) copyFileSync(path.join(ROOT, name), path.join(dir, name))
  seedChangelog(dir)
  repos.push(dir)
  return dir
}

/**
 * 夹具里放一份**真的**变更日志：抄项目那份的**开头**（到未发布那一段为止）。
 *
 * 判定那条链会 `git diff … -- doc/CHANGELOG.md` 读它，缺了就以「检查自己出错了」拦住提交；
 * 而"记没记一笔"看的是**改动**，不看这段文字，所以只抄开头就够（不手写第二份段名）。
 */
function seedChangelog(dir: string): void {
  const source = readFileSync(path.join(ROOT, 'doc', 'CHANGELOG.md'), 'utf8')
  const lines = source.split('\n')
  const stop = lines.findIndex((line) => line.startsWith('- '))
  const head = (stop > 0 ? lines.slice(0, stop + 1) : lines.slice(0, 12)).join('\n')
  mkdirSync(path.join(dir, 'doc'), { recursive: true })
  writeFileSync(path.join(dir, 'doc', 'CHANGELOG.md'), head + '\n', 'utf8')
}

/**
 * 在临时仓库里暂存一个文件（只 `git add`，不提交），**并当场体检夹具**。
 *
 * ⚠️ **父目录要自己建**：`mkdtemp` 只给出仓库根，`src/probe.ts` 的那层 `src/` 没有 ——
 *    不建它 `writeFileSync` 就 ENOENT（实测：4 条全红、只有 1 条红对了）。
 * ⚠️ **自检的对象别搞混**：查的是**项目里**那份钩子（`ROOT`），夹具里**不该**有 `.githooks/` ——
 *    夹具只提供"被操作的那个仓库"。查错了目录，四条会一起红在夹具上（实测）。
 */
function stage(cwd: string, file: string): void {
  expect(existsSync(path.join(ROOT, HOOK)), 'the project hook must exist: ' + HOOK).toBe(true)
  for (const name of [...FIXTURE_FILES, 'doc/CHANGELOG.md']) {
    expect(existsSync(path.join(cwd, name)), 'fixture is missing ' + name).toBe(true)
  }
  const full = path.join(cwd, file)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, 'a probe file\n', 'utf8')
  git(['add', '--', file], cwd)
  expect(existsSync(full), 'the fixture file must exist on disk: ' + file).toBe(true)
  expect(git(['diff', '--cached', '--name-only'], cwd), 'the fixture must be staged: ' + file).toContain(file)
}

/** 写一份提交信息文件（钩子的实参就是它），返回绝对路径 */
function messageFile(cwd: string, name: string, body: string): string {
  const file = path.join(cwd, name)
  writeFileSync(file, body, 'utf8')
  return file
}

/**
 * 真起一次钩子：退出码 + **两路输出合起来**（成功与失败都拿得到）。
 *
 * ⚠️ 用 `spawnSync` 而不是 `execFileSync`：后者**成功时只给 stdout**，
 *    而提醒打的是 stderr ⇒ 3 号用例（"要打出提醒"）用它**永远过不了**（实测踩过两次：
 *    差点把「打了但没看见」读成「她没打」）。
 */
function runHook(cwd: string, msgFile: string): { status: number; output: string } {
  const run = spawnSync(NODE, [path.resolve(ROOT, HOOK), msgFile], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  // ⚠️ status 为 null = 子进程没跑起来（沙箱挡的），**不是判据失败** —— 当场说清，别伪装成红
  if (run.error !== undefined && run.error !== null) {
    throw new Error('the hook process did not start at all; this is not a verdict: ' + run.error.message, {
      cause: run.error,
    })
  }
  return { status: run.status ?? 0, output: String(run.stdout ?? '') + String(run.stderr ?? '') }
}

/** 把一份源码当 TS 解析一次，返回它的语法错误（**只解析、不 spawn，也不需要它 resolve 任何东西**） */
function syntaxErrors(file: string): string[] {
  const parsed = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true)
  // ⚠️ `parseDiagnostics` 是解析器在运行时挂上去的字段，类型声明里没有 ⇒ 经 `unknown` 取一次；
  //    这里**只读**、不写，所以不是逃生口（`as any` 会把这个字段的意义整个抹掉）
  const bag = parsed as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }
  return (bag.parseDiagnostics ?? []).map((d) => {
    const pos = parsed.getLineAndCharacterOfPosition(d.start)
    return 'line ' + (pos.line + 1) + ': ' + ts.flattenDiagnosticMessageText(d.messageText, ' ')
  })
}

/**
 * ⚠️ **30–32 三条要真起钩子**（`spawnSync` → `npx commitlint` → `changelog.mjs`，串起三次进程启动）
 * ⇒ 默认的 5 秒超时不是给这种用例定的：2026-09-23 实测它在**五道门禁连着跑**的负载下到过 **5104ms**，
 *    偶发地把 `npm run test:coverage` 判红（读数与处置见 `.team/leader/2026-09-23/验收记录-票73-②.md` §二）。
 *    余量按实测给：常态 ~1.6s、最坏见过 5.1s ⇒ **20 秒**。
 *    ⚠️ **这是给进程启动留时间，不是把断言放宽** —— 断言一个字没动。
 */
const HOOK_TIMEOUT = 20000

describe('commit-msg: the hook is really started (the wiring, not the source text)', () => {
  afterAll(() => {
    for (const dir of repos) rmSync(dir, { recursive: true, force: true })
  })

  it(
    '30 lets a chore commit through (the program runs and does not block it)',
    () => {
      const repo = makeRepo()
      stage(repo, 'src/probe.ts')
      const msg = messageFile(repo, 'msg-chore.txt', 'chore(card): a probe chore commit\n')

      const run = runHook(repo, msg)
      expect(run.status, 'a chore commit must not be blocked: ' + run.output).toBe(0)
    },
    HOOK_TIMEOUT,
  )

  it(
    '31 blocks a feat that changed src/ without touching the changelog',
    () => {
      const repo = makeRepo()
      stage(repo, 'src/probe.ts')
      const msg = messageFile(repo, 'msg-feat.txt', 'feat(card): a probe feat commit\n')

      const run = runHook(repo, msg)
      expect(run.status, 'this commit must be blocked: ' + run.output).toBe(1)
      // ⚠️ 只断退出码不够：**语法错误也退 1**。要断在**这条检查自己那句拦下的话**上 ——
      //    它只在判定真的跑到「改了东西却没记」时才打得出来（契约 §9）。
      expect(run.output, 'the hook must fail for the changelog reason, not for a crash').toContain(
        'CHANGELOG',
      )
      expect(run.output, 'and it must name the file it is about').toContain('doc/CHANGELOG.md')
      // ⚠️ 上面那两条**分开「崩了」与「判拦下」**：夹具一崩，这里退的也是 1，而崩的那句话同样带着
      //    那两个串（`doc/CHANGELOG.md has no "## [...]" section` / `ENOENT … doc/CHANGELOG.md`）——
      //    本机没假绿只是因为 Windows 的 ENOENT 报告里带 `\`，而 CI 是 ubuntu（契约 §2.4 第 2 条）。
      //    中文那句「检查自己出错了」进不了这个文件（ascii 检查连字符串字面量一起拦），所以用两条
      //    **ASCII 指纹**分开：崩的那两条路会打 `ENOENT` / `has no "## [`，而**只有判定那条路**才会
      //    打出逃生口那一行（`reminder` 的三行里就有它）。
      expect(run.output, 'a crash on the fixture is not a verdict (missing file)').not.toContain('ENOENT')
      expect(run.output, 'a crash on the fixture is not a verdict (no unreleased section)').not.toContain(
        'has no "## [',
      )
      expect(run.output, 'only the verdict path prints the escape hatch line').toContain(ESCAPE_WORD)
    },
    HOOK_TIMEOUT,
  )

  it(
    '32 still reminds on a chore commit (an unconditionally passed switch would silence this)',
    () => {
      const repo = makeRepo()
      stage(repo, 'src/probe.ts')
      const msg = messageFile(repo, 'msg-chore-remind.txt', 'chore(card): a probe chore commit\n')

      const run = runHook(repo, msg)
      expect(run.status, 'chore is not blocked: ' + run.output).toBe(0)
      // 判定被 `--merge-head` 关掉时，这条路**什么都不会打**（放行且不提醒）⇒ 这条会红。
      // ⚠️ 提醒走 stderr ⇒ 这条用例是 `spawnSync` 的理由（见 `runHook` 的注释）。
      expect(run.output, 'an unrecorded change must still be reminded').toContain('doc/CHANGELOG.md')
    },
    HOOK_TIMEOUT,
  )

  it('33 the hook file is Node code: no BOM, shebang first, and it parses', () => {
    const source = readFileSync(path.join(ROOT, HOOK), 'utf8')
    expect(source.charCodeAt(0), 'a BOM would break the shebang').not.toBe(0xfeff)
    expect(source.split('\n')[0]).toMatch(/^#!.*node/)
    // ⚠️ 这一条是唯一**不 spawn 也能量到**的那半：shebang 那种行会被解析器当注释，但 shell 那行不会。
    //    它把「钩子起不来」在**任何环境**下都变成一条红（行为那三条要能起子进程才量得到）。
    expect(syntaxErrors(path.join(ROOT, HOOK)), 'the hook must be Node syntax, not shell').toEqual([])
  })
})
