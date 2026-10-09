// @vitest-environment jsdom
/**
 * 票 8f（甲案：建枝时顺带把配套动作建了）· S2 判据 —— 契约 `.team/test/2026-10-09/contract-8f.md`。
 *
 * 这一件只管**甲案那半边**：面板上多出来的「配套动作」那一段 · 勾着建 ⇒ 产物里那一枝**真的有一条动作
 * 指向它** · 那条动作**逐字段**对得上契约 · 产物**过得了格式校验**。
 * 乙案那半边（不勾 ⇒ 与今天逐字相同）住在 `branch-create-dom.test.ts` 的 `C6c`：
 * 那一族原来断的就是乙案，**翻面时留在原地**（照已知项 ② 的处置口径）。
 *
 * 🔴 **本票的核心风险是"界面说建成了、保存被格式拒"**（评审 C2 点名的形状）——
 *    `A2` / `A4` 就是钉这一条的：**"界面说建成了"与"保存真能落"必须是同一件事**。
 *
 * 🔴 **`useBranchCreate` 与 `BranchCreateForm` 这两个名字出现在这里不是巧合** —— `.githooks/pre-commit`
 *    的**检查 6**（"新增功能必须配测试"）是按**文件名**找证据的：这一件是从 `CardEditor` 那个接缝上
 *    把建枝那一族整个照下来跑的，而面板与它那一族的值住在 `useBranchCreate.ts` / `BranchCreateForm.vue` 里。
 *    名字写在这一行是让那道检查看得见（先例：`branch-create-dom.test.ts` 同一句话）。
 *
 * ⚠️ 判据一律挂在 `CardEditor.vue` 这个**现成的接缝**上，走**用户真走的那条路**（开面板 ⇒ 六选一 ⇒ 建出来
 *    ⇒ 顶栏那颗保存）。⚠️ **期望值全部从卡与 locale 现取**：这一份里一个中文字面量都没有。
 * ⚠️ 凡断"落盘内容"的地方都从**存储**读（保存之后草稿清空、`props.card` 不动 ⇒ 树上已经没有那一行了）。
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCard } from '../src/game/card'
import { checkSchema } from '../src/game/card-state'
import { t } from '../src/i18n'
import { CARD_KEY } from './support/card-resources'
import { FIELD_KEYS, card, editor, save, textOf } from './support/branch-tree'

/** 编辑器包装器（`editor()` 的返回类型 —— 不引 `any`） */
type W = ReturnType<typeof editor>

/** 契约 §1.3 的六个形状名 —— 就是 `SchemaType`（`src/game/card-state.ts:23`）那六个字面名 */
const SHAPES = ['string', 'integer', 'enum', 'list', 'map', 'object']

/** 判据自己敲进去的字（一律 ASCII） */
const PROBE = 'probe_branch'
const WHITELIST = 'probe_a,probe_b'
/** 同一份白名单里**重复**的那一格 —— 评审 C2 的正身（契约 §3 已知项 ①） */
const REPEATED = 'probe_a,probe_a'

/**
 * 契约 §1.5 点名的四把 locale 键（甲案新开的那一族）。
 *
 * 🔴 **必须逐条断它们在两份 locale 里都在**：缺键时 vue-i18n 把**键名本身**当译文返回 ⇒ 凡是
 *    "那段文字等于 `t(key)`"的断言，两边会一起退化成同一个字符串 ⇒ **假绿**（先例：`C9`）。
 */
const KEYS = [
  'card.branchAction',
  'card.branchActionWhen',
  'card.branchActionWhat',
  'card.branchActionPrinciples',
]

/**
 * 非 ASCII 检测器（判据拿它从卡里挑一个中文键名出来当新枝名）。
 *
 * ⚠️ 两端**在运行时构造**：直接写字面量会踩 ESLint 的 `no-control-regex`
 *    （与 `.githooks/checks/ascii.mjs:24-26` 同一招）—— 那正是"检查自己被检查"的现场。
 */
const NON_ASCII = new RegExp('[^' + String.fromCharCode(0) + '-' + String.fromCharCode(0x7f) + ']')

/** 收摊：挂出来的都要卸载，并确认没留下脏东西 */
afterEach(() => {
  document.body.innerHTML = ''
})

/** 一份 locale 的 JSON */
function localeOf(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync('src/locales/' + name + '.json', 'utf8')) as Record<string, unknown>
}

/** 点路径读一格（读不到就是 `undefined`） */
function leafOf(root: Record<string, unknown>, path: string): unknown {
  let node: unknown = root
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node
}

