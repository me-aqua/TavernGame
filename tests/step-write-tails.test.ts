/**
 * 票 73 · 段 8c-②（「编一步 · 写」）的**读盘类判据**：R8 / R9 / R11 / R12 / R13。
 *
 * 这一件的判据一条都不挂界面：它们量的是**字、名单与记号**（S0 §五 那五条口径）。
 * 与界面那一族分开住，是因为它们的失败信息说的是"盘上某个文件里还留着旧话"，
 * 而 `step-form-dom.test.ts` 那一族说的是"那一屏长什么样" —— 混在一件里读起来要对两次账。
 *
 * ⚠️ **测试里的字符串一律 ASCII**（`.githooks/checks/ascii.mjs` 连 `tests/` 一起拦）⇒
 *    凡是要比中文的地方，都拿 **Unicode 转义**写（与 `card-ui.test.ts` 里那条故事标题同一套做法）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** 读一个文件的文本（判据只读盘，不碰网络） */
function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/** 一个文件里出现过的 `text-[Npx]` 字号字面量（与 `editor-scale-tokens` 的普查同一套走法） */
function fontLiterals(file: string): number {
  return [...read(file).matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].length
}

/** 递归列一个目录下的每一个 `.ts`（相对路径、正斜杠、排序好） */
function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsFiles(full))
    else if (name.endsWith('.ts')) out.push(full.replace(/\\/g, '/'))
  }
  return out.sort()
}

/** 一份文本里那两个记号的**调用形式**落在哪几行（`it` / `describe` / `test` 后面接那个记号那种） */
function marksIn(text: string, mark: 'skip' | 'only'): number[] {
  const hits: number[] = []
  text.split('\n').forEach((line, index) => {
    if (new RegExp('\\b(it|describe|test)\\.' + mark + '\\s*\\(').test(line)) hits.push(index + 1)
  })
  return hits
}

/**
 * R13 · 🔴 （S0 §五 R13 · B8.1）**那族没人守的记号**：`tests/` 里 `.only` 零命中、`.skip` 零条。
 *
 * 为什么要它：`.only` 会让**别的用例静默不跑**（"通过的检查"与"根本没跑的检查"长得一模一样），
 * `.skip` 会让一条判据假装不存在 —— 而这两个记号在 `tests/` 里**从前没有任何检查管**
 * （`.githooks/**` 六个脚本对 `.skip` 零命中；`pre-commit` 那条 `.only` 检查被目录豁免挡在 `tests/` 外面）。
 * **判据写在 `tests/` 里，不写进 `.githooks/`** —— 那是协作者的文件。
 *
 * ⚠️ **本刀做完应当是 0 条**：8c-① 留下的 6 条挂起在本刀全部改写转绿（R4）。
 * ⚠️ 数的是**调用形式**（`it` / `describe` / `test` 后面接 `.skip` / `.only` 那种），不是光秃秃那五个字符 ——
 *    后者会把**解释这件事的散文**也数进去（一句"本刀把 6 条记号解封了"就红）⇒
 *    判据一红就得删掉解释，那是"把检查改绿"的另一张脸。
 *    ⚠️ **本文件自己的注释也不许写出调用形式**（写了就会被这条正则数到）—— 所以上面这几行都绕着写。
 *    而**被注释掉的**调用照样数得出来 —— 那正是"假装不存在"要拦的形状。
 */
describe('R13 the two marks nobody watches in tests/', () => {
  /** 这一件自己 —— 它含那两个记号的字面量（扫自己要排掉，否则永远红） */
  const SELF = 'tests/step-write-tails.test.ts'
  const files = tsFiles('tests').filter((file) => file !== SELF)

  it('the scanner itself can see a mark (calibration)', () => {
    // 反面控制：扫描器照不到东西时，"零命中"是一句空话 —— 先证明它数得出
    expect(marksIn("it.skip('x', () => {})", 'skip'), 'the scanner cannot see a skip at all').toEqual([1])
    expect(marksIn("describe.only('x', () => {})", 'only'), 'the scanner cannot see an only at all').toEqual([
      1,
    ])
    expect(
      marksIn('// it.skip( in a comment counts too', 'skip'),
      'a commented-out mark still counts',
    ).toEqual([1])
  })

  it('no test file switches anything on or off', () => {
    expect(files.length, 'the census found no test file at all').toBeGreaterThan(30)
    const only: string[] = []
    const skip: string[] = []
    for (const file of files) {
      const text = read(file)
      for (const line of marksIn(text, 'only')) only.push(file + ':' + line)
      for (const line of marksIn(text, 'skip')) skip.push(file + ':' + line)
    }
    expect(
      only,
      'a test file switches the runner into "only" mode: every other case silently stops running',
    ).toEqual([])
    expect(
      skip,
      'a test file switched itself off: this ticket rewrites them all, so the ledger is empty',
    ).toEqual([])
  })
})

