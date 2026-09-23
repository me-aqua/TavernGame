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
import { mount, type VueWrapper } from '@vue/test-utils'
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
  }
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
 * ⚠️ 这一块**没有 `data-*` 钩子**（`EditorShell.vue:128-137` 只有一个 `.band` 类），
 *    而票 71 的边界是"`src/` 一个字节不动" ⇒ 只能按类选、按结构认（头一颗是开合器、后面几颗是步骤）。
 * ⚠️ "它**只在 ≤820px 出现**"这一半 jsdom 量不到（没有媒体查询）—— 那一半在
 *    `e2e/visual.spec.ts` 的 `expectLandscapeShell`（`.band` 在屏上、细条那一栏不在）。
 */
async function checkS10(w: AnyWrapper): Promise<void> {
  expect(w.find('.band').exists(), 'the landscape band is missing: the strip has no fallback shape').toBe(
    true,
  )
  const buttons = () => w.find('.band').findAll('button')
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
 * 它**不进产品**，只做一件事 —— 让上面那 9 条判据在一个「照契约做对了」的树上跑一遍：
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
  const cols =
    `<div data-col="content">${plus('branch')}${nodes.join('')}</div>` +
    `<div data-col="flow" data-flow>${plus('step')}${steps}</div>` +
    `<div data-col="edit">${body}</div>` +
    `<div data-col="prompts"></div>`
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
  const band =
    fault === 'band' ? '' : `<div class="band"><span class="band-k"></span>${bandToggle}${bandMenu}</div>`
  return `<header data-top></header>${band}${shell}${ruler}`
}

/** 挂一版替身：同一批判据在它身上跑，`fault` 决定关掉哪一样 */
function stub(fault: string): AnyWrapper {
  return mount(ShellStub, {
    props: { card, source: 'builtin', fault },
    global: { plugins: [i18n] },
    attachTo: document.body,
  }) as AnyWrapper
}

/** 在替身上跑完 8 条判据，返回红了的那些编号（**每条各挂一版**：判据之间不许互相带状态） */
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

  it('T8 without the landscape band exactly S10 goes red', async () => {
    expect(await redsOn('band')).toEqual(['S10'])
  })
})
