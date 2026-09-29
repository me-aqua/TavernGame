// @vitest-environment jsdom
/**
 * 票 78「不许无声吞掉草稿」的判据 —— **票 8d-② 收口之后**（收口 2026-09-26 · 判据翻面 2026-09-29 · 玛尔塔）。
 *
 * 契约 `.team/test/2026-09-26/contract-8d2.md` §四；票 78 那一族的口径源 `.team/leader/2026-09-23/票78-S0.md`；
 * 两条"退休棘轮"的翻面台账在 `.team/test/2026-09-29/判据收口-票8d2.md`（T1 留痕）。
 *
 * 🔴 **这一族的入口退休了**：那 10 条（D1–D7 / D10 / D13 / D14）量的都是「**资源库面板那一次写**
 *    撞上脏草稿」—— 面板随 8d-② 退休（`CardResources.vue` 删掉、`importCard` 那条绕过草稿的路关掉），
 *    第四栏换成 `PromptForm`，写路径只剩**一条**：草稿 + 顶栏那颗保存。**那 10 条没有可搬的入口。**
 * ⚠️ **票 78 的意图不许跟着死**，所以这一件留下的是它**还站得住**的那几半：
 *      · 关窗 / 刷新那条守卫（`D8` / `D9`）—— 触发点照旧（`beforeunload` 挂在共享的 `window` 上）；
 *      · 编辑器自己那颗保存**一个字都不问**（`D12`）—— 它现在**是唯一**能走到重载的入口（`D15` 数过）；
 *      · 🆕 **退休那一套不许长回来**（组长 2026-09-26 裁"三样退休"）：三颗 locale 键在两份文件里
 *        **都不许有**、运行时也不许解析得出（`D11`），那条确认条的钩子与三颗键的点号名字在**整棵
 *        `src/`** 里**一个都不许剩**（`D16`）；
 *      · 🆕 **`D15`：把编辑器里每一颗按钮各点一遍**，数出还有几条路会走到 `reloadForCard`
 *        （`App.vue:202 → location.reload()`；三个调用点 `:224` / `:235` / `:432`）。
 *        两个读者：**抛 `saved` 的**（靠事件名，只抓得住"换了名字但照旧抛事件"）与
 *        **点了之后存储变了的**（外部事实，不吃任何名字 —— 2026-09-29 加的）。
 *    ⇒ **读数（不是推的）**：编辑器里只剩 `[data-card-save]` **一颗**；而它落盘之后手里没有没保存的草稿
 *      ⇒ 「有草稿才问一句」在编辑器里**没有触发点**，那一套（`onResourceSaved` / `discardAsk` /
 *      `keepDraft` / `discardDraft` 与那条确认条）**已随面板退休**。
 *    ⚠️ `useBranchDraft.ts` 抬头那条约定照旧成立：**哪天编辑器里又冒出一个"落盘之后还要重载"的入口**，
 *      这条"有草稿先问一句"**必须带回来** —— 那时把 `D11` / `D16` 这两条钉法一起解冻（带票号），
 *      组合层那 15 个键的公开面也要一起放行（`tests/use-branch-draft.test.ts` 的 `B0`）。
 *    ⚠️ **e2e 那条 `[data-editor-confirm]` 的 `toHaveCount(0)` 已删**（UI 没了之后它恒真、没有信息量）：
 *      它守的"点保存一个字都不问"由 `D12` 接手，源码那一半由 `D16` 接手（交接写在交付说明 §三）。
 * ⚠️ **没动的另外两半**：`App.vue:224` / `:235`（导入卡 / 恢复内置示例）住在 `SettingsDrawer` 里，
 *    编辑器开着时那一层被 `inert` 罩着 + 全屏遮罩挡着鼠标（票 81 的 `tests/drawer-inert-dom.test.ts` 与 e2e 守着）；
 *    「被拒的保存不许 emit `saved`」由 `tests/support/branch-tree.ts` 的 `B3d` 继续守着。
 * ⚠️ 期望值全部从卡与 locale 现取；中文字面量一个都不写（`.githooks/checks/ascii.mjs` 连 `tests/` 一起拦）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import { parseCard } from '../src/game/card'
import { i18n, t } from '../src/i18n'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { type AnyWrapper, type RowWrapper } from './support/branch-tree'
import { setLocale } from './support/trace-blocks'

/** 示例卡（拓扑那一步从它现算，不抄第二份） */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))

