// @vitest-environment jsdom
/**
 * 票 8d-② · S1（2026-09-26）：第四栏「公共提示词」+ 中栏**第四种形态「编公共提示词」**的组件层判据。
 *
 * 契约 `.team/test/2026-09-26/contract-8d2.md`（G1–G6 → 判据、"红在哪"、覆盖边界都在那儿）。
 * 🔴 **功能还没做 ⇒ 落地即红**：红在「第四栏交不出进第四形态的入口 / 中栏编不了那段正文」上，**不是**"模块找不到"。
 * ⚠️ 实现是 `CardEditor.vue` 内部 import 的两个件 —— **`src/components/PromptForm.vue`**（那一屏的表单）与
 *    **`src/components/usePromptDraft.ts`**（那一族的草稿，照 `useDisplayDraft.ts` 的三件套形状）：「换内容不换接缝」
 *    由这条钉住；`.githooks/pre-commit` 的检查 6 也要这两个名字出现在 `tests/` 里（**名字由 S2 定**）。
 * ⚠️ 期望值全部从卡与 locale 现取；字符串一律 ASCII；几何 / 点按区归 `e2e/`（组长跑）。
 * ⚠️ **导航不抛**：拿不到东西就交给调用方**自己那一句**去断 ⇒ 功能没做时红点分散在各条判据上，
 *    不是八条全落同一句（8d-① 的病，S3 点过名）。
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import { parseCard, type CardData } from '../src/game/card'
import { i18n } from '../src/i18n'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { CARD_KEY } from './support/card-resources'
import { save, storedRaw, type AnyWrapper, type CardJson, type RowWrapper } from './support/branch-tree'
import { label } from './support/trace-blocks'

/** 示例卡：本件全部期望值的来源（五块设定的声明序 · `script` 那棵对象 · `convention` 那个数组） */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
/** 五块设定的键，**按卡的声明序**（`settings` 是固定五键的对象，`card.ts:159`） */
const SETTING_KEYS = Object.keys(card.settings)
/** 卡里某一块设定的行数组（`Settings` 的键是固定的，这里按名字取） */
function block(key: string): string[] {
  return (card.settings as unknown as Record<string, string[]>)[key]
}
/** 第四栏那 7 条：五块设定 + 剧本 + 节点约定（顺序照 `CardResources.vue:41-49`） */
const ENTRIES = [
  ...SETTING_KEYS.map((key) => ({ id: key, body: block(key).join('\n') })),
  { id: 'script', body: JSON.stringify(card.script, null, 2) },
  { id: 'convention', body: card.convention.join('\n') },
]
/** 那 7 条的 id，按屏幕上的顺序 */
const IDS = ENTRIES.map((one) => one.id)
/** 那 7 条的名字在界面上从哪来：五块走 `prompts.settingBlock.<键>`，另两条各一个键 */
const LABELS: Record<string, string> = Object.fromEntries([
  ...SETTING_KEYS.map((key) => [key, 'prompts.settingBlock.' + key]),
  ['script', 'prompts.script'],
  ['convention', 'prompts.convention'],
])
/** 判据自己打进去的字（测试里的字符串字面量一律 ASCII） */
const TYPED_LINE = 'a prompt line typed for ticket 8d-2'
const NEW_TRUTH_KEY = 'added_by_the_prompt_ticket'
const NEW_TRUTH = 'a truth the prompt ticket added'
/** 一段**不是**合法 JSON 的正文（`JSON.parse` 会当场抛的那种） */
const BAD_JSON = '{ "truth": '

/** 那一条的正文 —— 本件期望值唯一的那处来源（取不到当场红，不静默变空串） */
function bodyOf(id: string): string {
  const found = ENTRIES.find((one) => one.id === id)
  expect(found !== undefined, 'this card has no entry called ' + id).toBe(true)
  return (found as { body: string }).body
}

/** 那一条的行数（正文按 `\n` 数 —— 五块/约定 = 数组长度，`script` = 那段 JSON 文本的行数） */
function linesOf(id: string): string {
  return String(bodyOf(id).split('\n').length)
}

