/**
 * 票 67 · 段 8a：**尺度 token 与边界**的判据（不需要 DOM 的那一半）。
 *
 * 契约 `.team/test/2026-09-22/contract-67.md`。这一件管三样：
 *   · 口径 6：尺度 token 一套，值逐个相等（字号 / 间距 / 圆角 / 控件高 / `--h-ta`）；
 *   · 口径 7：字号放大 = 每档抬一个固定的量、**相邻两档的间隔仍是 1.5**（不是乘 1.15，
 *     也不是把间隔改掉）；三档严格递减；
 *   · 边界（不做清单）：卡与 `src/game` 一个字节不动 · `CardGraph.vue` 不动 ·
 *     玩家界面那 70 处 `text-[Npx]` 不动 · 9 张玩家屏基线不动 · `--ln` 不动。
 *
 * ⚠️ 判据吃一份**材料**（CSS 文本 / 哈希表 / 字面量普查），不直接摸磁盘 ——
 *    末尾那块自检才能拿一份手写的材料喂同一批断言，数出「关掉某一样会红几条」。
 * ⚠️ 字号是**差值**判据，不是乘一个系数（乘出来是 14.95 那种数）。
 *    🔴 订正一处口径：S0 §九 裁决 2 与设计 §二.1 都写着「新值 − 旧值 = 1.5」，
 *    而它们给的那组数（13/11.5/10 → 14/12.5/11）**每档只抬了 1**，1.5 是**相邻两档的间隔**。
 *    这里按「两组数 + 间隔不变」这条能算出来的口径落（见契约 §二 的订正）。
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/** 尺度 token 的期望值（图里那一组，`.team/design/2026-09-18/v16/01-*.html:7-26` 的 `:root`） */
const SCALE: Record<string, string> = {
  '--fs1': '14px',
  '--fs2': '12.5px',
  '--fs3': '11px',
  '--s1': '4px',
  '--s2': '8px',
  '--s3': '12px',
  '--s4': '16px',
  '--s5': '20px',
  '--gut': '10px',
  '--r1': '4px',
  '--r2': '6px',
  '--r3': '10px',
  '--h-btn': '18px',
  '--h-ctl': '22px',
  '--h-cb': '12px',
  '--h-ta': '320px',
}

/** 放大之前那一组字号（图里量出来的数）—— 差值判据的另一半 */
const BEFORE: Record<string, number> = { '--fs1': 13, '--fs2': 11.5, '--fs3': 10 }

/** 三档字号的名字（放大前后比的是这三条，顺序即层级） */
const FONT_TIERS = ['--fs1', '--fs2', '--fs3']

/**
 * 每一档往上抬多少（设计那两组数一减就是它：13→14 / 11.5→12.5 / 10→11）。
 *
 * ⚠️ 设计 §二.1 的表格：变化列写的是 **+1**、相对差列写的是 **−1.5 不变**；
 *    表下面那句「加 1.5」说的是**相邻两档的间隔仍是 1.5**（"绝对差一个像素不差"）。
 *    「新值 − 旧值 = 1.5」在这组数上算不出来（那是 14−13=1），见契约 §二 的订正。
 */
const GROWTH = 1

/** 相邻两档的间隔（放大前后都必须正好是它 —— 节奏不变就是这一条） */
const GAP = 1.5

/**
 * 玩家界面的字面量普查（裁决 1/2 的边界）。
 *
 * 只挑**这一票碰不到**的玩家界面文件：编辑器自己的 `CardEditor` / `CardNodeForm` /
 * `CardResources` 不在里面（它们正要换成 token），`App.vue` 也不在（接线可能要动它）。
 */
const PLAYER_CENSUS: Record<string, { count: number; sizes: string[] }> = {
  'src/components/AppSidebar.vue': { count: 2, sizes: ['11.5', '12.5'] },
  'src/components/Blocks.vue': { count: 3, sizes: ['11', '12'] },
  'src/components/DebugPanel.vue': { count: 22, sizes: ['11', '11.5', '12', '13'] },
  'src/components/GameComposer.vue': { count: 3, sizes: ['11', '14'] },
  'src/components/SettingsDrawer.vue': { count: 16, sizes: ['11.5', '12.5', '13', '13.5', '17'] },
  'src/components/StoryPanel.vue': { count: 16, sizes: ['12', '12.5', '13', '15'] },
  'src/components/WorldPanel.vue': { count: 8, sizes: ['11', '12'] },
}

