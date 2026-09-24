/**
 * 票 73 · 段 8c-②（「编一步 · 写」）的**读盘类判据**：R8 / R9 / R11 / R12 / R13。
 * 票 75（判据牙口·第二轮）在这件里加了一条 **B4**：那两个只读标记在真件上是同一个表达式。
 *
 * 这一件的判据一条都不挂界面：它们量的是**字、名单与记号**（S0 §五 那五条口径）。
 * 与界面那一族分开住，是因为它们的失败信息说的是"盘上某个文件里还留着旧话"，
 * 而 `step-form-dom.test.ts` 那一族说的是"那一屏长什么样" —— 混在一件里读起来要对两次账。
 *
 * ⚠️ **测试里的字符串一律 ASCII**（`.githooks/checks/ascii.mjs` 连 `tests/` 一起拦）⇒
 *    凡是要比中文的地方，都拿 **Unicode 转义**写（与 `card-ui.test.ts` 里那条故事标题同一套做法）。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

/**
 * 那一族记号在**一份文本**里落在哪几行、是哪一个记号。
 *
 * 🔴 **票 75 的 B7：旧版只认一种写法**（`it` / `describe` / `test` 后面紧跟 `.skip(` 那种），
 *    四种形状照不到。现在这四种都照得到，逐条有反面控制（见 `calibration` 那条用例）：
 *    · **方括号取法** `it['skip'](…)`（点号后紧跟记号那种写法看不见它）；
 *    · **点号两边带空格** `it .only (`；
 *    · **条件版** `it.skipIf(…)` / `it.runIf(false)(…)` —— vitest 真有这两个 API，
 *      它们与 `.skip` 同一种后果（那条用例一条都不跑）；
 *    · **空的参数表** `describe.each([])(…)` —— 一条用例都不生成（同一种"假装不存在"）。
 *
 * ⚠️ **边界（刻意不进正则的）**：`x` 前缀那两个别名（`xit` / `xdescribe`）与 `todo` 记号。
 *    它们今天在 `tests/**` **0 命中**，而且与这两个记号不同族（`todo` 是"还没写"、
 *    不是"写了不跑"）；真要拦得**另立一条判据**，不在这条的形状里 —— 这是写下来的边界，
 *    不是"忘了"。
 * ⚠️ **正则在注释里也命中**（那是有意的：被注释掉的调用同样是"假装不存在"）。
 */
const MARK_NAMES = 'skipIf|runIf|skip|only'
/**
 * 调用形式：`it.skip(` / `it .only (` / `it['skip'](` —— 第二、三段各抓住"是哪一个记号"。
 *
 * ⚠️ **记号后面必须紧跟一个 `(`**（名字后面那种）或 `](`（方括号那种）：这是"调用形式"与
 *    "散文里提了一句"的分界。少了这一半，注释里一句「`it.skip`，不是删掉」就会把这条判据打红，
 *    而那会逼着人删掉解释 —— 那是"把检查改绿"的另一张脸（实测：票 75 第一版就踩了这一格）。
 */
const CALL = new RegExp(
  '\\b(it|describe|test)\\s*(?:\\.\\s*(' +
    MARK_NAMES +
    ')\\s*\\(|\\[\\s*[\'"](' +
    MARK_NAMES +
    ')[\'"]\\s*\\]\\s*\\()',
)
/** 空的参数表：一条用例都不生成 */
const NO_CASES = /\.each\(\s*\[\s*\]\s*\)/

function marksIn(text: string): Array<{ line: number; mark: string }> {
  const hits: Array<{ line: number; mark: string }> = []
  text.split('\n').forEach((line, index) => {
    const call = CALL.exec(line)
    if (call !== null) {
      hits.push({ line: index + 1, mark: (call[2] ?? call[3]) as string })
      return
    }
    if (NO_CASES.test(line)) hits.push({ line: index + 1, mark: 'each([])' })
  })
  return hits
}

/** 一份文件里的记号（读盘就这一处） */
function marksOf(file: string): Array<{ line: number; mark: string }> {
  return marksIn(read(file))
}

/**
 * 那一族记号在给定文件里的**普查** —— 返回 `文件:行:记号`。
 *
 * 真实的普查与"造个假文件 ⇒ 它红"那条反面控制**走同一支**：不然那条反面控制证的是另一支量具。
 */
