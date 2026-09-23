// @vitest-environment jsdom
/**
 * 卡编辑器里的**资源勾选区** —— 勾上 = 这个节点读这一块，取消勾 = 不写这个键。
 *
 * 契约 `.team/test/2026-09-17/contract-56.md`。这一份只管「勾选写回卡」这一层；
 * 写回去之后**发出去的请求**长什么样，在 `card-resource-request.test.ts` 里量。
 *
 * ⚠️ **挂的是 `CardEditor`，不是 `CardNodeForm`**：写回整份卡与跑校验是**外层**的事
 *    （见 `CardEditor.vue` 文件头「保存走与导入同一套校验」）—— 直接挂表单就等于要求
 *    表单自己会写卡，那是替产品改结构。所以这里走的是**用户真走的那条路**：
 *    在细条上点一步 → 那一屏出来 → 动勾选框 → 外层写回。
 *
 * ⚠️ 三条口径都落在这里：
 *   ① 取消勾 = **不写这个键**（不是写空表 —— 空表会被校验器拒；票 76 之后它与「不写」
 *      在**引擎端**等价，但**卡格式端**仍然拒，两句话别混）；
 *   ② 一列里**至少留一个**勾上（这一条锁的理由在票 76 之后要重看，见文件末）；
 *   ③ 勾选只动它自己那一列，别的字段一个字节不动。
 *
 * 🔴 **票 69（段 8b-①）把这一组整条挂起了**（契约 `.team/test/2026-09-22/contract-69.md`
 *    §5 第 3 项）。票 73（段 8c-①）把接缝接回来：入口是**细条上那一步**（不再是卡图的
 *    `[data-node]`），那一屏**只读** ⇒ **两条属"读"的用例解封**（名单 + 双语、未声明那一档），
 *    六条属"写"的仍然挂起（它们要的是**写路径**，归 8c-②，按"草稿 + 保存"改写）。
 *
 * ⚠️ **票 76 改了 `settings` 的缺省语义**（不写 = 一块都不发）⇒ 「未声明」那一条用例读的是
 *    **一块都不勾**，而且示例卡里已经挑不出"没写这个键"的节点 ⇒ 它自己造一张卡。
 * ⚠️ **只读那一屏里没有 `<input>`** ⇒ 「勾上了哪几块」这一读法改成读行上的
 *    `data-card-resource-mark-on`（`.checked` 只有输入控件有）。
 */
import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import { i18n } from '../src/i18n'
import { type CardData } from '../src/game/card'
import {
  CARD_KEY,
  EXAMPLE,
  declaredSettings,
  savedCard,
  withEveryDeclaration,
  withoutSettings,
} from './support/card-resources'
import { label, setLocale } from './support/trace-blocks'

/** 卡里五块设定的键（顺序就是卡的声明顺序） */
const SETTING_KEYS = Object.keys(EXAMPLE.settings)

/** 写全了声明的卡（示例卡里没有这样的节点：用来跑「取消到最后一个」这条来回） */
const FULL = withEveryDeclaration(EXAMPLE)

/**
 * 卡里没写 `settings` 的那一步 —— **本地夹具造出来的**：示例卡按票 76 补齐之后，
 * 八步全都有显式声明，卡里再也挑不出「没写这个键」的节点（S0 §五 裁决 3）。
 *
 * ⚠️ 节点**写死**（不现找），而且**别的夹具节点不许是它**（见下面 `NO_STYLE` 的注释）。
 */
const NO_SETTINGS = EXAMPLE.graph.topology[0]

/**
 * 「只写 `settings`、没写 style」的那一个节点 —— 别处用例拿它当"有声明的那一步"。
 *
 * 🔴 **必须排掉 `NO_SETTINGS`**：两个夹具撞成同一个节点的话，凡是要"拿有声明的那一步当对照"
 * 的断言都会变成永远红的假红（票 76 的 S2 在 `card-resource-request.test.ts` 里实测踩过一次）。
 */
const NO_STYLE = EXAMPLE.graph.topology.find(
  (id) =>
    id !== NO_SETTINGS &&
    declaredSettings(EXAMPLE, id) !== undefined &&
    !(declaredSettings(EXAMPLE, id) ?? []).includes('style'),
) as string

/** 一份本地造的卡：那一步的 `settings` 被整个删掉（"不写这个键"那一档的唯一造法） */
function absentCard(): CardData {
  const absent = withoutSettings(EXAMPLE, NO_SETTINGS)
  expect(declaredSettings(absent, NO_SETTINGS), NO_SETTINGS + ' must declare nothing').toBeUndefined()
  return absent
}