/** 存储里那份卡的原文（从没写过就是 `null`） */
function storedText(): string | null {
  return localStorage.getItem(CARD_KEY)
}

/** 存储里那份卡 —— 落盘判据一律读它（保存之后树上已经没有那一行了：草稿清空、`props.card` 不动） */
function storedCard(): Record<string, any> {
  const text = storedText()
  expect(text, 'nothing landed in storage, so this judge would say nothing').not.toBeNull()
  return JSON.parse(text as string) as Record<string, any>
}

/** 树上那一行（没有就报没有，不抛） */
function rowOf(w: W, name: string): ReturnType<W['find']> {
  return w.find('[data-branch-node="' + name + '"]')
}

/** 屏上那句被拒的原因（没有就是空串） */
function problemOf(w: W): string {
  const el = w.find('[data-branch-problem]')
  return el.exists() ? el.text().trim() : ''
}

/** 屏上那几条"这一枝还没有动作写它"（契约 §1.6：勾着建的那一枝**不许**再有它） */
function noticesOf(w: W): string[] {
  return w.findAll('[data-branch-unwritten]').map((el) => el.text().trim())
}

/**
 * 点开建枝面板（与 `branch-create-dom.test.ts` 同一个接缝：那颗按钮不住在树行里）。
 *
 * ⚠️ 功能没做时**红的就是这一句**（`[data-branch-add]` 不在）—— 那是"功能没做"那一种红。
 */
async function openCreate(w: W): Promise<void> {
  const entry = w.find('[data-branch-add]')
  expect(entry.exists(), 'the left column hands out no create-a-branch entry ([data-branch-add])').toBe(true)
  await entry.trigger('click')
  expect(
    w.find('[data-branch-create]').exists(),
    'pressing the entry opened no create panel ([data-branch-create])',
  ).toBe(true)
}

/** 六选一里的一个 */
async function chooseShape(w: W, shape: string): Promise<void> {
  const el = w.find('[data-branch-shape="' + shape + '"]')
  expect(el.exists(), 'the panel offers no shape named ' + shape).toBe(true)
  await el.trigger('click')
}

/** 名字那一格 */
async function typeName(w: W, name: string): Promise<void> {
  const box = w.find('[data-branch-name]')
  expect(box.exists(), 'the panel hands out no name box ([data-branch-name])').toBe(true)
  await box.setValue(name)
}

/** `list` / `map` 的元素形状 */
async function pickElement(w: W): Promise<void> {
  const el = w.find('[data-branch-of="string"]')
  expect(el.exists(), 'the element shape picker offers no string').toBe(true)
  await el.trigger('click')
}

/** `object` 第一个字段的名字与形状 */
async function pickSeed(w: W): Promise<void> {
  const box = w.find('[data-branch-field-key]')
  expect(box.exists(), 'the object branch hands out no first-field name').toBe(true)
  await box.setValue('probe_field')
  const kind = w.find('[data-branch-field-shape="string"]')
  expect(kind.exists(), 'that field hands out no shape picker').toBe(true)
  await kind.trigger('click')
}

/** 某个形状的必收项填满 */
async function complete(w: W, shape: string): Promise<void> {
  if (shape === 'enum') {
    const values = w.find('[data-branch-values]')
    expect(values.exists(), 'the enum branch hands out no whitelist box').toBe(true)
    await values.setValue(WHITELIST)
  }
  if (shape === 'list' || shape === 'map') await pickElement(w)
  if (shape === 'object') await pickSeed(w)
}

/**
 * 「配套动作」那一段那个勾（契约 §1.1）。
 *
 * ⚠️ 它是**这一段存在的证据** —— 勾不在，下面就分不出甲案与乙案两条路。
 * ⚠️ `on = true` 断的是"勾上了"这件**真事**（读 `checked`），不是"点过了"。
 */
async function setAction(w: W, on: boolean): Promise<void> {
  const box = w.find('[data-branch-action]')
  expect(box.exists(), 'the panel hands out no paired-action segment ([data-branch-action])').toBe(true)
  await box.setValue(on)
  expect(
    (box.element as HTMLInputElement).checked,
    'the paired-action switch did not follow the click: ' + String(on),
  ).toBe(on)
}

/** 按下「建出来」 */
async function make(w: W): Promise<void> {
  const button = w.find('[data-branch-make]')
  expect(button.exists(), 'the panel hands out no create button ([data-branch-make])').toBe(true)
  await button.trigger('click')
}

