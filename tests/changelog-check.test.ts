/**
 * 票 54：「改了东西却没记更新日志」那条提交期检查的用例集。
 *
 * 契约 `.team/test/2026-09-17/contract-54.md`（S0 是 `.team/leader/2026-09-17/` 那张任务卡，
 * 钩子位置来自 `.team/leader/scratch/2026-09-17/probe-54-hook-order.txt` 的实测读数）。
 *
 * ⚠️ **全部在进程内跑**：判定是脚本导出的**纯函数** `judge()`，入参是三份普通字符串与数组
 *    —— 不起 git、不 spawn、不碰真索引（我的沙箱跑不了子进程，契约 §0 ④ 就是这么定的）。
 * ⚠️ 用 `import * as mod`：`import { judge }` 在脚本还不存在时会**在收集阶段炸掉整份文件**
 *    （一条用例都跑不到），而契约要的是「红在判据上」。
 * ⚠️ 全文 ASCII：`.githooks/checks/ascii.mjs` **连测试里的中文字面量也拦**（调用点递的是 `allStaged`，
 *    `.githooks/pre-commit:299`，含 `tests/`；实测字符串字面量与 `describe()` 标题里的中文都 `exit=1`、
 *    中文注释放行）⇒ 脚本输出的中文文案**不抄**，断言只找结构性要素（路径 / 段名 / 逃生口那半句）；
 *    段名同理从 `doc/CHANGELOG.md` 现取（`unreleasedHeading()`），不在这里抄第二份。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as changelogCheck from '../.githooks/checks/changelog.mjs'
import {
  ESCAPE_WORD,
  amendNoStaged,
  docsOnly,
  featOnCards,
  featOnSource,
  featOnSourceRecorded,
  featOnTests,
  featWithEscape,
  mergeByHead,
  mergeByMessage,
  noBaseline,
  recorded,
  refactorOnSource,
  secondCommitAfterBlankOnly,
  secondCommitAfterRecorded,
  secondCommitWithoutRecord,
  unreleasedHeading,
  whitespaceOnly,
  type CaseInput,
  type Verdict,
} from './support/changelog-cases'

/** 脚本源码（形状类判据读它 —— 那几条判的是「接线怎么写」，不是「判得对不对」） */
const SCRIPT = '.githooks/checks/changelog.mjs'

/** 用例 9：四个本来就该放的类型 */
const RELEASED_TYPES = [
  'revert(card): undo it',
  'chore(deps): bump vite',
  'docs: fix a typo',
  'test: add cases',
]

/** 判一次。脚本还不存在时 `changelogCheck.judge` 是 undefined，用例会红在「不是函数」上（契约 §9） */
function judge(input: CaseInput): Verdict {
  return changelogCheck.judge(input) as Verdict
}

/** 三份入参连判两次 —— 用来证明判定是纯函数、且不改入参 */
function judgeTwice(input: CaseInput): [Verdict, Verdict] {
  const before = JSON.stringify(input)
  const first = judge(input)
  const second = judge(input)
  expect(JSON.stringify(input), 'judge must not touch its input').toBe(before)
  return [first, second]
}

/** 一个判定该不该拦 */
function blocked(input: CaseInput): boolean {
  return judge(input).blocked
}

/** 一个判定给不给提醒 */
function reminderOf(input: CaseInput): string | null {
  return judge(input).reminder
}

/** 把理由与提醒拼成一段文本：断言「里面提到了什么」时用它，不关心落在哪个字段 */
function textOf(input: CaseInput): string {
  const verdict = judge(input)
  return [verdict.reasons.join('\n'), verdict.reminder ?? ''].join('\n')
}

describe('changelog check: the plainly blocking cases (S0 rule 4)', () => {
  it('1 blocks a feat that changed src/ without moving the changelog', () => {
    const input = featOnSource()
    expect(blocked(input)).toBe(true)
    expect(judge(input).reasons.length, 'a block must say why').toBeGreaterThan(0)
  })

  it('2 releases the same commit once the changelog really moved', () => {
    expect(blocked(featOnSourceRecorded())).toBe(false)
    expect(reminderOf(featOnSourceRecorded())).toBeNull()
  })

  it('3 blocks a feat that only changed cards/ (the second line of the range)', () => {
    expect(blocked(featOnCards())).toBe(true)
  })

  it('4 releases a feat that only touched tests/, and says nothing at all', () => {
    expect(blocked(featOnTests())).toBe(false)
    expect(reminderOf(featOnTests()), 'a test-only commit is not a behaviour change').toBeNull()
  })
})

