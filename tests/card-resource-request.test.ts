// @vitest-environment jsdom
/**
 * 票 56 最值钱的一条：**界面改的是卡，卡改的是请求**。
 *
 * 契约 `.team/test/2026-09-17/contract-56.md` §5。判据不是「卡里的 `node.settings` 变了」——
 * 那只是中间站。这里走的是完整那条链：
 *   编辑器里的勾选 / 编辑 → 写进存储的那张卡（`parseCard` 读回来）→ `buildNodeMessages` 真装配
 *   → `chat()` 拼请求体 → **假 fetch 记下来的那条请求**。
 *
 * ⚠️ 请求一侧的「在不在」用**卡正文里的标志行**（设置块的第一条非空行 / 生成器的第一条原则）：
 *    卡的内容不随界面语言变，于是同一份断言在 zh-CN 与 en 下都成立；段标题只在语言那一组里
 *    跟着 `t()` 比（标题随语言变，用标志行去判标题会两边都判不出来）。
 *
 * 🔴 **票 69（段 8b-①）挂起了三条**（契约 `.team/test/2026-09-22/contract-69.md` §5 第 4 项）：
 *    那三条的入口是 `marks()`（点卡图上一个节点 → 动勾选框），而 8b-① 把卡图与节点表单一起
 *    移出了编辑器 ⇒ 点不到节点。处置与 `card-resource-marks.test.ts` 同一句：**整体等 8c/8d**
 *    （`it.skip`，不是删掉）。留在这里的两条不经过那个入口：一条走资源面板
 *    （`CardResources`），一条直接装配请求（「没写这个键 = 五块全发」那半的守卫）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import CardResources from '../src/components/CardResources.vue'
import { i18n, t } from '../src/i18n'
import {
  EXAMPLE,
  declaredSettings,
  markerOf,
  savedCard,
  withEveryDeclaration,
} from './support/card-resources'
import { fakeTracker, label, nodeRequest, setLocale } from './support/trace-blocks'
import type { CardData } from '../src/game/card'

/** 卡里五块设定的键（顺序就是卡的声明顺序） */
const SETTING_KEYS = Object.keys(EXAMPLE.settings)

/** 编辑 / 勾选用例碰的第一块与「只写 settings、没写 style」的那个节点 */
const FIRST_BLOCK = SETTING_KEYS[0]
const NO_STYLE = EXAMPLE.graph.topology.find(
  (id) =>
    declaredSettings(EXAMPLE, id) !== undefined && !(declaredSettings(EXAMPLE, id) ?? []).includes('style'),
) as string

/**
 * **没写 `settings`** 的节点 —— 「不写这个键 = 五块全发」只有它测得到。
 *
 * ⚠️ 别拿 `NO_STYLE` 当它：那个节点**写了**声明、只是里面没有 `style`，
 * 所以它**永远拿不到 `style` 那一块**，用它断言「五块全在」是自相矛盾（用例 19 原来就是这么错的）。
 */
const NO_SETTINGS = EXAMPLE.graph.topology.find((id) => declaredSettings(EXAMPLE, id) === undefined) as string
/** 每个用例自己装假 fetch，跑完一律还原（否则下一条用例跑到别人的假响应上） */
const track = fakeTracker()
afterEach(() => track.restoreAll())

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

/** 挂载资源库面板（卡从 props 进，改完的卡写回存储） */
function panel(card: CardData = EXAMPLE) {
  return mount(CardResources, {
    props: { card, error: '' },
    global: { plugins: [i18n] },
  })
}

/** 打开卡编辑器并选中节点：勾选框走的是**用户真走的那条路**（外层写回整份卡） */
async function marks(card: CardData, node: string): Promise<VueWrapper> {
  const w = mount(CardEditor, {
    props: { card, source: 'builtin' },
    global: { plugins: [i18n], stubs: { VueFlow: VueFlowStub } },
  })
  await w.find('[data-node="' + node + '"]').trigger('click')
  return w
}

/** 发起一次真请求，返回**发出去的那条 system 消息**（模型真会读到的那份文本） */
async function systemOf(card: CardData, node: string): Promise<string> {
  const { sent } = await nodeRequest(track, card, node)
  const system = sent.find((message) => message.role === 'system')
  if (system === undefined) throw new Error('the request carried no system message')
  return system.content
}

/** 一条标志行（块 / 生成器）现在在不在那条请求里 */
function carries(system: string, marker: string): boolean {
  return system.includes(marker)
}

/** 一个节点在卡里**本来**声明了哪几块设定（没写这个键 = 五块全发）—— 期望值一律从它现取 */
function originalSettings(card: CardData, node: string): string[] {
  return declaredSettings(card, node) ?? SETTING_KEYS
}

