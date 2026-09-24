// @vitest-environment jsdom
/**
 * 票 67 · 段 8a：**四栏外壳骨架**的判据（组件层）。
 *
 * 契约 `.team/test/2026-09-22/contract-67.md`；S0 `.team/leader/2026-09-22/段8a-S0.md` 的 9 条口径
 * 与 §九 的 8 条裁决。这一件只管**结构与交互**（口径 1–5 的那一半）：
 *   · 四栏 / 顶栏 / 细条 / 标尺的钩子与顺序；
 *   · 中栏是那个长滚动体的家（里面挂什么由那一票自己定）；
 *   · 细条高亮 = 当前选中的那一步；
 *   · 三个「＋」各自在哪一栏、能不能聚焦、按下去抛不抛事件。
 *
 * ⚠️ **票 69（段 8b-①）改了两处**（契约 `.team/test/2026-09-22/contract-69.md` §5 第 1 项）：
 *    ① **S4 整条作废** —— 它断言「选中一步之后 `[data-card-form]` 挂在中栏里」，而 8b-① 把
 *       卡图与「编一步」表单都移出了编辑器 ⇒ 那条断言的前提没有了。「中栏那个长滚动体还在」
 *       是 S3 的事（它没动）；「里面挂的是字段表」是那一票自己的
 *       `tests/branch-tree-dom.test.ts` 的事（A2a/A2b）。8c 把节点表单接回来时，这条要重写。
 *    ② **选节点那一轴改由细条承担**（`pick()` 点 `[data-step]`，不再点卡图的 `[data-node]`）——
 *       卡图不再挂在编辑器里，而细条点一下就是选那一步，S6 量的还是同一件事。
 *
 * ⚠️ **几何不在这里量**：jsdom 没有布局、也没有媒体查询 ⇒ 栏宽 / 标尺对齐 / 长滚动 /
 *    横屏降级（口径 1/2/3 的数值面与口径 8）都在 `e2e/visual.spec.ts` 里对着真浏览器量。
 * ⚠️ 判据一律挂在 `CardEditor.vue` 这个**现成的接缝**上（`card-ui.test.ts:359` 已经这么挂）：
 *    新外壳是它内部 import 的子组件（契约点名 `src/components/EditorShell.vue`），
 *    但必须能被 `CardEditor` 渲染出来 —— 这条钉住的是「换壳不换接缝」。
 * ⚠️ 选元素只用 `data-*` 钩子，不按文案找；字符串一律 ASCII（`.githooks/checks/ascii.mjs`）。
 *
 * 🔴 功能没做时这一族是红的，而且红在「钩子不在」上、不是「模块找不到」上 ——
 *    文件末尾那块**自检**（替身 + 故障注入）跑的就是上面同一批判据函数。
 */
import { readFileSync } from 'node:fs'
/* eslint-disable vue/one-component-per-file -- 这一件里有两个测试替身（卡图与外壳），都不是产品组件 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref, type PropType } from 'vue'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import { parseCard } from '../src/game/card'
import { i18n } from '../src/i18n'
import { EXAMPLE_CARD } from './support/card-fixtures'

/** 示例卡（判据要用的节点 id 与名字全部从卡里现读，不抄第二份） */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
const topology = card.graph.topology

/** 四栏的编号与顺序（口径 1）、三个「＋」的编号（口径 5）—— 契约里写死的两组值 */
const COLS = ['content', 'flow', 'edit', 'prompts']
const ADDS = ['branch', 'action', 'step']

/** 任意组件包装器（判据表对真外壳与替身一视同仁） */
type AnyWrapper = VueWrapper<any>

/** 三个「＋」各自的编号（契约里写死的那三个值） */
type AddName = 'branch' | 'action' | 'step'

/** 挂出来的东西一律收摊：挂在 document.body 上（焦点判据要真节点），收工要清干净 */
afterEach(() => {
  document.body.innerHTML = ''
})

