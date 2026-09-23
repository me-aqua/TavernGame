// @vitest-environment jsdom
/**
 * 票 81 —— 「卡图编辑器开着」这件事要在**结构上**成立：遮罩底下那一层不许被聚焦、也不许被点到。
 *
 * 契约 `.team/test/2026-09-23/contract-81.md` §2 的 **C1a / C1b**；
 * 口径源 `.team/leader/2026-09-23/票81-S0.md` §四（做法）＋ 组长 2026-09-23 的**窄修订**：
 * 范围从"抽屉那一层"放宽成"**遮罩底下那三层**"（顶栏 `div.flex.shrink-0.items-start` ·
 * 输入区 `div.px-4.pt-2.pb-4` · `div.drawer`），**不动根节点**（挂根上会把卡图自己也罩进去）。
 * 依据是真浏览器里的两次量：`.tools/leader81-scope.log`（**编辑器之外 27 颗**可聚焦 = 抽屉 21 + 另外 6）
 * 与 `.tools/leader81-sib.log`（那 6 颗挂在根节点的哪两个直接子元素上）。
 *
 * ⚠️ **这一件只断"接线"那一半**：编辑器开着时，谁被 `inert` 罩着、罩的是不是**整整一层**。
 *    行为那三条（`focus()` 拿不到 / `elementFromPoint` 命中遮罩 / 关掉之后恢复）**在 jsdom 里断不了**
 *    —— S1 实测（jsdom 30.0.1，探针落档 `.team/test/2026-09-23/probe81/`）：
 *      · `document.elementFromPoint` **根本不存在**（`TypeError: not a function`）；
 *      · `getBoundingClientRect()` 全是 0（没有几何可言）；
 *      · 祖先挂 `inert` 之后 `el.focus()` **照样成功**（jsdom 没有 inert 行为），`:inert` 也不是它认识的伪类。
 *    ⇒ 那三条落在 `e2e/smoke.spec.ts`（真浏览器）。往这里抄一份只会得到"怎么都红"的断言。
 * ⚠️ **反面控制（关掉编辑器之后 `inert` 要摘掉）在这里也写不了**：jsdom 的 `HTMLElement` 没有 `inert`
 *    这个 IDL 属性 ⇒ Vue 的 `shouldSetAsProp` 落到 `patchAttr` 分支 ⇒ `:inert="false"` 会**留下
 *    `inert="false"`**（S1 实测；真浏览器走 `patchDOMProp`，`false` 把属性摘干净）。
 *    写在这儿就是一条"实现对了也红"的地雷 ⇒ **"属性摘没摘"那半仍然只有 e2e 能断**（T3）。
 *    ✅ **但"极性"那半在这里断得了**（S3 评审注入实测：三层绑成反的 ⇒ C1a/C1b 都绿）⇒ 加了 **C1c**。
 * ⚠️ 判据读的是**编辑器之外的全部**（既不是那三颗按钮，也不是只有抽屉）：只糊住几颗的实现
 *    （`disabled` / `tabindex=-1` / `pointer-events`）能骗过行为那三条，不该骗过这一条。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../src/App.vue'
import { i18n } from '../src/i18n'

/** 票 81 点名的那三颗抽屉入口（判据要证明它们真的在这一层里，不是"没渲染"） */
const GATED_ENTRIES = ['data-card-view', 'data-card-import', 'data-card-reset']

/** 这一件里当前挂着的那一版 `App`（挂在 `document.body` 上，收尾要 `unmount`） */
let mounted: VueWrapper | null = null

afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

/**
 * 一个元素的自述 —— 失败信息要能直接点名"是谁还能被聚焦"。
 *
 * ⚠️ 名字不许叫 `describe`：那是 vitest 的套件函数，同名会被它顶掉（实测：`.map(describe)`
 *    变成了"在用例里开一个套件"，报的错与 inert 一个字都不沾）。
 */
