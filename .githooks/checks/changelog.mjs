/**
 * 更新日志检查（commit-msg 跑）。
 *
 * 规则：改了东西（`src/` 或 `cards/`，卡是内容、改了就是改了行为）却没在
 * `doc/CHANGELOG.md` 的未发布段记一笔时，`feat` / `fix` / `perf` 三类**拦下提交**，
 * 其它类型**只提醒**；提醒永远跟着「改了东西却没记」这一件事，与拦不拦无关。
 * 判据与逐条情形见 `.team/test/2026-09-17/contract-54.md`。
 *
 * ⚠️ 挂 `commit-msg` 而不是 `pre-commit`：实测（`.team/leader/scratch/2026-09-17/
 *    probe-54-hook-order.txt`）`pre-commit` 那一刻提交信息**还不存在，或是上一次的旧消息**
 *    ⇒ 按消息判的检查放那里会假放行 + 假拦截。消息路径**只从命令行参数来**。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** 「改了东西」的两条线：代码与卡 */
const CODE_LINE = /^(src|cards)\//
/**
 * 拦下的三类提交；其余类型只提醒。
 *
 * ⚠️ `!` 是**破坏性变更的写法**，不是第四类：`feat!:` / `feat(scope)!:` 的类型仍然是 `feat`
 * ⇒ 与不带 `!` 的**同一条口径**（契约 §3.5）；`chore!` / `docs!` 同理仍然只提醒。
 * 所以 `!` 得自己进这个正则 —— 漏了它，破坏性变更那半会**静默放水**。
 */