describe('changelog check: other typed commits only get a reminder (S0 rule 1)', () => {
  it('5 does not block a refactor but does remind', () => {
    const verdict = judge(refactorOnSource())
    expect(verdict.blocked).toBe(false)
    expect(verdict.reminder, 'the reminder is the whole point of this half').not.toBeNull()
  })

  it('18 hands out the reminder on the blocked path too', () => {
    const verdict = judge(featOnSource())
    expect(verdict.blocked).toBe(true)
    expect(verdict.reminder, 'blocked and reminded are not either/or').not.toBeNull()
  })
})

describe('changelog check: the breaking-change marker belongs to the type (S0 rule 1)', () => {
  it('34 blocks the "!" form of all three types, and still only reminds on chore!', () => {
    // Conventional Commits 的破坏性变更写法：类型后面直接跟 `!`（可带 scope）—— 类型本身没变，
    // 仍然是 feat / fix / perf ⇒ 与不带 `!` 的那条同一个口径（契约 §3.5 / 用例 34）。
    for (const type of ['feat', 'fix', 'perf']) {
      const bare = type + '!: a thing\n'
      const scoped = type + '(card)!: a thing\n'
      expect(blocked({ ...featOnSource(), message: bare }), bare.trim() + ' must block').toBe(true)
      expect(blocked({ ...featOnSource(), message: scoped }), scoped.trim() + ' must block').toBe(true)
    }
    // 反面控制：`chore!` 不在这三类里 ⇒ 仍然只提醒。少了这一半，「见到 `!` 就拦」那种改法也能过。
    const chore = judge({ ...featOnSource(), message: 'chore!: a thing\n' })
    expect(chore.blocked).toBe(false)
    expect(chore.reminder, 'a non-blocking type still gets the reminder').not.toBeNull()
  })
})

describe('changelog check: the escape hatch (S0 rule 3)', () => {
  /** 逃生口那一行里的破折号：house style 是 U+2014 两个 */
  const dash = String.fromCharCode(0x2014).repeat(2)

  it('6 releases a feat that declares the reason', () => {
    expect(blocked(featWithEscape(ESCAPE_WORD + ' ' + dash + ' the card is the content'))).toBe(false)
  })

  it('23 reads the escape hatch case-insensitively', () => {
    expect(blocked(featWithEscape('changelog: NONE ' + dash + ' same reason, other casing'))).toBe(false)
  })

  it('7 refuses the escape hatch when the reason is empty', () => {
    expect(blocked(featWithEscape(ESCAPE_WORD + ' ' + dash))).toBe(true)
  })

  it('8 refuses the escape hatch written with two ASCII hyphens', () => {
    expect(blocked(featWithEscape(ESCAPE_WORD + ' -- a reason'))).toBe(true)
  })
})

describe('changelog check: the complaint-free half (S0 rule 5)', () => {
  it('9 releases revert / chore / docs / test', () => {
    for (const type of RELEASED_TYPES) {
      expect(blocked({ ...featOnSource(), message: type + '\n' }), type).toBe(false)
    }
  })

  it('10 releases a merge commit seen through MERGE_HEAD', () => {
    const verdict = judge(mergeByHead())
    expect(verdict.blocked).toBe(false)
    expect(verdict.reasons).toEqual([])
    expect(verdict.reminder).toBeNull()
  })

  it('11 releases a merge commit seen through its message', () => {
    expect(blocked(mergeByMessage())).toBe(false)
  })

  it('12 still blocks when the changelog only moved whitespace around', () => {
    const input = { ...featOnSource(), changelogDiff: whitespaceOnly() }
    expect(blocked(input), 'a whitespace-only diff is not an entry').toBe(true)
    expect(textOf(input), 'the reason must say it was whitespace-only').toContain('CHANGELOG')
  })

  it('13 releases when the changelog gained real text (the pair of 12)', () => {
    const input = { ...featOnSource(), changelogDiff: recorded('- **a real line** - and why') }
    expect(blocked(input)).toBe(false)
  })

  it('14 handles the empty staged list of an amend', () => {
    const input = amendNoStaged()
    // 这份入参在别的分支上都会触发提醒（改了代码 + feat + 没有 CHANGELOG diff），
    // 所以「空表放行」这条守卫只有它测得出 —— 换一份温和的入参，这条分支删掉都不会红
    expect(input.staged, 'the fixture must really be the empty list').toHaveLength(0)
    const verdict = judge(input)
    expect(verdict.blocked).toBe(false)
    expect(verdict.reminder, 'an empty staged list means there is nothing to judge').toBeNull()
  })

  it('15 releases a docs-only commit without a reminder', () => {
    const verdict = judge(docsOnly())
    expect(verdict.blocked).toBe(false)
    expect(verdict.reminder).toBeNull()
  })

  it('22 does not mistake "srcx/" for "src/"', () => {
    const input = { ...featOnSource(), staged: ['srcx/app.ts'] }
    expect(blocked(input)).toBe(false)
    expect(reminderOf(input)).toBeNull()
  })
})