/** 三张卡：本票不动卡格式、不动卡内容（§四 不做清单） */
const CARD_HASHES: Record<string, string> = {
  'cards/long-night.json': '6a1f80bf2bc5df22709e74b3fabf17330655dd7dc5a814cfbda01c20299c6628',
  'cards/morningwind.json': '45dee3c72b4590a26dd8202b7dff8ef0be4d25af1a6c3e18f1eccc20a4d88dfa',
  'cards/night-watch.json': '8a20fb35aa65da0b453b2c9d95b577ba09729c8db9b78b04618bad7585984fc8',
}

/** 卡的图那一个组件：口径 3 把它留在左栏，**本票一个字不动**（`DebugPanel` 也在用它） */
const GRAPH_HASH = 'd11175e9134438eaba4018cfa14f9d5add5b7525f5281ffa22c29a1956b9282f'

/** 引擎与显示那一层（段 1–7 刚落地）：本票一个字节都不碰 */
const GAME_HASHES: Record<string, string> = {
  'src/game/card-actions.ts': '54bce7b568df843939965bce6e3422553f1be05bbd44e5d3f4a68c5c11a39fd5',
  'src/game/card-calendar.ts': 'de98d44898a36c8eccecf55ef87cf14f69c6b1d5f712c4b60120b5689159b295',
  'src/game/card-layout.ts': '6917106ee0a0fad518a45e5c8650337124b1aca7534f6dfac2801f84d4c55477',
  'src/game/card-read.ts': 'f3db497988950f77ab21024835ae545908cc2ae0271e81b18f714a97c17f59f8',
  'src/game/card-state.ts': '7bcb8708ed898a469de09b71e9f7f22d75396099af7daa0d88d3378142b22cae',
  'src/game/card-time.ts': '3eac6324b039c5ff5bd1488c12d3d18981d29b48055aff123d678bb558829343',
  'src/game/card.ts': 'd868bfba67d39816e717c55700d28b774a39c14d87b8c424537c04de0bc3ff05',
  'src/game/current-card.ts': '4e646b7377b3d40e84ead0a3d401f6bb039d04b43e2dbd34c137aa168eb470ab',
  'src/game/display.ts': '50e1ff921482d2f2a781ea5025ebcd7f542a912fe945f1e243381c3a1d828b31',
  'src/game/lifecycle.ts': 'daf929e362f421ce332dc9ffbb2514c732121bc9449f34dbc5bc2191053590d4',
  'src/game/opening.ts': '9676f5676449f75f2b0fb7cc33799d2978875bf4dd3d6770249a8d0078e1b6f2',
  'src/game/save.ts': 'e6076882cc49df1cccb78e596717449f7f1daa3d28b76db9cd138dccf07f32ce',
  'src/game/state.ts': 'bf83f43a6dd3b05d1a0f7d5232ec6c25c2ee56638017c58fe37c8a85c708ac1f',
}

/** 九张玩家屏的像素基线（macOS 录的）：裁决 2 —— 字号放大只作用于编辑器，一张都不许重录 */
const BASELINE_HASHES: Record<string, string> = {
  'e2e/visual.spec.ts-snapshots/dark--laptop-darwin.png':
    '77930db7f73556cc265840de7573d45aeebb7ce27031d7bf53723d0068176272',
  'e2e/visual.spec.ts-snapshots/debug-on--laptop-darwin.png':
    'ba47c8fc6c9a5ce6bbca09c358d472b2707d58ea75745e0be0b96cb69e8cfc77',
  'e2e/visual.spec.ts-snapshots/debug-panel-tools--laptop-darwin.png':
    'f5bc5b92b88c916ff62d81b2525ae421fc17d6140752ea847f8f98994da87614',
  'e2e/visual.spec.ts-snapshots/drawer-open--laptop-darwin.png':
    '8dc830183096fdff8d15bcc5896dd9a716b859960c7722137f9ab623951ec9c1',
  'e2e/visual.spec.ts-snapshots/long-story--phone-darwin.png':
    'aaed16bc8013bbd1cbf8239202d6339b44f2fd6535c7cdaac3b5ac89469d8a14',
  'e2e/visual.spec.ts-snapshots/playing-en--laptop-darwin.png':
    '324e323c7b8c61c638814adf28c041a28196ff401ca93267b744e97a95741a2f',
  'e2e/visual.spec.ts-snapshots/playing-en--phone-darwin.png':
    'c3d24e42214b9b8aeb9f39b63adc49f4c50233ccbcfccd71c928e283ed718917',
  'e2e/visual.spec.ts-snapshots/playing-zh--laptop-darwin.png':
    'b7080e3292748d890de977d853fa4e661e7341208251c0285ab8d85099daa4fe',
  'e2e/visual.spec.ts-snapshots/playing-zh--phone-darwin.png':
    '4875313939aaf75bb284738970012acf3f3b42ac270b0321b09d867fcf0cf8e0',
}