/**
 * 走一趟完整的建枝：开面板 ⇒ 六选一 ⇒ 起名 ⇒ 补必收项 ⇒ 勾上/摘下那个勾 ⇒ 建出来。
 *
 * @param withAction `true` = 不碰那个勾（契约 §1.1：**默认勾选**）；`false` = 明确摘掉
 */
async function create(w: W, shape: string, name: string, withAction: boolean): Promise<void> {
  await openCreate(w)
  await chooseShape(w, shape)
  await typeName(w, name)
  await complete(w, shape)
  if (!withAction) await setAction(w, false)
  await make(w)
}

/**
 * 界面对这一次建枝的**说法**（契约 §1.6）—— 判据只认这一句，不去猜草稿里有什么。
 *
 * 「说建成了」= 那一行上了树 **且** 没有一句被拒的原因。
 */
function uiSaysCreated(w: W, name: string): boolean {
  return rowOf(w, name).exists() && problemOf(w) === ''
}

/** 卡里原有的动作（名字 → 那一份声明），判据拿它作为"原有的一样都不许动"的底 */
function originalActions(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(card.actions)) as Record<string, unknown>
}

/**
 * 落盘那份卡里**指向这一枝**的动作名（没有就是空数组）。
 *
 * 认法按引擎的规矩来：`checkBranchKeepers`（`src/game/card.ts:425`）取的是 `path.split('.')[0]`。
 */
function actionsWriting(saved: Record<string, any>, branch: string): string[] {
  return Object.entries(saved.actions as Record<string, any>)
    .filter(([, action]) => String(action.path ?? '').split('.')[0] === branch)
    .map(([name]) => name)
}

/** 那一枝落进卡里之后长什么样（判据不手抄形状，按契约 §1.2 按形状现算） */
function branchShapeOf(shape: string): Record<string, unknown> {
  if (shape === 'enum') return { type: shape, values: WHITELIST.split(',') }
  if (shape === 'list' || shape === 'map') return { type: shape, of: { type: 'string' } }
  if (shape === 'object') return { type: shape, fields: { probe_field: { type: 'string' } } }
  return { type: shape }
}

describe('A1 the panel grows a paired-action segment, and it starts ticked (ticket 8f)', () => {
  it('A1a that segment is a real checkbox showing the locale label, and it is ticked by default', async () => {
    const w = editor()
    try {
      await openCreate(w)
      const box = w.find('[data-branch-action]')
      expect(box.exists(), 'the panel hands out no paired-action segment ([data-branch-action])').toBe(true)
      expect(box.element.tagName, 'the segment must be a real control').toBe('INPUT')
      expect(
        (box.element as HTMLInputElement).type,
        'the segment must be a checkbox (a switch the author can see the state of)',
      ).toBe('checkbox')
      expect(
        (box.element as HTMLInputElement).checked,
        'the paired action must be on by default (S1 section 2.1: the second step is what this ticket removes)',
      ).toBe(true)
      expect(textOf(w, '[data-branch-create]'), 'the segment must spell what the locale calls it').toContain(
        t('card.branchAction'),
      )
      // 摘得掉：这一条是"默认勾选"与"永远勾着"的分界（后面 A5 那条回归线靠它）
      await setAction(w, false)
    } finally {
      w.unmount()
    }
  })

  it('A1b those four keys are in both locales, and none of them falls back to its own name', () => {
    const zh = localeOf('zh-CN')
    const en = localeOf('en')
    for (const key of KEYS) {
      expect(leafOf(zh, key), 'zh-CN is missing ' + key).toBeTypeOf('string')
      expect(leafOf(en, key), 'en is missing ' + key).toBeTypeOf('string')
      expect(
        t(key, { name: PROBE }),
        key + ' fell back to its own name: every "the screen says t(key)" judge would pass for nothing',
      ).not.toBe(key)
    }
  })
})

