/**
 * 票 68b · S1（G4）：**locale 的键集 = 用到的键集**（票 68 验收记录 §八.2 那条开口的收口）。
 *
 * 口径源 `.team/leader/2026-09-26/票68b-S0.md` §二 G4 · §五.2：
 *   ① 两份 locale 的**键集合必须相等**；② 每个键都得**在代码里被用到** —— **两条都要，缺一条就是半条牙**。
 *
 * "用到了"= 满足下面任意一条（口径写死在这里，改口径就要改这一份）：
 *   a. 完整键名在 `src/**` 里以**成对的引号**出现（`'k'` / `"k"` / `` `k` ``）。
 *      用引号当边界是有意的：`header.debug` 不该被 `'header.debugTitle'` 蒙混过去
 *      （第一版量具就栽在这上面：它把死键读成了活键）。
 *   b. 命中一个**声明的动态家族**（`t('card.kind.' + kind)` 那一族）——每一族都带一句
 *      "它在源码里长什么样"的证据串，家族被重构掉时这一条会红：**名单不许烂在原地**。
 *
 * 🔴 **欠账名单**（`DEAD_KEY_DEBT`）：本票之前就躺在盘上的 26 个死键。
 *    它是**棘轮**，两个方向都钉死：
 *      · 名单**外**冒出死键 ⇒ 红（新债长不出来 —— 本票删掉的五个 `world.*` 就守在这一条上）；
 *      · 名单里某条**被删掉、或被用上** ⇒ 也红（逼下一个人收账）。
 *    收账归下一票，指针在 `.team/leader/todo.md`。
 *
 * ⚠️ 字符串一律 ASCII（`tests/` 不豁免 `ascii.mjs`）⇒ 这一份里一个中文字面量都不写。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** 两份 locale（`src/locales/*.json` 是代码里唯一允许出现中文的地方） */
const LOCALES = ['zh-CN', 'en'] as const

/** 应用代码的根（判"有没有人用"只看它 —— 测试引用一个键不算产品在用） */
const APP_ROOT = 'src'

/**
 * 代码里用**前缀 + 变量**取键的那几族。
 *
 * `proof` 是**必须出现在 `site` 里**的那一句 —— 它是"这一族还在"的证据，
 * 也是"家族被重构掉了、名单该改了"的报警器。
 */
const DYNAMIC_FAMILIES = [
  { prefix: 'calendar.segment.', site: 'src/utils/calendar.ts', proof: 'calendar.segment.${key}' },
  {
    prefix: 'calendar.weekday.',
    site: 'src/utils/calendar.ts',
    proof: 'calendar.weekday.${d.getDay()}',
  },
  { prefix: 'provider.', site: 'src/components/SettingsDrawer.vue', proof: 'provider.${k}' },
  { prefix: 'debug.role.', site: 'src/agent/prompts.ts', proof: "'debug.role.' + message.role" },
  { prefix: 'card.kind.', site: 'src/components/BranchForm.vue', proof: "'card.kind.' + row.kind" },
  {
    prefix: 'prompts.settingBlock.',
    site: 'src/agent/prompts.ts',
    proof: "'prompts.settingBlock.' + key",
  },
] as const

/**
 * 本票之前就没人用的那些键（**本票不删它们** —— 见 `.team/leader/2026-09-26/票68b-S0.md` §二 G4
 * 与组长 2026-09-26 的裁决）。
 * ⚠️ **2026-09-26 订正（评审 C-2，组长重量过）**：这 26 条里**只有 `card.graphHint` 一条**
 * 在协作者的分支 `origin/feat/game-stage-hud`（`c50d476`）上还活着
 * （`src/components/CardEditor.vue:180`）；`player.defaultName` 在他那边只出现在 `doc/DESIGN.md`
 * 那一行，而**我们这边同一行也有** ⇒ 不算"在他分支上活着"。
 * 本票删掉的五个 `world.*` **不在**这份名单里（`G4c` 守着删干净），它们在**他的分支上是活的**
 * （`src/components/WorldPanel.vue` + `src/App.vue:331-342`）—— 那条证据的方向是
 * "**这一票在那个方向制造了新的撞车面**"（写进 PR 描述），不是"不扩大撞车面"。
 */
const DEAD_KEY_DEBT = [
  'app.statusUnconfigured',
  'card.graphHint',
  'header.debug',
  'header.debugTitle',
  'header.export',
  'header.exportTitle',
  'header.import',
  'header.importTitle',
  'header.languageEn',
  'header.languageIconSystem',
  'header.languageSystem',
  'header.languageZh',
  'header.reset',
  'header.resetTitle',
  'header.themeDark',
  'header.themeIconDark',
  'header.themeIconLight',
  'header.themeIconSystem',
  'header.themeLight',
  'header.themeSystem',
  'player.defaultName',
  'scene.unknownPlace',
  'scene.unknownPlaceDesc',
  'sidebar.place',
  'sidebar.time',
  'sidebar.turnCount',
] as const