/** 判据吃的那份材料：全都从磁盘量出来，判据本身不摸磁盘 */
interface Material {
  /** 尺度那一层的全部 CSS（`src/styles/**` 拼起来：token 落哪一份文件都行，但只许一处） */
  css: string
  /** `src/` 里其余文件的文本 —— 查"这个 token 别处还有没有第二份" */
  elsewhere: Array<{ file: string; text: string }>
  /** 边界文件的 sha256 */
  hashes: Record<string, string>
  /** 玩家界面 `text-[Npx]` 的普查 */
  census: Record<string, { count: number; sizes: string[] }>
}

/** 递归列一个目录下的文件（相对路径、正斜杠、排序好，跟 git 的写法一致） */
function walk(dir: string, root = process.cwd()): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full, root))
    else out.push(relative(root, full).replace(/\\/g, '/'))
  }
  return out.sort()
}

/** 一个文件的 sha256 */
function hashOf(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 一个文件的 `text-[Npx]` 普查：几处、用了哪几种尺寸 */
function censusOf(file: string): { count: number; sizes: string[] } {
  const hits = [...readFileSync(file, 'utf8').matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => m[1])
  return { count: hits.length, sizes: [...new Set(hits)].sort() }
}

/** 从磁盘量一份材料 */
function readMaterial(): Material {
  const files = walk('src')
  const styles = files.filter((f) => f.startsWith('src/styles/') && f.endsWith('.css'))
  expect(styles.length, 'the scale layer must have at least one stylesheet').toBeGreaterThan(0)
  const hashes: Record<string, string> = {}
  for (const file of [
    ...Object.keys(CARD_HASHES),
    ...Object.keys(GAME_HASHES),
    ...Object.keys(BASELINE_HASHES),
  ]) {
    hashes[file] = hashOf(file)
  }
  hashes['src/components/CardGraph.vue'] = hashOf('src/components/CardGraph.vue')
  const census: Record<string, { count: number; sizes: string[] }> = {}
  for (const file of Object.keys(PLAYER_CENSUS)) census[file] = censusOf(file)
  return {
    css: styles.map((f) => readFileSync(f, 'utf8')).join('\n'),
    elsewhere: files
      .filter((f) => !styles.includes(f))
      .map((f) => ({ file: f, text: readFileSync(f, 'utf8') })),
    hashes,
    census,
  }
}

/** 解析一段 CSS 里的自定义属性：同名都收着；`var(--x)` 转口不算一次取值 */
function tokensOf(css: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
    const value = m[2].trim()
    if (value === 'var(' + m[1] + ')') continue
    out[m[1]] = [...(out[m[1]] ?? []), value]
  }
  return out
}

/** 一个 token 的取值：没写就是 undefined；一份里写出两个不同值就算两处（就地红） */
function valueOf(css: string, name: string): string | undefined {
  const values = [...new Set(tokensOf(css)[name] ?? [])]
  expect(values.length, name + ' must be declared with a single value').toBeLessThanOrEqual(1)
  return values[0]
}

/** K1 · 口径 6：三档字号 = 14 / 12.5 / 11 */
function checkK1(m: Material): void {
  for (const name of ['--fs1', '--fs2', '--fs3']) {
    expect(valueOf(m.css, name), 'the token ' + name + ' is missing or wrong').toBe(SCALE[name])
  }
}