const BLOCKING_TYPES = /^(feat|fix|perf)(!|\(|:|$)/
/** 逃生口：词 `none` 与两个 U+2014 之间允许空白；理由必须是**非空白**，空理由不算声明 */
const ESCAPE = /CHANGELOG:\s*none\s*\u2014\u2014+\s*(\S[^\r\n]*)/i

/**
 * 判一次提交该不该被这条纪律拦下；提醒要不要打，也由它说。
 *
 * ⚠️ 纯函数：不读文件、不读 argv、不改入参 —— 用例在进程内直接调它，
 *    于是 import 本模块**不许有任何副作用**。
 */
export function judge(input = {}) {
  const { message = '', staged = [], changelogDiff = '' } = input
  const branchDiff = input.branchChangelogDiff ?? ''

  // 合并提交放行，而且不提醒：两条路都要看 —— `MERGE_HEAD` 是实测判据（合并那一次
  // `pre-commit` 根本不跑、`commit-msg` 的实参是 `.git/MERGE_MSG`），消息文本是第二层保险
  if (input.mergeHead || /^Merge /.test(message)) return released()

  // 判据是「有没有 src/ 或 cards/ 的文件」，**不是**「表空不空」：空表必然一个都没有，
  // 那是同一条判据（写成两条会多出一条永远走不到的分支 —— 删掉它一条用例都不会红）
  const changed = staged.filter((file) => CODE_LINE.test(file))
  if (!changed.length) return released()

  // 「记了一笔」= 这一次动了、或本分支此前动过，而且那份 diff 里除增删行的内容之外还有非空白
  if (hasContent(changelogDiff) || hasContent(branchDiff)) return released()
  if (ESCAPE.test(message)) return released()

  return {
    blocked: BLOCKING_TYPES.test(message),
    reasons: buildReasons(changed, changelogDiff),
    reminder: buildReminder(changed),
  }
}

/** 什么都不用做：放行，而且不提醒 */
function released() {
  return { blocked: false, reasons: [], reminder: null }
}

/** diff 里除了增删行的内容之外还有没有非空白字符 */
function hasContent(diff) {
  const { removed, added } = changedLines(diff)
  return [...removed, ...added].some((line) => line.trim() !== '')
}

/** diff 里这一行的正文：去掉 `+` / `-` 那个符号 */
const body = (line) => line.slice(1)

/** 数出一份 diff 里删掉与加上的行的正文（跳过 hunk 头与那三行文件头） */
function changedLines(diff) {
  const removed = []
  const added = []
  for (const line of diff.split('\n')) {
    // `---` / `+++` 是文件头不是删除 / 新增；`@@` / `diff ` / `index ` 是元信息
    if (/^(---|\+\+\+|@@|diff |index )/.test(line)) continue
    if (line.startsWith('-')) removed.push(body(line))
    else if (line.startsWith('+')) added.push(body(line))
  }
  return { removed, added }
}

/** `src/` 还是 `cards/` 动了（报错里要能看出是哪条线） */
function scopeOf(files) {
  return files.some((file) => file.startsWith('cards/')) ? '卡与代码' : '代码'
}

/** 未发布那一段的段名；段名改了这里跟着走，不抄第二份 */
function unreleasedHeading() {
  const heading = readFileSync('doc/CHANGELOG.md', 'utf8')
    .split('\n')
    .find((line) => line.startsWith('## [') && line.includes(']'))
  if (heading === undefined) throw new Error('doc/CHANGELOG.md has no "## [...]" section')
  return heading.replace(/^##\s+/, '').trim()
}

/** 给用户看的下一步：说清去哪写、怎么写 */
function buildReminder(files) {
  const section = unreleasedHeading()
  return [
    `这次动了${scopeOf(files)}（${files.join(', ')}），但没在 doc/CHANGELOG.md 的 ${section} 段记一笔。`,
    `去 doc/CHANGELOG.md 的 ${section} 段加一条，或在提交信息里写明：`,
    '  CHANGELOG: none —— <理由>',
  ].join('\n')
}

/** 拦下时说的理由：改了哪条线、为什么算改了行为、以及这次为什么不算记过 */
function buildReasons(files, changelogDiff) {
  const listed = files.slice(0, 5).join(', ') + (files.length > 5 ? ' …' : '')
  const reasons = [
    `改了${scopeOf(files)}：${listed} —— src/ 与 cards/ 都算改了行为，卡是内容，改了就是改了行为。`,
  ]
  reasons.push(
    changelogDiff.trim() === ''
      ? 'doc/CHANGELOG.md 一个字都没动，本分支此前也没记过。'
      : 'doc/CHANGELOG.md 的改动只有空白 —— 那不算记了一笔，请写一行真文字。',
  )
  return reasons
}

/** 命令行入口：读这次提交的消息与暂存区，交给 judge，该拦就退出 1 */
function run() {
  const flags = parseFlags()
  if (!flags.message) {
    console.error('✖ 用法：node .githooks/checks/changelog.mjs --message <提交信息路径> [--merge-head]')
    process.exit(1)
  }

  const verdict = judge({
    message: readFileSync(flags.message, 'utf8'),
    staged: git('diff --cached --name-only --diff-filter=ACM'),
    changelogDiff: gitText('diff --cached -- doc/CHANGELOG.md'),
    mergeHead: flags.mergeHead,
    branchCommits: branchCommits(),
    branchChangelogDiff: branchChangelogDiff(),
  })

  if (verdict.reminder) console.error('\n' + verdict.reminder)
  if (!verdict.blocked) return

  console.error('\n✖ 改了东西却没记更新日志，已阻止提交：\n')
  for (const reason of verdict.reasons) console.error('  ' + reason)
  console.error('')
  process.exit(1)
}

/**
 * 先问一句 git 在不在，再问它别的。
 *
 * ⚠️ 少了这一步，git 跑不起来会被「读文件读不到」那条路悄悄吃掉：
 *    每种读法都把失败当成「没输出」⇒ 暂存区看着是空的 ⇒ 一律放行。
 *    实测就是这么骗过一次（`execSync` 抛的 `status` 是 `null` 不是 `undefined`，
 *    所以按 `status` 分辨"没输出"与"没跑起来"分不开）。**宁可拦住提交，也不放行。**
 */
function requireGit() {
  try {
    execSync('git --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    throw new Error('git 跑不起来，这条检查没法判：' + (err instanceof Error ? err.message : String(err)), {
      cause: err,
    })
  }
}

/**
 * 读命令行开关：`--message <路径>` 与 `--merge-head`；`--merge-head` 没给就问 git。
 *
 * ⚠️ **消息路径只能来自实参**：合并那一次 git 给的是合并消息文件，而那个固定的
 *    「本次提交信息」文件里躺着的是**上一次的旧消息** —— 读它就会假放行 + 假拦截。
 */
function parseFlags() {
  const at = process.argv.indexOf('--message')
  const asked = process.argv.includes('--merge-head')
  return {
    message: at < 0 ? '' : (process.argv[at + 1] ?? ''),
    mergeHead: asked || gitText('rev-parse -q --verify MERGE_HEAD') !== '',
  }
}

/** 跑一条 git 命令，按行返回（取不到就是空表） */
function git(args) {
  return gitText(args).split('\n').filter(Boolean)
}

/** 跑一条 git 命令，原样返回输出（git 正常退出但没输出 = 合法状态，给空串） */
function gitText(args) {
  try {
    return execSync('git ' + args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    if (err instanceof Error && typeof err.status === 'number') return ''
    throw new Error('git ' + args + ' 跑不起来：' + (err instanceof Error ? err.message : String(err)), {
      cause: err,
    })
  }
}

/** 本分支自 merge-base 起改过的文件（含工作区）；取不到基线就是空表 */
function branchCommits() {
  return git('diff --name-only ' + base())
}

/** `git diff <merge-base> -- doc/CHANGELOG.md`：本分支记过没有，只看这里的内容 */
function branchChangelogDiff() {
  return gitText('diff ' + base() + ' -- doc/CHANGELOG.md')
}

/** 本分支的基线：默认远端 main（已经落地的真相），可用环境变量覆盖 */
function base() {
  return process.env.CHANGELOG_BASE || 'origin/main'
}

// ---------- CLI 薄壳的判据：只有直接跑本文件时才干活 ----------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireGit()
    run()
  } catch (err) {
    // 绝不静默放行：判定自己出错时必须拦下提交，否则这条纪律会变成一个看不见的后门
    console.error('\n✖ 更新日志检查自己出错了，已阻止提交：')
    console.error('  ' + (err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }
}
