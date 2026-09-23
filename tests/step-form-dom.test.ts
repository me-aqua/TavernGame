// @vitest-environment jsdom
/**
 * 票 73 · 段 8c-①：**「编一步 · 读」**的判据（组件层）。
 *
 * 契约 `.team/test/2026-09-23/contract-73.md`；口径源 `.team/leader/2026-09-23/段8c-S0.md`
 * §十二 的 **R1–R10**、§十一 的六条硬裁决。这一件只管**读**那一半（R1–R6）：
 *   · 细条点一步 ⇒ 中栏换成那一步的编屏，那一屏说的是卡里这一步真实声明的东西；
 *   · 两条轴（树 `picked` / 细条 `selected`）**任一时刻最多一个非空**，开屏两个都空；
 *   · 那一屏里**一个可编控件都没有**（本刀只读）。
 *
 * ⚠️ **判据挂在 `CardEditor.vue` 这个现成的接缝上**（`editor-shell-dom.test.ts:22` 已经这么挂）：
 *    新组件是它内部 import 的子组件（**`src/components/StepForm.vue`**），但必须能被 `CardEditor`
 *    渲染出来 —— 这条钉住的是「换内容不换接缝」，也让"功能没做"的红落在**钩子不在**上，
 *    不是"模块找不到"上（`.githooks/pre-commit` 的检查 6 也要求这个名字出现在 `tests/` 里）。
 * ⚠️ **期望值一律从卡现取**（`graph.nodes[id]` 的键 / `prompt` 的行 / `tools` / `reads` / `settings`），
 *    一个中文键名都不手写 —— `.githooks/checks/ascii.mjs` 连 `tests/` 里的字符串一起拦。
 * ⚠️ **几何、媒体查询、可见性这里都量不到**（jsdom 没有布局）⇒ 横屏那一档的"在屏上"归 `e2e/`。
 * 🔴 **每一个"一个都没有"型的断言都自带反面控制** —— 票 71 的教训：注入物尺寸 `auto` 的断言
 *    等于没写；这里凡断"数 = 0"的地方，都用**同一句查询**在**别处**先证明它数得出东西。
 *
 * ⚠️ **票 76（`settings` 缺省语义改成"不写 = 一块都不发"）是本件的前置之一**：
 *    R6 按**票 76 之后的卡**写（示例卡的 `outline` / `story` 会被补上显式声明），
 *    契约 §R6 与 §依赖 里写明了这一条。
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import { parseCard, type CardData } from '../src/game/card'
import { i18n } from '../src/i18n'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { PICK_A, PICK_B, TREE_PATHS, textOf, type AnyWrapper } from './support/branch-tree'

/** 示例卡（判据要的节点名、键集、行数、动作、枝名全部从它现算，不抄第二份） */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))

/** 拓扑与节点表：本件每一条判据的期望值都从这两个出发 */
const topology = card.graph.topology
const nodes = card.graph.nodes

/** 第一步与第二步（"换一步"那条判据要两步**真的不同**，挑的时候当场断） */
const FIRST = topology[0]
const SECOND = topology[1]

/** 卡里五块设定的键（顺序就是卡的声明顺序） */
const SETTING_KEYS = Object.keys(card.settings)

/** 卡里每一步声明的键（节点上没有 NODE_KEYS 之外的键 —— 这一件不抄那份名单） */
function declaredKeys(id: string): string[] {
  return Object.keys(nodes[id])
}

/**
 * 那一屏**应当**画出来的块：卡里声明的那几个键 + 两样**常驻**的。
 *
 * ⚠️ 常驻的两样都有理由：`id` 是拓扑的键、不是声明（`card.ts:78-82`）；
 *    `settings` 那一栏任何时候都有答案（票 76 之后：不写 = 一块都不读）⇒ 它不随卡增删，
 *    内容（哪几块 on）才是随卡的那一半。**其余六个键一个都不常驻** —— `role` 尤其不许画空框。
 */
function expectedBlocks(id: string): string[] {
  return [...new Set([...declaredKeys(id), 'id', 'settings'])]
}

/** 每一步声明的 `settings`（票 76 之后八步全有；没有那个键 = 一块都不发） */
function declaredSettings(id: string): string[] {
  return (nodes[id] as { settings?: string[] }).settings ?? []
}

/** 卡里最长的那条主提示词（"逐行显示"那条判据拿它当对象：行数最多、最容易漏） */
const LONGEST_PROMPT = topology.reduce((best, id) =>
  nodes[id].prompt.length > nodes[best].prompt.length ? id : best,
)