/** K2 · 口径 6：五档间距 + 竖条槽（`--s5` 仍是 20 —— 裁决 3 不许把它抬到 24） */
function checkK2(m: Material): void {
  for (const name of ['--s1', '--s2', '--s3', '--s4', '--s5', '--gut']) {
    expect(valueOf(m.css, name), 'the token ' + name + ' is missing or wrong').toBe(SCALE[name])
  }
}

/** K3 · 口径 6：三档圆角 = 4 / 6 / 10 */
function checkK3(m: Material): void {
  for (const name of ['--r1', '--r2', '--r3']) {
    expect(valueOf(m.css, name), 'the token ' + name + ' is missing or wrong').toBe(SCALE[name])
  }
}

/** K4 · 口径 6：控件高三档 + 长文本框的最小高度 */
function checkK4(m: Material): void {
  for (const name of ['--h-btn', '--h-ctl', '--h-cb', '--h-ta']) {
    expect(valueOf(m.css, name), 'the token ' + name + ' is missing or wrong').toBe(SCALE[name])
  }
}

/** K5 · 口径 7：三档都变大（每档 +1）、相邻间隔仍是 1.5、严格递减 —— 不是乘一个系数 */
function checkK5(m: Material): void {
  const after = FONT_TIERS.map((name) => Number.parseFloat(valueOf(m.css, name) ?? 'NaN'))
  expect(
    after.filter((n) => Number.isNaN(n)),
    'a font tier is missing',
  ).toEqual([])
  FONT_TIERS.forEach((name, i) => {
    expect(
      after[i] - BEFORE[name],
      'the tier ' + name + ' must grow by the step, not by a ratio',
    ).toBeCloseTo(GROWTH, 5)
    expect(after[i] > BEFORE[name], 'the tier ' + name + ' must grow').toBe(true)
  })
  // 节奏：相邻两档的间隔一个像素不差（等比放大做不到这一条 —— 14.95/13.225/11.5 的间隔是 1.725）
  expect(after[0] - after[1], 'the gap between the first two tiers must stay').toBeCloseTo(GAP, 5)
  expect(after[1] - after[2], 'the gap between the last two tiers must stay').toBeCloseTo(GAP, 5)
  expect(after[0] > after[1] && after[1] > after[2], 'the three tiers must stay strictly ordered').toBe(true)
}

/** K6 · 口径 6「收一处」：每个 token 只在尺度那一层声明，别处不许有第二份 */
function checkK6(m: Material): void {
  for (const name of Object.keys(SCALE)) {
    const pattern = new RegExp(name + '(?![\\w-])\\s*:')
    const others = m.elsewhere.filter((f) => pattern.test(f.text)).map((f) => f.file)
    expect(others, 'the token ' + name + ' is declared outside the scale layer').toEqual([])
  }
}

/** K7 · 裁决 3：行高不动 —— `--ln` 要么不引入，要么仍是 1.6 */
function checkK7(m: Material): void {
  const line = valueOf(m.css, '--ln')
  expect(line === undefined || line === '1.6', 'this ticket must not change the line height').toBe(true)
}

