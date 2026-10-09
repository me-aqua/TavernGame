// @vitest-environment jsdom
/**
 * 票 8e（「新建一枝」）· S1 判据 —— 契约 `.team/test/2026-09-29/契约-8e.md`（S0 的 G1–G8）。
 *
 * 这一件只管**组件层**：左栏那颗按钮 · 六选一 · 每个形状的必收项 · 名字三条 · 建出来的枝立刻进树 ·
 * 那条会咬人的引擎约束当场说清 · 唯一那条写路径。**几何**（点按区 24×24 / 字号三档 / 横向溢出）
 * 在真浏览器里量（`e2e/smoke.spec.ts` 里那一节，与组件层同一个契约）。
 *
 * 🔴 **`useBranchCreate` 与 `BranchCreateForm` 这两个名字出现在这里不是巧合** —— `.githooks/pre-commit`
 *    的**检查 6**（"新增功能必须配测试"）是按**文件名**找证据的：这一件就是从 `CardEditor` 那个接缝上
 *    把建枝那一族整个照下来跑的，而面板与它那一族的值住在 `useBranchCreate.ts` / `BranchCreateForm.vue` 里。
 *    名字写在这一行是让那道检查看得见 —— **断言仍旧一条都不改**（先例：`useStepDraft` / `DisplayForm`）。
 *
 * ⚠️ 判据一律挂在 `CardEditor.vue` 这个**现成的接缝**上（`branch-tree-dom.test.ts` 已经这么挂）：
 *    按钮住在 `StateTreeNav.vue` 里，但必须能被 `CardEditor` 渲染出来 ⇒ 「功能没做」的红落在
 *    **钩子不在**上，不是"模块找不到"上。
 * ⚠️ **期望值全部从卡与 locale 现取**：这一份里一个中文字面量都没有（`ascii.mjs` 连 `tests/` 一起拦）。
 * ⚠️ 凡断"没有 / 是空"的地方都自带前提（先证明这一屏真的长得出来），免得"读不到东西"被当成通过。
 * ⚠️ **两种形状的子形状选择器只给 `string` / `integer`**（契约 §1.3）：那是格式里唯二能缩写的两种
 *    （`card-state.ts:53` 的 `SHORTHAND`），也是 8b-② 给新字段的那两个。
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCard } from '../src/game/card'
import { checkSchema } from '../src/game/card-state'
import { t } from '../src/i18n'
import { CARD_KEY } from './support/card-resources'
import { TREE_PATHS, card, editor, pickRow, save, textOf } from './support/branch-tree'

/** 编辑器包装器（`editor()` 的返回类型 —— 不引 `any`） */
type W = ReturnType<typeof editor>

/** 契约 §1.3 的六个形状名 —— 就是 `SchemaType`（`src/game/card-state.ts:23`）那六个字面名 */
const SHAPES = ['string', 'integer', 'enum', 'list', 'map', 'object']

/** 判据自己敲进去的字（一律 ASCII） */
const PROBE = 'probe_branch'
const WHITELIST = 'probe_a,probe_b'
const BAD_SHAPE = 'probe_not_a_shape'

/**
 * 契约 §1.5 点名的 locale 键。
 *
 * 🔴 **必须逐条断它们在两份 locale 里都在**：缺键时 vue-i18n 把**键名本身**当译文返回
 *    （起点读数 `[P6]` 实测：`t('card.branchNew')` 回的就是 `"card.branchNew"`）⇒ 凡是
 *    "屏上那句话等于 `t(key)`"的断言，两边会一起退化成同一个字符串 ⇒ **假绿**。
 */
const KEYS = [
  'card.branchNew',
  'card.branchMake',
  'card.branchNameEmpty',
  'card.branchNameDot',
  'card.branchNameTaken',
  'card.branchValuesEmpty',
  'card.branchOfMissing',
  'card.branchFieldsEmpty',
  'card.branchUnwritten',
]

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

/** 树上那一行（没有就报没有，不抛） */
function rowOf(w: W, name: string): ReturnType<W['find']> {
  return w.find('[data-branch-node="' + name + '"]')
}