/**
 * 一份本地造的卡：把某一步的 `settings` 整个删掉（"不写这个键"那一档的唯一造法）。
 *
 * ⚠️ 票 76 之后**不许**再从卡里 `find` 一个「没写 `settings`」的节点 —— 三张卡的声明都补齐了，
 *    卡里再也挑不出那一档（S0 §五 裁决 3）⇒ 这一档由本文件自己造。
 */
function withoutSettings(id: string): CardData {
  const copy = JSON.parse(JSON.stringify(card)) as Record<string, any>
  delete copy.graph.nodes[id].settings
  return parseCard(JSON.stringify(copy))
}

/** 「不写 `settings`」那一档的夹具节点：**写死第一步**，不再从卡里现找（票 76 裁决 3） */
const NO_SETTINGS = FIRST

/** 挂出来的东西一律收摊（挂在 document.body 上，收工要清干净） */
afterEach(() => {
  document.body.innerHTML = ''
})

/** 挂一版编辑器（判据与自检两条通道都从它出发） */
function mountEditor(which: CardData = card): AnyWrapper {
  return mount(CardEditor, {
    props: { card: which, source: 'builtin' },
    global: { plugins: [i18n] },
    attachTo: document.body,
  }) as AnyWrapper
}

/** 细条上点一步（那一轴今天已经接线，缺的只是"中栏跟不跟着换"） */
async function pickStep(w: AnyWrapper, id: string): Promise<void> {
  const step = w.find('[data-step="' + id + '"]')
  expect(step.exists(), 'no step for this node in the strip: ' + id).toBe(true)
  await step.trigger('click')
}

/** 左栏树上点一行（选中一格状态节点） */
async function pickBranch(w: AnyWrapper, path: string): Promise<void> {
  const row = w.find('[data-branch-node="' + path + '"]')
  expect(row.exists(), 'no row for this state node in the tree: ' + path).toBe(true)
  await row.trigger('click')
}

/** 两条选择轴那一瞬的读数 —— R2 的全部证据都在它上面 */
interface Axes {
  /** 树上亮着的那几行（`data-branch-on` 的值 = 路径） */
  branch: string[]
  /** 细条上亮着的那几步（`data-step-on` 的值 = 节点 id） */
  step: string[]
  branchForm: boolean
  stepForm: boolean
  none: boolean
  subtitle: string
}

/** 读两条轴（缺什么就报缺，不抛） */
function axesOf(w: AnyWrapper): Axes {
  return {
    branch: w.findAll('[data-branch-on]').map((el) => el.attributes('data-branch-node') ?? ''),
    step: w.findAll('[data-step-on]').map((el) => el.attributes('data-step') ?? ''),
    branchForm: w.find('[data-branch-form]').exists(),
    stepForm: w.find('[data-step-form]').exists(),
    none: w.find('[data-branch-none]').exists(),
    subtitle: textOf(w, '[data-branch-title]'),
  }
}

/** 一段选择范围里**可编控件**的标签（`input` / `select` / `textarea` / 真能编的 `contenteditable`） */
function controlsIn(w: AnyWrapper, scope: string): string[] {
  return w
    .findAll(scope + ' input, ' + scope + ' select, ' + scope + ' textarea, ' + scope + ' [contenteditable]')
    .filter((el) => el.attributes('contenteditable') !== 'false')
    .map((el) => el.element.tagName)
}

/** 「编一步」那一屏读出来的一屏 —— 断言只吃它，自检那一块才能拿替身喂同一批断言 */
interface Screen {
  present: boolean
  /** 它长在中栏那个滚动体（`[data-mid]`）里吗 */
  inMid: boolean
  /** 根上那个节点 id */
  node: string
  /** 屏上出现的块（`data-step-block` 的值），按显示顺序 */
  blocks: string[]
  /** 主提示词一行一个（`data-step-prompt-line` 的文字） */
  prompt: string[]
  tools: string[]
  reads: string[]
  /** 勾选区：哪几块、on 没 on */
  marks: Array<{ key: string; on: boolean }>
  /** `role` 那一块在不在 */
  role: boolean
  roleControls: string[]
  controls: string[]
  kills: number
}

