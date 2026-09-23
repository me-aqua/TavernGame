// @vitest-environment jsdom
/**
 * 票 78：「存回卡」与「关窗 / 刷新」不许**无声吞掉**那份没保存的草稿 —— 判据（组件层）。
 *
 * 契约 `.team/test/2026-09-23/contract-78.md` §1（触发条件 · 两条出路 · DOM / i18n / `beforeunload`
 * 三张表）与 §2 的 **D1–D14**；口径源 `.team/leader/2026-09-23/票78-S0.md` 的 **R1–R8**。
 * 这一件管三样：
 *   · 面板那颗「存回卡」碰到**脏草稿**要先问一句，**干净时一个字都不问**（两半都在）；
 *   · 「取消」之后草稿逐字还在、`dirty` 仍真、**面板那一次写照样落盘**；「继续」才放行重载；
 *   · 关窗 / 刷新只在**有草稿**时拦，干净时**不注册**那个监听。
 *
 * ⚠️ **判据挂在 `CardEditor.vue` 这个现成的接缝上**（`step-form-dom.test.ts:11` 已经这么挂）：
 *    条子是它自己模板里的一段，但必须能被 `CardEditor` 渲染出来 —— 这条钉住的是「换内容不换接缝」，
 *    也让"功能没做"的红落在**钩子不在**上，不是"模块找不到"上。
 * ⚠️ **"重载被放行"一律读 `emitted('saved')`**：不挂 `App`、不 mock `location.reload`
 *    （`App.vue:182` 直接调它，jsdom 里那是 `Not implemented: navigation` ⇒ 测不到还容易假绿）。
 * ⚠️ **期望值全部从卡与 locale 现取**：一个中文键名、一句中文字面量都不手写
 *    （`.githooks/checks/ascii.mjs` 连 `tests/` 里的字符串一起拦；文案只住在 `src/locales/*.json`）。
 * 🔴 **凡断"没有 / 数 = 0"的地方都自带前提**（先证明"这一屏真的长得出来"），
 *    免得"读不到东西"被读成"通过" —— 票 71 那族债的教训。**守卫不等于判别**，见契约 §2.1 的报数口径。
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import { parseCard } from '../src/game/card'
import { i18n } from '../src/i18n'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { CARD_KEY } from './support/card-resources'
import { PICK_A, declaredOrder, noteBox, type AnyWrapper, type RowWrapper } from './support/branch-tree'
import { label, setLocale } from './support/trace-blocks'

/** 示例卡（拓扑、设定块、字段名全部从它现算，不抄第二份） */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))

/** 拓扑的第一步（造「编一步」那一族的脏用它） */
const FIRST_STEP = card.graph.topology[0]

/** 卡里第一块设定（面板那条写路径改的就是它） */
const FIRST_BLOCK = Object.keys(card.settings)[0]

/** 判据自己打进去的字（测试里的字符串字面量一律 ASCII） */
const TYPED_NAME = 'a draft name typed for ticket 78'
const TYPED_NOTE = 'a note draft typed for ticket 78'
const TYPED_RESOURCE = 'a resource line typed for ticket 78'

/** 这一件里**当前**挂着的那一版编辑器（挂出来的东西一律收摊：收尾要 `unmount`，挂在 `document.body` 上） */
let mounted: VueWrapper | null = null