/** 读一份 locale 并拍平成点路径（`{a:{b:'x'}}` 变成 `a.b`） */
function keysOf(name: string): string[] {
  const raw = JSON.parse(readFileSync(APP_ROOT + '/locales/' + name + '.json', 'utf8')) as Record<string, any>
  const out: string[] = []
  /** 走一层：对象往下钻，叶子记成一条点路径 */
  const walk = (node: Record<string, any>, prefix: string): void => {
    for (const key of Object.keys(node)) {
      const path = prefix === '' ? key : prefix + '.' + key
      const cell = node[key]
      if (cell !== null && typeof cell === 'object' && !Array.isArray(cell)) walk(cell, path)
      else out.push(path)
    }
  }
  walk(raw, '')
  return out.sort()
}

/** 应用源码的全文（`.ts` / `.vue` 都算；locale 自己不算） */
function appSource(): string {
  const files: string[] = []
  /** 走一层：把 `.ts` / `.vue` 都收进来（locale 自己不算） */
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name).replace(/\\/g, '/')
      if (entry.isDirectory()) walk(path)
      else if (/\.(ts|vue)$/.test(path) && !path.includes('/locales/')) files.push(path)
    }
  }
  walk(APP_ROOT)
  // ⚠️ 去掉反斜杠再找：`.stories.ts` 里有一处 `$t(\'card.graphLegend\')`（引号被转义），
  //    不归一化就会把它读成"没人用"（量具第一版实测到的假阳性）。
  return files.map((file) => readFileSync(file, 'utf8').replace(/\\(['"`])/g, '$1')).join('\n')
}

/** 这个键在应用里被引用了吗（两条口径见文件头） */
function isUsed(key: string, source: string): boolean {
  const quoted = (one: string): boolean =>
    source.includes("'" + one + "'") || source.includes('"' + one + '"') || source.includes('`' + one + '`')
  if (quoted(key)) return true
  return DYNAMIC_FAMILIES.some((family) => key.startsWith(family.prefix))
}

/** 这一份判据读到的全部东西（一次读好，四条用例共用同一批字节） */
const keys = { 'zh-CN': keysOf('zh-CN'), en: keysOf('en') } as Record<string, string[]>
const source = appSource()
const dead = keys['zh-CN'].filter((key) => !isUsed(key, source))

describe('the two locales say the same thing', () => {
  it('G4a both locales carry exactly the same key set', () => {
    expect(keys.en, 'en is missing keys that zh-CN has').toEqual(keys['zh-CN'])
    // 守卫：一份空表也能"相等" ⇒ 先证明这一份 locale 真读到了东西
    expect(
      keys['zh-CN'].length,
      'the locale files came back empty: this criterion measured nothing',
    ).toBeGreaterThan(200)
  })
})

describe('every locale key is a key some code asks for', () => {
  it('G4b no key is dead unless it is on the dated debt list', () => {
    const unknown = dead.filter((key) => !(DEAD_KEY_DEBT as readonly string[]).includes(key))
    expect(
      unknown,
      'these keys are in the locale but no code asks for them: delete them, or (if they are meant for a ' +
        'screen that does not exist yet) put them on the debt list with a ticket number',
    ).toEqual([])
  })

  it('G4c the five world.* keys this ticket removed are gone from both locales', () => {
    for (const name of LOCALES) {
      const stale = keys[name].filter((key) => key.startsWith('world.'))
      expect(
        stale,
        name + ' still carries a world.* key: the drawer they named was removed in ticket 68',
      ).toEqual([])
    }
  })

  it('G4d the debt list is still true: every entry exists and is still dead', () => {
    const stale = DEAD_KEY_DEBT.filter((key) => !keys['zh-CN'].includes(key) || !dead.includes(key))
    expect(
      stale,
      'the debt list has stale entries: each one is either gone from the locale or used by code again. ' +
        'That is good news, not a regression - strike it off the list (and off the pointer in .team/leader/todo.md)',
    ).toEqual([])
  })

  it('G4e each dynamic key family is still in the source it is declared against', () => {
    for (const family of DYNAMIC_FAMILIES) {
      const text = readFileSync(family.site, 'utf8')
      expect(
        text.includes(family.proof),
        family.site + ' no longer builds keys with "' + family.prefix + '": the family list is stale',
      ).toBe(true)
      // 这一族必须真的接着键（否则上面那条等于给一个空家族开口子）
      const reached = keys['zh-CN'].filter((key) => key.startsWith(family.prefix))
      expect(reached.length, 'no locale key starts with ' + family.prefix).toBeGreaterThan(0)
    }
  })
})