/** R9 · `CardNodeForm` 的字号换 token：文件里 `text-[Npx]` 零命中，并且从 `EDITOR_OWNED` 名单里出来 */
describe('R9 the old node form uses the scale tiers', () => {
  const FORM = 'src/components/CardNodeForm.vue'

  it('the form carries no font-size literal any more', () => {
    expect(fontLiterals(FORM), 'this file still pins px font sizes instead of the --fs1/2/3 tiers').toBe(0)
  })

  it('and it left the registry of files that are allowed to carry literals', () => {
    const registry = read('tests/editor-scale-tokens.test.ts')
    expect(
      registry.includes("'" + FORM + "'"),
      'the file is out of the form but still registered as "allowed to carry literals"',
    ).toBe(false)
  })
})

/** R12 · `StepForm` 与 `EditorShell` 各补一个 `.stories.ts`（`pre-commit` 会提醒"巡检覆盖不到"） */
describe('R12 the two editor components have stories', () => {
  for (const name of ['StepForm', 'EditorShell']) {
    it(name + '.stories.ts exists and declares itself', () => {
      const file = 'src/components/' + name + '.stories.ts'
      const text = read(file)
      expect(text, 'the story has no meta at all').toContain('satisfies Meta<')
      expect(text, 'the story must import the component it documents').toContain("from './" + name + ".vue'")
    })
  }
})

/**
 * R11 · 两处收尾（S0 §五 R11）。
 *
 * ⚠️ **只判得了半条**：另一处「施工图那行」在 `.team/leader/格式升级-分段计划.md` ——
 *    **那个文件不在仓库里**（`.team/` 不进 git）⇒ 判据读它会在换台机器/CI 上失败。
 *    ⇒ 那一半**不写判据**，记进契约与交件说明，由组长在 S4 目视核（契约 §9 开口）。
 */
describe('R11 the empty-state line names the strip as well', () => {
  /** 两个 locale 里那句话（键 = `card.branchNone`） */
  const LINE: Record<string, string> = {
    'src/locales/zh-CN.json': '\\u7ec6\\u6761|\\u5de5\\u4f5c\\u6d41',
    'src/locales/en.json': 'strip|workflow',
  }

  for (const [file, words] of Object.entries(LINE)) {
    it('names the strip entry in ' + file, () => {
      const text = read(file)
      const hit = text.split('\n').find((line) => line.includes('"branchNone"'))
      expect(hit, 'this locale has no branchNone line at all').not.toBe(undefined)
      expect(
        new RegExp(words).test(hit as string),
        'the empty state still tells the author about the left column only, while the strip is an entry too',
      ).toBe(true)
    })
  }
})

/**
 * R8 · 🔴 五处旧语义**连行为一起改**（字与行为必须同时改）—— 这里只判**字**那一半：
 * 旧话族在那四个文件里零命中。行为那一半（`CardNodeForm` 的勾选缺省）归 8c-② 的实现面。
 */
describe('R8 the old wording about the absent settings key is gone', () => {
  /** 旧话族：`\u5168\u8bfb` = 全读 · `\u5168\u52fe` = 全勾 · `\u8868\u8fbe\u4e0d\u51fa\u6765` = 表达不出来 */
  const OLD =
    '\\u5168\\u8bfb|\\u5168\\u52fe|\\u8868\\u8fbe\\u4e0d\\u51fa\\u6765|cannot express|is an empty list'
  const FILES = [
    'src/components/CardNodeForm.vue',
    'src/components/CardNodeForm.stories.ts',
    'src/locales/zh-CN.json',
    'src/locales/en.json',
  ]

  for (const file of FILES) {
    it('no stale sentence in ' + file, () => {
      const hits = read(file)
        .split('\n')
        .map((line, index) => ({ line: index + 1, text: line }))
        .filter((one) => new RegExp(OLD).test(one.text))
        .map((one) => one.line + ': ' + one.text.trim())
      expect(hits, 'that sentence is false since the absent key means "send nothing"').toEqual([])
    })
  }
})