/** vue-flow 的替身：节点渲染成一个按钮，点了把 nodeClick 抛上来（jsdom 里没有 ResizeObserver） */
const VueFlowStub = defineComponent({
  name: 'VueFlow',
  props: { nodes: { type: Array, required: true }, edges: { type: Array, required: true } },
  emits: ['nodeClick'],
  /** 一层 div，里面每个节点一个按钮（点 = 选中那个节点） */
  setup:
    (props, { emit }) =>
    () =>
      h(
        'div',
        { class: 'flow-stub' },
        (props.nodes as Array<{ id: string; data: { label: string } }>).map((node) =>
          h('button', { 'data-node': node.id, onClick: () => emit('nodeClick', { node }) }, node.data.label),
        ),
      ),
})

/** 挂一版编辑器（vue-flow 换替身，挂到 body 上让 focus() 量得到） */
function editor(): AnyWrapper {
  return mount(CardEditor, {
    props: { card, source: 'builtin' },
    global: { plugins: [i18n], stubs: { VueFlow: VueFlowStub } },
    attachTo: document.body,
  }) as AnyWrapper
}

/** 判据只吃这份读数 —— 读数与断言分开，自检那一块才能拿替身喂同一批断言 */
interface Shell {
  /** 四栏：值 + 它是不是长在 `[data-shell]` 里 */
  cols: Array<{ col: string; inShell: boolean }>
  ruler: { present: boolean; segs: number; afterCols: boolean }
  mid: { present: boolean; inEdit: boolean }
  top: boolean
  flow: boolean
  /** 细条里的步骤（`data-step` 的值）与高亮的那一个 */
  steps: string[]
  on: string[]
  /** 三个「＋」：在哪一栏、是不是真按钮、可不可聚焦 */
  adds: Array<{ what: string; col: string | null; tag: string; disabled: boolean; tabindex: number }>
  /** 细条每一项自己的文字（判「显示哪一步」用） */
  stepText: Record<string, string>
  /** 票 74 · A 形态：两颗抽屉开关的取值、在不在横带里、是不是排在步骤按钮之后 */
  toggles: { values: string[]; allInBand: boolean; lastInBand: boolean }
  /** 抽屉自己的取值（票 74 · J11b：两个集合要逐项相等） */
  drawers: string[]
  /** 票 74 · B 形态：竖屏那一屏的提示块（`display:none` 由 CSS 管，jsdom 只判它在不在） */
  rotate: { present: boolean; text: string }
}

/** 读一棵渲染好的树：外壳长什么样（缺什么就报缺，不抛） */
function shellOf(w: AnyWrapper): Shell {
  const cols = w.findAll('[data-col]')
  const ruler = w.find('[data-ruler]')
  const lastCol = cols.length ? cols[cols.length - 1] : null
  const mid = w.find('[data-mid]')
  const steps = w.findAll('[data-step]')
  const colOf = (el: Element): string | null => el.closest('[data-col]')?.getAttribute('data-col') ?? null

  return {
    cols: cols.map((c) => ({
      col: c.attributes('data-col') ?? '',
      inShell: c.element.closest('[data-shell]') !== null,
    })),
    ruler: {
      present: ruler.exists(),
      segs: ruler.exists() ? ruler.findAll('[data-ruler-seg]').length : 0,
      // 标尺必须排在四栏**之后**（它是底部那一条），拿 DOM 序判，不看坐标
      afterCols:
        ruler.exists() &&
        lastCol !== null &&
        Boolean(lastCol.element.compareDocumentPosition(ruler.element) & Node.DOCUMENT_POSITION_FOLLOWING),
    },
    mid: {
      present: mid.exists(),
      inEdit: w.find('[data-col="edit"] [data-mid]').exists(),
    },
    top: w.find('[data-top]').exists(),
    flow: w.find('[data-flow]').exists(),
    steps: steps.map((el) => el.attributes('data-step') ?? ''),
    on: w.findAll('[data-step-on]').map((el) => el.attributes('data-step') ?? ''),
    adds: w.findAll('[data-add]').map((el) => ({
      what: el.attributes('data-add') ?? '',
      col: colOf(el.element),
      tag: el.element.tagName,
      disabled: el.attributes('disabled') !== undefined,
      tabindex: Number(el.attributes('tabindex') ?? '0'),
    })),
    stepText: Object.fromEntries(steps.map((el) => [el.attributes('data-step') ?? '', el.text()])),
    toggles: togglesOf(w),
    drawers: w.findAll('[data-drawer]').map((el) => el.attributes('data-drawer') ?? ''),
    rotate: rotateOf(w),
  }
}