describe('changelog check: a branch records the entry once, not once per commit (rule 10)', () => {
  it('26 releases the second commit when an earlier commit on the branch recorded it', () => {
    const verdict = judge(secondCommitAfterRecorded())
    expect(verdict.blocked, 'the entry is already on this branch').toBe(false)
    expect(verdict.reminder, 'nothing is missing, so nothing to remind').toBeNull()
  })

  it('27 still blocks when no commit on the branch recorded it', () => {
    const verdict = judge(secondCommitWithoutRecord())
    expect(verdict.blocked, 'two commits changed code and nobody recorded anything').toBe(true)
    expect(verdict.reminder).not.toBeNull()
  })

  it('28 does not count a branch that only moved changelog whitespace (the pair of 26)', () => {
    expect(blocked(secondCommitAfterBlankOnly())).toBe(true)
  })

  it('29 falls back to "staged only" when no baseline can be taken', () => {
    const input = noBaseline()
    expect(input.branchCommits, 'the fixture must really be the empty list').toHaveLength(0)
    // 与「没有本分支信息」时的判定**逐字相同**
    expect(blocked(input)).toBe(blocked(featOnSource()))
    expect(reminderOf(input)).toBe(reminderOf(featOnSource()))
  })
})

describe('changelog check: the reminder must carry the next step (S0 rule 6)', () => {
  it('16 names the file, the section and the escape hatch', () => {
    const reminder = reminderOf(refactorOnSource()) ?? ''
    expect(reminder).toContain('doc/CHANGELOG.md')
    expect(reminder).toContain(unreleasedHeading())
    expect(reminder).toContain(ESCAPE_WORD)
  })

  it('17 says which line of the range changed', () => {
    expect(textOf(featOnSource())).toContain('src/game/card.ts')
    expect(textOf(featOnCards())).toContain('cards/morningwind.json')
  })
})

describe('changelog check: the script must have the shape the contract fixes (S0 rule 7)', () => {
  it('19 can be imported without running the CLI', () => {
    expect(typeof changelogCheck.judge, 'judge must be a named export').toBe('function')
  })

  it('20 detects direct execution and never hardcodes the message path', () => {
    const source = readFileSync(SCRIPT, 'utf8')
    expect(source, 'the ESM way to tell "run directly"').toContain('import.meta.url')
    expect(source, 'the entry path is argv[1]').toContain('process.argv[1]')
    expect(
      source,
      'the message path must come from the argument: a merge passes .git/MERGE_MSG while .git/COMMIT_EDITMSG holds the previous message',
    ).not.toContain('.git/COMMIT_EDITMSG')
  })

  it('21 is a pure function: same input twice, and the input is untouched', () => {
    const [first, second] = judgeTwice(featOnCards())
    expect(second).toEqual(first)
  })

  it('24 spells the two CLI flags the hook will pass', () => {
    const source = readFileSync(SCRIPT, 'utf8')
    expect(source).toContain('--message')
    expect(source).toContain('--merge-head')
  })

  it('25 is not a check that simply blocks everything (negative control)', () => {
    expect(blocked(featOnSourceRecorded()), 'recorded => released').toBe(false)
    expect(blocked(amendNoStaged()), 'nothing staged => released').toBe(false)
  })
})