/** 拓扑的第一步（造「编一步」那一族的脏用它） */
const FIRST_STEP = card.graph.topology[0]

/** 判据自己打进去的那个名字（测试里的字符串字面量一律 ASCII） */
const TYPED_NAME = 'a draft name typed for the recovery of ticket 78'

/** 随资源库面板一起退休的三颗 locale 键（组长 2026-09-26 裁；S2 已从两份 locale 删掉） */
const RETIRED_KEYS = ['card.discardDraft', 'card.discardCancel', 'card.discardContinue']

/** 那条确认条在模板里的钩子 —— 它退休之后 `src/**` 里一个都不许剩 */
const RETIRED_HOOK = 'data-editor-confirm'

/**
 * 一颗**还活着**的键（`D11` / `D16` 的校准）：两条棘轮都先证明"这套读法看得见'在'"。
 *
 * 少了这一步，"三颗都不在"与"这套读法什么都没读到"长得一模一样。
 */
const LIVE_KEY = 'card.saveFailed'

/** 两份 locale 的名字（语言切换与读文件两处共用同一份次序） */
const LOCALE_NAMES = ['zh-CN', 'en'] as const

/** 键名在它那一节里的写法（`card.saveFailed` → `saveFailed`） */
function leafOf(key: string): string {
  return key.slice(key.indexOf('.') + 1)
}

/**
 * 两份 locale 的 `card` 那一节（按**点号路径**取，不按行找）。
 *
 * ⚠️ 不按行找是有来由的：`"saveFailed"` 在两份文件里各有**两处**（`card` 与 `agent` 各一节），
 *    按行 `.find()` 拿到的是"文件里先出现的那一处"—— 那是巧合，不是判据。
 */
function cardSections(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const name of LOCALE_NAMES) {
    const parsed = JSON.parse(readFileSync('src/locales/' + name + '.json', 'utf8')) as {
      card?: Record<string, unknown>
    }
    out[name] = parsed.card ?? {}
  }
  return out
}

/**
 * 应用源码的全文（`.ts` / `.vue` 都算；`src/locales/` 那两份不算 —— 它们由 `cardSections()` 读）。
 *
 * 走法与 `tests/locale-keys.test.ts` 的 `appSource()` 一致：那一条判"键有没有人用"，
 * 这一条判"退休的记号有没有剩" —— 两件事，同一把尺。
 */
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
  walk('src')
  return files.map((file) => readFileSync(file, 'utf8')).join('\n')
}

/** 这一件里**当前**挂着的那一版编辑器（挂出来的东西一律收摊：收尾要 `unmount`，挂在 `document.body` 上） */
let mounted: VueWrapper | null = null