/**
 * 横带里那几颗按钮（**不含**抽屉开关）—— 票 74 的重钉口径。
 *
 * 两颗 `[data-drawer-toggle]` 搬进横带之后，`findAll('button')` 数的就是**三样**东西的混合
 * （换一步的开合器 + 卡里那几步 + 两颗面板开关）⇒ "数出来几个"这件事必须先说清数的是哪一堆。
 */
function bandButtons(w: AnyWrapper): DOMWrapper<HTMLButtonElement>[] {
  const band = w.find('.band')
  return band.exists()
    ? band.findAll('button').filter((el) => el.attributes('data-drawer-toggle') === undefined)
    : []
}

/** 两颗抽屉开关搬到哪去了（取值 / 在不在横带 / 是不是排在步骤按钮之后） */
function togglesOf(w: AnyWrapper): Shell['toggles'] {
  const all = w.findAll('[data-drawer-toggle]')
  const band = w.find('.band')
  const inside = band.exists() ? band.findAll('button') : []
  const first = inside.findIndex((el) => el.attributes('data-drawer-toggle') !== undefined)
  return {
    values: all.map((el) => el.attributes('data-drawer-toggle') ?? ''),
    allInBand: all.length > 0 && all.every((el) => el.element.closest('.band') !== null),
    lastInBand:
      first > 0 &&
      inside.length > first &&
      inside.slice(first).every((el) => el.attributes('data-drawer-toggle') !== undefined),
  }
}

/** 竖屏那一屏的提示块（`[data-rotate]`）；不在就报不在，不抛 */
function rotateOf(w: AnyWrapper): Shell['rotate'] {
  const el = w.find('[data-rotate]')
  return { present: el.exists(), text: el.exists() ? el.text() : '' }
}

/** 选一个节点：点细条上那一步（卡图不再挂在编辑器里，选节点那一轴现在由细条承担） */
async function pick(w: AnyWrapper, id: string): Promise<void> {
  const step = w.find('[data-step="' + id + '"]')
  expect(step.exists(), 'no step for this node in the strip: ' + id).toBe(true)
  await step.trigger('click')
}

/** S1 · 口径 1 的骨架面：四栏恰好四个、按契约的顺序、长在 `[data-shell]` 里 */
function checkS1(w: AnyWrapper): void {
  const s = shellOf(w)
  expect(
    s.cols.map((c) => c.col),
    'the shell must have exactly these four columns, in order',
  ).toEqual(COLS)
  expect(
    s.cols.filter((c) => !c.inShell).map((c) => c.col),
    'every column must sit inside [data-shell]',
  ).toEqual([])
}

/** S2 · 口径 2 的骨架面：底部标尺在位、四段、排在四栏之后 */
function checkS2(w: AnyWrapper): void {
  const s = shellOf(w)
  expect(s.ruler.present, 'the width ruler [data-ruler] is missing').toBe(true)
  expect(s.ruler.segs, 'the ruler must have one segment per column').toBe(COLS.length)
  expect(s.ruler.afterCols, 'the ruler must come after the four columns').toBe(true)
}

/** S3 · 口径 3 的骨架面：中栏里那一个长滚动体（`[data-mid]`）在，且只有一个 */
function checkS3(w: AnyWrapper): void {
  const s = shellOf(w)
  expect(s.mid.present, 'the mid column has no scroll body [data-mid]').toBe(true)
  expect(s.mid.inEdit, '[data-mid] must live inside [data-col="edit"]').toBe(true)
  expect(w.findAll('[data-mid]').length, 'the scroll body must be a single one').toBe(1)
}

/**
 * S4（口径 3 的挂载点）**票 69 作废** —— 见文件头那两条。
 *
 * 它原来断言「选中一步之后 `[data-card-form]` 挂在中栏那个滚动体里」，而 8b-① 把卡图与
 * 「编一步」表单都移出了编辑器 ⇒ 那条断言的前提没有了。8c 把节点表单接回来时按那一票的
 * 契约重写；「中栏那个长滚动体还在」由 S3 守着。
 *
 * 下面是 S5 · 口径 4 的静态面：顶栏与细条在位；细条列的是卡里的节点、按拓扑顺序、各自写着名字。
 */
