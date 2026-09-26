// @vitest-environment jsdom
/**
 * 票 8d-① · S1（2026-09-26）：中栏**第三种形态「编一块显示」**的组件层判据。
 *
 * 契约 `.team/test/2026-09-26/contract-8d1.md`（G1–G6 / R1–R7 的逐条对照、"红在哪"、"牙口"都在那儿）。
 * 🔴 **本票的功能还没做 ⇒ 这一件落地即红**，红在「编辑器交不出进第三形态的入口」上；判据挂在现成接缝
 *    `CardEditor.vue` 上（照 8c 的先例）⇒ 红不是"模块找不到"。**一条都不挂起。**
 * ⚠️ **判据挂在 `CardEditor.vue` 这个现成的接缝上**（照 8c 的先例）：实现是它内部 import 的两个件 ——
 *    **`src/components/DisplayForm.vue`**（那一屏的表单）与 **`src/components/useDisplayDraft.ts`**（显示块那一族的草稿），
 *    「换内容不换接缝」由这条钉住；`.githooks/pre-commit` 的检查 6 也要求这两个名字出现在 `tests/` 里。
 * ⚠️ 期望值从卡与 `src/game/display.ts` 现取；字符串一律 ASCII；几何那几样归 `e2e/`（组长跑）。
 * 🆕 S3 的 **C-2** 补的那一条（`C2/N3`）：`[data-display-on]` 此前零覆盖（见那个 `it` 上面的注释）。
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import { parseCard, type CardData } from '../src/game/card'
import { DISPLAY_FORMATS, DISPLAY_SIDES } from '../src/game/display'
import { i18n } from '../src/i18n'
import { EXAMPLE_CARD, LONG_NIGHT_CARD } from './support/card-fixtures'
import { CARD_KEY } from './support/card-resources'
import {
  PICK_MIX,
  TREE_PATHS,
  pickRow,
  save,
  schemaAtPath,
  storedRaw,
  typeOf,
  type AnyWrapper,
  type CardJson,
  type RowWrapper,
} from './support/branch-tree'

/** 示例卡（六个显示块、两边都有）：本件全部期望值的来源，顺序即屏幕上的顺序 */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
const declared = card.display.sidebar
/** 已经被画掉的枝（`checkEntry` 第 4 条：一块 = 一枝） */
const drawn = new Set(declared.map((entry) => entry.path))
/** 判据自己填进去的那段标题（测试里的字符串字面量一律 ASCII） */
const NEW_TITLE = 'renamed by the display ticket'
/** 格式 → 它要的容器（`display.ts:50` 那是私表；R1d 的最后一次保存就是它的裁判） */
const CONTAINER: Record<string, string> = { 'key-value': 'object', list: 'list', grouped: 'map' }
/** 四个键（明细里各一个控件，顺序就是断言与列表的顺序） */
const KEYS = ['path', 'title', 'format', 'side']

/** 一份卡的 JSON（读落盘结果、试改坏一处时都用它） */
function copyOf(): CardJson {
  return JSON.parse(JSON.stringify(card)) as CardJson
}

/** 还没被画、容器类型是 `kind` 的枝（树序）—— `path` 能填的合法值（`*` 那段不是一格，丢掉） */
function freeBranches(kind: string): string[] {
  return TREE_PATHS.filter(
    (path) => !path.includes('*') && !drawn.has(path) && typeOf(schemaAtPath(path)) === kind,
  )
}

/** 两份 locale 里的一句话（读真文件，不从 i18n 实例反推） */
function localeOf(name: string): Record<string, any> {
  return JSON.parse(readFileSync('src/locales/' + name + '.json', 'utf8')) as Record<string, any>
}

/** 挂一版真编辑器跑一段判据、跑完收摊（每条判据各挂一版：判据之间不许互相带状态） */
async function onEditor(run: (w: AnyWrapper) => Promise<void>, which?: CardData): Promise<void> {
  const w = mount(CardEditor, {
    props: { card: which ?? card, source: 'builtin' },
    global: { plugins: [i18n] },
    attachTo: document.body,
  }) as AnyWrapper
  try {
    await run(w)
  } finally {
    w.unmount()
  }
}