afterEach(() => {
  // ⚠️ **必须 `unmount`，不能只清 DOM**：`beforeunload` 那条守卫挂在**共享的 `window`** 上，
  //    只清 DOM 的话前一条用例留下的脏编辑器还挂着监听 ⇒ "干净编辑器不许拦"读到的
  //    是**上一条用例**留下的真相（票 78 的 S2 撞出来的）。
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

/**
 * 那条确认条（`[data-editor-confirm]`）。
 *
 * ⚠️ **票 8d-② 之后 `src/` 里一个字节都不剩**（`D16` 在源码层看着这件事）⇒ 这里读到的
 *    永远该是"没有"。`D12` 读它，问的是"脏草稿 + 点顶栏保存这条路**不出现**它" ——
 *    那正是它退休前唯一会出现的那条路。
 */
function confirmBar(w: AnyWrapper): RowWrapper {
  return w.find('[data-editor-confirm]')
}

/** 顶栏那颗「保存」：**干净时它是禁用的** —— `dirty` 的可观察读数是它 */
function saveButton(w: AnyWrapper): RowWrapper {
  const button = w.find('[data-top] [data-card-save]')
  expect(button.exists(), 'the top bar hands out no save button').toBe(true)
  return button
}

/** 这一刻编辑器脏不脏（顶栏那颗按钮能不能按） */
function editorIsDirty(w: AnyWrapper): boolean {
  return saveButton(w).attributes('disabled') === undefined
}

/** 开第四栏（顶栏那一颗开合它的按钮）—— 8d-② 之后第四栏是公共提示词列表 */
async function openPrompts(w: AnyWrapper): Promise<void> {
  const button = w.find('[data-card-resources-open]')
  expect(button.exists(), 'the top bar hands out no prompts-column toggle').toBe(true)
  await button.trigger('click')
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

/** 造一份脏草稿（`dirty` 的三源并集在这里只走「编一步」那一源 —— 另两源在各自的门里量） */
async function dirtyByStep(w: AnyWrapper): Promise<void> {
  await pickStep(w, FIRST_STEP)
  await stepNameBox(w).setValue(TYPED_NAME)
  expect(editorIsDirty(w), 'editing a step did not make the editor dirty').toBe(true)
}

/** 挂一版编辑器 + 走一遍开场（开第四栏、造一份脏草稿）—— 普查从同一个开场出发，**跑完自己收摊** */
async function openedEditor<T>(run: (w: AnyWrapper) => Promise<T> | T): Promise<T> {
  const w = mountEditor()
  try {
    await openPrompts(w)
    await dirtyByStep(w)
    return await run(w)
  } finally {
    w.unmount()
    mounted = null
    document.body.innerHTML = ''
  }
}

/** 往 window 上派发一个**可取消**的 `beforeunload`：true ⇔ 有人 `preventDefault` 过 */
function beforeUnloadPrevented(): boolean {
  return window.dispatchEvent(new Event('beforeunload', { cancelable: true })) === false
}

/**
 * 装一对 `addEventListener` / `removeEventListener` 探针，返回"净剩几个 `beforeunload` 监听"。
 *
 * 原来 D9 与 D14 共用这一支量具；D14 随那条确认条一起走了（没有触发点），现在 D9 自己用。
 */
function countBeforeUnloadGuards(): () => number {
  const add = vi.spyOn(window, 'addEventListener')
  const remove = vi.spyOn(window, 'removeEventListener')
  return () =>
    add.mock.calls.filter((call) => call[0] === 'beforeunload').length -
    remove.mock.calls.filter((call) => call[0] === 'beforeunload').length
}

/** 一颗按钮的读法：先认它的钩子，认不出就用标签 + 头几个字（目的是**在读数里认得出是谁**） */
function nameOf(el: Element): string {
  for (const attr of [
    'data-card-save',
    'data-card-close',
    'data-card-resources-open',
    'data-add',
    'data-step',
    'data-prompt-row',
    'data-display-open',
    'data-field-add',
    'data-field-del',
    'data-branch-node',
    'data-drawer-toggle',
  ]) {
    const value = el.getAttribute(attr)
    if (value !== null) return '[' + attr + (value === '' ? ']' : '="' + value + '"]')
  }
  return el.tagName + ':' + (el.textContent ?? '').trim().slice(0, 24)
}

/** 点一遍的结果：点的是谁 + 它有没有把 `saved` 抛出来 + **点它之后存储变了没有** + 点它炸没炸 */
interface Clicked {
  what: string
  saved: boolean
  storage: boolean
  error: string
}

/**
 * 这一刻的存储快照（键 → 值）。
 *
 * 🔴 **这是 D15 的第二个读者，也是唯一不吃字形的那个**：`emitted('saved')` 只有
 *    `CardEditor` 自己的事件名一个形状，谁换个名字发就沉默；而"点了之后存储变了"
 *    是**外部事实** —— 一个新名字都不用认（组长 2026-09-29 裁的改法，出处 `验收记录-票8d-2.md` §六）。
 */
function storageSnapshot(): string {
  const keys = Object.keys(localStorage).sort()
  return JSON.stringify(keys.map((key) => [key, localStorage.getItem(key)]))
}

/**
 * 把编辑器里**每一颗按钮**各点一遍（各挂一版新编辑器）。
 *
 * ⚠️ 这是**读数**，不是"读源码的确认"：
 *    · `saved` 是 `CardEditor` 交给外层的那个事件，而外层（`App.vue:432`）正是拿它调
 *      `reloadForCard()` ⇒ **谁 emit 它，谁就把整页重载掉**；
 *    · `storage` 问的是**另一件事**：点这一下有没有把东西写进存储（落卡 / 落配置都算）——
 *      一条"悄悄直接 `importCard`、但不 emit `saved`"的新入口在 `saved` 那一列**看不见**，
 *      而它照样会把手里那份草稿冲掉。
 */
async function census(): Promise<Clicked[]> {
  const total = await openedEditor((w) => w.findAll('[data-card-editor] button').length)
  const clicks: Clicked[] = []
  for (let index = 0; index < total; index += 1) {
    clicks.push(
      await openedEditor(async (w) => {
        const el = w.findAll('[data-card-editor] button')[index]
        const what = nameOf(el.element)
        const before = storageSnapshot()
        let error = ''
        try {
          await el.trigger('click')
        } catch (err) {
          error = (err as Error).message
        }
        return { what, saved: w.emitted('saved') !== undefined, storage: storageSnapshot() !== before, error }
      }),
    )
  }
  return clicks
}

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
})

describe('R8 the three keys stay retired in both locale files', () => {
  /**
   * 🔴 **这一条在 2026-09-29 翻了个面**（T1）：三颗键随面板退休 ⇒ 判据从"必须在两份 locale 里"
   *    改成"**两边都不许有**"（台账 `.team/test/2026-09-29/判据收口-票8d2.md` §一）。
   *    它现在是**棘轮**：这三颗键回来的时候，必须有人带着票号来解冻这一条 ——
   *    因为"回来"只在一件事成立时才是对的：编辑器里又有了"落盘之后还要重载"的入口
   *    （`useBranchDraft.ts` 抬头那条约定）。
   */
  // 两份 locale 的 `card` 那一节（键的存在与否按点号路径判）
  const SECTIONS = cardSections()

  it('D11 keeps those three keys out of both files, and out of the runtime', () => {
    // ① 校准：这套读法看得见"在" —— 一颗活着的键两份里都有、两套语言都解析得出
    for (const name of LOCALE_NAMES) {
      expect(
        Object.hasOwn(SECTIONS[name], leafOf(LIVE_KEY)),
        'the ' + name + ' locale came back without ' + LIVE_KEY + ': this reader sees nothing',
      ).toBe(true)
    }
    for (const locale of LOCALE_NAMES) {
      setLocale(locale)
      expect(t(LIVE_KEY), 'the reader cannot see a key that is really there').not.toBe(LIVE_KEY)
    }

    // ② 三颗退休键：两份文件里那一行都不在，两套语言也都不解析（缺 key 时 `t()` 原样吐回键名）
    for (const key of RETIRED_KEYS) {
      for (const name of LOCALE_NAMES) {
        expect(
          Object.hasOwn(SECTIONS[name], leafOf(key)),
          key +
            ' is back in the ' +
            name +
            ' locale: the panel question was retired with the panel (see useBranchDraft.ts). ' +
            'If a save-then-reload entry point is back, bring the question back and unfreeze this pin ' +
            'with a ticket number',
        ).toBe(false)
      }
      for (const locale of LOCALE_NAMES) {
        setLocale(locale)
        expect(t(key), 'the ' + locale + ' screen still has copy for ' + key).toBe(key)
      }
    }
    setLocale('zh-CN')
  })
})

describe('R8b no retired marker is left anywhere in the app source', () => {
  /**
   * 🆕 `D16` · **源码层那条棘轮**：三颗键的点号名字与那条确认条的钩子在 `src/**` 里一个都不许剩。
   *
   * 为什么要有它：`e2e/smoke.spec.ts` 那条 `toHaveCount(0)` 随着 UI 删掉**恒真**（没有信息量）⇒
   * 那条读数由 `D12`（同一条路：脏草稿 + 点保存）+ 这一条接手。这一条比 e2e 那条强的地方是
   * "**复活了但这条路上渲染不出来**"也抓得到 —— 而"退休的 UI 又长回来"正是这条棘轮要防的事。
   * ⚠️ 注释里的留痕不算：`useBranchDraft.ts` 抬头那段退休说明写着这四个名字（**那是留痕，不是代码**），
   *    所以这一条只认**点号键名**（`card.discardDraft`）与**模板钩子**（`data-editor-confirm`）这两种形状。
   */
  it('D16 no retired key and no confirm-bar hook is left in src', () => {
    const source = appSource()
    // 校准：这套读法读到了真东西（读成空串的话下面几条什么都没证）
    expect(
      source.includes(LIVE_KEY),
      'the app source came back without ' + LIVE_KEY + ': this scan says nothing',
    ).toBe(true)
    for (const key of RETIRED_KEYS) {
      expect(source.includes(key), 'the retired key ' + key + ' is back in the app source').toBe(false)
    }
    expect(
      source.includes(RETIRED_HOOK),
      'the retired confirm bar ' + RETIRED_HOOK + ' is back in the app source',
    ).toBe(false)
  })
})

describe('R7 counting the ways out of the editor into a reload', () => {
  /**
   * 🆕 D15 · **把编辑器里每一颗按钮点一遍**：谁 emit `saved`，谁就是一条会走到
   * `reloadForCard()`（`App.vue:202`）的路 —— 由 `App.vue:432` 那一句接上。
   *
   * 为什么要有它：票 78 那 10 条判据量的那个入口（面板那一次写）没了，**"还有没有别的重载入口"
   * 这件事就没有任何判据看着了** —— 而它正是那条守卫存在的理由。这一条把它变成读数：
   * 数出来的清单写在失败信息里，将来多长出一条路当场红。
   *
   * 🔴 **两个读者一起看这一份读数**（组长 2026-09-29 裁的改法，出处 `验收记录-票8d-2.md` §六）：
   *    光认 `emitted('saved')` 只抓得住"**换了名字但照旧抛事件**"那一类；一条**悄悄直接
   *    `importCard`、连事件都不抛**的新入口会同时漏过 `D11` / `D16` / `G3` 与它自己
   *    —— 而用户真的会丢草稿。**"点了之后存储变了"是外部事实**：一个新名字都不用认。
   */
  it('D15 the editor hands out exactly one way into a reload: its own save', async () => {
    const clicks = await census()
    /** 会走到重载的那几颗（抛了 `saved`） */
    const saved = clicks.filter((one) => one.saved).map((one) => one.what)
    /** 点一下就会写存储的那几颗（落卡 / 落配置都算）—— 它**不必**等于上面那一串 */
    const wrote = clicks.filter((one) => one.storage).map((one) => one.what)
    // 读数落进 stdout（跑这一件时看得到）—— 报给组长的那两份"入口清单"就是这一行
    console.log(
      '[census] clicked=' +
        clicks.length +
        ' saved=' +
        JSON.stringify(saved) +
        ' wrote=' +
        JSON.stringify(wrote),
    )
    // 守卫：一颗按钮都没点到的话，下面那句"只有一颗"什么都没证
    expect(clicks.length, 'no button was clicked: this census would say nothing').toBeGreaterThan(10)
    expect(
      clicks.filter((one) => one.error !== '').map((one) => one.what + ' -> ' + one.error),
      'a click blew up: the census is not trustworthy',
    ).toEqual([])
    expect(saved, 'the editor must own exactly one way to a reload, and it is the top-bar save').toEqual([
      '[data-card-save]',
    ])
    // 🔴 存储那一列：**抛了 `saved` 的每一颗都真的动过存储**（"抛事件"与"落盘"不许各说各的）
    expect(
      saved.filter((one) => !wrote.includes(one)),
      'a button announced a reload without writing anything: the two readings disagree',
    ).toEqual([])
    // 🔴 反向：还有别的按钮会写存储吗？今天**恰好一颗**（就是那颗保存）——
    //    多出来的那一颗就是"悄悄写卡、却不抛 `saved`"的新入口，草稿会从它手里丢
    expect(wrote, 'a second button writes storage: does it reload the page behind the draft?').toEqual([
      '[data-card-save]',
    ])
  })
})

describe('the one path left: the editor own save', () => {
  /**
   * ⚠️ 这一条原来与"面板那条路"配成一对（两条路只共享 `saved` 这个事件名）—— 面板那条路退休之后
   *    只剩它一条。它读的那条确认条**已经在 `src/` 里不存在**（`D16` 看着源码那一侧）⇒
   *    这里问的是"脏草稿 + 点顶栏保存**这条路上不出现**它"，而它退休前唯一会出现的就是这条路。
   */
  it('D12 the editor own save never asks anything, and the retired bar stays away', async () => {
    const w = mountEditor()
    await dirtyByStep(w)
    expect(editorIsDirty(w), 'there is something to save').toBe(true)

    await saveButton(w).trigger('click')

    expect(confirmBar(w).exists(), 'saving from the top bar is not a way to throw the draft away').toBe(false)
    expect(w.emitted('saved'), 'the editor own save announces itself once').toHaveLength(1)
  })
})