function checkS5(w: AnyWrapper): void {
  const s = shellOf(w)
  expect(s.top, 'the top bar [data-top] is missing').toBe(true)
  expect(s.flow, 'the workflow strip [data-flow] is missing').toBe(true)
  expect(s.steps.length, 'the strip lists no step at all').toBeGreaterThan(0)
  expect(
    s.steps.filter((id) => !topology.includes(id)),
    'the strip invented a step',
  ).toEqual([])
  // 顺序：拓扑里删掉若干步之后剩下的那一段（子序列），不是自己排的
  let at = -1
  for (const id of s.steps) {
    const next = topology.indexOf(id, at + 1)
    expect(next, 'the strip order does not follow the topology: ' + id).toBeGreaterThan(at)
    at = next
  }
  for (const id of s.steps) {
    expect(s.stepText[id], 'the step does not spell its node name: ' + id).toContain(
      card.graph.nodes[id].name,
    )
  }
}

/** S6 · 口径 4 的动态面：高亮的那一项就是当前选中那一步（没选中时一项都不亮） */
async function checkS6(w: AnyWrapper): Promise<void> {
  expect(shellOf(w).on, 'nothing is selected, so nothing may be highlighted').toEqual([])
  await pick(w, topology[0])
  expect(shellOf(w).on, 'the highlighted step must be the selected node').toEqual([topology[0]])
  await pick(w, topology[1])
  expect(shellOf(w).on, 'the highlight must move with the selection').toEqual([topology[1]])
}

/** S7 · 口径 5 的位置面：三个「＋」各一个，各自长在契约说的那一栏里 */
function checkS7(w: AnyWrapper): void {
  const s = shellOf(w)
  expect(s.adds.map((a) => a.what).sort(), 'the three plus buttons must exist, one each').toEqual(
    [...ADDS].sort(),
  )
  const want: Record<string, string> = { branch: 'content', action: 'edit', step: 'flow' }
  for (const add of s.adds) {
    expect(add.col, 'the "' + add.what + '" plus is in the wrong column').toBe(want[add.what])
  }
}

/** S8 · 口径 5 的键盘面：每个「＋」是真按钮、没被禁用、focus() 落得到它身上 */
function checkS8(w: AnyWrapper): void {
  const s = shellOf(w)
  expect(s.adds.length, 'no plus button to focus at all').toBe(ADDS.length)
  for (const add of s.adds) {
    expect(add.tag, 'the "' + add.what + '" plus is not a button').toBe('BUTTON')
    expect(add.disabled, 'the "' + add.what + '" plus is disabled').toBe(false)
    expect(add.tabindex, 'the "' + add.what + '" plus is out of the tab order').toBeGreaterThanOrEqual(0)
    const el = w.find('[data-add="' + add.what + '"]').element as HTMLButtonElement
    el.focus()
    expect(document.activeElement, 'the "' + add.what + '" plus cannot take focus').toBe(el)
  }
}

/** S9 · 口径 5 的动作面：按下去各自抛自己的事件（本票不要求真的改卡） */
async function checkS9(w: AnyWrapper): Promise<void> {
  for (const what of ADDS) {
    const el = w.find('[data-add="' + what + '"]')
    expect(el.exists(), 'no plus button for: ' + what).toBe(true)
    await el.trigger('click')
    expect(w.emitted('add-' + what), 'pressing the "' + what + '" plus emitted nothing').toHaveLength(1)
  }
}

/**
 * S10 · 票 71 补的那一条（口径 8 的另一半）· **横带**：细条收成它之后，
 * 它要显示**当前那一步**，而且「换一步」真的换得动。
 *
 * ⚠️ **票 74 的重钉（T1）**：横带里多了两颗 `[data-drawer-toggle]`（A 形态把面板开关搬进来），
 *    所以"数出来几个按钮"一律走 `bandButtons()` —— 它把抽屉开关**排除在外**，
 *    数出来仍是「开合器 + 卡里那几步」。**一条断言都没减**，减的只是数数时混进来的东西。
 * ⚠️ 这一块**没有 `data-*` 钩子**（`EditorShell.vue` 的横带只有 `.band` 与按钮），
 *    而票 71 的边界是"`src/` 一个字节不动" ⇒ 只能按类选、按结构认（头一颗是开合器、后面几颗是步骤）。
 * ⚠️ "它**只在 ≤820px 出现**"这一半 jsdom 量不到（没有媒体查询）—— 那一半在
 *    `e2e/visual.spec.ts` 的 `expectLandscapeShell`（`.band` 在屏上、细条那一栏不在）。
 */