/** 打开第三形态：本票唯一的入口（八条判据今天全红在这一句上） */
async function openDisplay(w: AnyWrapper): Promise<void> {
  const entry = w.find('[data-display-open]')
  expect(entry.exists(), 'no way into the third form: [data-display-open] is missing').toBe(true)
  await entry.trigger('click')
  expect(
    w.find('[data-mid] [data-display-form]').exists(),
    'no third form in the mid scroll body [data-mid] after the click',
  ).toBe(true)
}

/** 列表里那几行的条号，按显示顺序 */
function blockIndexes(w: AnyWrapper): string[] {
  return w.findAll('[data-display-block]').map((el) => el.attributes('data-display-block') ?? '')
}

/** 点第 i 条声明 ⇒ 明细区开在它身上（G1 的"点一条 ⇒ 那一屏可编"） */
async function pickBlock(w: AnyWrapper, index: number): Promise<void> {
  const row = w.find('[data-display-block="' + index + '"]')
  expect(row.exists(), 'no list row for declaration ' + index).toBe(true)
  await row.trigger('click')
  const detail = w.find('[data-display-entry]')
  expect(detail.exists(), 'picking a declaration opened no detail area').toBe(true)
  expect(detail.attributes('data-display-index'), 'the detail is about another declaration').toBe(
    String(index),
  )
}

/** 明细里某个键的控件（取不到就是 `null`） */
function cell(w: AnyWrapper, key: string): RowWrapper | null {
  const el = w.find('[data-display-entry] [data-display-field="' + key + '"]')
  return el.exists() ? el : null
}

/** 一个控件的值（不在就是空串 —— 空串会让比较当场红） */
function valueOf(el: RowWrapper | null): string {
  return el === null ? '' : ((el.element as HTMLInputElement | HTMLSelectElement).value ?? '')
}

/** 明细读出来的一条：条号 + 那四个键的控件里的值 */
function readEntry(w: AnyWrapper): Record<string, string> {
  const one: Record<string, string> = {
    index: w.find('[data-display-entry]').attributes('data-display-index') ?? '',
  }
  for (const key of KEYS) one[key] = valueOf(cell(w, key))
  return one
}

/** 一个 `<select>` 的选项值（按界面顺序） */
function optionsOf(key: string, w: AnyWrapper): string[] {
  const el = cell(w, key)
  if (el === null) return []
  return Array.from((el.element as HTMLSelectElement).options).map((one) => one.value)
}