/** 一个节点在卡里**本来**声明了哪几块设定（没写这个键 = 一块都不发，票 76 的语义）—— 期望值一律从它现取 */
function originalSettings(card: CardData, node: string): string[] {
  return declaredSettings(card, node) ?? []
}

/** 这个节点的**真实声明**去掉一块 —— 「取消勾一块」之后卡里应当是什么，就是它 */
function settingsWithout(card: CardData, node: string, block: string): string[] {
  return originalSettings(card, node).filter((key) => key !== block)
}

/** 打开卡编辑器并在**细条上选中一步**：那一屏与勾选区就都在了 */
async function editor(card: CardData, node: string): Promise<VueWrapper> {
  const w = mount(CardEditor, {
    props: { card, source: 'builtin' },
    global: { plugins: [i18n] },
  })
  const step = w.find('[data-step="' + node + '"]')
  expect(step.exists(), 'no step for this node in the strip: ' + node).toBe(true)
  await step.trigger('click')
  return w
}

/** 一枚勾选标记：`setting:<块名>` / `generator:<生成器名>` */
function box(w: VueWrapper, kind: 'setting' | 'generator', name: string) {
  return w.find('[data-card-resource-mark="' + kind + ':' + name + '"]')
}

/** 勾选标记上的名字（去掉那一列的前缀） */
function markName(el: { attributes(name: string): string | undefined }, kind: string): string {
  return (el.attributes('data-card-resource-mark') as string).slice(kind.length + 1)
}

/** 一列里**列出来的**名字（顺序 = 界面顺序）—— 名单类判据都从它来 */
function marks(w: VueWrapper, kind: 'setting' | 'generator'): string[] {
  return w.findAll('[data-card-resource-mark^="' + kind + ':"]').map((entry) => markName(entry, kind))
}

/** 一列里**读到了**的名字（顺序 = 界面顺序）—— 只读那一屏靠行上的标记报这件事 */
function checked(w: VueWrapper, kind: 'setting' | 'generator'): string[] {
  return w
    .findAll('[data-card-resource-mark^="' + kind + ':"]')
    .filter((entry) => entry.attributes('data-card-resource-mark-on') !== undefined)
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

  it('reads no block at all when the node wrote no settings (absent means none)', async () => {
    const w = await editor(absentCard(), NO_SETTINGS)
    // 五块照样列出来（"这一栏有哪几块"不随卡变），变的是**哪几块被读到**
    expect(marks(w, 'setting')).toEqual(SETTING_KEYS)
    expect(checked(w, 'setting')).toEqual([])
  })

  it.skip('unchecking one block writes the remaining ones, and only that field changes', async () => {
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

  it.skip('checking a block back on writes the full list, key and all', async () => {
    const w = await editor(FULL, NO_SETTINGS)
    await uncheck(w, 'setting', 'style')
    expect(declaredSettings(savedCard(), NO_SETTINGS)).toEqual(settingsWithout(FULL, NO_SETTINGS, 'style'))

    await check(w, 'setting', 'style')
    expect(declaredSettings(savedCard(), NO_SETTINGS)).toEqual(originalSettings(FULL, NO_SETTINGS))
    expect(localStorage.getItem(CARD_KEY)).not.toBeNull()
  })

  it.skip('never lets the last checked block go: it is disabled, says why, and a click does nothing', async () => {
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

/**
 * 这一组现在的状态（票 73 交回时）：
 *
 * - **两条属"读"的解封了**（名单 + 双语、未声明那一档），它们读的是那一屏的**显示**；
 * - **三条属"写"的仍然挂起**（`uncheck` / `check` 那三条）：它们要的是**写路径**，
 *   而且假设"勾完即落盘"，与 8b-② 立的「草稿 + 顶栏保存」正面冲突
 *   ⇒ **押后到 8c-②**，按"勾完再点保存"改写；
 * - `card-resource-request.test.ts` 那三条（写 + 端到端）同理。
 *
 * ⚠️ **"最后一块锁住"那条口径的来源变了**：它拦的是「空表表达不出"一块都不发"」这件事，
 *    而票 76 之后「一块都不发」＝**不写这个键**，表达得出来 ⇒ 那把锁的**理由消失**。
 *    要不要留着它，是 8c-② 的界面口径（组长裁）。
 */