async function checkS10(w: AnyWrapper): Promise<void> {
  expect(w.find('.band').exists(), 'the landscape band is missing: the strip has no fallback shape').toBe(
    true,
  )
  const buttons = () => bandButtons(w)
  await pick(w, topology[0])
  expect(buttons()[0].text(), 'the band must name the step that is currently picked').toContain(
    card.graph.nodes[topology[0]].name,
  )
  // 换一步：点开 → 卡里每一步都在 → 点其中一条就换成它，菜单顺手收掉
  expect(buttons().length, 'closed, the band must hand out its toggle and nothing else').toBe(1)
  await buttons()[0].trigger('click')
  expect(buttons().length, 'opening the band must list every step of the card').toBe(1 + topology.length)
  expect(
    buttons()
      .slice(1)
      .map((el) => el.text()),
    'the band must list the card steps in topology order',
  ).toEqual(topology.map((id) => card.graph.nodes[id].name))
  await buttons()[2].trigger('click')
  expect(shellOf(w).on, 'picking a step from the band must move the selection').toEqual([topology[1]])
  expect(buttons().length, 'picking a step must close the menu again').toBe(1)
}

/**
 * J11s · 票 74 · A 形态的位置面：两颗抽屉开关（`[data-drawer-toggle]`）**搬进横带**，
 * 而且按设计 §A.1-2 的 DOM 序**排在步骤按钮之后**（开合器 → 各步 → 内容 → 提示词）。
 *
 * ⚠️ 顺序这一半**不是装饰**：`e2e/visual.spec.ts` 的 `expectLandscapeShell` 是从横带
 *    "头一颗是开合器、第 2 颗起是各步"认出那几步的 —— 顺序变了，那一条就会认错对象。
 * ⚠️ "它们在 ≤820 才可见"那一半 jsdom 量不到（没有媒体查询）：默认态由 CSS `display:none` 收起，
 *    这一条只管**它们在不在那棵树里、在横带的哪一段**。
 */
function checkJ11s(w: AnyWrapper): void {
  const s = shellOf(w)
  expect(s.toggles.values.slice().sort(), 'one toggle per drawer panel').toEqual(['content', 'prompts'])
  expect(s.toggles.allInBand, 'the two drawer toggles must live inside the landscape band').toBe(true)
  expect(s.toggles.lastInBand, 'inside the band the drawer toggles must come after the step buttons').toBe(
    true,
  )
}

/**
 * J11b · 票 74 的一致性面：**有抽屉就必须有它自己的开关，反过来也一样**。
 *
 * 查的是"对不对"而不是"有没有" —— 多一个抽屉而横带没跟上（或反过来）⇒ 当场红。
 * 它**今天就是绿的**，而且必须是绿的：它不是判别，是守卫（`contract-74.md` §三 有分工表）。
 */
function checkJ11b(w: AnyWrapper): void {
  const s = shellOf(w)
  expect(
    s.toggles.values.slice().sort(),
    'every drawer panel needs its own toggle in the band, and the other way round',
  ).toEqual(s.drawers.slice().sort())
}

/**
 * J5s · 票 74 · B 形态的结构面：竖屏那一屏的提示块 `[data-rotate]` 在 DOM 里，
 * 而且它写的**就是 i18n 表里那两句**（标题 + 说明）。
 *
 * ⚠️ 机制是**纯 CSS `display:none`**（设计 §五.3 明说不许 `v-if` + `matchMedia`）⇒
 *    这一块**永远在树里**，可见性归真浏览器那一层（`e2e/visual.spec.ts` 的 J5）。
 *    `v-if` 会让"它在不在"取决于替身环境，那正是这一条要挡住的。
 */
function checkJ5s(w: AnyWrapper): void {
  const s = shellOf(w)
  expect(s.rotate.present, 'the rotate notice [data-rotate] is missing from the editor DOM').toBe(true)
  expect(s.rotate.text, 'the rotate notice must spell the title').toContain(i18n.global.t('card.rotateTitle'))
  expect(s.rotate.text, 'the rotate notice must spell the body').toContain(i18n.global.t('card.rotateBody'))
}