/** 读那一屏（不在时就报"不在"，各条判据自己决定这算不算"什么也没验"） */
function screenOf(w: AnyWrapper): Screen {
  const root = w.find('[data-step-form]')
  /** 只在那一屏里面找（不在时一律空数组，省得每处都判一次） */
  const inside = (selector: string) => (root.exists() ? root.findAll(selector) : [])
  return {
    present: root.exists(),
    inMid: w.find('[data-mid] [data-step-form]').exists(),
    node: root.exists() ? (root.attributes('data-step-node') ?? '') : '',
    blocks: inside('[data-step-block]').map((el) => el.attributes('data-step-block') ?? ''),
    prompt: inside('[data-step-prompt-line]').map((el) => el.text()),
    tools: inside('[data-step-tool]').map((el) => el.attributes('data-step-tool') ?? ''),
    reads: inside('[data-step-read]').map((el) => el.attributes('data-step-read') ?? ''),
    marks: inside('[data-card-resource-mark]').map((el) => ({
      key: (el.attributes('data-card-resource-mark') ?? '').replace(/^setting:/, ''),
      on: el.attributes('data-card-resource-mark-on') !== undefined,
    })),
    role: inside('[data-step-block="role"]').length > 0,
    roleControls: controlsIn(w, '[data-step-block="role"]'),
    controls: controlsIn(w, '[data-step-form]'),
    kills: inside('[data-field-del], [data-add]').length,
  }
}

// ---------- C1–C6：判据（11 条；另两条 C1d / C6b 单独挂，见下面两个 it）----------

/** C1a · R1：细条点一步 ⇒ 中栏换成那一步的编屏（今天点一下中栏纹丝不动） */
async function checkC1a(w: AnyWrapper): Promise<void> {
  await pickStep(w, FIRST)
  const s = screenOf(w)
  expect(s.present, 'picking a step must bring up the screen of that step').toBe(true)
  expect(s.inMid, 'that screen must live in the mid scroll body [data-mid]').toBe(true)
  expect(s.node, 'the screen must say which step it is about').toBe(FIRST)
  expect(s.kills, 'no trash and no plus may reach this screen').toBe(0)
  expect(axesOf(w).none, 'the empty state must step aside once a step is picked').toBe(false)
  expect(axesOf(w).branchForm, 'the field table and the step screen may not share the mid column').toBe(false)
}

/** C1b · R1 的另一半：换一步 ⇒ 那一屏跟着换（冻在第一步上的实现过不了这一条） */
async function checkC1b(w: AnyWrapper): Promise<void> {
  expect(FIRST, 'this check needs two different steps to swap between').not.toBe(SECOND)
  await pickStep(w, FIRST)
  const before = screenOf(w)
  await pickStep(w, SECOND)
  const after = screenOf(w)
  expect(before.node, 'the first pick must show the first step').toBe(FIRST)
  expect(after.node, 'the screen must follow the second pick').toBe(SECOND)
  expect(textOf(w, '[data-step-block="name"]'), 'the screen must name the step it is about').toContain(
    nodes[SECOND].name,
  )
}

/** C1c · R1 的字幕面：中栏字幕 = 那一步的名字，而且细条亮着的就是它（两处不许各说各的） */
async function checkC1c(w: AnyWrapper): Promise<void> {
  await pickStep(w, FIRST)
  const first = axesOf(w)
  expect(first.step, 'the strip must light the picked step').toEqual([FIRST])
  expect(first.subtitle, 'the mid subtitle must name that step').toContain(nodes[FIRST].name)
  await pickStep(w, SECOND)
  const second = axesOf(w)
  expect(second.subtitle, 'the subtitle must follow the strip').toContain(nodes[SECOND].name)
  expect(second.subtitle, 'the subtitle did not move with the pick').not.toBe(first.subtitle)
}

/**
 * C2 · 🔴 R2：两条轴互斥 —— **任一时刻最多一个非空**，开屏两个都空。
 *
 * ⚠️ 今天真界面上两个会**同时亮**（`.team/dev/2026-09-23/8c-编一步-实现面.md` §1.4 的实测：
 *    `branchOn=["lead"]` + `stepOn=["psych"]`）⇒ 这条会红，而且红的就是要拦的那件事。
 * ⚠️ 自带反面控制：两个"非空"的态都**真的出现过**（否则"一律空"也满足上面每一句）。
 */
async function checkC2(w: AnyWrapper): Promise<void> {
  /** 一条不变量：两条轴加起来至多一个亮着，而且中栏与亮着的那一轴**一一对应** */
  const invariant = (where: string): Axes => {
    const a = axesOf(w)
    expect(
      a.branch.length + a.step.length,
      'at most one of the two axes may be lit, and this is: ' + where,
    ).toBeLessThanOrEqual(1)
    expect(a.stepForm, 'the step screen is up exactly when the strip axis is lit: ' + where).toBe(
      a.step.length === 1,
    )
    expect(a.branchForm, 'the field table is up exactly when the tree axis is lit: ' + where).toBe(
      a.branch.length === 1,
    )
    return a
  }

  const open = axesOf(w)
  expect(open.branch, 'nothing may be picked on the tree when the editor opens').toEqual([])
  expect(open.step, 'no step may be auto-picked when the editor opens').toEqual([])
  expect(open.none, 'with both axes empty the mid column must be the explicit empty state').toBe(true)
  expect(open.stepForm, 'the step screen may not be up before anything is picked').toBe(false)

  await pickBranch(w, PICK_A)
  const onTree = invariant('right after picking a tree row')
  expect(onTree.branch, 'the tree row that was clicked must be the lit one').toEqual([PICK_A])
  expect(onTree.none, 'the empty state must step aside once a row is picked').toBe(false)

  await pickStep(w, FIRST)
  const onStep = invariant('right after picking a step while a tree row was lit')
  expect(onStep.step, 'the step that was clicked must be the lit one').toEqual([FIRST])

  await pickBranch(w, PICK_B)
  const back = invariant('after going back to the tree')
  expect(back.branch, 'picking a tree row again must take the light back').toEqual([PICK_B])
}