describe('A2 a branch created with its paired action really lands in the card', () => {
  it('A2a the produced card carries that branch and one action pointing at it, and the engine accepts it', async () => {
    const w = editor()
    try {
      const before = JSON.stringify(card)
      const hadActions = originalActions()
      expect(
        Object.keys(hadActions).length,
        'the example card has no action at all, so "nothing else moved" says nothing',
      ).toBeGreaterThan(0)

      await create(w, 'string', PROBE, true)
      expect(uiSaysCreated(w, PROBE), 'the create was refused: ' + problemOf(w)).toBe(true)
      expect(
        noticesOf(w),
        'a branch with its own action is written by something: that notice is a lie',
      ).toEqual([])

      await save(w)
      const saved = storedCard()
      expect(saved.state[PROBE], 'the branch must be in the saved card, exactly as it was chosen').toEqual(
        branchShapeOf('string'),
      )
      expect(
        actionsWriting(saved, PROBE),
        'the saved card must carry exactly one action writing that branch (that is the whole ticket)',
      ).toHaveLength(1)
      expect(
        Object.keys(saved.actions),
        'no action may be lost or renamed behind the back of the author',
      ).toHaveLength(Object.keys(hadActions).length + 1)
      for (const [name, action] of Object.entries(hadActions)) {
        expect(saved.actions[name], 'an action that was already in the card changed: ' + name).toEqual(action)
      }
      // 🔴 格式层：这一条是被验的**整张卡**（不是草稿、不是那一行），引擎是唯一的裁判
      expect(
        () => parseCard(JSON.stringify(saved)),
        'what the screen called created must be a card the format accepts',
      ).not.toThrow()
      expect(w.emitted('saved'), 'a save that landed must tell the shell it happened').toHaveLength(1)
      expect(JSON.stringify(card), 'the draft must never be the card itself').toBe(before)
    } finally {
      w.unmount()
    }
  })

  it('A2b all six shapes land with their action, so "the screen said created" is never a dead end', async () => {
    for (const shape of SHAPES) {
      const w = editor()
      try {
        await create(w, shape, PROBE, true)
        expect(uiSaysCreated(w, PROBE), shape + ' was refused: ' + problemOf(w)).toBe(true)
        await save(w)
        const saved = storedCard()
        expect(saved.state[PROBE], 'the branch must be in the saved card: ' + shape).toEqual(
          branchShapeOf(shape),
        )
        expect(actionsWriting(saved, PROBE), 'no action writes that branch: ' + shape).toHaveLength(1)
        expect(
          () => parseCard(JSON.stringify(saved)),
          'a branch the screen called created produced a card the format refuses: ' + shape,
        ).not.toThrow()
      } finally {
        w.unmount()
      }
    }
  })
})

describe('A3 the paired action is written field by field, the way the contract pins it', () => {
  it('A3a the three segments are the locale text with the branch named in them, and no effect is claimed', async () => {
    const w = editor()
    try {
      await create(w, 'string', PROBE, true)
      await save(w)
      const saved = storedCard()
      const action = saved.actions[actionsWriting(saved, PROBE)[0]] as Record<string, unknown>
      for (const [key, localeKey] of [
        ['whenToUse', 'card.branchActionWhen'],
        ['what', 'card.branchActionWhat'],
        ['principles', 'card.branchActionPrinciples'],
      ] as Array<[string, string]>) {
        expect(action[key], 'the segment ' + key + ' must be the text the locale carries').toBe(
          t(localeKey, { name: PROBE }),
        )
        expect(
          String(action[key]).trim().length,
          'the segment ' + key + ' must say something',
        ).toBeGreaterThan(0)
      }
      expect(
        String(action.whenToUse) + String(action.what) + String(action.principles),
        'the three segments are the model tool description: they must name the branch they write',
      ).toContain(PROBE)
      expect(
        Object.hasOwn(action, 'effect'),
        'a paired action writes a path: it may not also claim an engine effect',
      ).toBe(false)
      expect(
        Object.hasOwn(action, 'mode') ? action.mode : 'set',
        'the default must be a plain write: push / merge are shape-bound and would be refused elsewhere',
      ).toBe('set')
    } finally {
      w.unmount()
    }
  })

  it('A3b a map branch demands a key, and the produced action hands one over', async () => {
    // 前提（从引擎现取）：map 那一枝的动作**没有 `key` 就过不了格式**（`src/game/card.ts:291-295`）
    const keyless = JSON.parse(JSON.stringify(card)) as Record<string, any>
    keyless.state[PROBE] = { type: 'map', of: { type: 'string' } }
    keyless.actions.probe_writer = { whenToUse: 'a', what: 'b', principles: 'c', path: PROBE }
    let engine = ''
    try {
      parseCard(JSON.stringify(keyless))
    } catch (err) {
      engine = (err as Error).message
    }
    expect(engine, 'premise: the engine really refuses a map action without a key').toContain('key')
    // 反面控制同一条读法：给它一个非空 key，同一张卡当场通过
    keyless.actions.probe_writer.key = 'name'
    expect(
      () => parseCard(JSON.stringify(keyless)),
      'this reader cannot say yes, so the line above would pass for nothing',
    ).not.toThrow()

    const w = editor()
    try {
      await create(w, 'map', PROBE, true)
      expect(uiSaysCreated(w, PROBE), 'the create was refused: ' + problemOf(w)).toBe(true)
      await save(w)
      const saved = storedCard()
      const action = saved.actions[actionsWriting(saved, PROBE)[0]] as Record<string, unknown>
      expect(
        typeof action.key === 'string' && (action.key as string).length > 0,
        'a map branch is written entry by entry: the action must say which parameter names the entry',
      ).toBe(true)
      expect(() => parseCard(JSON.stringify(saved)), 'that card must pass the format').not.toThrow()
    } finally {
      w.unmount()
    }
  })

  it('A3c a non-map branch carries no key, which the format refuses just as firmly', async () => {
    const w = editor()
    try {
      await create(w, 'string', PROBE, true)
      await save(w)
      const saved = storedCard()
      const action = saved.actions[actionsWriting(saved, PROBE)[0]] as Record<string, unknown>
      expect(
        Object.hasOwn(action, 'key'),
        'key is only for a map in state: on any other shape the format refuses it',
      ).toBe(false)
      // 前提（从引擎现取）：上面那句不是风格选择 —— 非 map 带 key 同样过不了
      const wrong = JSON.parse(JSON.stringify(card)) as Record<string, any>
      wrong.state[PROBE] = { type: 'string' }
      wrong.actions.probe_writer = { whenToUse: 'a', what: 'b', principles: 'c', path: PROBE, key: 'name' }
      expect(
        () => parseCard(JSON.stringify(wrong)),
        'premise: a key on a non-map action is refused by the format',
      ).toThrow()
    } finally {
      w.unmount()
    }
  })
})