/** 一条判据：编号 + 一句话（用例名）+ 断言（吃一棵挂好的树） */
interface Check {
  id: string
  what: string
  run: (w: AnyWrapper) => Promise<void> | void
}

/** 这一件的判据表 —— 用例与自检的故障注入跑的都是它 */
const CHECKS: Check[] = [
  { id: 'S1', what: 'the shell is four columns, in the order the contract names', run: checkS1 },
  { id: 'S2', what: 'the width ruler sits under the columns, one segment each', run: checkS2 },
  { id: 'S3', what: 'the mid column owns the single long-scroll body', run: checkS3 },
  { id: 'S5', what: 'the top bar and the strip list the card nodes in order', run: checkS5 },
  { id: 'S6', what: 'the highlighted step is the selected node', run: checkS6 },
  { id: 'S7', what: 'the three plus buttons exist, each in its own column', run: checkS7 },
  { id: 'S8', what: 'every plus is a button that can take focus', run: checkS8 },
  { id: 'S9', what: 'pressing a plus emits its own event', run: checkS9 },
  { id: 'S10', what: 'the landscape band names the current step and can swap it', run: checkS10 },
  {
    id: 'J11s',
    what: 'the two drawer toggles live in the band, after the step buttons',
    run: checkJ11s,
  },
  { id: 'J11b', what: 'every drawer panel and every toggle come in pairs', run: checkJ11b },
  { id: 'J5s', what: 'the rotate notice is in the DOM and spells the two i18n keys', run: checkJ5s },
]

describe('the four-column editor shell (criteria 1-5)', () => {
  for (const check of CHECKS) {
    it(`${check.id} ${check.what}`, async () => {
      const w = editor()
      try {
        await check.run(w)
      } finally {
        w.unmount()
      }
    })
  }
})

/**
 * 替身：一份照契约长的最小外壳，用 `innerHTML` 铺出来、点击走事件委托。
 *
 * 它**不进产品**，只做一件事 —— 让 `CHECKS` 里**每一条**判据在一个「照契约做对了」的树上跑一遍：
 * 全绿 ⇒ 这些判据不是永远红的；再按 `fault` 把某一样**整条关掉** ⇒ 数它们红几条。
 * `fault` 一次只关一样，关的都是「整条能力」，不是改一个数。
 */
const ShellStub = defineComponent({
  name: 'EditorShellStub',
  props: {
    card: { type: Object as PropType<typeof card>, required: true },
    source: { type: String, required: true },
    fault: { type: String, default: '' },
  },
  emits: ['add-branch', 'add-action', 'add-step'],
  /** 铺那棵树，并把 [data-step] / [data-add] / 横带的点击转成选中与事件 */
  setup(props, { emit }) {
    const selected = ref('')
    /** 横带那个「换一步」开着没有（真件里是 `EditorShell.vue:69` 的 `picking`） */
    const picking = ref(false)
    /**
     * 点到了哪个钩子：选节点走 select（细条那一步），按「＋」走各自的事件。
     *
     * ⚠️ 横带那几颗**没有钩子**（真件也没给），所以只能按 `.band` 与结构认：
     *    头一颗是开合器，后面几颗按**文字**回认卡里的节点名（真件走的是 `pick(id)`）。
     */
    const onClick = (event: MouseEvent) => {
      const el = event.target as Element
      const bandBtn = el.closest('.band button')
      if (bandBtn) {
        if ((bandBtn.closest('.band') as Element).querySelector('button') === bandBtn) {
          picking.value = !picking.value
        } else {
          const name = (bandBtn.textContent ?? '').trim()
          const hit = topology.find((id) => card.graph.nodes[id].name === name)
          if (hit !== undefined) {
            picking.value = false
            selected.value = hit
          }
        }
        return
      }
      const target = el.closest('[data-step], [data-add]')
      if (!target) return
      const step = target.getAttribute('data-step')
      const add = target.getAttribute('data-add')
      if (step !== null) selected.value = step
      else if (add !== null) emit(('add-' + add) as `add-${AddName}`)
    }
    return () =>
      h('div', {
        'data-card-editor': '',
        innerHTML: shellHtml(props.fault, selected.value, picking.value),
        onClick,
      })
  },
})