function nameOf(el: Element): string {
  const hook = [...el.attributes].map((one) => one.name).find((name) => name.startsWith('data-'))
  const tag = el.tagName.toLowerCase()
  const named = hook === undefined ? tag : tag + '[' + hook + ']'
  const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 12)
  return text === '' ? named : named + ' "' + text + '"'
}

/** 能聚焦的东西的名单（判据管的是"一层"或"编辑器之外全部"，所以口径要宽） */
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]'

/** 一层里能聚焦的东西 */
function focusablesIn(layer: Element): Element[] {
  return [...layer.querySelectorAll(FOCUSABLE)]
}

/**
 * 遮罩**之外**能聚焦的东西 —— C1a 的取值范围。
 *
 * ⚠️ **不是只有抽屉**：组长 2026-09-23 把范围裁成"遮罩底下那三层"（顶栏 + 输入区 + 抽屉），
 *    真浏览器里量到的是 **27 颗**（抽屉 21 + 顶栏 4 + 输入区 2 —— `.tools/leader81-scope.log`
 *    与 `.tools/leader81-sib.log`）。
 * ⚠️ 这里**不写死 27**：新加一颗控件就变红是**假红**。这一条断的是"有没有漏网的"，不是"有几颗"。
 *    （本机 jsdom 里那两层的颗数就与真浏览器不同 —— 见 `.team/test/2026-09-23/S1-读数-票81.md` §7。）
 */
function focusablesOutsideEditor(editor: Element): Element[] {
  return [...document.querySelectorAll(FOCUSABLE)].filter((el) => !editor.contains(el))
}

/**
 * 文档里 `inert` 的**值**正好是 `"true"` 的那些元素 —— C1c 的量具（管极性）。
 *
 * ⚠️ 读的是**值**，不是"属性在不在"：jsdom 里 Vue 走 `patchAttr` 分支 ⇒ 绑成假值时属性**留着**
 *    （`inert="false"`）⇒ 用 `closest('[inert]')` 那种读法对极性一无所知，而 `toBe(null)` 会把
 *    **对的实现判红**（S3 特别提醒过这一条）。
 * ⚠️ 这一支**只在 jsdom 有牙**：真浏览器里 Vue 走 DOM 属性分支 ⇒ 绑成 `true` 时属性是 `inert=""`，
 *    不是 `"true"`。真浏览器那边的极性归 `e2e` 的 T1 / T3 行为读数管。
 */
function inertTrue(): Element[] {
  return [...document.querySelectorAll('[inert]')].filter((el) => el.getAttribute('inert') === 'true')
}

/**
 * 挂上真 `App`、点开抽屉、再点开卡图 —— 两条判据共用这个开头。
 *
 * ⚠️ 必须挂**真 `App`**：`inert` 那条接线住在它里面（`cardOpen` 是它自己的状态），
 *    拿一个替身来挂就读不到这条判据要断的东西。
 */
async function openDrawerUnderEditor(): Promise<void> {
  mounted = mount(App, { global: { plugins: [i18n] }, attachTo: document.body }) as VueWrapper

  const settings = document.querySelector('button[data-settings]') as HTMLButtonElement | null
  expect(settings, 'the shell hands out no settings button, so nothing below would be measured').not.toBe(
    null,
  )
  settings?.click()
  await nextTick()

  const view = document.querySelector(
    '[data-card-section] button[data-card-view]',
  ) as HTMLButtonElement | null
  expect(view, 'the drawer hands out no card-view entry, so the editor would never open').not.toBe(null)
  view?.click()
  await nextTick()

  expect(document.querySelector('[data-card-editor]'), 'the card editor never opened').not.toBe(null)
  expect(document.querySelector('.drawer'), 'the drawer must stay open under the editor').not.toBe(null)
}