afterEach(() => {
  // ⚠️ **必须 `unmount`，不能只清 DOM**：`beforeunload` 那条守卫挂在**共享的 `window`** 上，
  //    只清 DOM 的话前一条用例留下的脏编辑器还挂着监听 ⇒ D8 那半条"干净编辑器不许拦"
  //    读到的 `defaultPrevented` 是**上一条用例**留下的真相（票 78 的 S2 撞出来的）。
  //    真产品里同时只有一个编辑器，所以"先卸干净"才是忠实的隔离。
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** 挂一版真编辑器（卡与来源从 props 进；挂到 body 上，卸载时生命周期跑得完整） */
function mountEditor(): AnyWrapper {
  mounted = mount(CardEditor, {
    props: { card, source: 'builtin' },
    global: { plugins: [i18n] },
    attachTo: document.body,
  }) as AnyWrapper
  return mounted
}

/** 那条确认条（不在 = `exists()` 假 —— 判据读的就是这个"在不在"） */
function bar(w: AnyWrapper): RowWrapper {
  return w.find('[data-editor-confirm]')
}

/** 顶栏那颗「保存」：**干净时它是禁用的** —— `dirty` 的可观察读数是它 */
function saveButton(w: AnyWrapper): RowWrapper {
  const button = w.find('[data-top] [data-card-save]')
  expect(button.exists(), 'the top bar hands out no save button').toBe(true)
  return button
}

/** 这一刻编辑器脏不脏（顶栏那颗按钮能不能按）—— 契约 §1.4 里"dirty 仍为真"的读法 */
function editorIsDirty(w: AnyWrapper): boolean {
  return saveButton(w).attributes('disabled') === undefined
}

/** 开提示词资源面板（顶栏那一颗开合它的按钮） */
async function openPanel(w: AnyWrapper): Promise<void> {
  const button = w.find('[data-card-resources-open]')
  expect(button.exists(), 'the top bar hands out no resource-panel toggle').toBe(true)
  await button.trigger('click')
}

/** 面板那条写路径：展开一块设定 → 改正文 → 点「存回卡」 */
async function saveResource(w: AnyWrapper, id: string, text: string): Promise<void> {
  const item = '[data-card-resource="' + id + '"]'
  expect(w.find(item).exists(), 'the panel lists no resource called ' + id).toBe(true)
  await w.find(item + ' [data-card-resource-open]').trigger('click')
  await w.find(item + ' [data-card-resource-text]').setValue(text)
  await w.find(item + ' [data-card-resource-save]').trigger('click')
}

/** 细条上点一步（「编一步」那一族的入口） */
async function pickStep(w: AnyWrapper, id: string): Promise<void> {
  const step = w.find('[data-step="' + id + '"]')
  expect(step.exists(), 'no step for this node in the strip: ' + id).toBe(true)
  await step.trigger('click')
}

/** 那一屏「名」那一格（草稿的可观察读数就是它里面的值） */
function stepNameBox(w: AnyWrapper): RowWrapper {
  const box = w.find('[data-step-form] [data-step-block="name"] input')
  expect(box.exists(), 'the step screen hands out no name box').toBe(true)
  return box
}

/** 左栏树上点一行（说明 / 加字段那两族草稿的入口） */
async function pickBranch(w: AnyWrapper, path: string): Promise<void> {
  const row = w.find('[data-branch-node="' + path + '"]')
  expect(row.exists(), 'no row for this state node in the tree: ' + path).toBe(true)
  await row.trigger('click')
}

/**
 * 造一份脏草稿 —— **来源①**：「编一步」那一族（改一步的名）。
 *
 * ⚠️ 三个来源各喂一次不是啰嗦：`dirty` 是**并集**（`CardEditor.vue:223`），
 *    只认其中一族（"编一步"）的实现会过 D1 而漏掉 D2/D3 —— 那正是 S0 §六 点名的那个风险。
 */
async function dirtyByStep(w: AnyWrapper): Promise<void> {
  await pickStep(w, FIRST_STEP)
  await stepNameBox(w).setValue(TYPED_NAME)
  expect(editorIsDirty(w), 'editing a step did not make the editor dirty').toBe(true)
}

/** 造一份脏草稿 —— **来源②**：说明草稿（与「编一步」无关的那一族：`touched`） */
async function dirtyByNote(w: AnyWrapper): Promise<void> {
  await pickBranch(w, PICK_A)
  const key = declaredOrder(PICK_A)[0]
  expect(key, 'this node has no field to write a note on').not.toBe(undefined)
  await noteBox(w, PICK_A, key).setValue(TYPED_NOTE)
  expect(editorIsDirty(w), 'editing a note did not make the editor dirty').toBe(true)
}

/** 造一份脏草稿 —— **来源③**：表尾那颗「＋」开出来的新行（`fresh`：还没落过盘的那一行） */
async function dirtyByFreshRow(w: AnyWrapper): Promise<void> {
  await pickBranch(w, PICK_A)
  const plus = w.find('[data-field-add]')
  expect(plus.exists(), 'the table hands out no add-a-field entry').toBe(true)
  await plus.trigger('click')
  expect(w.find('[data-row-new]').exists(), 'the plus opened no new row').toBe(true)
  expect(editorIsDirty(w), 'an unsaved new row did not make the editor dirty').toBe(true)
}

/** 把面板那段正文改掉再存回卡（四条判别用例的公共开头） */
async function stashDraftThenSaveResource(w: AnyWrapper, kind: string): Promise<void> {
  await openPanel(w)
  if (kind === 'step') await dirtyByStep(w)
  else if (kind === 'note') await dirtyByNote(w)
  else await dirtyByFreshRow(w)
  // 前提：点之前**没有**条 —— 它是被这一下点出来的，不是常驻的
  expect(bar(w).exists(), 'the confirm bar must not be there before anything asked for it').toBe(false)
  await saveResource(w, FIRST_BLOCK, TYPED_RESOURCE)
}

/** 往 window 上派发一个**可取消**的 `beforeunload`：true ⇔ 有人 `preventDefault` 过 */
function beforeUnloadPrevented(): boolean {
  return window.dispatchEvent(new Event('beforeunload', { cancelable: true })) === false
}

/**
 * 装一对 `addEventListener` / `removeEventListener` 探针，返回"净剩几个 `beforeunload` 监听"。
 *
 * D9 与 D14 共用**同一支量具**（一个断"脏了才挂、卸载要摘"，一个断"答应丢掉之后要摘掉"）——
 * 各写一份必然走偏。它量的是**挂没挂**（行为那一半由 D8 的派发探针管）。
 */
function countBeforeUnloadGuards(): () => number {
  const add = vi.spyOn(window, 'addEventListener')
  const remove = vi.spyOn(window, 'removeEventListener')
  return () =>
    add.mock.calls.filter((call) => call[0] === 'beforeunload').length -
    remove.mock.calls.filter((call) => call[0] === 'beforeunload').length
}

describe('R1 the panel write asks before it throws a draft away', () => {
  it('D1 asks when the step draft is dirty, and does not let the reload through', async () => {
    const w = mountEditor()
    await stashDraftThenSaveResource(w, 'step')

    expect(bar(w).exists(), 'saving the panel over a dirty draft must ask first').toBe(true)
    expect(
      w.emitted('saved'),
      'the reload must not be let through while the question is open',
    ).toBeUndefined()
  })

  it('D2 asks for a dirty note draft as well (the union, not just the step family)', async () => {
    const w = mountEditor()
    await stashDraftThenSaveResource(w, 'note')
    // 反面：这一条不许靠「编一步」那一族脏起来（两条轴都空着）
    expect(w.findAll('[data-step-on]').length, 'this check must not lean on the step family').toBe(0)

    expect(bar(w).exists(), 'a dirty note draft is a dirty draft: it must ask too').toBe(true)
    expect(
      w.emitted('saved'),
      'the reload must not be let through while the question is open',
    ).toBeUndefined()
  })

  it('D3 asks for an unsaved new row as well (the third source of the union)', async () => {
    const w = mountEditor()
    await stashDraftThenSaveResource(w, 'fresh')
    expect(w.findAll('[data-step-on]').length, 'this check must not lean on the step family').toBe(0)

    expect(bar(w).exists(), 'an unsaved new row is a dirty draft: it must ask too').toBe(true)
    expect(
      w.emitted('saved'),
      'the reload must not be let through while the question is open',
    ).toBeUndefined()
  })
})

describe('R4 a clean editor is never asked', () => {
  it('D4 goes straight through when nothing is unsaved', async () => {
    const w = mountEditor()
    await openPanel(w)
    // 前提：这一刻真的是干净的（顶栏那颗按钮按不动），而且还没有条
    expect(editorIsDirty(w), 'nothing was changed yet, so the editor must be clean').toBe(false)
    expect(bar(w).exists(), 'the confirm bar must not be there before anything asked for it').toBe(false)

    await saveResource(w, FIRST_BLOCK, TYPED_RESOURCE)

    expect(bar(w).exists(), 'a clean hand must not be asked anything').toBe(false)
    expect(w.emitted('saved'), 'the reload must go through right away').toHaveLength(1)
  })
})

describe('R3 / R2 the two ways out of the question', () => {
  it('D5 continuing lets the reload through, exactly once', async () => {
    const w = mountEditor()
    await stashDraftThenSaveResource(w, 'step')

    const go = w.find('[data-editor-confirm] [data-editor-confirm-continue]')
    expect(go.exists(), 'the bar hands out no continue button (is the bar there at all?)').toBe(true)
    await go.trigger('click')

    expect(bar(w).exists(), 'the bar must step aside once the question is answered').toBe(false)
    expect(w.emitted('saved'), 'continuing is what lets the reload through').toHaveLength(1)
  })

  it('D6 cancelling keeps the draft verbatim and keeps the editor dirty', async () => {
    const w = mountEditor()
    await stashDraftThenSaveResource(w, 'step')

    const cancel = w.find('[data-editor-confirm] [data-editor-confirm-cancel]')
    expect(cancel.exists(), 'the bar hands out no cancel button (is the bar there at all?)').toBe(true)
    await cancel.trigger('click')

    expect(bar(w).exists(), 'the bar must step aside once the question is answered').toBe(false)
    expect(w.emitted('saved'), 'cancel must not let the reload through').toBeUndefined()
    expect(
      (stepNameBox(w).element as HTMLInputElement).value,
      'the draft in the box must survive the cancel verbatim',
    ).toBe(TYPED_NAME)
    expect(editorIsDirty(w), 'the draft must still be dirty after a cancel').toBe(true)
  })

  it('D7 keeps the panel write on disk while the draft stays out of it', async () => {
    const w = mountEditor()
    await stashDraftThenSaveResource(w, 'step')
    const cancel = w.find('[data-editor-confirm] [data-editor-confirm-cancel]')
    expect(cancel.exists(), 'no cancel button to answer the question with (is the bar there at all?)').toBe(
      true,
    )
    await cancel.trigger('click')

    const text = localStorage.getItem(CARD_KEY)
    expect(text, 'the panel write must have hit the card storage').not.toBe(null)
    const stored = JSON.parse(text as string) as Record<string, any>
    expect(
      stored.settings[FIRST_BLOCK],
      'the block the panel saved must be on disk verbatim, cancel or not',
    ).toEqual([TYPED_RESOURCE])
    // 反面：编辑器那份草稿**不许**跟着落盘（两处写的不是同一样东西）
    expect(stored.graph.nodes[FIRST_STEP].name, 'the editor draft must not travel with the panel write').toBe(
      card.graph.nodes[FIRST_STEP].name,
    )
  })
})

describe('R6 closing the tab is only held back while a draft is open', () => {
  it('D8 lets a clean editor close, and holds a dirty one', async () => {
    const w = mountEditor()
    // 校准：这条探针**看得见** preventDefault 才作数（这一刻应用还没挂任何监听）
    const mine = (event: Event): void => event.preventDefault()
    window.addEventListener('beforeunload', mine)
    expect(beforeUnloadPrevented(), 'the probe cannot observe a prevented unload at all').toBe(true)
    window.removeEventListener('beforeunload', mine)

    expect(beforeUnloadPrevented(), 'a clean editor must not hold the tab back').toBe(false)

    await dirtyByStep(w)
    expect(beforeUnloadPrevented(), 'a dirty draft must hold the tab back').toBe(true)
  })

  it('D9 registers that listener only while a draft is dirty', async () => {
    const live = countBeforeUnloadGuards()

    const w = mountEditor()
    expect(live(), 'a clean editor must not register a beforeunload listener').toBe(0)

    await dirtyByStep(w)
    expect(live(), 'a dirty draft must register one').toBeGreaterThan(0)

    w.unmount()
    expect(live(), 'unmounting must take that listener away again').toBe(0)
  })

  it('D14 continuing takes the tab guard down before the reload goes out', async () => {
    // 加固条（不在 S0 的 R 表里，理由写在契约 §6-⑨）：用户刚说过"丢掉吧"，
    // 那条守卫的**理由**已经用掉了 —— 留着它，重载时会再弹一次浏览器的原生警告，
    // 而那个警告在 Playwright 里是自动 dismiss（= **取消**这次导航）⇒ `E2` 那条也会红。
    const live = countBeforeUnloadGuards()
    const w = mountEditor()
    await stashDraftThenSaveResource(w, 'step')
    expect(live(), 'the guard must be up while the question is open').toBeGreaterThan(0)

    const go = w.find('[data-editor-confirm] [data-editor-confirm-continue]')
    expect(go.exists(), 'the bar hands out no continue button (is the bar there at all?)').toBe(true)
    await go.trigger('click')

    expect(live(), 'the draft was just given up: the tab guard must step down with it').toBe(0)
  })
})

describe('R8 the sentence and the two buttons live in the locale files', () => {
  /** 那条确认 + 两颗按钮的键（判据只认键名，字从 locale 现取） */
  const KEYS = ['card.discardDraft', 'card.discardCancel', 'card.discardContinue']

  /** 两份 locale 文件的原文（直接读文件：光看渲染分不出"两份都有"与"只有 en 那份"） */
  const LOCALES: Record<string, string> = {
    'src/locales/zh-CN.json': readFileSync('src/locales/zh-CN.json', 'utf8'),
    'src/locales/en.json': readFileSync('src/locales/en.json', 'utf8'),
  }

  it('D10 renders all three strings from the locale, in both languages', async () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      setLocale(locale)
      const w = mountEditor()
      await stashDraftThenSaveResource(w, 'step')

      const root = w.find('[data-editor-confirm]')
      expect(root.exists(), locale + ': the bar never showed up, so this check would say nothing').toBe(true)
      expect(root.text(), locale).toContain(label(KEYS[0]))
      const cancel = root.find('[data-editor-confirm-cancel]')
      const go = root.find('[data-editor-confirm-continue]')
      expect(cancel.exists(), locale + ': the bar hands out no cancel button').toBe(true)
      expect(go.exists(), locale + ': the bar hands out no continue button').toBe(true)
      expect(cancel.text(), locale).toBe(label(KEYS[1]))
      expect(go.text(), locale).toBe(label(KEYS[2]))

      w.unmount()
      document.body.innerHTML = ''
    }
    setLocale('zh-CN')
  })

  it('D11 keeps every key in both files, and the English copy is really English', () => {
    /** 那个键在 JSON 里那一行（`card` 那一节里的名字，缩进 + `"name": "…"` 的形状） */
    const lineOf = (text: string, key: string): string =>
      text.split('\n').find((line) => line.trim().startsWith('"' + key.split('.')[1] + '":')) ?? ''
    const CJK = new RegExp('[\\u4e00-\\u9fff]')

    for (const key of KEYS) {
      const zh = lineOf(LOCALES['src/locales/zh-CN.json'], key)
      const en = lineOf(LOCALES['src/locales/en.json'], key)
      expect(zh, 'the Chinese locale has no line for ' + key).not.toBe('')
      expect(en, 'the English locale has no line for ' + key).not.toBe('')
      expect(CJK.test(zh), 'the Chinese copy of ' + key + ' carries no Chinese at all').toBe(true)
      expect(CJK.test(en), 'the English copy of ' + key + ' is the Chinese one again').toBe(false)
    }
  })
})

describe('the two paths that only share the event name', () => {
  it('D12 the editor own save button never asks anything', async () => {
    const w = mountEditor()
    await dirtyByStep(w)
    expect(editorIsDirty(w), 'there is something to save').toBe(true)

    await saveButton(w).trigger('click')

    expect(bar(w).exists(), 'saving from the top bar is not a way to throw the draft away').toBe(false)
    expect(w.emitted('saved'), 'the editor own save announces itself once').toHaveLength(1)
  })

  it('D13 a panel write the card refuses asks nothing and announces nothing', async () => {
    const w = mountEditor()
    await openPanel(w)
    await dirtyByStep(w)
    // 清空正文 = 面板自己拦下来的那一类（卡的行数组只拒空表，一行空串是合法的）
    await saveResource(w, FIRST_BLOCK, '')

    expect(w.find('[data-card-error]').exists(), 'a refused panel write must say why').toBe(true)
    expect(bar(w).exists(), 'a refused write threw nothing away, so there is nothing to ask').toBe(false)
    expect(w.emitted('saved'), 'a refused write saves nothing').toBeUndefined()
  })
})