/** K9 · 借来的那一条：样式表里要有键盘焦点环，而且指得上按钮 */
function checkK9(m: Material): void {
  const rule = m.css.match(/([^{}]*:focus-visible[^{}]*)\{/)
  expect(rule, 'no :focus-visible ring in the stylesheets').not.toBeNull()
  const selector = (rule as RegExpMatchArray)[1].trim()
  // 名字里带上 button、或者用通配/裸伪类把它罩住，都算"指得上按钮"
  expect(
    /button|\*/.test(selector) || selector === ':focus-visible',
    'the focus ring must cover buttons',
  ).toBe(true)
}

/** B1 · 边界：三张卡一个字节不动 */
function checkB1(m: Material): void {
  for (const [file, hash] of Object.entries(CARD_HASHES)) {
    expect(m.hashes[file], file + ' must not change in this ticket').toBe(hash)
  }
}

/** B2 · 边界：`CardGraph.vue` 一个字节不动 */
function checkB2(m: Material): void {
  expect(m.hashes['src/components/CardGraph.vue'], 'CardGraph.vue must not change in this ticket').toBe(
    GRAPH_HASH,
  )
}

/** B3 · 边界：引擎与显示那一层（`src/game/**`）不增不减、逐字不动 */
function checkB3(m: Material): void {
  const game = Object.keys(m.hashes)
    .filter((f) => f.startsWith('src/game/'))
    .sort()
  expect(game, 'src/game must not grow or shrink in this ticket').toEqual(Object.keys(GAME_HASHES).sort())
  for (const [file, hash] of Object.entries(GAME_HASHES)) {
    expect(m.hashes[file], file + ' must not change in this ticket').toBe(hash)
  }
}

/** B4 · 边界：玩家界面那几十处 `text-[Npx]` 一处不动（裁决 1/2） */
function checkB4(m: Material): void {
  for (const [file, want] of Object.entries(PLAYER_CENSUS)) {
    const got = m.census[file]
    expect(got, file + ' has no font literal census at all').toBeDefined()
    expect(got?.count, file + ': the number of literal font sizes changed').toBe(want.count)
    expect(got?.sizes, file + ': the literal font sizes changed').toEqual(want.sizes)
  }
}

/** B5 · 边界：九张玩家屏基线一张都不重录（裁决 2） */
function checkB5(m: Material): void {
  expect(Object.keys(BASELINE_HASHES)).toHaveLength(9)
  for (const [file, hash] of Object.entries(BASELINE_HASHES)) {
    expect(m.hashes[file], file + ' must not be re-recorded in this ticket').toBe(hash)
  }
}

/** 一条判据：编号 + 一句话（用例名）+ 断言（吃一份材料） */
interface Check {
  id: string
  what: string
  run: (m: Material) => void
}

/** 这一件的判据表 —— 用例与自检的故障注入跑的都是它 */
const CHECKS: Check[] = [
  { id: 'K1', what: 'the three font tiers equal 14 / 12.5 / 11', run: checkK1 },
  { id: 'K2', what: 'the five spacing steps and the gutter keep their values', run: checkK2 },
  { id: 'K3', what: 'the three corner radii keep their values', run: checkK3 },
  { id: 'K4', what: 'the control heights and the long text box keep their values', run: checkK4 },
  { id: 'K5', what: 'every font tier grows by a flat step and keeps the gap to its neighbour', run: checkK5 },
  { id: 'K6', what: 'every token is declared in the scale layer and nowhere else', run: checkK6 },
  { id: 'K7', what: 'the line height is not touched', run: checkK7 },
  { id: 'K9', what: 'the stylesheets carry a focus ring for buttons', run: checkK9 },
  { id: 'B1', what: 'the three cards are byte for byte the same', run: checkB1 },
  { id: 'B2', what: 'CardGraph.vue is byte for byte the same', run: checkB2 },
  { id: 'B3', what: 'the engine layer src/game is untouched', run: checkB3 },
  { id: 'B4', what: 'the player screens keep their literal font sizes', run: checkB4 },
  { id: 'B5', what: 'the nine player-screen baselines are not re-recorded', run: checkB5 },
]

describe('the editor scale tokens and this ticket boundaries', () => {
  for (const check of CHECKS) {
    it(`${check.id} ${check.what}`, () => {
      check.run(readMaterial())
    })
  }
})

/** 一份照契约写的 CSS（替身）：证明上面那一族**能绿**，再逐个故障证明它**能红** */
const SAMPLE_CSS =
  ':root{\n' +
  '  --fs1:14px; --fs2:12.5px; --fs3:11px;\n' +
  '  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:20px;\n' +
  '  --gut:10px;\n' +
  '  --r1:4px; --r2:6px; --r3:10px;\n' +
  '  --h-btn:18px; --h-ctl:22px; --h-cb:12px;\n' +
  '  --h-ta:320px;\n' +
  '}\n' +
  ':where(button, a, input, textarea, select, summary):focus-visible { outline: 2px solid currentColor }\n'

/** 拿真材料当底、按 `fault` 换掉一样东西 —— 一次只换一样 */
function sample(fault: string): Material {
  const base = readMaterial()
  const m: Material = { ...base, css: SAMPLE_CSS, elsewhere: [], census: { ...base.census } }
  if (fault === 'nothing') return m
  if (fault === 'scaled') {
    // 乘 1.15 那一组（裁决 2 点名不许）：14.95 / 13.225 / 11.5
    m.css = SAMPLE_CSS.replace('--fs1:14px', '--fs1:14.95px')
      .replace('--fs2:12.5px', '--fs2:13.225px')
      .replace('--fs3:11px', '--fs3:11.5px')
    return m
  }
  if (fault === 's5-24') return { ...m, css: SAMPLE_CSS.replace('--s5:20px', '--s5:24px') }
  if (fault === 'line-height') return { ...m, css: SAMPLE_CSS + ':root{ --ln:1.5 }\n' }
  if (fault === 'focus-ring') return { ...m, css: SAMPLE_CSS.split('\n').slice(0, -2).join('\n') }
  if (fault === 'elsewhere') {
    return { ...m, elsewhere: [{ file: 'src/components/Fake.vue', text: '--fs1: 13px;' }] }
  }
  if (fault === 'no-tokens') return { ...m, css: '' }
  if (fault === 'card-hash') {
    return { ...m, hashes: { ...m.hashes, 'cards/morningwind.json': 'e3b0c44298fc1c149afbf4c8996fb924' } }
  }
  if (fault === 'graph-hash') {
    return {
      ...m,
      hashes: { ...m.hashes, 'src/components/CardGraph.vue': 'e3b0c44298fc1c149afbf4c8996fb924' },
    }
  }
  if (fault === 'game-file') {
    const hashes = { ...m.hashes }
    delete hashes['src/game/card.ts']
    return { ...m, hashes }
  }
  if (fault === 'census') {
    return {
      ...m,
      census: {
        ...m.census,
        'src/components/StoryPanel.vue': { count: 15, sizes: ['12', '12.5', '13', '15'] },
      },
    }
  }
  if (fault === 'baseline') {
    return {
      ...m,
      hashes: { ...m.hashes, 'e2e/visual.spec.ts-snapshots/dark--laptop-darwin.png': 'changed' },
    }
  }
  throw new Error('unknown fault: ' + fault)
}

/** 拿一份材料跑完 13 条判据，返回红了的那些编号 */
function redsOn(m: Material): string[] {
  const red: string[] = []
  for (const check of CHECKS) {
    try {
      check.run(m)
    } catch {
      red.push(check.id)
    }
  }
  return red
}

describe('self-check: these criteria can go red, and by how much', () => {
  it('T1 a scale layer that follows the contract turns none of them red', () => {
    expect(redsOn(sample('nothing'))).toEqual([])
  })

  it('T2 a proportional scale instead of a flat one turns exactly K1/K5 red', () => {
    expect(redsOn(sample('scaled'))).toEqual(['K1', 'K5'])
  })

  it('T3 raising the block spacing to 24 turns exactly K2 red', () => {
    expect(redsOn(sample('s5-24'))).toEqual(['K2'])
  })

  it('T4 tightening the line height turns exactly K7 red', () => {
    expect(redsOn(sample('line-height'))).toEqual(['K7'])
  })

  it('T5 dropping the focus ring turns exactly K9 red', () => {
    expect(redsOn(sample('focus-ring'))).toEqual(['K9'])
  })

  it('T6 a second declaration outside the scale layer turns exactly K6 red', () => {
    expect(redsOn(sample('elsewhere'))).toEqual(['K6'])
  })

  it('T7 an empty scale layer (nothing built yet) turns six of them red', () => {
    expect(redsOn(sample('no-tokens'))).toEqual(['K1', 'K2', 'K3', 'K4', 'K5', 'K9'])
  })

  it('T8 one changed card, graph, engine file, census or baseline turns its own check red', () => {
    expect(redsOn(sample('card-hash'))).toEqual(['B1'])
    expect(redsOn(sample('graph-hash'))).toEqual(['B2'])
    expect(redsOn(sample('game-file'))).toEqual(['B3'])
    expect(redsOn(sample('census'))).toEqual(['B4'])
    expect(redsOn(sample('baseline'))).toEqual(['B5'])
  })
})