describe('R81 the layers under the modal stay out of reach while the card editor is open', () => {
  it('C1a puts every focusable thing outside the editor under an inert ancestor', async () => {
    await openDrawerUnderEditor()

    const editor = document.querySelector('[data-card-editor]')
    expect(editor, 'the editor never rendered, so C1a would have no boundary to draw').not.toBe(null)
    expect(
      document.querySelector('.drawer'),
      'the drawer never rendered, so this check would say nothing',
    ).not.toBe(null)

    // 前提①：遮罩外面真的抓到了能聚焦的东西（0 个 ⇒ 下面那句什么也没验）
    const controls = focusablesOutsideEditor(editor as Element)
    expect(controls.length, 'the shell handed out nothing focusable outside the editor').toBeGreaterThan(0)

    // 前提②：票 81 点名的那三颗真的在名单里（"全都被罩住"不许是"它们没渲染"）
    for (const attr of GATED_ENTRIES) {
      expect(
        controls.filter((el) => el.hasAttribute(attr)).length,
        'the drawer hands out no [' + attr + '] to check',
      ).toBe(1)
    }

    // 判据本体：没被 `[inert]` 罩住的，一个都不许剩 —— 名单直接点名是谁
    const loose = controls.filter((el) => el.closest('[inert]') === null).map(nameOf)
    expect(
      loose,
      'with the card editor open, every focusable thing outside the editor must sit inside [inert]',
    ).toEqual([])
  })

  it('C1b leaves the editor own controls out of that inert subtree', async () => {
    await openDrawerUnderEditor()

    const editor = document.querySelector('[data-card-editor]')
    expect(editor, 'the editor never rendered, so this check would say nothing').not.toBe(null)

    const controls = focusablesIn(editor as Element)
    expect(controls.length, 'the editor handed out nothing focusable to check').toBeGreaterThan(0)

    // 反面：遮罩自己（连它里面的控件）不许被 inert 罩住 —— 罩住了，这一屏就变成一个死掉的模态
    const caught = controls.filter((el) => el.closest('[inert]') !== null).map(nameOf)
    expect(
      caught,
      'the card editor own controls must stay usable: none of them may sit inside [inert]',
    ).toEqual([])
    expect(editor?.closest('[inert]'), 'the card editor itself must not be inert').toBe(null)
  })

  it('C1c leaves nothing at inert="true" once the editor is closed', async () => {
    await openDrawerUnderEditor()

    // 关掉编辑器 —— 抽屉还开着（不然下面量的就是别的屏了）
    const close = document.querySelector('[data-card-editor] [data-card-close]') as HTMLButtonElement | null
    expect(close, 'the editor hands out no close button, so it would stay open').not.toBe(null)
    close?.click()
    await nextTick()
    expect(document.querySelector('[data-card-editor]'), 'the editor must be gone').toBe(null)
    expect(document.querySelector('.drawer'), 'the drawer must stay open under the editor').not.toBe(null)

    // 校准①：这一支量具**看得见** `inert="true"` 才作数（放一颗进去、看见它、再拿走）——
    // 少了这一步，"选择器写错"与"真的没有"长得一模一样（票 71 那族债）
    const decoy = document.createElement('div')
    decoy.setAttribute('inert', 'true')
    document.body.append(decoy)
    expect(inertTrue().length, 'the probe cannot see inert="true" at all').toBeGreaterThan(0)
    decoy.remove()
    expect(inertTrue().length, 'the decoy must be gone again').toBe(0)

    // 校准②：把故障信号放到**真屏上**（抽屉那一层）看它抓不抓得到 —— 这就是 S3 注入的那种绑反
    const drawer = document.querySelector('.drawer') as HTMLElement
    drawer.setAttribute('inert', 'true')
    expect(inertTrue(), 'the probe cannot see a layer that is bound the wrong way').toEqual([drawer])
    drawer.removeAttribute('inert')

    // 判据本体：关着的时候，整份文档里 `inert` 的**值**不许有一个是 `"true"`（＝绑反了）
    expect(
      inertTrue().map(nameOf),
      'with the card editor closed, nothing may sit at inert="true" -- that is the binding, inverted',
    ).toEqual([])
  })
})