/** C3a · R3：那一屏的块**就是卡里这一步声明的键**（一个不多一个不少），外加两样常驻的 */
async function checkC3a(w: AnyWrapper): Promise<void> {
  const shapes = new Set(topology.map((id) => declaredKeys(id).join('|')))
  expect(shapes.size, 'every step declares the same keys: then this check says nothing').toBeGreaterThan(1)
  for (const id of topology) {
    await pickStep(w, id)
    const got = screenOf(w).blocks
    expect([...got].sort(), 'the blocks must be exactly the keys the card declares, for: ' + id).toEqual(
      [...expectedBlocks(id)].sort(),
    )
  }
}

/** C3b · R3 的内容面：身份（name + 只读 id）· `duty` 逐字 · 主提示词**一行一条、一行不少** */
async function checkC3b(w: AnyWrapper): Promise<void> {
  expect(LONGEST_PROMPT, 'the longest prompt of this card must have more than one line').not.toBe('')
  const lines = nodes[LONGEST_PROMPT].prompt
  expect(lines.length, 'this check needs a multi-line prompt to be worth anything').toBeGreaterThan(3)
  expect(
    lines.filter((line) => line.trim() !== '').length,
    'a prompt of nothing but empty lines would pass this check',
  ).toBeGreaterThan(0)
  expect(lines.filter((line) => line.trim() === '').length, 'no empty line to keep').toBeGreaterThan(0)
  await pickStep(w, LONGEST_PROMPT)
  const s = screenOf(w)
  expect(textOf(w, '[data-step-block="name"]'), 'the screen must spell the node name').toContain(
    nodes[LONGEST_PROMPT].name,
  )
  expect(textOf(w, '[data-step-block="id"]'), 'the read-only node id must be on screen').toContain(
    LONGEST_PROMPT,
  )
  expect(textOf(w, '[data-step-block="duty"]'), 'the duty must be shown word for word').toContain(
    nodes[LONGEST_PROMPT].duty,
  )
  expect(s.prompt.length, 'the prompt must be one element per line of the card').toBe(lines.length)
  lines.forEach((line, index) => {
    if (line.trim() === '') {
      expect(s.prompt[index].trim(), 'an empty line of the card must stay an empty line: ' + index).toBe('')
      return
    }
    expect(s.prompt[index], 'line ' + index + ' must be the line the card declares').toContain(line.trim())
  })
}

/** 卡里 `tools` 是空表的那一步（"一个动作都不给"要看得出来，不是画成空白） */
const PICK_EMPTY_TOOLS = topology.find((id) => (nodes[id].tools ?? []).length === 0) as string

/** C3c · R3 的声明面：`tools` / `reads` 两栏逐项 = 卡里那一步声明的，`reads` 还得是卡自己的枝名 */
async function checkC3c(w: AnyWrapper): Promise<void> {
  const withTools = topology.find((id) => (nodes[id].tools ?? []).length > 1) as string
  expect(withTools, 'no step of this card holds more than one tool').not.toBe(undefined)
  expect(PICK_EMPTY_TOOLS, 'no step of this card writes an empty tool list').not.toBe(undefined)
  for (const id of [withTools, PICK_EMPTY_TOOLS]) {
    await pickStep(w, id)
    const s = screenOf(w)
    expect(s.tools, 'the tool rows must be the tools the card gives that step: ' + id).toEqual(
      nodes[id].tools ?? [],
    )
    expect([...s.reads].sort(), 'the read rows must be the branches the card gives that step: ' + id).toEqual(
      [...(nodes[id].reads ?? [])].sort(),
    )
    expect(
      s.reads.filter((name) => !Object.hasOwn(card.state, name)),
      'a row must name a top-level branch of the card itself: ' + id,
    ).toEqual([])
  }
}