/** 造替身那棵树：`fault` 指名这一次把哪一样整条关掉（空串 = 照契约长全） */
function shellHtml(fault: string, selected: string, picking: boolean): string {
  const nodes = topology.map((id) => `<button data-node="${id}">${card.graph.nodes[id].name}</button>`)
  const steps =
    fault === 'steps'
      ? ''
      : topology
          .map((id) => {
            const on = fault === 'highlight' ? id === topology[0] : id === selected
            return `<button data-step="${id}"${on ? ' data-step-on' : ''}>${card.graph.nodes[id].name}</button>`
          })
          .join('')
  const plus = (what: string) => (fault === 'adds' ? '' : `<button data-add="${what}">+</button>`)
  // 'mid' = 中栏不再是那个长滚动体（编辑面还在中栏里，只是没有 [data-mid]）
  const body = fault === 'mid' ? plus('action') : `<div data-mid>${plus('action')}</div>`
  // 'drawerpair' = 提示词那一栏少了 data-drawer ⇒ 面板与开关配不成对（J11b 的牙长在这一处）
  const promptsDrawer = fault === 'drawerpair' ? '' : ' data-drawer="prompts"'
  const cols =
    `<div data-col="content" data-drawer="content">${plus('branch')}${nodes.join('')}</div>` +
    `<div data-col="flow" data-flow>${plus('step')}${steps}</div>` +
    `<div data-col="edit">${body}</div>` +
    `<div data-col="prompts"${promptsDrawer}></div>`
  // 四栏没长在栅格容器里 = "骨架那一条整条不在"（别的一律照旧，故障要切得干净）
  const shell = fault === 'shell' ? `<div>${cols}</div>` : `<div data-shell>${cols}</div>`
  const ruler =
    fault === 'ruler'
      ? ''
      : '<div data-ruler>' + '<span data-ruler-seg></span>'.repeat(COLS.length) + '</div>'
  // 横带（票 71 的 S10）：照真件的结构长 —— `.band` 里第一颗是开合器、后面几颗是步骤，**都没有钩子**
  const bandToggle = `<button type="button">${selected ? card.graph.nodes[selected].name : ''}</button>`
  const bandMenu = picking
    ? topology.map((id) => `<button type="button">${card.graph.nodes[id].name}</button>`).join('')
    : ''
  // 票 74 的 A 形态：两颗抽屉开关**跟在步骤之后**（'bandtoggles' = 它们没搬进来，仍落在顶栏里）
  const toggles = ['content', 'prompts']
    .map((name) => `<button type="button" data-drawer-toggle="${name}">${name}</button>`)
    .join('')
  const band =
    fault === 'band'
      ? ''
      : `<div class="band"><span class="band-k"></span>${bandToggle}${bandMenu}${
          fault === 'bandtoggles' ? '' : toggles
        }</div>`
  // 票 74 的 B 形态：竖屏那一屏的提示块（真件里**永远在树里**，看不看得见由 CSS 定）
  const rotate =
    fault === 'rotate'
      ? ''
      : `<div data-rotate><span>${String(i18n.global.t('card.rotateTitle'))}</span>` +
        `<span>${String(i18n.global.t('card.rotateBody'))}</span></div>`
  const top = `<header data-top>${fault === 'bandtoggles' ? toggles : ''}</header>`
  return `${top}${rotate}${band}${shell}${ruler}`
}

/** 挂一版替身：同一批判据在它身上跑，`fault` 决定关掉哪一样 */
function stub(fault: string): AnyWrapper {
  return mount(ShellStub, {
    props: { card, source: 'builtin', fault },
    global: { plugins: [i18n] },
    attachTo: document.body,
  }) as AnyWrapper
}

/** 在替身上把 `CHECKS` 里**每一条**判据都跑一遍，返回红了的那些编号（**每条各挂一版**：判据之间不许互相带状态） */
async function redsOn(fault: string): Promise<string[]> {
  const red: string[] = []
  for (const check of CHECKS) {
    const w = stub(fault)
    try {
      await check.run(w)
    } catch {
      red.push(check.id)
    } finally {
      w.unmount()
    }
  }
  return red
}