/** 顶栏那颗保存（干净时禁用 —— 显示块的草稿必须也算进 `dirty`） */
function saveButton(w: AnyWrapper): RowWrapper {
  const button = w.find('[data-top] [data-card-save]')
  expect(button.exists(), 'the top bar hands out no save button').toBe(true)
  return button
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a declaration of display.sidebar, edited in the mid column (ticket 8d-1)', () => {
  /**
   * 前提（**今天就是绿的**）：本件挑给 `path` / `format` 的候选，卡自己收得下。
   *
   * 八条判据今天全红在**同一句** ⇒ 它们后面那些断言今天一条都没被验过 —— 这一条把
   * "我挑的候选对不对"从界面上摘出来先量，免得 S2 落地那天红的是**我的量具**。
   */
  it('premise the branches this file moves to are accepted by the card itself', () => {
    for (const [format, kind] of [
      ['key-value', 'object'],
      ['list', 'list'],
    ]) {
      const free = freeBranches(kind)
      expect(free.length, 'no undrawn ' + kind + ' branch on this card').toBeGreaterThan(0)
      const moved = copyOf()
      const at = declared.findIndex((entry) => CONTAINER[entry.format] !== format)
      moved.display.sidebar[at].path = free[0]
      moved.display.sidebar[at].format = format
      expect(() => parseCard(JSON.stringify(moved)), 'the card refuses what R1c / R1d move to').not.toThrow()
    }
    // 反面：这张卡里没有自由的 map 枝 ⇒ 「＋」的初值不许挑 `grouped`（挑了就存不下去，R3 当场红）
    expect(freeBranches('map'), 'a free map branch exists: that is not the trap it is today').toEqual([])
  })

  /** G1 · 中栏长出第三种形态：一条声明一行、按声明序、与另外两形态互斥 */
  it('G1 the third form lists one row per declaration, in card order, and owns the mid column', async () => {
    expect(declared.length, 'this card declares no block: nothing to measure').toBeGreaterThan(1)
    await onEditor(async (w) => {
      await openDisplay(w)
      expect(blockIndexes(w), 'one row per declaration, in card order').toEqual(
        declared.map((_entry, index) => String(index)),
      )
      declared.forEach((entry, index) => {
        const text = w.find('[data-display-block="' + index + '"]').text()
        expect(text, 'row ' + index + ' must show the path it declares').toContain(entry.path)
        expect(text, 'row ' + index + ' must say which declaration it is').toContain(String(index + 1))
      })
      for (const gone of ['[data-branch-form]', '[data-step-form]', '[data-branch-none]']) {
        expect(w.find(gone).exists(), 'the third form shares the mid column with ' + gone).toBe(false)
      }
    })
  })

  /** G2 + R1a · 四个键的值来自卡、跟着选中走；`format` / `side` 只能挑不能打（G6 的后半） */
  it('G2/R1a the four keys are the card values, follow the pick, and the enums can only be picked', async () => {
    const second = declared.findIndex((e) => e.format !== declared[0].format && e.side !== declared[0].side)
    expect(second, 'needs two declarations differing in format and side').toBeGreaterThan(0)
    await onEditor(async (w) => {
      await openDisplay(w)
      await pickBlock(w, 0)
      expect(readEntry(w), 'the cells must hold the four keys of that declaration').toEqual({
        index: '0',
        ...declared[0],
      })
      for (const [key, tag] of [
        ['path', 'INPUT'],
        ['title', 'INPUT'],
        ['format', 'SELECT'],
        ['side', 'SELECT'],
      ]) {
        expect(cell(w, key)?.element.tagName, key + ' needs a ' + tag + ' control').toBe(tag)
      }
      expect(optionsOf('format', w), 'the format list must be DISPLAY_FORMATS').toEqual([...DISPLAY_FORMATS])
      expect(optionsOf('side', w), 'the side list must be DISPLAY_SIDES').toEqual([...DISPLAY_SIDES])
      const controls = w.findAll(
        '[data-display-entry] input, [data-display-entry] select, [data-display-entry] textarea',
      )
      expect(controls.length, 'the detail hands out more than the four keys').toBe(4)
      for (const el of controls)
        expect(el.attributes('disabled'), 'a dead control is no control').toBeUndefined()
      // 本票只加不减（S0 裁决 2）：第三形态里一个删除钩子都不许有
      expect(w.findAll('[data-display-form] [data-field-del]').length, 'no delete in this ticket').toBe(0)
      await pickBlock(w, second)
      expect(readEntry(w), 'the detail did not follow the pick').toEqual({
        index: String(second),
        ...declared[second],
      })
    })
  })

  /** 🔴 R2 + R1b · `side` 从右边改到左边（本票的来处）· `title` 一起改 ⇒ 一次保存恰好这两处 */
  it('R2/R1b a right block moves to the left, and both edits land in one save', async () => {
    const at = declared.findIndex((entry) => entry.side === 'right')
    expect(at, 'no block on the right: R2 would measure nothing').toBeGreaterThan(-1)
    await onEditor(async (w) => {
      await openDisplay(w)
      await pickBlock(w, at)
      await (cell(w, 'title') as RowWrapper).setValue(NEW_TITLE)
      await (cell(w, 'side') as RowWrapper).setValue('left')
      expect(
        saveButton(w).attributes('disabled'),
        'a pending change must make the save usable',
      ).toBeUndefined()
      await save(w)
      const want = copyOf()
      want.display.sidebar[at].title = NEW_TITLE
      want.display.sidebar[at].side = 'left'
      expect(storedRaw(), 'exactly those two changes, nothing else').toEqual(want)
      expect(parseCard(localStorage.getItem(CARD_KEY) as string).display.sidebar[at].side).toBe('left')
    })
  })

  /** R1c + R1d · `path` 单独落盘；`format` 只能**跟着 path 一起**改（那两种容器一一对应） */
  it('R1c/R1d path lands on its own, and format lands together with a matching path', async () => {
    const at = declared.findIndex((entry) => CONTAINER[entry.format] === 'object')
    const free = freeBranches('object')
    const moved = freeBranches('list')
    const format = DISPLAY_FORMATS.find((one) => CONTAINER[one] === 'list') as string
    expect(at, 'this card declares no key-value block').toBeGreaterThan(-1)
    expect(free.length > 0 && moved.length > 0, 'no free branch to move a block to').toBe(true)
    // 前提：单独改格式，**卡自己**就拒 —— 所以那两个键必须一起动
    const bad = copyOf()
    bad.display.sidebar[at].format = format
    expect(() => parseCard(JSON.stringify(bad)), 'a format its container cannot draw was accepted').toThrow()
    await onEditor(async (w) => {
      await openDisplay(w)
      await pickBlock(w, at)
      await (cell(w, 'path') as RowWrapper).setValue(free[0])
      await save(w)
      const want = copyOf()
      want.display.sidebar[at].path = free[0]
      expect(storedRaw(), 'exactly that one path changed').toEqual(want)
      // 第二轮：换到另一种容器 ⇒ 必须连格式一起改
      await pickBlock(w, at)
      await (cell(w, 'path') as RowWrapper).setValue(moved[0])
      await (cell(w, 'format') as RowWrapper).setValue(format)
      await save(w)
      const both = copyOf()
      both.display.sidebar[at].path = moved[0]
      both.display.sidebar[at].format = format
      expect(storedRaw(), 'both keys must land in the same save').toEqual(both)
    })
  })

  /** R3 · 「＋」加出来的一条**不改任何东西就能存下去**（初值猜错就红在卡自己那句拒绝上） */
  it('R3 the plus adds a declaration the card itself accepts, untouched', async () => {
    const before = localStorage.getItem(CARD_KEY)
    await onEditor(async (w) => {
      await openDisplay(w)
      const plus = w.find('[data-display-add]')
      expect(plus.exists(), 'the third form hands out no plus (G3)').toBe(true)
      expect(plus.element.tagName, 'the plus must be a real button').toBe('BUTTON')
      await plus.trigger('click')
      expect(blockIndexes(w).length, 'the plus must add exactly one declaration').toBe(declared.length + 1)
      const fresh = readEntry(w)
      expect(fresh.index, 'the new declaration must be the one being edited').toBe(String(declared.length))
      for (const key of KEYS) expect(fresh[key], 'born filled in: ' + key).not.toBe('')
      await save(w)
      const stored = localStorage.getItem(CARD_KEY) as string
      expect(stored, 'the save did not reach the card at all').not.toBe(before)
      const saved = parseCard(stored)
      expect(saved.display.sidebar, 'exactly one declaration added').toHaveLength(declared.length + 1)
      const added = saved.display.sidebar[declared.length]
      expect(TREE_PATHS, 'the new path must be a real branch of the card').toContain(added.path)
      // 「＋」挑的是**树序第一个**"没被画过、容器是 object"的枝（契约 §二 `:43`）；
      // ⚠️ 它只咬得住"挑哪一个"——`!drawn.has()` 那一半今天不可能红（本票只加不减，S3 的 N1 已记成盲区）
      expect(added.path, 'the plus must take the first free object branch, in tree order').toBe(
        freeBranches('object')[0],
      )
      expect(CONTAINER[added.format], 'the path must match the container of its format').toBe(
        typeOf(schemaAtPath(added.path)),
      )
      expect(
        saved.display.sidebar.filter((entry) => entry.path === added.path),
        'one block per branch: no branch drawn twice',
      ).toHaveLength(1)
      const want = copyOf()
      want.display.sidebar.push(added as unknown as Record<string, unknown>)
      expect(storedRaw(), 'nothing but that one new declaration may change').toEqual(want)
    })
  })

  /** R4 · 写路径只有一条：草稿 + 顶栏保存；点别处 / 切形态不许偷偷落盘，草稿跨条留着 */
  it('R4 the only path to the card is the top-bar save, and drafts survive switching', async () => {
    const before = localStorage.getItem(CARD_KEY)
    expect(declared.length, 'needs two declarations to carry two drafts').toBeGreaterThan(1)
    await onEditor(async (w) => {
      await openDisplay(w)
      await pickBlock(w, 0)
      await (cell(w, 'title') as RowWrapper).setValue(NEW_TITLE)
      expect(
        saveButton(w).attributes('disabled'),
        'a pending change must make the save usable',
      ).toBeUndefined()
      await pickBlock(w, 1)
      await (cell(w, 'title') as RowWrapper).setValue(NEW_TITLE + ' two')
      expect(localStorage.getItem(CARD_KEY), 'editing must not reach the card before the save').toBe(before)
      // 三条"看着像保存"的路：失焦 / 回车 / 换形态再换回来 —— 一条都不许落盘
      await (cell(w, 'title') as RowWrapper).trigger('blur')
      await (cell(w, 'title') as RowWrapper).trigger('keydown', { key: 'Enter' })
      await pickRow(w, PICK_MIX)
      expect(w.find('[data-display-form]').exists(), 'the third form must give the mid column back').toBe(
        false,
      )
      await openDisplay(w)
      expect(localStorage.getItem(CARD_KEY), 'only the top-bar save may write the card').toBe(before)
      await pickBlock(w, 0)
      expect(valueOf(cell(w, 'title')), 'the draft of the first declaration was dropped').toBe(NEW_TITLE)
      await save(w)
      const want = copyOf()
      want.display.sidebar[0].title = NEW_TITLE
      want.display.sidebar[1].title = NEW_TITLE + ' two'
      expect(storedRaw(), 'one save must land every draft that was typed').toEqual(want)
    })
  })

  /** G6 · 空态有话说、坏值不用救：`sidebar: []` ⇒ 明说"没有这一块"；坏值载入本来就失败（守卫） */
  it('G6 an empty sidebar says so, and a bad declaration never reaches the screen', async () => {
    const empty = parseCard(readFileSync(LONG_NIGHT_CARD, 'utf8'))
    expect(empty.display.sidebar, 'this fixture must declare an empty sidebar').toEqual([])
    await onEditor(async (w) => {
      await openDisplay(w)
      expect(blockIndexes(w), 'a card that declares no block must draw no row').toEqual([])
      const none = w.find('[data-display-none]')
      expect(none.exists(), 'nothing declared and nothing said: "no block" looks like "broken"').toBe(true)
      expect(none.text().trim(), 'the empty state must be the sentence of the locale').toBe(
        String(i18n.global.t('card.displayNone')),
      )
      for (const name of ['zh-CN', 'en']) {
        const sentence = localeOf(name).card?.displayNone
        expect(typeof sentence, name + ' has no card.displayNone: it would show the key').toBe('string')
      }
      expect(w.find('[data-display-add]').exists(), 'the empty state must still hand out the plus').toBe(true)
    }, empty)
    const bad = copyOf()
    bad.display.sidebar[0].side = 'middle'
    expect(() => parseCard(JSON.stringify(bad)), 'the card must refuse a side it does not know').toThrow(
      /display\.sidebar\[0\]\.side/,
    )
    bad.display.sidebar[0].side = 'left'
    bad.display.sidebar[0].format = 'table'
    expect(() => parseCard(JSON.stringify(bad)), 'the card must refuse a format it does not know').toThrow(
      /display\.sidebar\[0\]\.format/,
    )
  })

  /**
   * 🔴 C-2（S3 的阻塞条件）· `[data-display-on]` 在此之前**零覆盖**：契约 §二 `:35` 写着"至多一行带它"，
   * 实现也在，但判据全文没出现过那个名字。两个方向都断：没选中时一个都没有（`:36`）、选中时恰好一个且是它；
   * 顺带断明细块恰好一块（N3 与 C-2 同一处 —— `readEntry` 用 `find`，多画一块它看不出来）。
   * ⚠️ 读数一律 `expect.soft`：硬断言撞到第一条就停，后面几条**一次都没被评到**（票 74 的教训）。
   */
  it('C2/N3 the picked row is the only one marked, and there is exactly one detail block', async () => {
    const other = declared.length - 1
    expect(other, 'needs a second declaration to move the mark onto').toBeGreaterThan(0)
    await onEditor(async (w) => {
      /** 亮着的那几行的条号（选择器收在第三形态里 —— 断的是"这一屏亮着谁"） */
      const on = (): string[] =>
        w
          .findAll('[data-display-form] [data-display-on]')
          .map((el) => el.attributes('data-display-block') ?? '')
      await openDisplay(w)
      expect.soft(on(), 'a row is marked before anything was picked').toEqual([])
      await pickBlock(w, 0)
      expect.soft(on(), 'the row being edited is not the only marked one').toEqual(['0'])
      expect.soft(w.findAll('[data-display-entry]').length, 'the detail must be exactly one block').toBe(1)
      await pickBlock(w, other)
      expect.soft(on(), 'the mark did not move onto the row being edited').toEqual([String(other)])
      expect.soft(w.findAll('[data-display-entry]').length, 'a second detail block stayed behind').toBe(1)
    })
  })
})