/** C3d · R3 的边界：写了空表 = **一个都没有**，那一档要看得见一句话，不能是一块空白 */
async function checkC3d(w: AnyWrapper): Promise<void> {
  const empty = topology.filter((id) => (nodes[id].tools ?? []).length === 0)
  const full = topology.filter((id) => (nodes[id].tools ?? []).length > 0)
  expect(empty.length, 'no step of this card writes an empty tool list').toBeGreaterThan(0)
  expect(full.length, 'every step writes an empty tool list: then this check says nothing').toBeGreaterThan(0)
  for (const id of empty) {
    await pickStep(w, id)
    expect(screenOf(w).tools, 'an empty list means no tool at all, for: ' + id).toEqual([])
    expect(
      textOf(w, '[data-step-block="tools"]').length,
      'an empty list must still say so instead of drawing nothing: ' + id,
    ).toBeGreaterThan(0)
  }
}

/**
 * C4 · 🔴 R4：那一屏里**一个可编控件都没有**（本刀只读）。
 *
 * ⚠️ **这条最容易写成空断言**（票 71 的 ⑧②：注入物尺寸是 `auto` 的断言等于没写）⇒ 三段一起断：
 *    ① 前提：那一屏**在**（不在的话"没有控件"是空话）；
 *    ② 反面控制：**同一句查询**在编枝态那张表里数得出控件（量具真的照得到东西）；
 *    ③ 正题：那一屏里 `input` / `select` / `textarea` / `contenteditable` 一个都没有，垃圾桶与 ＋ 也没有。
 */
async function checkC4(w: AnyWrapper): Promise<void> {
  await pickBranch(w, PICK_A)
  expect(
    controlsIn(w, '[data-branch-form]').length,
    'the same query finds no control in the field table either: then it proves nothing about the step screen',
  ).toBeGreaterThan(0)
  await pickStep(w, FIRST)
  const s = screenOf(w)
  expect(s.present, 'the step screen is not there, so "no control in it" says nothing').toBe(true)
  expect(
    s.controls,
    'this ticket shows the step read-only: no editable control may be on that screen',
  ).toEqual([])
  expect(s.kills, 'no trash and no plus may be on that screen').toBe(0)
}

/** C5 · R5：`role` 只在**写了它**的那一步显示，而且只读（没写的那几步不画那一块，不是空框） */
async function checkC5(w: AnyWrapper): Promise<void> {
  const withRole = topology.filter((id) => nodes[id].role !== undefined)
  const withoutRole = topology.filter((id) => nodes[id].role === undefined)
  expect(withRole.length, 'the card format wants exactly one step writing role').toBe(1)
  expect(withoutRole.length, 'every step writes role: then this check says nothing').toBeGreaterThan(0)
  const keeper = withRole[0]
  await pickStep(w, keeper)
  const s = screenOf(w)
  expect(s.role, 'the step that writes role must show that block').toBe(true)
  expect(textOf(w, '[data-step-block="role"]'), 'the value of role must be on screen').toContain(
    nodes[keeper].role as string,
  )
  expect(s.roleControls, 'role is a pointer of the whole card: it is read-only here').toEqual([])
  for (const id of withoutRole) {
    await pickStep(w, id)
    expect(screenOf(w).role, 'a step that writes no role must not draw that block: ' + id).toBe(false)
  }
}

/**
 * C6a · R6：勾选区读出来的是**卡里那一步声明的那几块**（逐个相等）。
 *
 * ⚠️ **按票 76 之后的卡写**：`settings` 的缺省语义已改成"不写 = 一块都不发"，
 *    示例卡的 `outline` / `story` 由票 76 补上显式声明 ⇒ **不再有"缺省 = 全五块"要断**。
 *    这里写的是 `?? []`：今天那两步还没有显式声明时它是"一块都不 on"，票 76 落完自动对上。
 */
async function checkC6a(w: AnyWrapper): Promise<void> {
  expect(SETTING_KEYS.length, 'this card declares no setting block at all').toBeGreaterThan(0)
  const shapes = new Set<string>()
  for (const id of topology) {
    await pickStep(w, id)
    const marks = screenOf(w).marks
    expect(
      marks.map((one) => one.key),
      'the marks column must list the blocks of the card, in card order: ' + id,
    ).toEqual(SETTING_KEYS)
    const on = marks.filter((one) => one.on).map((one) => one.key)
    expect(on, 'what is on must be what the card declares for that step: ' + id).toEqual(declaredSettings(id))
    shapes.add(on.join('|'))
  }
  expect(shapes.size, 'every step declaring the same blocks would pass the line above').toBeGreaterThan(1)
}

// ---------- 判据表（用例与自检的故障注入跑的都是它）----------

/** 一条判据：编号 + 一句话（用例名）+ 断言（吃一棵挂好的树） */
interface Check {
  id: string
  what: string
  run: (w: AnyWrapper) => Promise<void> | void
}

