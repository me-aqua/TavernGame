/**
 * 票 54 的共享夹具：造 `judge()` 要的三份入参（提交信息 / 暂存文件表 / CHANGELOG 的 diff）。
 *
 * 为什么集中在这里：契约把判定做成**纯函数**（`.team/test/2026-09-17/contract-54.md` §2），
 * 于是用例只需要三份**普通字符串与数组** —— 不起 git、不 spawn、不碰真索引。
 * 这些造法（尤其是 diff 的形状）是判据的一部分，各写一份必然走偏。
 *
 * ⚠️ 全文 ASCII：`.githooks/checks/ascii.mjs` **连测试里的中文字面量也拦** —— 它的调用点递的是
 *    `allStaged`（`.githooks/pre-commit:299`，含 `tests/`），实测：字符串字面量里的中文与
 *    `describe()` 标题里的中文都 `exit=1`，中文**注释**放行（脚本先剥注释）。
 *    脚本输出的中文文案**不在这里抄**：断言只找结构性要素（路径 / 段名 / 逃生口那半句）。
 */
import { readFileSync } from 'node:fs'

/**
 * 一次提交的入参：本次暂存那三份 + 「本分支」那两份（契约 §3.10，组长裁决 09-17）。
 *
 * ⚠️ 为什么需要本分支那一对：单笔提交**净增上限 500 行** ⇒ 稍大的 feature 必然拆成 2–3 笔
 * （票 55 / 票 56 各三笔）⇒ 只看**本次暂存**的话，从第 2 笔起必然被拦、每笔都要写一句
 * `CHANGELOG: none —— 已在前一笔`，**纪律当场变仪式**。所以判据要把「本分支自 merge-base
 * 起的改动」算进来：**本分支已经记过一笔，后面的提交就不必再记**。
 */
export interface CaseInput {
  message: string
  staged: string[]
  changelogDiff: string
  mergeHead?: unknown
  /** 本分支自 merge-base 起**改过**的文件（含工作区与暂存区）—— 空表 = 取不到基线 / 直接在 base 上提交 */
  branchCommits?: string[]
  /** `git diff merge-base` 的文本 —— 「本分支记过没有」只看内容，不看文件名 */
  branchChangelogDiff?: string
}

/** 判定的形状（与契约 §2 的返回形状逐字一致；脚本换了形状，这里先红） */
export interface Verdict {
  blocked: boolean
  reasons: string[]
  reminder: string | null
}

/** 逃生口的词（house style：`——` 是 U+2014 两个，不是 ASCII 的两个连字符） */
export const ESCAPE_WORD = 'CHANGELOG: none'

/**
 * 未发布那一段的名字 —— **从 `doc/CHANGELOG.md` 里现取**，不在测试里抄一份字面量
 * （抄一份就是第二个真相：段名改了，断言不会跟着改；而且它是中文，抄进来会被 ascii 拦）。
 */