describe('A4 what the screen calls created and what the format accepts are the same thing (known item C2)', () => {
  it('A4a a repeated enum whitelist never ends as "the screen said created, the save was refused"', async () => {
    // 前提（从引擎现取）：格式**真的拒重复**（`src/game/card-state.ts:149`）
    expect(
      () => checkSchema({ type: 'enum', values: ['probe_a', 'probe_a'] }, 'probe'),
      'premise: the card format refuses a whitelist that repeats a value',
    ).toThrow(/repeat/)

    const w = editor()
    try {
      await openCreate(w)
      await chooseShape(w, 'enum')
      await typeName(w, PROBE)
      const values = w.find('[data-branch-values]')
      expect(values.exists(), 'the enum branch hands out no whitelist box').toBe(true)
      await values.setValue(REPEATED)
      await make(w)

      if (uiSaysCreated(w, PROBE)) {
        // 界面说建成了 ⇒ 那就必须真能落盘（这一支是契约 §3 已知项 ① 要的那句话）
        await save(w)
        const saved = storedCard()
        const list = (saved.state[PROBE] as Record<string, unknown>).values as string[]
        expect(new Set(list).size, 'the saved whitelist repeats a value the format refuses').toBe(list.length)
        expect(() => parseCard(JSON.stringify(saved)), 'a created branch must produce a card').not.toThrow()
      } else {
        // 或者当场说清 —— 那就一个字节都不许动，而且要说得出话
        expect(problemOf(w), 'a refused create must say why').not.toBe('')
        expect(storedText(), 'a refused create must not touch the storage').toBeNull()
      }
    } finally {
      w.unmount()
    }
  })

  it('A4b a branch name the engine cannot turn into a tool name is never a silent dead end', async () => {
    // 前提：卡的字段名里有**非 ASCII** 的那几个，而它们不在顶层枝里 ⇒ 能当一枝新枝的名字（界面自己放行，
    // 引擎对动作名却只收 `[a-zA-Z0-9_-]`，`src/game/card.ts:179`）—— 这正是 C2 那一族里最尖的一格。
    const free = [...FIELD_KEYS].filter((key) => !Object.hasOwn(card.state, key))
    const cn = free.find((key) => NON_ASCII.test(key))
    expect(cn, 'the example card has no non-ASCII field name to build this name from').toBeTypeOf('string')
    const name = cn as string

    const w = editor()
    try {
      await create(w, 'string', name, true)
      if (uiSaysCreated(w, name)) {
        await save(w)
        const saved = storedCard()
        expect(
          actionsWriting(saved, name),
          'the screen said created, so something must write it',
        ).toHaveLength(1)
        expect(
          () => parseCard(JSON.stringify(saved)),
          'a branch name the engine cannot turn into a tool name must not end as a refused save',
        ).not.toThrow()
      } else {
        expect(problemOf(w), 'a refused create must say why').not.toBe('')
        expect(storedText(), 'a refused create must not touch the storage').toBeNull()
      }
    } finally {
      w.unmount()
    }
  })
})
