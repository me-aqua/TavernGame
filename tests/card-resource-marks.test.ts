// @vitest-environment jsdom
/**
 * 票 56：卡编辑器里的**资源勾选区** —— 勾上 = 这个节点读这一块，取消勾 = 不写这个键。
 *
 * 契约 `.team/test/2026-09-17/contract-56.md`。这一份只管「勾选写回卡」这一层；
 * 写回去之后**发出去的请求**长什么样，在 `card-resource-request.test.ts` 里量。
 *
 * ⚠️ **挂的是 `CardEditor`，不是 `CardNodeForm`**：写回整份卡与跑校验是**外层**的事
 *    （见 `CardEditor.vue` 文件头「保存走与导入同一套校验」）—— 直接挂表单就等于要求
 *    表单自己会写卡，那是替产品改结构。所以这里走的是**用户真走的那条路**：
 *    点卡图上一个节点 → 表单出来 → 动勾选框 → 外层写回。
 *
 * ⚠️ 三条口径都落在这里：
 *   ① 取消勾 = **不写这个键**（不是写空表 —— 空表会被校验器拒，而且语义正好相反）；
 *   ② 一列里**至少留一个**勾上：空表在卡格式里表达不出来，而「不写这个键」= 五块全发；
 *   ③ 勾选只动它自己那一列，别的字段一个字节不动。
 */
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import { i18n } from '../src/i18n'
import {
  CARD_KEY,
  EXAMPLE,
  declaredSettings,
  savedCard,
  withEveryDeclaration,
} from './support/card-resources'
import { label, setLocale } from './support/trace-blocks'
import type { CardData } from '../src/game/card'

/** 卡里五块设定的键（顺序就是卡的声明顺序） */
const SETTING_KEYS = Object.keys(EXAMPLE.settings)

/** 写全了声明的卡（示例卡里没有这样的节点：用来跑「取消到最后一个」这条来回） */
const FULL = withEveryDeclaration(EXAMPLE)

/** 只写 `settings`、没写 style 的那一个节点 */
const NO_STYLE = EXAMPLE.graph.topology.find(
  (id) =>
    declaredSettings(EXAMPLE, id) !== undefined && !(declaredSettings(EXAMPLE, id) ?? []).includes('style'),
) as string

/** 没写 `settings` 的节点（界面上五块全勾；取消勾之后要能回落到「不写这个键」那一档） */
const NO_SETTINGS = EXAMPLE.graph.topology.find((id) => declaredSettings(EXAMPLE, id) === undefined) as string