function censusOf(files: string[]): string[] {
  const hits: string[] = []
  for (const file of files) {
    for (const one of marksOf(file)) hits.push(file + ':' + one.line + ':' + one.mark)
  }
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
 * 🔴 **政策口径（票 75 的 G7 要求写下来）**："`.skip` 零条 / `.only` 零条"是一条**有意钉住的
 *    永久条件**，不是"暂时干净"。往后哪一票**真的需要**挂起一条用例时，**先有意识地改这条判据
 *    并留痕**（改哪一行、为什么），而不是悄悄加一个记号 —— 那正是这两个记号最坏的用法。
 * ⚠️ 数的是**调用形式**（`it` / `describe` / `test` 后面接 `.skip` / `.only` 那种），不是光秃秃那五个字符 ——
 *    后者会把**解释这件事的散文**也数进去（一句"把 6 条记号解封了"就红）⇒
 *    判据一红就得删掉解释，那是"把检查改绿"的另一张脸。
 *    ⚠️ **本件自己排在外**（`SELF`）：这一件的校准串本来就得写出调用形式。**别的文件**里（含注释）
 *    写出来照样数得到 —— 那正是"假装不存在"要拦的形状。
 */
describe('R13 the two marks nobody watches in tests/', () => {
  /** 这一件自己 —— 它含那两个记号的字面量（扫自己要排掉，否则永远红） */
  const SELF = 'tests/step-write-tails.test.ts'
  const files = tsFiles('tests').filter((file) => file !== SELF)

  it('the scanner itself can see every shape of a mark (calibration)', () => {
    // 反面控制：扫描器照不到东西时，"零命中"是一句空话 —— 先证明它数得出
    const seen = (text: string): string[] => marksIn(text).map((one) => one.line + ':' + one.mark)
    expect(seen("it.skip('x', () => {})"), 'the scanner cannot see a skip at all').toEqual(['1:skip'])
    expect(seen("describe.only('x', () => {})"), 'the scanner cannot see an only at all').toEqual(['1:only'])
    expect(seen('// it.skip( in a comment counts too'), 'a commented-out mark still counts').toEqual([
      '1:skip',
    ])
    // 票 75 的 B7：旧版这四种形状一种都照不到 —— 逐种先证明它数得出
    expect(seen("it['skip']('x', () => {})"), 'a bracket lookup hides the mark from the scanner').toEqual([
      '1:skip',
    ])
    expect(seen("it .only ('x', () => {})"), 'a space around the dot hides the mark').toEqual(['1:only'])
    expect(seen("it.skipIf(true)('x', () => {})"), 'the conditional form of skip is a mark too').toEqual([
      '1:skipIf',
    ])
    expect(seen("it.runIf(false)('x', () => {})"), 'runIf(false) runs nothing either').toEqual(['1:runIf'])
    expect(seen("describe.each([])('x', () => {})"), 'an empty table runs no case at all').toEqual([
      '1:each([])',
    ])
  })

  it('a fake file that carries a mark does turn the census red', () => {
    // 🔴 「造个假文件 ⇒ 它红」（票 75 的 B7）：**同一支普查**指向一份真文件，四种旧版照不到的
    //    形状各一行 —— 少了这一条，上面那条"零命中"就只是"量具照不到"的另一种说法。
    // ⚠️ 假文件落在系统临时目录（**不落 `tests/`**：落在里面会被下一趟普查当真文件收走）。
    const dir = mkdtempSync(join(tmpdir(), 'r13-marks-'))
    try {
      const fake = join(dir, 'a-fake.test.ts')
      writeFileSync(
        fake,
        [
          "it['skip']('x', () => {})",
          "it .only ('x', () => {})",
          "it.skipIf(true)('x', () => {})",
          "describe.each([])('x', () => {})",
        ].join('\n') + '\n',
        'utf8',
      )
      const hits = censusOf([fake])
      expect(hits.length, 'the census read nothing out of a file that carries four marks').toBe(4)
      expect(hits[0], 'the census must name the file and the line it saw a mark on').toContain(
        'a-fake.test.ts:1:',
      )
      // 这一句的形状与下面那条普查的断言**逐字同形** —— 它红 = 下面那条也会红
      expect(hits, 'a file that switches cases off must be reported, never silently skipped').not.toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('no test file switches anything on or off', () => {
    expect(files.length, 'the census found no test file at all').toBeGreaterThan(30)
    const hits = censusOf(files)
    expect(
      hits.filter((one) => one.endsWith(':only')),
      'a test file switches the runner into "only" mode: every other case silently stops running',
    ).toEqual([])
    expect(
      hits.filter((one) => !one.endsWith(':only')),
      'a test file switched itself off: the ledger of marks must stay empty',
    ).toEqual([])
  })
})

/**
 * B4 · 🔴 （票 75 量出来的）那两个只读标记在**真件**上是**同一个表达式**。
 *
 * 来历：`A4a` 的 ① 断的是「`data-field-readonly` ⇔ `data-field-takeover`」逐行相等，而
 * `BranchForm.vue` 里这两个属性绑的**是同一句**（`row.taken ? '' : null`）⇒ 那句话在真件上
 * **不可能红**（"量出来是恒真"那一类），它在**自检替身**上才有真牙（替身那两个是独立开关，
 * 读数见 `branch-tree-selfcheck.test.ts` 的 `readonly` 档）。真件上的牙是 A4a 的 ②③。
 *
 * 这一条把那个事实**当场钉住**（不靠记性），同时守住"同一个表达式"：谁把它拆成两份，
 * 这条当场红 —— 那一刻 A4a 的 ① 才重新变成一条独立的断言，而不是一句看着像在断事的话。
 *
 * 🔴 **取法收严（2026-09-24 · S3 的复审攻出一处形状漏洞）**：第一版**按行取** ——
 *    一行里两个属性都写出来时，两次都拿到**同一条整行**，于是"两个不同的表达式"也判等（**空转**）。
 *    ⇒ 现在按**两个属性各自的绑定**取（正则各自抓，**归一化空白**再逐字比，**有序**），
 *    同不同行都不影响。反面控制见下面那条 calibration（同一行、两个不同表达式 ⇒ 必须**不等**）。
 */
describe('B4 the two read-only marks are one and the same expression', () => {
  const FORM = 'src/components/BranchForm.vue'

  /**
   * 一份文本里某个属性绑的**每一个**表达式（按出现次序；空白归一化后再比 —— 换行/缩进不该影响结论）。
   *
   * ⚠️ 用 `[^"]*` 抓值：组件的绑定里用的是单引号（`row.taken ? '' : null`）⇒ 不会提前收口。
   */
  function bindingsOf(source: string, attr: string): string[] {
    return [...source.matchAll(new RegExp(':' + attr + '="([^"]*)"', 'g'))].map((one) =>
      one[1].replace(/\s+/g, ' ').trim(),
    )
  }

  it('binds the read-only mark and the takeover mark to the same expression', () => {
    const source = read(FORM)
    const readonly = bindingsOf(source, 'data-field-readonly')
    const takeover = bindingsOf(source, 'data-field-takeover')
    // 前提：两个属性都**真的绑着**（一个都没抓到的话，下面那句"相等"是空 == 空）
    expect(readonly.length, 'the read-only mark is not bound in the component any more').toBeGreaterThan(0)
    expect(takeover.length, 'the takeover mark is not bound in the component any more').toBeGreaterThan(0)
    expect(
      readonly,
      'the two marks became two independent bindings: A4a may now read them as two different things',
    ).toEqual(takeover)
  })

  it('a same-line pair of two different bindings does not slip through (calibration)', () => {
    // 反面控制：**同一行**上两个属性各绑各的 —— 第一版按行取的写法在这份文本上会判"相等"（空转）
    const oneLine =
      '<div :data-field-readonly="row.taken ? \'\' : null" :data-field-takeover="row.other ? \'\' : null">'
    const readonly = bindingsOf(oneLine, 'data-field-readonly')
    const takeover = bindingsOf(oneLine, 'data-field-takeover')
    expect(readonly, 'the calibration text is not read the way this control assumes').toEqual([
      "row.taken ? '' : null",
    ])
    expect(takeover, 'the calibration text is not read the way this control assumes').toEqual([
      "row.other ? '' : null",
    ])
    expect(readonly, 'two different bindings on one line must not read as the same expression').not.toEqual(
      takeover,
    )
    /** 第一版的取法：按行找、再对**整行**贪婪匹配（`attr` 只用来找那一行） */
    const byLine = (attr: string): string => {
      const hit = oneLine.split('\n').find((line) => line.includes(':' + attr + '="'))
      expect(hit, 'the calibration text has no binding for ' + attr).not.toBe(undefined)
      return /="([\s\S]*)"\s*$/.exec((hit as string).trim())?.[1] ?? ''
    }
    // 🔴 这就是那个洞的形状（S3 的 `b4oneline`）：一行里两个属性时，旧的取法**两个属性都取不出东西**
    //    （正则要求行尾就是那个引号，而这一行以 `>` 收尾）⇒ 两边都是空串 ⇒ 判等 ⇒ **空转**。
    //    上面那两句 `toEqual` 才是收严之后的读数；这一句把"旧版为什么会绿"当场钉住。
    expect(
      byLine('data-field-readonly'),
      'the by-line reading must not be able to tell a one-line pair apart: this is the hole, pinned',
    ).toBe(byLine('data-field-takeover'))
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