export function unreleasedHeading(): string {
  const heading = readFileSync('doc/CHANGELOG.md', 'utf8')
    .split('\n')
    .find((line) => line.startsWith('## [') && line.includes(']'))
  if (heading === undefined) throw new Error('doc/CHANGELOG.md has no "## [...]" section')
  return heading.replace(/^##\s+/, '').trim()
}

/** 一条改动的 diff（`+` / `-` 开头的行里，去掉符号之后的内容就是这一行的正文） */
export function diffOf(file: string, removed: string[], added: string[]): string {
  return [
    'diff --git a/' + file + ' b/' + file,
    'index 1111111..2222222 100644',
    '--- a/' + file,
    '+++ b/' + file,
    '@@ -1,3 +1,3 @@',
    ...removed.map((line) => '-' + line),
    ...added.map((line) => '+' + line),
  ].join('\n')
}

/** 一次真记了一笔的改动：未发布段里多一行真文字 */
export function recorded(content: string): string {
  return diffOf('doc/CHANGELOG.md', [], [content])
}

/** 一次「只改空白」的改动：只多一个空行（`+` 后面什么都没有） */
export function whitespaceOnly(): string {
  return diffOf('doc/CHANGELOG.md', [], [''])
}

/** 用例 1：`feat` + 改 `src/` + 没动 CHANGELOG ⇒ 必须被拦 */
export function featOnSource(): CaseInput {
  return { message: 'feat(card): add a thing\n', staged: ['src/game/card.ts'], changelogDiff: '' }
}

/** 用例 2：同一件事但记了一笔 ⇒ 放行、不提醒 */
export function featOnSourceRecorded(): CaseInput {
  return { ...featOnSource(), changelogDiff: recorded('- **add a thing** - why') }
}

/** 用例 3：`feat` 只改卡（卡是内容，改了就是改了行为）⇒ 必须被拦 */
export function featOnCards(): CaseInput {
  return {
    message: 'feat(card): rework the example\n',
    staged: ['cards/morningwind.json'],
    changelogDiff: '',
  }
}

/** 用例 4：`feat` 只改 `tests/`（测试票，不是行为变更）⇒ 放行、且不提醒 */
export function featOnTests(): CaseInput {
  return { message: 'feat(test): more cases\n', staged: ['tests/store.test.ts'], changelogDiff: '' }
}

/** 用例 5：`refactor` 改了源码 ⇒ 不拦，但要有提醒 */
export function refactorOnSource(): CaseInput {
  return { message: 'refactor(game): split a file\n', staged: ['src/game/save.ts'], changelogDiff: '' }
}

/** 用例 6 / 7 / 8 / 23：带逃生口的提交（那一行由调用方给） */
export function featWithEscape(escapeLine: string): CaseInput {
  return { ...featOnSource(), message: 'feat(card): add a thing\n\n' + escapeLine + '\n' }
}

/** 用例 9：四个「本来就该放」的类型（各判一次） */
export const RELEASED_TYPES = [
  'revert(card): undo it',
  'chore(deps): bump vite',
  'docs: fix a typo',
  'test: add cases',
]

/** 用例 10 / 11：合并提交（一口走 MERGE_HEAD、一口走消息文本） */
export function mergeByHead(): CaseInput {
  return {
    message: "Merge branch 'side'\n",
    staged: ['src/app.ts'],
    changelogDiff: '',
    mergeHead: 'abc123',
  }
}

export function mergeByMessage(): CaseInput {
  return { message: "Merge branch 'side'\n", staged: ['src/app.ts'], changelogDiff: '' }
}

/**
 * 用例 14：`--amend --no-edit` 那种「没有新暂存文件」的空表。
 *
 * ⚠️ 判据是**空表 ⇒ 放行、不提醒，一个字节都不看** —— 所以这条入参故意带上
 * 「改了代码 + 消息是 feat + 没有 CHANGELOG diff」：那三样在任何别的分支上都会触发提醒，
 * 只有「空表先返回」才可能得到 `reminder: null`。**空表但没带这些的入参是测不出这条守卫的**
 * （故障注入实测：那样写的话，把这条分支删掉也一条都不会红）。
 */
export function amendNoStaged(): CaseInput {
  return {
    message: 'feat(card): smuggled in through an amend\n',
    staged: [],
    changelogDiff: '',
  }
}

/** 用例 15：只改文档与钩子（没碰 `src/`、没碰卡）⇒ 放行、不提醒 */
export function docsOnly(): CaseInput {
  return {
    message: 'docs: rewrite the skill\n',
    staged: ['doc/DESIGN.md', '.githooks/checks/secrets.mjs'],
    changelogDiff: '',
  }
}

/**
 * 用例 26：**同一支上的第 2 笔** —— 第 1 笔已经把 CHANGELOG 记了，这一笔只改代码。
 *
 * 本分支自 merge-base 起改过 `src/app.ts` **与** `doc/CHANGELOG.md`，且那份 diff 里有真文字。
 */
export function secondCommitAfterRecorded(): CaseInput {
  return {
    ...featOnSource(),
    branchCommits: ['src/app.ts', 'doc/CHANGELOG.md'],
    branchChangelogDiff: recorded('- **the first commit recorded it** - and why'),
  }
}

/** 用例 27：本分支从没记过 CHANGELOG（第 2 笔）⇒ 拦 —— 现状不变，只是判据换了个地方看 */
export function secondCommitWithoutRecord(): CaseInput {
  return {
    ...featOnSource(),
    branchCommits: ['src/app.ts', 'src/other.ts'],
    branchChangelogDiff: '',
  }
}

/** 用例 28：本分支只给 CHANGELOG 添了个空行 ⇒ 不算记过（与 26 成对） */
export function secondCommitAfterBlankOnly(): CaseInput {
  return {
    ...featOnSource(),
    branchCommits: ['src/app.ts', 'doc/CHANGELOG.md'],
    branchChangelogDiff: whitespaceOnly(),
  }
}

/** 用例 29：取不到基线（无 merge-base ⇒ 空分支表）⇒ 退回只看本次暂存 —— 与「现在的行为」逐字相同 */
export function noBaseline(): CaseInput {
  return { ...featOnSource(), branchCommits: [], branchChangelogDiff: '' }
}