/** 这一件的判据表 —— 用例与自检跑的都是它 */
const CHECKS: Check[] = [
  { id: 'C1a', what: 'picking a step brings up the screen of that step in the mid column', run: checkC1a },
  { id: 'C1b', what: 'the screen follows when another step is picked', run: checkC1b },
  { id: 'C1c', what: 'the mid subtitle names the step the strip has lit', run: checkC1c },
  { id: 'C2', what: 'the two selection axes never light together', run: checkC2 },
  { id: 'C3a', what: 'the blocks are exactly the keys the card declares for that step', run: checkC3a },
  { id: 'C3b', what: 'name, id, duty and every prompt line come from the card', run: checkC3b },
  { id: 'C3c', what: 'the tool and read rows are the ones the card declares', run: checkC3c },
  { id: 'C3d', what: 'an empty tool list says so instead of drawing nothing', run: checkC3d },
  { id: 'C4', what: 'the step screen holds no editable control at all', run: checkC4 },
  { id: 'C5', what: 'role shows only where the card writes it, and read-only', run: checkC5 },
  { id: 'C6a', what: 'the marks column reads the settings the card declares', run: checkC6a },
]

describe('the step screen in the mid column (ticket 73, read-only half)', () => {
  for (const check of CHECKS) {
    it(`${check.id} ${check.what}`, async () => {
      const w = mountEditor()
      try {
        await check.run(w)
      } finally {
        w.unmount()
      }
    })
  }

  /**
   * C1d · 降级形态那条路（S0 裁决 9 的第一条判据）：**横带**换一步，中栏也换。
   *
   * ⚠️ 横带那几颗按钮**没有 `data-*` 钩子**（`EditorShell.vue:128-137` 只有 `.band` 一个类），
   *    而本刀不许动 `src/` 的既有钩子面 ⇒ 只能按 `.band` 与结构认（与 `S10` 同一套读法）。
   * ⚠️ "它只在 ≤820px 出现"这一半 jsdom 量不到 —— 那一半在 `e2e/visual.spec.ts` 的
   *    `expectLandscapeShell`。
   */
  it('C1d the landscape band swaps the mid column too', async () => {
    const w = mountEditor()
    try {
      const band = w.find('.band')
      expect(band.exists(), 'the landscape band is missing').toBe(true)
      const buttons = () => band.findAll('button')
      expect(buttons().length, 'closed, the band hands out its toggle and nothing else').toBe(1)
      await buttons()[0].trigger('click')
      expect(buttons().length, 'opening the band must list every step of the card').toBe(1 + topology.length)
      await buttons()[2].trigger('click')
      const a = axesOf(w)
      expect(a.step, 'picking a step from the band must move the selection').toEqual([SECOND])
      expect(a.branch, 'the tree axis must stay empty when the band picks').toEqual([])
      const s = screenOf(w)
      expect(s.present, 'the band is the only entry in landscape: the mid column must follow it').toBe(true)
      expect(s.node, 'the mid column must show the step the band picked').toBe(SECOND)
    } finally {
      w.unmount()
    }
  })

  /**
   * C6b · R6 的边上那一档：卡里**没写** `settings` 的节点 ⇒ **一块都不 on**（票 76 的新语义）。
   *
   * ⚠️ 这一条**不在故障矩阵里**（它要换一张卡挂编辑器，替身那份是照示例卡长的）⇒ 反面控制写在它自己身上：
   *    同一张卡里**写了** `settings` 的那一步，on 的集合必须正好是它声明的几块。
   */
  it('C6b a step that writes no settings reads nothing at all', async () => {
    const absent = withoutSettings(NO_SETTINGS)
    expect(
      Object.hasOwn(absent.graph.nodes[NO_SETTINGS], 'settings'),
      'the fixture must really drop that key',
    ).toBe(false)
    const w = mountEditor(absent)
    try {
      await pickStep(w, NO_SETTINGS)
      const s = screenOf(w)
      expect(s.present, 'the fixture step must have a screen too').toBe(true)
      expect(
        s.marks.map((one) => one.key),
        'all five blocks must still be listed',
      ).toEqual(SETTING_KEYS)
      expect(
        s.marks.filter((one) => one.on).map((one) => one.key),
        'writing no settings means sending no block at all: nothing may be on',
      ).toEqual([])
      const other = topology.find((id) => id !== NO_SETTINGS && declaredSettings(id).length > 0) as string
      await pickStep(w, other)
      expect(
        screenOf(w)
          .marks.filter((one) => one.on)
          .map((one) => one.key),
        'a step that does declare blocks must still show them: without this the line above is a blanket',
      ).toEqual(declaredSettings(other))
    } finally {
      w.unmount()
    }
  })
})

