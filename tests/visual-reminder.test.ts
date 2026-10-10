/**
 * 票「协作者的两处检查」· **「组件动了要看图」那条提醒的判据**：
 * 组件就是组件 —— 它在 `src/components/` 下面第几层都一样。
 *
 * 缺陷（来历：`follow-ups.md` 2026-09-23 那一节）：`pre-commit` 的两条界面正则里，
 * 组件那条是 `src\/components\/([A-Za-z0-9]+)\.vue` 加两个锚 —— **只认一层**。于是
 * `src/components/world/SceneSigil.vue` 这种一个都不匹配 ⇒ 改了界面，钩子一声不吭
 * （实测读数在 `.team/test/2026-10-10/probe2-run.log`：暂存 `world/SceneSigil.vue`，
 * 输出只剩那行 `SKIP_DISCIPLINE=1`，提醒一个字都没有）。**静默漏掉是最坏的那一类。**
 *
 * 判据真起一次**钩子本体**：在这个夹具仓库里 `git init` + `git add`，**绝不碰项目自己的索引**。
 * 提醒是「打印给人看的东西」，只有进程的 stdout 量得到它。`SKIP_DISCIPLINE=1` 那条支路
 * 只做视觉提醒就退出（`pre-commit:25`）⇒ 夹具不必把 eslint / vitest 那一整套拉起来。
 * ⚠️ 两条支路调的是**同一个** `remindVisualCheck`，所以这一层管得到正常路径；
 *    它管不到的是「正常路径上有没有调它」—— 那是钩子的既有行为，不在本票改动范围。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/** 被测的那个程序：`.githooks/pre-commit`（**项目里那份** —— 夹具只提供"被操作的仓库"） */
const HOOK = '.githooks/pre-commit'

/** 项目根：钩子从这里取（vitest 的 cwd 就是它） */
const ROOT = process.cwd()

/** Windows 上不能直接起无扩展名的脚本，统一经 node 起 */
const NODE = process.execPath

/**
 * 临时仓库放哪儿：**项目内的 `node_modules/.cache/`**，不是系统临时目录。
 *
 * 与 `tests/changelog-wiring.test.ts` 同一个理由：`node_modules/` 被 git 忽略（不会脏了仓库），
 * 而夹具留在项目内，任何按 cwd 往上找东西的钩子都还找得到项目的那一层。
 */
const REPO_PARENT = path.join('node_modules', '.cache')

/**
 * 钩子要起子进程（`node` + `git`）⇒ 默认 5 秒不是给这种用例定的
 * （先例：`tests/changelog-wiring.test.ts` 实测最坏见过 5.1s）。余量按同一条给。
 */
const HOOK_TIMEOUT = 20000

/** 这一轮造出来的临时仓库（每个用例一个；收工逐个删掉，别留一地垃圾） */
const repos: string[] = []

/** 跑一条 git（用 `-C` 定位临时仓库，不靠 cwd） */
function git(args: string[], cwd: string): string {
  return String(execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }))
}

/** 造一个临时仓库：`git init` 一个空仓库就是这一档要的全部 */
function makeRepo(): string {
  const parent = path.join(ROOT, REPO_PARENT)
  mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(path.join(parent, 'visual-reminder-'))
  expect(path.isAbsolute(dir), 'the fixture path must be absolute: the hook gets it as cwd').toBe(true)
  git(['init', '-q'], dir)
  repos.push(dir)
  return dir
}

/** 组件旁边放一份故事文件 —— **只放盘上、不进暂存区**（钩子查的是工作区） */
function writeStory(repo: string, component: string): void {
  const full = path.join(repo, component.replace(/\.vue$/, '.stories.ts'))
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, '// probe story\n', 'utf8')
}

/**
 * 在临时仓库里暂存一个文件（只 `git add`，不提交），**并当场体检夹具**。
 *
 * ⚠️ **父目录要自己建**：`mkdtemp` 只给出仓库根，`src/components/world/` 那两层没有 ——
 *    不建它 `writeFileSync` 就 ENOENT（先例实测：4 条全红、只有 1 条红对了）。
 */