/** vue-flow 的替身：每个节点一个按钮（点 = 选中那个节点）——与 card-ui.test.ts 同一套做法 */
const VueFlowStub = defineComponent({
  name: 'VueFlow',
  props: { nodes: { type: Array, required: true }, edges: { type: Array, required: true } },
  emits: ['nodeClick'],
  /** 画一层按钮，点谁就把 nodeClick 抛上来 */
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

/** 一个节点在卡里**本来**声明了哪几块设定（没写这个键 = 五块全发）—— 期望值一律从它现取 */
function originalSettings(card: CardData, node: string): string[] {
  return declaredSettings(card, node) ?? SETTING_KEYS
}

/** 这个节点的**真实声明**去掉一块 —— 「取消勾一块」之后卡里应当是什么，就是它 */
function settingsWithout(card: CardData, node: string, block: string): string[] {
  return originalSettings(card, node).filter((key) => key !== block)
}

/** 打开卡编辑器并选中一个节点：表单与勾选区就都在了 */
async function editor(card: CardData, node: string): Promise<VueWrapper> {
  const w = mount(CardEditor, {
    props: { card, source: 'builtin' },
    global: { plugins: [i18n], stubs: { VueFlow: VueFlowStub } },
  })
  await w.find('[data-node="' + node + '"]').trigger('click')
  return w
}

/** 一枚勾选框：`setting:<块名>` / `generator:<生成器名>` */
function box(w: VueWrapper, kind: 'setting' | 'generator', name: string) {
  return w.find('[data-card-resource-mark="' + kind + ':' + name + '"]')
}

/** 勾选框上的名字（去掉那一列的前缀） */
function markName(el: { attributes(name: string): string | undefined }, kind: string): string {
  return (el.attributes('data-card-resource-mark') as string).slice(kind.length + 1)
}

/** 一列里**列出来的**名字（顺序 = 界面顺序）—— 名单类判据都从它来 */
function marks(w: VueWrapper, kind: 'setting' | 'generator'): string[] {
  return w.findAll('[data-card-resource-mark^="' + kind + ':"]').map((entry) => markName(entry, kind))
}

/** 一列里勾上的名字（顺序 = 界面顺序） */
function checked(w: VueWrapper, kind: 'setting' | 'generator'): string[] {
  return w
    .findAll('[data-card-resource-mark^="' + kind + ':"]')
    .filter((entry) => (entry.element as HTMLInputElement).checked)
    .map((entry) => markName(entry, kind))
}

/**
 * 取消勾一个 / 勾上一个（写回卡是外层的事，走的是产品那条路径）。
 *
 * ⚠️ **`setValue` 不查 `disabled`**（VTU 的 `setChecked` 直接改 `element.checked`），
 * 所以它**能**把「最后一块」那枚锁住的框点掉 —— 要证「点不动」必须用 `trigger('click')`
 * （VTU 的 `trigger` 会先判 `isDisabled()`）。用例 13 用的正是 `trigger`。
 */
async function uncheck(w: VueWrapper, kind: 'setting' | 'generator', name: string) {
  await box(w, kind, name).setValue(false)
}

async function check(w: VueWrapper, kind: 'setting' | 'generator', name: string) {
  await box(w, kind, name).setValue(true)
}

describe('CardEditor: the resource checkboxes on a node', () => {
  it('lists the five setting blocks under the names the resource panel uses', async () => {
    const w = await editor(EXAMPLE, NO_STYLE)
    expect(marks(w, 'setting')).toEqual(SETTING_KEYS)

    const labelText = label('prompts.settingBlock.' + SETTING_KEYS[0])
    for (const locale of ['zh-CN', 'en'] as const) {
      setLocale(locale)
      expect(w.find('[data-card-resource-marks]').text(), locale).toContain(labelText)
    }
    setLocale('zh-CN')
  })

  it('checks every block when the node wrote no settings (absent means all five)', async () => {
    const w = await editor(EXAMPLE, NO_SETTINGS)
    expect(declaredSettings(EXAMPLE, NO_SETTINGS)).toBeUndefined()
    expect(checked(w, 'setting')).toEqual(SETTING_KEYS)
  })

  it('unchecking one block writes the remaining ones, and only that field changes', async () => {
    const w = await editor(EXAMPLE, NO_STYLE)
    await uncheck(w, 'setting', 'world')

    const stored = savedCard()
    // ⚠️ 期望值从**这个节点的声明**现取：它只声明四块（没有 style），取消 world 之后应当剩三块
    expect(originalSettings(EXAMPLE, NO_STYLE)).toHaveLength(4)
    expect(declaredSettings(stored, NO_STYLE)).toEqual(settingsWithout(EXAMPLE, NO_STYLE, 'world'))
    const before = EXAMPLE.graph.nodes[NO_STYLE]
    const after = stored.graph.nodes[NO_STYLE]
    expect(after.tools).toEqual(before.tools)
    expect(after.reads).toEqual(before.reads)
    expect(after.prompt).toEqual(before.prompt)
    expect(after.name).toBe(before.name)
    expect(after.duty).toBe(before.duty)
  })

  it('checking a block back on writes the full list, key and all', async () => {
    const w = await editor(FULL, NO_SETTINGS)
    await uncheck(w, 'setting', 'style')
    expect(declaredSettings(savedCard(), NO_SETTINGS)).toEqual(settingsWithout(FULL, NO_SETTINGS, 'style'))

    await check(w, 'setting', 'style')
    expect(declaredSettings(savedCard(), NO_SETTINGS)).toEqual(originalSettings(FULL, NO_SETTINGS))
    expect(localStorage.getItem(CARD_KEY)).not.toBeNull()
  })

  it('never lets the last checked block go: it is disabled, says why, and a click does nothing', async () => {
    const w = await editor(EXAMPLE, NO_SETTINGS)
    for (const key of originalSettings(EXAMPLE, NO_SETTINGS).slice(1)) await uncheck(w, 'setting', key)

    expect(checked(w, 'setting')).toEqual([SETTING_KEYS[0]])
    const last = box(w, 'setting', SETTING_KEYS[0])
    expect(last.attributes('disabled')).toBeDefined()
    expect(w.find('[data-card-resource-marks]').text()).toContain(label('card.resourceAtLeastOne'))

    // 点它也没用：界面上「点了却没生效」比直接不让点更坏。
    // ⚠️ 这一条**只有在用 `trigger('click')` 时才成立** —— `setValue` 不查 `disabled`，
    //    换成 `setValue(false)` 会把它点掉，于是这条守卫变成假绿（评审实测过这一对行为）。
    await last.trigger('click')
    expect(checked(w, 'setting')).toEqual([SETTING_KEYS[0]])
    expect(declaredSettings(savedCard(), NO_SETTINGS)).toEqual([SETTING_KEYS[0]])
  })
})