describe('card resources: the request follows the checkboxes', () => {
  it('a block edited in the resource panel really travels in the next request', async () => {
    setLocale('zh-CN')
    const before = await systemOf(EXAMPLE, NO_STYLE)
    // 起点：这块本来发给它 —— 否则下面的「变了」证明不了什么
    expect(carries(before, markerOf(EXAMPLE, FIRST_BLOCK))).toBe(true)
    expect(carries(before, '### ' + label('prompts.settingBlock.' + FIRST_BLOCK))).toBe(true)

    const w = panel()
    await w.find('[data-card-resource="' + FIRST_BLOCK + '"] [data-card-resource-open]').trigger('click')
    await w
      .find('[data-card-resource="' + FIRST_BLOCK + '"] [data-card-resource-text]')
      .setValue('a line the model must read\nand one more')
    await w.find('[data-card-resource="' + FIRST_BLOCK + '"] [data-card-resource-save]').trigger('click')

    const after = await systemOf(savedCard(), NO_STYLE)
    expect(carries(after, 'a line the model must read')).toBe(true)
    expect(carries(after, markerOf(EXAMPLE, FIRST_BLOCK))).toBe(false)
    // 别处一个字没动：换了的是这一块，不是整段提示词
    expect(carries(after, markerOf(EXAMPLE, SETTING_KEYS[1]))).toBe(true)
  })

  it.skip('unchecking a block takes it out of that node request, and leaves the others alone', async () => {
    const w = await marks(EXAMPLE, NO_STYLE)
    await w.find('[data-card-resource-mark="setting:' + FIRST_BLOCK + '"]').setValue(false)

    const after = await systemOf(savedCard(), NO_STYLE)
    // ⚠️ 名单要钉死（评审 F2）：只断「长度 > 1」是同义反复 —— 循环的迭代集合得是**已知的那几块**。
    //    ⚠️ 钉的必须是**这个夹具节点真实的声明**：它是「五块去掉 style」（`world/core/common/lead`），
    //       不是卡里的那五块 —— 拿后者要求一个不读 `style` 的节点，就是本票反复出现的那件事。
    expect(declaredSettings(EXAMPLE, NO_STYLE), 'the fixture node must declare').toBeDefined()
    const declared = originalSettings(EXAMPLE, NO_STYLE)
    const left = declared.filter((key) => key !== FIRST_BLOCK)
    expect(declared, 'this node declares four blocks (it does not read style)').toEqual([
      'world',
      'core',
      'common',
      'lead',
    ])
    expect(left, 'cancelling one block must leave a known list').toEqual(['core', 'common', 'lead'])
    expect(declaredSettings(savedCard(), NO_STYLE)).toEqual(left)
    expect(carries(after, markerOf(EXAMPLE, FIRST_BLOCK))).toBe(false)
    expect(carries(after, '### ' + label('prompts.settingBlock.' + FIRST_BLOCK))).toBe(false)
    // 没取消的那几块逐块都还在（**这个节点读得到的**那几块，不是卡里那五块）
    for (const key of left) {
      expect(carries(after, markerOf(EXAMPLE, key)), key).toBe(true)
    }
  })

  it.skip('checking a block back on puts it back into the request', async () => {
    const w = await marks(withEveryDeclaration(EXAMPLE), NO_STYLE)
    const box = '[data-card-resource-mark="setting:' + FIRST_BLOCK + '"]'
    await w.find(box).setValue(false)
    expect(carries(await systemOf(savedCard(), NO_STYLE), markerOf(EXAMPLE, FIRST_BLOCK))).toBe(false)

    await w.find(box).setValue(true)
    const after = await systemOf(savedCard(), NO_STYLE)
    expect(carries(after, markerOf(EXAMPLE, FIRST_BLOCK))).toBe(true)
    expect(carries(after, '### ' + label('prompts.settingBlock.' + FIRST_BLOCK))).toBe(true)
  })

  it('a node that had nothing checked from the start still carries all five (the absent key)', async () => {
    // ⚠️ 这一条是「不勾 = 不写这个键」那半的守卫：卡里没写这个键 = 五块全发。
    //    最坏的一种实现（勾选集为空也不写键 ⇒ 静默变成「一块都不发」）会让它红。
    // ⚠️ 节点必须是**没写 `settings`** 的那个：`NO_STYLE` 写了声明、只是没有 `style`，
    //    拿它断言「五块全在」自相矛盾（这一条原来就是这么错的，见契约 §0 ⑧）。
    expect(declaredSettings(EXAMPLE, NO_SETTINGS), NO_SETTINGS + ' must declare nothing').toBeUndefined()
    const system = await systemOf(EXAMPLE, NO_SETTINGS)
    for (const key of SETTING_KEYS) expect(carries(system, markerOf(EXAMPLE, key)), key).toBe(true)
  })

  it.skip('holds in English too', async () => {
    setLocale('en')
    const w = await marks(EXAMPLE, NO_STYLE)
    await w.find('[data-card-resource-mark="setting:' + FIRST_BLOCK + '"]').setValue(false)

    const after = await systemOf(savedCard(), NO_STYLE)
    expect(carries(after, markerOf(EXAMPLE, FIRST_BLOCK))).toBe(false)
    expect(carries(after, t('prompts.settingBlock.' + FIRST_BLOCK))).toBe(false)
    expect(carries(after, markerOf(EXAMPLE, SETTING_KEYS[1]))).toBe(true)
  })
})