/** 屏上那句被拒的原因（没有就是空串） */
function problemOf(w: W): string {
  const el = w.find('[data-branch-problem]')
  return el.exists() ? el.text().trim() : ''
}

/**
 * 点开建枝面板。
 *
 * ⚠️ 功能没做时**红的就是这一句**（`[data-branch-add]` 不在）—— 那是"功能没做"那一种红。
 * ⚠️ 按钮**不许长在树行里**（S0 §五.1：行里一个字都不许多），所以这里连着断一句。
 */
async function openCreate(w: W): Promise<void> {
  const entry = w.find('[data-branch-add]')
  expect(entry.exists(), 'the left column hands out no create-a-branch entry ([data-branch-add])').toBe(true)
  expect(
    entry.element.closest('[data-branch-node]'),
    'the entry must not grow inside a tree row: a row spells its dotted path and nothing else',
  ).toBeNull()
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

/** `list` / `map` 的元素形状（**不许有默认值** —— 有默认值的话"缺 `of`"这一态到不了） */
async function pickElement(w: W, shape: string): Promise<void> {
  const el = w.find('[data-branch-of="' + shape + '"]')
  expect(el.exists(), 'the element shape picker offers no ' + shape).toBe(true)
  await el.trigger('click')
}

/** `object` 第一个字段的名字与形状（`fields` 空表过不了卡自己的校验） */
async function pickSeed(w: W, key: string, shape: string): Promise<void> {
  const box = w.find('[data-branch-field-key]')
  expect(box.exists(), 'the object branch hands out no first-field name ([data-branch-field-key])').toBe(true)
  await box.setValue(key)
  const kind = w.find('[data-branch-field-shape="' + shape + '"]')
  expect(kind.exists(), 'that field hands out no shape picker').toBe(true)
  await kind.trigger('click')
}

/** 某个形状的必收项填满（G3 的正面控制靠它） */
async function complete(w: W, shape: string): Promise<void> {
  if (shape === 'enum') {
    const values = w.find('[data-branch-values]')
    expect(values.exists(), 'the enum branch hands out no whitelist box ([data-branch-values])').toBe(true)
    await values.setValue(WHITELIST)
  }
  if (shape === 'list' || shape === 'map') await pickElement(w, 'string')
  if (shape === 'object') await pickSeed(w, 'probe_field', 'string')
}

/** 按下「建出来」 */
async function make(w: W): Promise<void> {
  const button = w.find('[data-branch-make]')
  expect(button.exists(), 'the panel hands out no create button ([data-branch-make])').toBe(true)
  await button.trigger('click')
}

/** 给一个形状补上它自己那几个必填键（`checkSchema` 认不认这些名字，由 C2b 拿它问） */
function filledShape(shape: string): Record<string, unknown> {
  if (shape === 'enum') return { type: shape, values: ['probe'] }
  if (shape === 'list' || shape === 'map') return { type: shape, of: 'string' }
  if (shape === 'object') return { type: shape, fields: { probe: 'string' } }
  return { type: shape }
}

describe('G1 the left column grows one create-a-branch entry, and the rows stay pure (ticket 8e)', () => {
  it('C1a that entry is a real button in the left column, and it spells what the locale says', () => {
    const w = editor()
    try {
      const entry = w.find('[data-branch-add]')
      expect(entry.exists(), 'the editor hands out no create-a-branch entry ([data-branch-add])').toBe(true)
      expect(entry.element.tagName, 'the entry must be a real button').toBe('BUTTON')
      expect(
        entry.element.closest('[data-col="content"]'),
        'the entry must live in the left column (G1 says the left column grows it)',
      ).not.toBeNull()
      expect(textOf(w, '[data-branch-add]'), 'the entry must carry the label the locale gives it').toBe(
        t('card.branchNew'),
      )
    } finally {
      w.unmount()
    }
  })

  it('C1b every row still spells exactly its dotted path, with the panel closed and with it open', async () => {
    const w = editor()
    try {
      /** 树上此刻那几行的路径 */
      const paths = (): string[] =>
        w.findAll('[data-branch-node]').map((el) => el.attributes('data-branch-node') ?? '')
      /** 文字不等于自己那条路径的行（＝被污染的行） */
      const impure = (): string[] =>
        w
          .findAll('[data-branch-node]')
          .filter((el) => el.text().trim() !== (el.attributes('data-branch-node') ?? ''))
          .map((el) => (el.attributes('data-branch-node') ?? '') + ' -> ' + el.text().trim())

      expect(paths().length, 'the tree is gone, so this judge would say nothing').toBeGreaterThan(0)
      expect([...paths()].sort(), 'the tree must list exactly the card nodes').toEqual([...TREE_PATHS].sort())
      expect(impure(), 'a row must spell exactly its dotted path: nothing else may grow on it').toEqual([])

      await openCreate(w)
      expect([...paths()].sort(), 'opening the create panel may not change the tree').toEqual(
        [...TREE_PATHS].sort(),
      )
      expect(impure(), 'a row must stay pure while the create panel is open').toEqual([])
    } finally {
      w.unmount()
    }
  })
})

describe('G2 the panel offers six shapes, and the six names are the format own names', () => {
  it('C2a the six entries are exactly the SchemaType literals, each a button with its locale label', async () => {
    const w = editor()
    try {
      await openCreate(w)
      const found = w.findAll('[data-branch-shape]').map((el) => el.attributes('data-branch-shape') ?? '')
      expect([...found].sort(), 'the six shape entries must be exactly the six SchemaType names').toEqual(
        [...SHAPES].sort(),
      )
      for (const shape of SHAPES) {
        const el = w.find('[data-branch-shape="' + shape + '"]')
        expect(el.element.tagName, 'a shape entry must be a real button: ' + shape).toBe('BUTTON')
        expect(el.text().trim(), 'a shape entry must spell what the locale says: ' + shape).toBe(
          t('card.kind.' + shape),
        )
      }
    } finally {
      w.unmount()
    }
  })

  it('C2b those six names are the list the card format itself accepts', () => {
    for (const shape of SHAPES) {
      expect(
        () => checkSchema(filledShape(shape), 'probe'),
        shape + ' must be a type the card format accepts (the judge list is the format list)',
      ).not.toThrow()
    }
    // 反面控制：这套读法**说不** —— 一个不存在的形状名必须被格式拒掉
    expect(() => checkSchema({ type: BAD_SHAPE }, 'probe'), 'this reader cannot say no').toThrow()
    // 三条"空的不行"是**格式自己**的规矩（G3 那三条的根据）
    expect(() => checkSchema({ type: 'enum', values: [] }, 'probe')).toThrow()
    expect(() => checkSchema({ type: 'list' }, 'probe')).toThrow()
    expect(() => checkSchema({ type: 'object', fields: {} }, 'probe')).toThrow()
  })
})

describe('G3 every shape demands its own required bits, and the reason names the missing one', () => {
  it('C3a an enum without a whitelist is refused, and a filled one goes through', async () => {
    const w = editor()
    try {
      await openCreate(w)
      await chooseShape(w, 'enum')
      await typeName(w, PROBE)
      await make(w)
      expect(problemOf(w), 'an enum with no whitelist must be refused').toBe(t('card.branchValuesEmpty'))
      expect(rowOf(w, PROBE).exists(), 'a refused create may not grow a branch').toBe(false)
      expect(storedText(), 'a refused create must not touch the storage').toBeNull()

      await complete(w, 'enum')
      await make(w)
      expect(problemOf(w), 'this create must go through (or "always refuse" would pass too)').toBe('')
      expect(rowOf(w, PROBE).exists(), 'the branch must show up on the tree').toBe(true)
    } finally {
      w.unmount()
    }
  })

  it('C3b a list or a map with no element shape is refused, and picking one goes through', async () => {
    for (const shape of ['list', 'map']) {
      const w = editor()
      try {
        await openCreate(w)
        await chooseShape(w, shape)
        await typeName(w, PROBE)
        // 前提：元素形状**没有默认值**（契约 §1.3）—— 有默认值的话「还没选」这一态根本到不了，
        // 下面那句一次都不会红。这一条不需要额外的钩子：默认值会让"建得出来"，而下一步要的是"被拒"。
        await make(w)
        expect(problemOf(w), 'a ' + shape + ' with no element shape must be refused').toBe(
          t('card.branchOfMissing'),
        )
        expect(rowOf(w, PROBE).exists(), 'a refused create may not grow a branch: ' + shape).toBe(false)
        expect(storedText(), 'a refused create must not touch the storage').toBeNull()

        await complete(w, shape)
        await make(w)
        expect(problemOf(w), 'this create must go through: ' + shape).toBe('')
        expect(rowOf(w, PROBE).exists(), 'the branch must show up on the tree: ' + shape).toBe(true)
      } finally {
        w.unmount()
      }
    }
  })

  it('C3c an object with no field is refused, and one named field goes through', async () => {
    const w = editor()
    try {
      await openCreate(w)
      await chooseShape(w, 'object')
      await typeName(w, PROBE)
      const seed = w.find('[data-branch-field-key]')
      expect(seed.exists(), 'the object branch hands out no first-field name').toBe(true)
      expect(
        (seed.element as HTMLInputElement).value,
        'the first field must start empty: a default name would make "missing" unreachable',
      ).toBe('')
      await make(w)
      expect(problemOf(w), 'an object with an empty field table must be refused').toBe(
        t('card.branchFieldsEmpty'),
      )
      expect(rowOf(w, PROBE).exists(), 'a refused create may not grow a branch').toBe(false)
      expect(storedText(), 'a refused create must not touch the storage').toBeNull()

      await complete(w, 'object')
      await make(w)
      expect(problemOf(w), 'this create must go through').toBe('')
      expect(rowOf(w, PROBE).exists(), 'the branch must show up on the tree').toBe(true)
    } finally {
      w.unmount()
    }
  })
})

describe('G4 the branch just created is on the tree at once, and it can be picked', () => {
  it('C4a each of the six shapes, once created, gets a row of its own type at depth 1', async () => {
    for (const shape of SHAPES) {
      const w = editor()
      try {
        await openCreate(w)
        await chooseShape(w, shape)
        await typeName(w, PROBE)
        await complete(w, shape)
        await make(w)
        const row = rowOf(w, PROBE)
        expect(row.exists(), 'the branch just created must show up on the left tree: ' + shape).toBe(true)
        expect(row.attributes('data-branch-depth'), 'a top level branch sits at depth 1: ' + shape).toBe('1')
        expect(
          row.attributes('data-branch-type'),
          'the row must carry the shape that was chosen: ' + shape,
        ).toBe(shape)
        expect(row.text().trim(), 'the new row must spell its path and nothing else').toBe(PROBE)
      } finally {
        w.unmount()
      }
    }
  })

  it('C4b the row of the new branch can be picked, and the mid column follows it', async () => {
    const w = editor()
    try {
      await openCreate(w)
      await chooseShape(w, 'string')
      await typeName(w, PROBE)
      await make(w)
      expect(rowOf(w, PROBE).exists(), 'the branch just created must be on the tree').toBe(true)
      await pickRow(w, PROBE)
      expect(
        w.findAll('[data-branch-on]').map((el) => el.attributes('data-branch-node') ?? ''),
        'exactly the new row may stay lit',
      ).toEqual([PROBE])
      expect(
        textOf(w, '[data-branch-title]'),
        'the mid subtitle must name the branch being edited',
      ).toContain(PROBE)
    } finally {
      w.unmount()
    }
  })
})

describe('G5 a bad name is refused in the draft layer, and the reason names the rule', () => {
  it('C5a an empty name, or one of spaces only, is refused, and a legal name goes through', async () => {
    const w = editor()
    try {
      await openCreate(w)
      await chooseShape(w, 'string')
      for (const typed of ['', '   ']) {
        await typeName(w, typed)
        await make(w)
        expect(problemOf(w), 'a name like ' + JSON.stringify(typed) + ' must be refused').toBe(
          t('card.branchNameEmpty'),
        )
        expect(rowOf(w, PROBE).exists(), 'a refused create may not grow a branch').toBe(false)
      }
      expect(storedText(), 'a refused create must not touch the storage').toBeNull()

      await typeName(w, PROBE)
      await make(w)
      expect(problemOf(w), 'this create must go through').toBe('')
      expect(rowOf(w, PROBE).exists(), 'the branch must show up on the tree').toBe(true)
    } finally {
      w.unmount()
    }
  })

  it('C5b a dotted name is refused, and a legal one after it goes through', async () => {
    const w = editor()
    try {
      await openCreate(w)
      await chooseShape(w, 'string')
      await typeName(w, PROBE + '.inner')
      await make(w)
      expect(problemOf(w), 'a dotted name must be refused (the path syntax would never reach it)').toBe(
        t('card.branchNameDot'),
      )
      expect(rowOf(w, PROBE + '.inner').exists(), 'a refused create may not grow a branch').toBe(false)

      await typeName(w, PROBE)
      await make(w)
      expect(problemOf(w), 'this create must go through').toBe('')
      expect(rowOf(w, PROBE).exists(), 'the branch must show up on the tree').toBe(true)
    } finally {
      w.unmount()
    }
  })

  it('C5c a name an existing branch already has is refused, and a free one goes through', async () => {
    const taken = Object.keys(card.state)[0]
    const w = editor()
    try {
      expect(taken, 'the example card has a branch to collide with').toBeTruthy()
      await openCreate(w)
      await chooseShape(w, 'string')
      await typeName(w, taken)
      await make(w)
      expect(problemOf(w), 'a name that is already a branch must be refused').toBe(t('card.branchNameTaken'))
      expect(rowOf(w, PROBE).exists(), 'a refused create may not grow a branch').toBe(false)

      await typeName(w, PROBE)
      await make(w)
      expect(problemOf(w), 'this create must go through').toBe('')
      expect(rowOf(w, PROBE).exists(), 'the branch must show up on the tree').toBe(true)
    } finally {
      w.unmount()
    }
  })

  /**
   * `C5d` · **契约 §1.4 的第四条非法名**（S0 的 G5 只点了三条，这一条是同一族的第四个）：
   * 一个**落不下**的键名。实测（起点读数 `[P4]`）：`table['__proto__'] = schema` **不建那个键**
   * 却**改掉了原型** ⇒ 界面会报成功、卡里根本没有它（`useBranchDraft` 的 `fieldNameProto` 守的
   * 就是同一件事）。这里只断"**被拒且说得出话**"，**不钉具体哪一句文案** —— 换文案不该红。
   */
  it('C5d a name that cannot land as a JSON key is refused instead of silently vanishing', async () => {
    const w = editor()
    try {
      const probe: Record<string, unknown> = {}
      probe['__proto__'] = { type: 'string' }
      expect(Object.hasOwn(probe, '__proto__'), 'premise: that assignment does not create the key').toBe(
        false,
      )

      await openCreate(w)
      await chooseShape(w, 'string')
      await typeName(w, '__proto__')
      await make(w)
      expect(problemOf(w), 'the UI must refuse this name with a reason of its own').not.toBe('')
      expect(rowOf(w, '__proto__').exists(), 'nothing may show up on the tree').toBe(false)
      expect(storedText(), 'a refused create must not touch the storage').toBeNull()
    } finally {
      w.unmount()
    }
  })
})

/**
 * 🔴 **票 8f 把 `C6a` 翻面了**（台账见契约 `.team/test/2026-10-09/contract-8f.md` §4 已知项 ②）。
 *
 * **原来断什么**：建完一枝之后屏上**必须**出现"这枝还没有动作写它"那句（乙案：建枝不建动作）。
 * **现在断什么**：甲案落地之后，**默认勾着配套动作**建出来的那一枝**有**动作写它
 * ⇒ 那句话**必须一句都不在**（它在就是在说假话）。⚠️ 断言没有删、也没有改弱：
 * 原来数的是"至少一句、句句非空、不许长在树行里"，现在数的是"零句"——**同一个读法换了朝向**。
 * 乙案那一半（不勾 ⇒ 那句话回来、而且是真的）搬到 `C6c`，一句话都没丢。
 */
describe('G6 a created branch says who writes it: the paired action, or the notice (ticket 8e, flipped by 8f)', () => {
  it('C6a a branch created with its paired action puts no notice on screen at all', async () => {
    const w = editor()
    try {
      expect(
        w.findAll('[data-branch-unwritten]').length,
        'nothing was created yet, so no notice may be on screen',
      ).toBe(0)

      await openCreate(w)
      await chooseShape(w, 'string')
      await typeName(w, PROBE)
      await make(w)

      expect(rowOf(w, PROBE).exists(), 'the branch must be on the tree before this line says anything').toBe(
        true,
      )
      expect(
        w.findAll('[data-branch-unwritten]').map((el) => el.text().trim()),
        'an action writes this branch: the notice that says otherwise is a lie (ticket 8f pairs one in)',
      ).toEqual([])
    } finally {
      w.unmount()
    }
  })

  /**
   * 🔴 `C6b` · **票 8f 把这一条也翻面了**（同一个台账，见契约 §4 已知项 ②）。
   *
   * **原来断什么**：按顶栏那颗保存 ⇒ 引擎**用自己的原话**把它拦下、卡一个字节不动（乙案：新枝没人写）。
   * **现在断什么**：勾着配套动作建出来的那一枝**真的存得回卡** —— 落盘那份卡过 `parseCard`、
   * 那条动作的 `path` 指着这一枝、而引擎**一句话都不抱怨**（`[data-card-error]` 不在）。
   * ⚠️ 断言没有删、也没有改弱：这一条比原来**严**（原来说的是"被拒"，现在说的是"真的落"），
   * 而"期望值从引擎现取"那条口径照旧。⚠️ 乙案那半边一个字没丢，就在下面 `C6c`。
   */
  it('C6b the save lands for real: the engine takes the card, and it carries the action writing that branch', async () => {
    const w = editor()
    try {
      await openCreate(w)
      await chooseShape(w, 'string')
      await typeName(w, PROBE)
      await make(w)
      expect(rowOf(w, PROBE).exists(), 'the branch must be on the tree before this line says anything').toBe(
        true,
      )

      await save(w)
      expect(
        w.find('[data-card-error]').exists(),
        'the engine refused a card whose every top level branch is written by an action',
      ).toBe(false)
      const text = storedText()
      expect(text, 'the screen said created, so the card must really land').not.toBeNull()
      const saved = JSON.parse(text as string) as Record<string, any>
      expect(saved.state[PROBE], 'the saved card must carry that branch').toEqual({ type: 'string' })
      expect(
        Object.entries(saved.actions as Record<string, any>)
          .filter(([, action]) => String(action.path ?? '').split('.')[0] === PROBE)
          .map(([name]) => name),
        'the saved card must carry exactly one action writing that branch',
      ).toHaveLength(1)
      expect(
        () => parseCard(JSON.stringify(saved)),
        'what the screen called created must be a card the format accepts',
      ).not.toThrow()
      expect(w.emitted('saved'), 'a save that landed must ask the outer layer to reload').toHaveLength(1)
    } finally {
      w.unmount()
    }
  })

  /**
   * `C6c` · **乙案那条回归线**（S1 §六 ②：**不勾 ⇒ 产物与今天逐字相同**）。
   *
   * 这一条就是 8e 的 `C6a` + `C6b` 原样搬过来，只多了一步"把配套动作那个勾摘掉"。
   * ⚠️ 它同时是"甲案没有偷偷替作者建动作"的哨兵：真建了的话保存会**成功**，
   * 下面那句"被引擎拦下"当场红。
   * ⚠️ 期望值仍旧从引擎现取（把这一枝加进卡里问 `parseCard`），不手抄那句英文。
   */
  it('C6c with the paired action switched off the notice is back, and it is still true', async () => {
    const w = editor()
    try {
      expect(
        w.findAll('[data-branch-unwritten]').length,
        'nothing was created yet, so no notice may be on screen',
      ).toBe(0)

      await openCreate(w)
      await chooseShape(w, 'string')
      await typeName(w, PROBE)
      const box = w.find('[data-branch-action]')
      expect(box.exists(), 'the panel hands out no paired-action segment ([data-branch-action])').toBe(true)
      await box.setValue(false)
      await make(w)

      const notices = w.findAll('[data-branch-unwritten]')
      expect(
        notices.length,
        'with the action switched off the branch has nobody writing it: the screen must say so',
      ).toBeGreaterThan(0)
      expect(
        notices.filter((el) => el.element.closest('[data-branch-node]') !== null).length,
        'the notice must not grow inside a tree row either',
      ).toBe(0)
      expect(notices.filter((el) => el.text().trim() === '').length, 'the notice must say something').toBe(0)
      expect(
        w.find('[data-card-editor]').text(),
        'the sentence must be the one the locale carries, with the branch named in it',
      ).toContain(t('card.branchUnwritten', { name: PROBE }))

      // 那句话是真的：把这一枝加进卡里问引擎（期望值现取，不手抄）
      const next = JSON.parse(JSON.stringify(card)) as Record<string, any>
      next.state[PROBE] = { type: 'string' }
      let engine = ''
      try {
        parseCard(JSON.stringify(next))
      } catch (err) {
        engine = (err as Error).message
      }
      expect(engine, 'premise: the engine really refuses a branch that no action maintains').toContain(
        'no action maintains',
      )

      const before = JSON.stringify(card)
      await save(w)
      expect(
        textOf(w, '[data-card-error]'),
        'the refused save must put the engine own words on screen',
      ).toContain(engine)
      expect(storedText(), 'a refused save must not write the card').toBeNull()
      expect(w.emitted('saved'), 'a refused save must not ask the outer layer to reload').toBeUndefined()
      expect(JSON.stringify(card), 'a refused save must not touch the card the props point at').toBe(before)
    } finally {
      w.unmount()
    }
  })
})

describe('G7 creating a branch only feeds the draft, and the top bar stays the only way out', () => {
  it('C7a the card and the storage stay untouched, and the draft wakes the save button up', async () => {
    const w = editor()
    try {
      const before = JSON.stringify(card)
      expect(
        w.find('[data-top] [data-card-save]').attributes('disabled'),
        'a fresh editor is clean, so saving is out of reach',
      ).toBeDefined()

      await openCreate(w)
      await chooseShape(w, 'object')
      await typeName(w, PROBE)
      await complete(w, 'object')
      await make(w)

      expect(JSON.stringify(card), 'the draft must not be the card itself').toBe(before)
      expect(storedText(), 'creating a branch must not write the card').toBeNull()
      expect(w.emitted('saved'), 'creating a branch must not ask for a reload').toBeUndefined()
      expect(
        w.find('[data-top] [data-card-save]').attributes('disabled'),
        'the draft is dirty now: the top bar save must wake up (it is the only way out)',
      ).toBeUndefined()
    } finally {
      w.unmount()
    }
  })

  it('C7b none of the create family buttons reaches the reload path', async () => {
    const w = editor()
    try {
      const entry = w.find('[data-branch-add]')
      expect(entry.exists(), 'the editor hands out no create-a-branch entry').toBe(true)
      await entry.trigger('click')
      expect(w.emitted('saved'), 'the entry itself must not save anything').toBeUndefined()

      // 🔴 **贴着形状走**：`data-branch-of` / `data-branch-field-shape` 是**条件渲染**的 ——
      //    换一颗形状就会把它们卸掉。所以每点完一颗形状，**立刻**把那一刻长出来的次级选择器点掉；
      //    "每一轮只点一颗"会把 `of` 那一对漏在网外（轮到点 `map` / `object` 时它已经不在了）。
      const picked = new Set<Element>()
      const unclicked = () => w.findAll('[data-branch-create] button').filter((el) => !picked.has(el.element))
      /** 点一颗按钮，并断它没有走到那条会重新载入的路径（`saved`） */
      const press = async (el: {
        element: Element
        text: () => string
        trigger: (name: string) => Promise<unknown>
      }) => {
        picked.add(el.element)
        await el.trigger('click')
        expect(
          w.emitted('saved'),
          'a create-panel button reached the reload path: ' + el.text().trim(),
        ).toBeUndefined()
      }
      /** 此刻面板上还没点过的次级选择器（`of` / `field-shape` 那两族） */
      const extras = () =>
        unclicked().filter(
          (el) =>
            el.attributes('data-branch-of') !== undefined ||
            el.attributes('data-branch-field-shape') !== undefined,
        )
      for (const shape of w.findAll('[data-branch-create] button[data-branch-shape]')) {
        if (picked.has(shape.element)) continue
        await press(shape)
        for (let guard = 0; guard < 8; guard++) {
          const extra = extras()
          if (!extra.length) break
          await press(extra[0])
        }
      }
      const make = unclicked().find((el) => el.attributes('data-branch-make') !== undefined)
      if (make) await press(make)
      console.log('[C7b] picked = ' + picked.size + ' (shapes ' + SHAPES.length + ')')
      // 🔴 下限是 **`SHAPES.length + 5`**，不是 `SHAPES.length`：那 5 颗是 `of` 一对 +
      //    `field-shape` 一对 + `make` 一颗 —— S3 窄复审抓到的正是"`of` 那对没进网时
      //    `9 > 6` 照样通过"。写宽了，这条普查就退回成一句空话。
      expect(
        picked.size,
        'the panel hands out too few buttons: this census would say nothing',
      ).toBeGreaterThanOrEqual(SHAPES.length + 5)
      // 🔴 **收尾再核一次：面板上不许剩「没点到」的按钮。** 上面那两族名单（`of` / `field-shape`）与下限
      //    `+5` 都是**今天这张面板的枚举** —— 将来谁加一族条件渲染的按钮而忘了进 `extras()`，那些按钮会
      //    **静默漏网**，而 `picked = 11 + n ≥ 11` **照样通过**。这一行把"剩没剩"也钉住。
      //    📌 出处：S3 复审确认时给的非阻塞观察（组长 2026-09-29 采纳）。
      expect(unclicked(), 'a create-panel button was never clicked: this census is not exhaustive').toEqual(
        [],
      )
      // 🔴 全局那次普查（编辑器里**每一颗**按钮各点一遍）住在 `tests/editor-draft-guard-dom.test.ts`
      //    的 `D15`：它照旧只许数出 `[data-card-save]` 一颗 —— 新按钮自动进那次普查，这里不复制它。
    } finally {
      w.unmount()
    }
  })
})

describe('G8 and the locale: size guard and the keys this ticket contracts', () => {
  /**
   * `C8` · **守卫**（起点就是绿的）：钩子的逐文件上限是 **550 行**（`.githooks/pre-commit:214`），
   * 而它数行数的口径是 `content.split('\n').length`（**带尾换行就算一行**）—— 这一条照那个口径量，
   * 不然同一条规矩两把尺子。⚠️ 它**不是判别**：本票开工时是绿的，它抓的是"这一票把文件撑爆"。
   */
  it('C8 CardEditor.vue still fits the file limit the commit hook enforces', () => {
    const lines = readFileSync('src/components/CardEditor.vue', 'utf8').split('\n').length
    console.log('[C8] CardEditor.vue lines = ' + lines + ' (limit 550)')
    expect(lines, 'CardEditor.vue must stay inside the file limit of the commit hook').toBeLessThanOrEqual(
      550,
    )
  })

  it('C9 both locales carry every contracted key, and none of them falls back to its own name', () => {
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
    expect(
      t('card.branchUnwritten', { name: PROBE }),
      'the notice must name the branch it is about (this contract pins the {name} placeholder)',
    ).toContain(PROBE)
  })
})