// ---------- 自检：替身 + 故障注入（"0 红 = 没牙"的落地）----------

/** 铺进 `innerHTML` 的那点转义（卡里的正文带引号与 `<`） */
function esc(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** 一行元素（动作 / 枝名那种"值挂在属性上"的行） */
function rowHtml(attr: string, value: string): string {
  return `<li ${attr}="${esc(value)}">${esc(value)}</li>`
}

/** 那一屏的 HTML：`fault` 指名这一次把哪一样整条关掉 */
function screenHtml(fault: string, id: string): string {
  const node = nodes[id] as Record<string, any>
  // `blocks`：卡里没写的键也画一块（多画 = C3a 与 C5 一起红）
  const declared: string[] = Object.keys(node)
  const want = [...new Set([...declared, 'id', 'settings', ...(fault === 'blocks' ? ['role'] : [])])]
  const parts: string[] = []
  for (const key of want) {
    if (key === 'id') parts.push(`<p data-step-block="id">${esc(id)}</p>`)
    else if (key === 'name') parts.push(`<p data-step-block="name">${esc(node.name)}</p>`)
    else if (key === 'duty') parts.push(`<p data-step-block="duty">${esc(node.duty)}</p>`)
    else if (key === 'prompt') {
      // `prompt`：只画第一行（少画 = C3b 红）
      const lines: string[] = fault === 'prompt' ? node.prompt.slice(0, 1) : node.prompt
      parts.push(
        `<div data-step-block="prompt">${lines
          .map((line) => `<p data-step-prompt-line>${esc(line)}</p>`)
          .join('')}</div>`,
      )
    } else if (key === 'role') {
      // `rolectrl`：这一块里混进一个下拉（只该 C5 红 —— C4 挑的那一步没有 role）
      const extra = fault === 'rolectrl' ? '<select></select>' : ''
      parts.push(`<div data-step-block="role">${esc(node.role)}${extra}</div>`)
    } else if (key === 'tools') {
      const list: string[] = node.tools ?? []
      parts.push(
        `<div data-step-block="tools">${list.length === 0 ? 'none' : list.map((name) => rowHtml('data-step-tool', name)).join('')}</div>`,
      )
    } else if (key === 'reads') {
      const list: string[] = node.reads
      parts.push(
        `<div data-step-block="reads">${list.map((name) => rowHtml('data-step-read', name)).join('')}</div>`,
      )
    } else if (key === 'settings') {
      // `marks`：一律全勾（不看卡 = C6a 红）
      const on: string[] = fault === 'marks' ? SETTING_KEYS : (node.settings ?? [])
      parts.push(
        `<div data-step-block="settings"><ul data-card-resource-marks>${SETTING_KEYS.map(
          (block) =>
            `<li data-card-resource-mark="setting:${block}"${on.includes(block) ? ' data-card-resource-mark-on' : ''}>${block}</li>`,
        ).join('')}</ul></div>`,
      )
    }
  }
  const extra = fault === 'ctrl' ? '<input data-x>' : ''
  return `<div data-step-form data-step-node="${esc(id)}">${parts.join('')}${extra}</div>`
}

/** 铺那一屏：两条轴 + 中栏三态（`fault` 指名这一次把哪一样整条关掉） */
function stubHtml(fault: string, step: string, branch: string, frozen: string): string {
  // `frozen`：那一屏冻在第一次选中的那一步上（"换了步中栏不跟"的经典形状）
  const lit = fault === 'frozen' && frozen !== '' ? frozen : step
  const strip = topology
    .map(
      (id) =>
        `<button data-step="${id}"${id === step ? ' data-step-on' : ''}>${esc(nodes[id].name)}</button>`,
    )
    .join('')
  const tree = TREE_PATHS.map(
    (path) =>
      `<button data-branch-node="${esc(path)}"${path === branch ? ' data-branch-on' : ''}>${esc(path)}</button>`,
  ).join('')
  // `nostep`：选了一步也不出那一屏（今天真界面就是这个样子）
  const target = fault === 'nostep' ? '' : lit
  const mid =
    target !== ''
      ? screenHtml(fault, target)
      : branch !== ''
        ? '<div data-branch-form><input data-x></div>'
        : '<p data-branch-none></p>'
  const head = step !== '' ? nodes[step].name : branch
  return (
    '<header data-top></header>' +
    `<section data-col="content">${tree}</section>` +
    `<section data-col="flow">${strip}</section>` +
    `<section data-col="edit"><span data-branch-title>${esc(head)}</span><div data-mid>${mid}</div></section>`
  )
}

/**
 * 替身：一份照契约长的一屏（细条 + 树 + 中栏三态），`innerHTML` 铺出来、点击走事件委托。
 *
 * 它**不进产品**，只做一件事 —— 让上面那 11 条判据在一个「照契约做对了」的树上跑一遍：
 * 全绿 ⇒ 这些判据不是永远红的；再按 `fault` 把某一样**整条关掉** ⇒ 数它们红几条。
 */
const StepStub = defineComponent({
  name: 'StepScreenStub',
  props: { fault: { type: String, default: '' } },
  /** 两条轴：`step` 是细条选的、`branch` 是树选的（照契约长的时候互不清场才是故障） */
  setup(props) {
    const step = ref('')
    const branch = ref('')
    /** 那一屏第一次画出来是哪一步 —— `frozen` 就冻在它身上 */
    const frozen = ref('')
    /** 点到了哪个钩子：细条那一步走选中，树那一行也走选中（两条轴各自清场是照契约那一半） */
    const onClick = (event: MouseEvent) => {
      const el = event.target as Element
      const one = el.closest('[data-step]')
      if (one) {
        const id = one.getAttribute('data-step') ?? ''
        if (frozen.value === '') frozen.value = id
        step.value = id
        if (props.fault !== 'both') branch.value = ''
        return
      }
      const row = el.closest('[data-branch-node]')
      if (row) {
        branch.value = row.getAttribute('data-branch-node') ?? ''
        if (props.fault !== 'both') step.value = ''
      }
    }
    return () =>
      h('div', {
        'data-card-editor': '',
        innerHTML: stubHtml(props.fault, step.value, branch.value, frozen.value),
        onClick,
      })
  },
})

/** 挂一版替身：同一批判据在它身上跑，`fault` 决定关掉哪一样 */
function stub(fault: string): AnyWrapper {
  return mount(StepStub, {
    props: { fault },
    global: { plugins: [i18n] },
    attachTo: document.body,
  }) as AnyWrapper
}

/** 在替身上跑完那 11 条判据，返回红了的那些编号（**每条各挂一版**：判据之间不许互相带状态） */
async function redsOn(fault: string): Promise<string[]> {
  const red: string[] = []
  for (const check of CHECKS) {
    const w = stub(fault)
    try {
      await check.run(w)
    } catch (err) {
      if (process.env.ZOF73_DEBUG === '1') console.log(check.id + ' :: ' + (err as Error).message)
      red.push(check.id)
    } finally {
      w.unmount()
    }
  }
  return red
}

/**
 * 故障矩阵：一次整条关掉一样能力，数它红几条。第一条是**通道自检**（替身照契约长 ⇒ 0 红）。
 *
 * ⚠️ 这些数是**跑出来的**（`node .tools/zof69-vitest.mjs tests/step-form-dom.test.ts`），
 *    不是推出来的 —— 8b-① 那一票凭"注入 ⇒ 哪条会红"推期望值，错了四格。
 */
const FAULTS: Array<{ fault: string; reds: string[] }> = [
  { fault: '', reds: [] },
  // `both`：两条轴互不清场 —— 今天真界面就是这个行为，C2 要咬的正是它
  { fault: 'both', reds: ['C2'] },
  // `nostep`：选了一步也不出那一屏 —— 今天真界面就是这个行为
  { fault: 'nostep', reds: ['C1a', 'C1b', 'C2', 'C3a', 'C3b', 'C3c', 'C3d', 'C4', 'C5', 'C6a'] },
  { fault: 'ctrl', reds: ['C4'] },
  { fault: 'rolectrl', reds: ['C5'] },
  { fault: 'blocks', reds: ['C3a', 'C5'] },
  { fault: 'prompt', reds: ['C3b'] },
  { fault: 'marks', reds: ['C6a'] },
  // `frozen`：那一屏冻在第一次选中的那一步上（C2 也红：轴空了屏还挂着，那是"轴与中栏一一对应"那一句）
  { fault: 'frozen', reds: ['C1b', 'C2', 'C3a', 'C3c', 'C5', 'C6a'] },
]

describe('self-check: these criteria can go red, and by how much', () => {
  for (const one of FAULTS) {
    it(`T ${one.fault || 'as-contracted'} turns exactly [${one.reds.join(' ')}] red`, async () => {
      const red = await redsOn(one.fault)
      // `ZOF73_DEBUG=1` 时打一行机器可读的读数：改判据之后重算这张表靠它
      if (process.env.ZOF73_DEBUG === '1') {
        console.log('ZOF73 ' + (one.fault || 'as-contracted') + ' => [' + red.join(' ') + ']')
      }
      expect(red).toEqual(one.reds)
    })
  }
})