describe('self-check: these criteria can go red, and by how much', () => {
  it('T1 a stand-in that follows the contract turns none of them red', async () => {
    // 通道自检：0 红 ⇒ 下面那些「红了几条」是真数出来的，不是「永远红」
    expect(await redsOn('')).toEqual([])
  })

  it('T2 the four columns outside [data-shell] turn exactly S1 red', async () => {
    expect(await redsOn('shell')).toEqual(['S1'])
  })

  it('T3 without the width ruler exactly S2 goes red', async () => {
    expect(await redsOn('ruler')).toEqual(['S2'])
  })

  it('T4 a mid column without its scroll body turns exactly S3 red', async () => {
    expect(await redsOn('mid')).toEqual(['S3'])
  })

  it('T5 a strip with no step at all turns exactly S5/S6/S10 red', async () => {
    // ⚠️ 票 71 补的 S10 也在这一条轴上：横带显示的是**选中的那一步**，而选中那一轴由细条承担
    //    （横屏下细条不在屏上，唯一入口就是横带自己）⇒ 细条整条没了，S10 一起红，这是真的依赖
    expect(await redsOn('steps')).toEqual(['S5', 'S6', 'S10'])
  })

  it('T6 a highlight frozen on the first step turns exactly S6/S10 red', async () => {
    // 同上：高亮冻住 ⇒ 横带说的那一步与细条对不上，S10 的交叉核对就没有对象了
    expect(await redsOn('highlight')).toEqual(['S6', 'S10'])
  })

  it('T7 without the plus buttons exactly S7/S8/S9 go red', async () => {
    expect(await redsOn('adds')).toEqual(['S7', 'S8', 'S9'])
  })

  it('T8 without the landscape band exactly S10/J11s/J11b go red', async () => {
    // ⚠️ 票 74 之后这是一条**真的依赖**：两颗抽屉开关住在横带里 ⇒ 横带整条不在，它们也就没地方长
    //    ⇒ J11s（在不在横带里）与 J11b（开关与面板配不配得上）一起红。不是连带误伤，是同一条事实。
    expect(await redsOn('band')).toEqual(['S10', 'J11s', 'J11b'])
  })

  it('T9 a shell without the rotate notice turns exactly J5s red', async () => {
    expect(await redsOn('rotate')).toEqual(['J5s'])
  })

  it('T10 drawer toggles left in the top bar turn exactly J11s red', async () => {
    expect(await redsOn('bandtoggles')).toEqual(['J11s'])
  })

  it('T11 a drawer panel without its data-drawer turns exactly J11b red', async () => {
    expect(await redsOn('drawerpair')).toEqual(['J11b'])
  })
})

/**
 * 票 74 · 窄屏那三件 —— 组件层的**静态那一半**。
 *
 * 几何（可用宽度、可见性、媒体查询）一律在 `e2e/visual.spec.ts` 里对着真浏览器量；这里只管
 * "那两句话在不在、在几份表里" —— 它是 `[data-rotate]` 那一块**能不能有内容**的前提，
 * 而内容在 jsdom 里读得到、在真浏览器那层反而只能读到"渲染出来的那一份"。
 *
 * 🔴 **为什么非要在这一层断一次**：`vue-i18n` 取不到键时**把键名原样回显**（不抛、不报错）
 *    ⇒ `[data-rotate]` 照样有文字、照样"看得见"，两句提示却是一串 `card.rotateTitle`。
 *    那种坏法在 e2e 那层**长得跟成功一模一样**（契约 §五 有这一段）。
 */
describe('the rotate notice has something to say (criteria J5t)', () => {
  /** 两颗 locale 表：设计 §B.3 要求同一个键表、中英各一份 */
  const LOCALES = ['zh-CN', 'en']
  /** 那一屏的两句话 */
  const NOTICE_KEYS = ['rotateTitle', 'rotateBody']

  for (const lang of LOCALES) {
    for (const key of NOTICE_KEYS) {
      it(`J5t card.${key} is spelled out in ${lang}`, () => {
        const table = JSON.parse(readFileSync(`src/locales/${lang}.json`, 'utf8')) as {
          card: Record<string, string>
        }
        const said = table.card[key]
        expect(typeof said, lang + ' has no card.' + key).toBe('string')
        expect((said ?? '').trim().length, lang + ' leaves card.' + key + ' empty').toBeGreaterThan(0)
        expect(said, lang + ' echoes the key back instead of saying something').not.toBe('card.' + key)
      })
    }
  }
})