/** 一份卡的 JSON（读落盘结果时用它） */
function copyOf(): CardJson {
  return JSON.parse(JSON.stringify(card)) as CardJson
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

/** 开第四栏：顶栏那颗开合按钮（外壳照旧，本票不改它的开合语义） */
async function openPrompts(w: AnyWrapper): Promise<void> {
  const button = w.find('[data-top] [data-card-resources-open]')
  expect(button.exists(), 'the top bar hands out no toggle for the prompts column').toBe(true)
  await button.trigger('click')
}

/** 第四栏那几行的条号（按显示顺序） */
function rowIds(w: AnyWrapper): string[] {
  return w
    .findAll('[data-col="prompts"] [data-prompt-row]')
    .map((el) => el.attributes('data-prompt-row') ?? '')
}

/** 第四栏里那一条（取不到就是 `null` —— 缺的那一件由调用方自己断） */
function rowFor(w: AnyWrapper, id: string): RowWrapper | null {
  const row = w.find('[data-col="prompts"] [data-prompt-row="' + id + '"]')
  return row.exists() ? row : null
}

/**
 * 走进第四形态：点第四栏那一条。
 *
 * ⚠️ **它不抛也不断**：拿不到那一行就什么都不点 —— 于是"第四栏没有这一条"与"中栏没长出第四形态"
 * 这两件事分别由调用方的两句断言各自负责，红点才不会全落在这里。
 */
async function enterPrompt(w: AnyWrapper, id: string): Promise<void> {
  const row = rowFor(w, id)
  if (row !== null) await row.trigger('click')
}

/** 中栏那个第四形态（不在就是 `null`） */
function promptForm(w: AnyWrapper): RowWrapper | null {
  const form = w.find('[data-mid] [data-prompt-form]')
  return form.exists() ? form : null
}

/** 第四形态里正文那个控件（不在就是 `null`） */
function bodyBox(w: AnyWrapper): RowWrapper | null {
  const box = w.find('[data-prompt-form] [data-prompt-text]')
  return box.exists() ? box : null
}

/** 一个控件的值（不在就是空串 —— 空串会让比较当场红） */
function valueOf(el: RowWrapper | null): string {
  return el === null ? '' : ((el.element as HTMLTextAreaElement).value ?? '')
}

/** 顶栏那颗保存（干净时禁用 —— 这一族的草稿必须也算进 `dirty`） */
function saveButton(w: AnyWrapper): RowWrapper {
  const button = w.find('[data-top] [data-card-save]')
  expect(button.exists(), 'the top bar hands out no save button').toBe(true)
  return button
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the public prompts of the card, edited in the mid column (ticket 8d-2)', () => {
  /**
   * 前提（**今天就是绿的**）：本件挑的那 7 条、以及"行数"这个读数，卡的形状支持得住 ——
   * 免得 S2 落地那天红的是**我的量具**。
   */
  it('premise the seven entries this file leans on are the card own shape', () => {
    expect(IDS, 'the seven entries, in the order the panel draws them').toEqual([
      ...SETTING_KEYS,
      'script',
      'convention',
    ])
    expect(SETTING_KEYS.length, 'this card must declare the five setting blocks').toBe(5)
    expect(Array.isArray(card.convention), 'convention is a line array').toBe(true)
    expect(Array.isArray(card.script), 'script is an object: its body is JSON text').toBe(false)
    for (const id of IDS)
      expect(bodyOf(id).length, 'an empty body: nothing to edit: ' + id).toBeGreaterThan(0)
    // 行数七条互不相同 ⇒ "每条带行数"那个读数不可能靠一个常数通过（写死 26 也满足不了）
    expect(new Set(IDS.map(linesOf)).size, 'two entries share a line count: a constant would pass').toBe(
      IDS.length,
    )
    // 空行是**合法**的正文（`requireTextList` 只拒空表，`card-read.ts:53`）⇒ 逐字比较必须容得下它
    expect(bodyOf(SETTING_KEYS[3]), 'this block must keep an empty line').toContain('\n\n')
  })

  /** G1 · 第四栏列出那 7 条：一条一行、按卡的声明序、每条带行数；没选中时一行都不亮 */
  it('G1 the fourth column lists the seven entries, in card order, each with its line count', async () => {
    await onEditor(async (w) => {
      await openPrompts(w)
      expect(rowIds(w), 'the fourth column hands out no list of the public prompts').toEqual(IDS)
      expect.soft(rowFor(w, IDS[0])?.element.tagName, 'a row must be a real button').toBe('BUTTON')
      expect
        .soft(w.findAll('[data-col="prompts"] [data-prompt-on]').length, 'a row is marked too early')
        .toBe(0)
      for (const id of IDS) {
        const row = rowFor(w, id) as RowWrapper
        const count = row.findAll('[data-prompt-lines]')
        expect.soft(count.length, 'exactly one line count per row: ' + id).toBe(1)
        expect
          .soft(count.length === 1 ? count[0].text().trim() : '', 'the line count of ' + id)
          .toBe(linesOf(id))
        expect.soft(row.text(), 'the row must name what it stands for: ' + id).toContain(label(LABELS[id]))
      }
    })
  })

  /** G2 · 点一条 ⇒ 中栏长出**第四种形态**：表头写明编的是哪一个、正文就是卡里那一段 */
  it('G2 picking a row turns the mid column into the fourth form, headed by that entry', async () => {
    await onEditor(async (w) => {
      await openPrompts(w)
      await enterPrompt(w, IDS[0])
      expect(promptForm(w), 'no fourth form in the mid body [data-mid] after picking a row').not.toBe(null)
      expect(promptForm(w)?.attributes('data-prompt-id'), 'the form is about another entry').toBe(IDS[0])
      const head = w.find('[data-prompt-form] [data-prompt-head]')
      expect.soft(head.exists(), 'the fourth form hands out no head').toBe(true)
      const said = head.exists() ? head.text() : ''
      expect.soft(said, 'the head must name the entry being edited').toContain(label(LABELS[IDS[0]]))
      expect.soft(said, 'the head must say what kind of thing this is').toContain(label('card.shellPrompts'))
      expect
        .soft(valueOf(bodyBox(w)), 'the body must be that entry of the card, verbatim')
        .toBe(bodyOf(IDS[0]))
      // 选中态：恰好一行亮着、而且是它（8d-① 的 `C2/N3` 欠过这一条，这里一开始就带上）
      const marked = (): Array<string | undefined> =>
        w.findAll('[data-col="prompts"] [data-prompt-on]').map((el) => el.attributes('data-prompt-row'))
      expect.soft(marked(), 'the entry being edited must be the only marked row').toEqual([IDS[0]])
      // 另三形态与它互斥（那三条是 8c / 8d-① 的地盘，这一句只断"让位"）
      for (const gone of [
        '[data-step-form]',
        '[data-branch-form]',
        '[data-display-form]',
        '[data-branch-none]',
      ]) {
        expect.soft(w.find(gone).exists(), 'the fourth form shares the mid column with ' + gone).toBe(false)
      }
      // 换一条 ⇒ 表头、正文、标记都跟着换；`script` 那一条的正文是 JSON 文本
      await enterPrompt(w, 'script')
      expect(promptForm(w)?.attributes('data-prompt-id'), 'the form did not follow the pick').toBe('script')
      expect
        .soft(w.find('[data-prompt-head]').text(), 'the head did not follow the pick')
        .toContain(label('prompts.script'))
      expect
        .soft(valueOf(bodyBox(w)), 'the script body must be the JSON text of the card')
        .toBe(bodyOf('script'))
      expect.soft(marked(), 'the mark did not move onto the entry being edited').toEqual(['script'])
    })
  })

  /**
   * 🔴 G3 · 第四栏**不再挂**那套走 `importCard` 的面板 —— 那条路绕过草稿、成功即 reload
   * （票 78/81 那一族"手里的草稿会无声消失"的老问题），本票把它关掉。
   *
   * ⚠️ 它与别的判据**不同源**：报文说的是"旧开口还开着"，不是"新入口没做出来"。
   */
  it('G3 the fourth column no longer hangs the importCard panel, whose write bypassed the draft', async () => {
    await onEditor(async (w) => {
      await openPrompts(w)
      expect
        .soft(
          w
            .findAll('[data-col="prompts"] [data-card-resource]')
            .map((el) => el.attributes('data-card-resource')),
          'the fourth column still hangs the old panel: its write path is importCard, not the draft',
        )
        .toEqual([])
      expect
        .soft(
          w.findAll('[data-col="prompts"] [data-card-resource-save]').length,
          'the old save-to-card button is still on screen',
        )
        .toBe(0)
      expect.soft(rowIds(w).length, 'the fourth column hands out no rows at all').toBeGreaterThan(0)
    })
  })

  /** G3/R4 · 写路径只有一条：改动进草稿、顶栏那颗保存才落盘（失焦 / 回车 / 换条都不许落盘） */
  it('G3/R4 the only way to the card is the draft plus the top-bar save', async () => {
    const before = localStorage.getItem(CARD_KEY)
    await onEditor(async (w) => {
      await openPrompts(w)
      await enterPrompt(w, IDS[0])
      const box = bodyBox(w)
      expect(box, 'no body to type into: the fourth form is not there').not.toBe(null)
      await (box as RowWrapper).setValue(bodyOf(IDS[0]) + '\n' + TYPED_LINE)
      expect(
        saveButton(w).attributes('disabled'),
        'a pending change must make the save usable',
      ).toBeUndefined()
      // 三条"看着像保存"的路：失焦 / 回车 / 换一条再换回来
      await (box as RowWrapper).trigger('blur')
      await (box as RowWrapper).trigger('keydown', { key: 'Enter' })
      await enterPrompt(w, 'convention')
      expect(localStorage.getItem(CARD_KEY), 'editing must not reach the card before the save').toBe(before)
      await enterPrompt(w, IDS[0])
      expect
        .soft(valueOf(bodyBox(w)), 'the draft of this entry was dropped')
        .toBe(bodyOf(IDS[0]) + '\n' + TYPED_LINE)
      await save(w)
      const want = copyOf()
      want.settings[IDS[0]] = (bodyOf(IDS[0]) + '\n' + TYPED_LINE).split('\n')
      expect(storedRaw(), 'exactly that one block changed, and nothing else').toEqual(want)
      expect(w.emitted('saved'), 'a save must tell the shell it happened').toHaveLength(1)
    })
  })

  /**
   * 🔴 G4 · `script` 那一条的坏值**拦在草稿层**：一句人话、不许抛、更不许把坏值写进卡。
   *
   * 口径（契约 §二）：那句人话进 `[data-prompt-error]`（这一屏自己的那一块），**不走**
   * `[data-card-error]` —— 走到后者就等于"交给 `importCard` 去发现"，正是这一条要拦的事。
   */
  it('G4 a script body that is not valid JSON is refused by the draft, not by the card', async () => {
    const before = localStorage.getItem(CARD_KEY)
    await onEditor(async (w) => {
      await openPrompts(w)
      await enterPrompt(w, 'script')
      const box = bodyBox(w)
      expect(box, 'no script body to type a bad JSON into: the fourth form is not there').not.toBe(null)
      // 前提：那句人话两份 locale 都要有（少了它，下面那句会拿 key 名当真话读）
      for (const name of ['zh-CN', 'en']) {
        const copy = JSON.parse(readFileSync('src/locales/' + name + '.json', 'utf8')) as Record<string, any>
        expect(typeof copy.card?.promptBadJson, name + ' has no card.promptBadJson').toBe('string')
      }
      expect(
        w.find('[data-prompt-error]').exists(),
        'the refusal is on screen before anything went wrong',
      ).toBe(false)
      await (box as RowWrapper).setValue(BAD_JSON)
      expect(
        saveButton(w).attributes('disabled'),
        'a pending change must make the save usable',
      ).toBeUndefined()
      await save(w)
      const said = w.find('[data-prompt-error]')
      expect.soft(said.exists(), 'a bad JSON body was refused without a word').toBe(true)
      expect
        .soft(said.exists() ? said.text().trim() : '', 'the reason must be the sentence of the locale')
        .toContain(label('card.promptBadJson'))
      expect
        .soft(w.find('[data-card-error]').exists(), 'this is the draft layer talking, not the card')
        .toBe(false)
      expect.soft(localStorage.getItem(CARD_KEY), 'a refused save must not touch storage').toBe(before)
      expect.soft(w.emitted('saved'), 'nothing was saved, so nothing may be announced').toBeUndefined()
      expect.soft(valueOf(bodyBox(w)), 'the draft must survive the refusal verbatim').toBe(BAD_JSON)
      // 改回合法 JSON ⇒ 那句话跟着正文走，保存就落盘（"坏值拦得住、好值放得行"的对照）
      const good = { ...card.script, [NEW_TRUTH_KEY]: NEW_TRUTH }
      await (bodyBox(w) as RowWrapper).setValue(JSON.stringify(good, null, 2))
      expect.soft(w.find('[data-prompt-error]').exists(), 'the message stayed behind').toBe(false)
      await save(w)
      expect(storedRaw().script, 'the good JSON must land in the card').toEqual(good)
    })
  })

  /**
   * 🔴 G4b · **清空一段行数组正文 = 合法**（组长 2026-09-26 裁的口径 —— **这是改口径，不是漏**）。
   *
   * 依据：卡自己只拒**空表**（`card-read.ts:53`：`lines.length === 0` 才拒，一行空串合法）
   * ⇒ **界面不许比引擎严**。⇒ 退休面板那条「这一项不能留空」（`card.resourceEmpty`）**不继承**：
   *    旧路是"面板拒绝存空"，新路下**空是合法的**。
   * ⚠️ 反面控制（同一句里，免得"一律不报错"也满足前一半）：清空 `script` **确实**是坏值 ——
   *    `JSON.parse('')` 会抛，所以它报的是**不是合法 JSON** 那句话。
   */
  it('G4b clearing a line-array entry is legal: no complaint, and it lands in the card', async () => {
    await onEditor(async (w) => {
      await openPrompts(w)
      await enterPrompt(w, IDS[0])
      const box = bodyBox(w)
      expect(box, 'no body to clear: the fourth form is not there').not.toBe(null)
      await (box as RowWrapper).setValue('')
      expect
        .soft(w.find('[data-prompt-error]').exists(), 'an empty body was treated as a bad value')
        .toBe(false)
      expect(
        saveButton(w).attributes('disabled'),
        'a pending change must make the save usable',
      ).toBeUndefined()
      // 真裁判（前提）：卡自己收得下「一块空正文」这一份 —— "界面不许比引擎严"这句拿它当尺子
      const want = copyOf()
      want.settings[IDS[0]] = ['']
      expect(() => parseCard(JSON.stringify(want)), 'the card itself refuses an empty block').not.toThrow()
      await save(w)
      const stored = localStorage.getItem(CARD_KEY)
      expect.soft(stored, 'the save never reached the card').not.toBe(null)
      expect
        .soft(
          stored === null ? null : (JSON.parse(stored) as CardJson),
          'the empty body must land verbatim, and nothing else may change',
        )
        .toEqual(want)
      expect.soft(w.emitted('saved'), 'a save must tell the shell it happened').toHaveLength(1)
      // 反面控制：清空 `script` 是**真的**坏值（空串过不了 `JSON.parse`）
      await enterPrompt(w, 'script')
      await (bodyBox(w) as RowWrapper).setValue('')
      const said = w.find('[data-prompt-error]')
      expect.soft(said.exists(), 'an empty script body is not valid JSON either').toBe(true)
      expect
        .soft(said.exists() ? said.text() : '', 'the retired empty-guard sentence is still speaking')
        .toContain(label('card.promptBadJson'))
    })
  })

  /** G6 · 外壳骨架与 8d-① 那屏都不动：四栏照旧、开合照旧、四条轴互斥（两向都断） */
  it('G6 the shell skeleton stands, and the four forms exclude each other both ways', async () => {
    await onEditor(async (w) => {
      // 外壳那一层照旧（`EditorShell.vue` 543 行、余量 7 ⇒ 本票尽量一字节不改）
      for (const kept of ['[data-top] [data-card-resources-open]', '[data-top] [data-card-save]']) {
        expect.soft(w.find(kept).exists(), 'the shell lost a top-bar control: ' + kept).toBe(true)
      }
      for (const col of ['content', 'flow', 'edit', 'prompts']) {
        expect.soft(w.find('[data-col="' + col + '"]').exists(), 'the shell lost a column: ' + col).toBe(true)
      }
      expect.soft(w.findAll('[data-ruler-seg]').length, 'the four-column ruler changed').toBe(4)
      // 关着时第四栏还是那句提示、不开列表（开合语义照旧）
      expect.soft(rowIds(w).length, 'the fourth column lists rows while it is closed').toBe(0)
      await openPrompts(w)
      expect.soft(rowIds(w).length, 'the toggle opened no list of the public prompts').toBeGreaterThan(0)
      await openPrompts(w)
      expect.soft(rowIds(w).length, 'the toggle no longer closes the fourth column').toBe(0)
      expect
        .soft(w.find('[data-col="prompts"]').text(), 'the closed column must say how to open it')
        .toContain(label('card.promptsClosed'))
      // 反向：进第四形态之后，点左栏那颗 ⇒ 第三形态回来、第四形态让位
      await openPrompts(w)
      await enterPrompt(w, IDS[1])
      expect(promptForm(w), 'the fourth form is not there to give the column back').not.toBe(null)
      await w.find('[data-display-open]').trigger('click')
      expect.soft(w.find('[data-mid] [data-display-form]').exists(), 'the third form is gone').toBe(true)
      expect.soft(promptForm(w), 'the fourth form did not give the mid column back').toBe(null)
      // 反向：点细条上的一步 ⇒ 第四形态同样让位
      await w.find('[data-step="' + card.graph.topology[0] + '"]').trigger('click')
      expect.soft(w.find('[data-mid] [data-step-form]').exists(), 'the step form is gone').toBe(true)
      expect.soft(promptForm(w), 'the fourth form survived a pick on another axis').toBe(null)
    })
  })
})