function stage(cwd: string, file: string): void {
  expect(existsSync(path.join(ROOT, HOOK)), 'the project hook must exist: ' + HOOK).toBe(true)
  const full = path.join(cwd, file)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, '// probe fixture\n', 'utf8')
  git(['add', '--', file], cwd)
  expect(git(['diff', '--cached', '--name-only'], cwd), 'the fixture must be staged: ' + file).toContain(file)
}

/**
 * 真起一次钩子，返回**两路输出合起来**（提醒与失败信息各走一路，只看一路会读错）。
 *
 * ⚠️ `status === null`（`spawn` 被拒）**不是判据失败**，当场抛出来说清。
 */
function runHook(cwd: string): string {
  const run = spawnSync(NODE, [path.resolve(ROOT, HOOK)], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SKIP_DISCIPLINE: '1' },
    maxBuffer: 8 * 1024 * 1024,
  })
  if (run.error !== undefined && run.error !== null) {
    throw new Error('the hook process did not start at all; this is not a verdict: ' + run.error.message, {
      cause: run.error,
    })
  }
  const out = String(run.stdout ?? '') + String(run.stderr ?? '')
  expect(run.status, 'skipping discipline must still exit 0: ' + out).toBe(0)
  return out
}

/** 造一次「这一份被暂存」的现场，返回钩子的输出 */
function remindFor(file: string, withStory: boolean): string {
  const repo = makeRepo()
  if (withStory) writeStory(repo, file)
  stage(repo, file)
  return runHook(repo)
}

/** 把输出里的组件名换成占位符：两份提醒的形状才好逐字比 */
function shapeOf(out: string, name: string): string {
  return out.replace(new RegExp(name, 'gi'), '<NAME>')
}

describe('pre-commit visual reminder: a component is a component at any depth', () => {
  afterAll(() => {
    for (const dir of repos) rmSync(dir, { recursive: true, force: true })
  })

  it(
    '1 reminds about a component that sits in a subdirectory',
    () => {
      const out = remindFor('src/components/world/SceneSigil.vue', true)
      expect(out, 'the reminder must fire for src/components/world/').toContain('npm run stories')
      expect(out, 'and it must name that component').toContain('SceneSigil')
    },
    HOOK_TIMEOUT,
  )

  it(
    '2 reads exactly like the top-level reminder when the story file is there',
    () => {
      const top = remindFor('src/components/WorldPanel.vue', true)
      expect(top, 'control: the reminder works at the top level').toContain('npm run stories')
      const nested = remindFor('src/components/world/SceneSigil.vue', true)
      expect(shapeOf(nested, 'SceneSigil'), 'nested and top-level reminders must read the same').toBe(
        shapeOf(top, 'WorldPanel'),
      )
    },
    HOOK_TIMEOUT,
  )

  it(
    '3 still warns when a subdirectory component has no story file',
    () => {
      const withStory = remindFor('src/components/world/SceneSigil.vue', true)
      const without = remindFor('src/components/world/SceneSigil.vue', false)
      expect(without, 'the missing-story warning must name the component').toContain('SceneSigil')
      expect(
        without.split('\n').length,
        'a missing story file must add a warning line: ' + without,
      ).toBeGreaterThan(withStory.split('\n').length)
    },
    HOOK_TIMEOUT,
  )

  it(
    '4 keeps reminding about the whole page when App.vue changes',
    () => {
      const out = remindFor('src/App.vue', false)
      expect(out, 'the page-level branch must keep working').toContain('npm run visual')
    },
    HOOK_TIMEOUT,
  )

  it(
    '5 says nothing when the change is not user interface',
    () => {
      const out = remindFor('src/game/card.ts', false)
      expect(out, 'no reminder for non-UI code').not.toContain('npm run stories')
      expect(out, 'no reminder for non-UI code').not.toContain('npm run visual')
    },
    HOOK_TIMEOUT,
  )
})
