// @vitest-environment jsdom
/**
 * 卡界面的组件测试：卡图（节点数与选中）、编辑表单（改了什么就抛什么）、卡一节
 * （来源与四个动作），以及「点节点 → 改提示词 → 保存」这条完整链路。
 *
 * 保存那一步断言的是**真的落到 localStorage 垫片上**的那一刻（组件只 emit saved，
 * reload 是外层 App 的事）—— 不依赖真实下载，也不依赖真实 reload。
 *
 * vue-flow 要 ResizeObserver 量尺寸，jsdom 里没有 —— 换成替身：它把每个节点画成一个
 * 按钮、点了把 nodeClick 抛上来，于是「点节点出表单」也测得到。画面本身归组件故事巡检
 * （npm run stories）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import CardGraph from '../src/components/CardGraph.vue'
import CardNodeForm from '../src/components/CardNodeForm.vue'
import CardSection from '../src/components/CardSection.vue'
import cardGraphStory, { Failed, Running, Selected } from '../src/components/CardGraph.stories'
import { parseCard } from '../src/game/card'
import { toGraph } from '../src/game/card-layout'
import * as K from '../src/game/card-keys'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { i18n, t } from '../src/i18n'

/** 示例卡（节点数、名字与提示词全部从卡里现读：卡是唯一事实来源） */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
const graph = toGraph(card)
const declared = card[K.KEY_DECL] as Record<string, any>
const topology = (declared[K.KEY_GRAPH] as Record<string, any>)[K.KEY_TOPOLOGY] as string[]
const nodes = (declared[K.KEY_GRAPH] as Record<string, any>)[K.KEY_NODES] as Record<
  string,
  Record<string, string>
>
const prompts = (card[K.KEY_PROMPT] as Record<string, any>)[K.KEY_NODES] as Record<string, string[]>

/** 活动卡的存储键（与产品一致） */
const CARD_KEY = 'tavernGame.card'

/** 替身看到的一个节点（只用到这两处） */
interface StubNode {
  id: string
  data: { label: string }
}

/** 把替身里的一个节点画成按钮：点了就把 nodeClick 抛上去（真 vue-flow 由点按命中判定） */
function nodeButton(node: StubNode, emit: (event: 'nodeClick', payload: unknown) => void) {
  return h('button', { 'data-node': node.id, onClick: () => emit('nodeClick', { node }) }, node.data.label)
}

/** vue-flow 的替身：只记 props，节点渲染成按钮 */
const VueFlowStub = defineComponent({
  name: 'VueFlow',
  props: { nodes: { type: Array, required: true }, edges: { type: Array, required: true } },
  emits: ['nodeClick'],
  /** 画一层 div，里面每个节点一个按钮（点了就 nodeClick） */
  setup:
    (props, { emit }) =>
    () =>
      h(
        'div',
        { class: 'flow-stub' },
        (props.nodes as StubNode[]).map((node) => nodeButton(node, emit)),
      ),
})

/** 挂载组件并接上真实 i18n 实例（与别的组件测试同一套） */
function render<C>(component: C, options: Record<string, unknown> = {}) {
  const global = { plugins: [i18n], ...(options.global as Record<string, unknown> | undefined) }
  return mount(
    component as Parameters<typeof mount>[0],
    { ...options, global } as Parameters<typeof mount>[1],
  )
}

/** 交给 vue-flow 的那份节点数据（高亮是样式，这里断言数据里的标记） */
function flowNodes(props: Record<string, unknown> = {}) {
  const w = render(CardGraph, { props: { card, ...props }, global: { stubs: { VueFlow: VueFlowStub } } })
  return w.findComponent(VueFlowStub).props('nodes') as Array<{
    id: string
    data: { active: boolean; failed: boolean; selected: boolean }
  }>
}

describe('CardGraph', () => {
  it('hands the parsed card to vue-flow as nodes and edges', () => {
    const w = render(CardGraph, { props: { card }, global: { stubs: { VueFlow: VueFlowStub } } })
    const flow = w.findComponent(VueFlowStub)
    const drawn = flow.props('nodes') as Array<{ id: string; data: { label: string } }>
    expect(drawn.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id))
    expect(drawn[0].data.label).toBe(graph.nodes[0].label)
    expect(flow.props('edges')).toHaveLength(graph.edges.length)
  })

  it('flags exactly the running node, and nothing when the props are omitted', () => {
    const running = graph.nodes[4].id

    const drawn = flowNodes({ active: running })
    expect(drawn.filter((node) => node.data.active).map((node) => node.id)).toEqual([running])
    expect(drawn.every((node) => !node.data.failed && !node.data.selected)).toBe(true)

    const plain = flowNodes()
    expect(plain.every((node) => !node.data.active && !node.data.failed)).toBe(true)
  })

  it('flags the failed node, and failure wins over running', () => {
    const broken = graph.nodes[2].id
    // 挂掉的节点同时就是「正在跑」的那一个：只该亮失败色
    const drawn = flowNodes({ active: broken, failed: broken })

    expect(drawn.filter((node) => node.data.failed).map((node) => node.id)).toEqual([broken])
    expect(drawn.filter((node) => node.data.active)).toEqual([])
  })

  it('flags the selected node so the editor can show which one it is editing', () => {
    const picked = graph.nodes[1].id
    const drawn = flowNodes({ selected: picked })

    expect(drawn.filter((node) => node.data.selected).map((node) => node.id)).toEqual([picked])
  })

  it('lets a click on a node out as select', async () => {
    const w = render(CardGraph, { props: { card }, global: { stubs: { VueFlow: VueFlowStub } } })
    await w.find('[data-node="' + topology[0] + '"]').trigger('click')

    expect(w.emitted('select')?.[0]).toEqual([topology[0]])
  })

  it('highlights nodes that exist in the card (the stories do not hardcode ids)', () => {
    for (const id of [Running.args?.active, Failed.args?.failed, Selected.args?.selected]) {
      expect(graph.nodes.map((node) => node.id)).toContain(id)
    }
  })

  it('spells the node and edge counts in the story title, counted from the card', () => {
    // 故事标题是字面量（Storybook 不许动态标题），所以在这里守住它 —— 卡改了它会红。
    // 测试代码必须 ASCII，标题里的中文（组件 / 节点 / 边）转义写
    const expected =
      '\u7ec4\u4ef6/CardGraph\uff08' +
      graph.nodes.length +
      ' \u8282\u70b9 / ' +
      graph.edges.length +
      ' \u8fb9\uff09'
    expect(cardGraphStory.title).toBe(expected)
  })

  it('marks read edges for the dashed style, leaves the rest solid, and writes no labels', () => {
    const w = render(CardGraph, { props: { card }, global: { stubs: { VueFlow: VueFlowStub } } })
    const edges = w.findComponent(VueFlowStub).props('edges') as Array<{ class: string; label?: string }>
    const reads = graph.edges.filter((edge) => edge.read).length
    expect(edges.filter((edge) => edge.class === 'card-graph-read')).toHaveLength(reads)
    expect(edges.filter((edge) => edge.class === 'card-graph-flow')).toHaveLength(graph.edges.length - reads)
    // 虚线不写字：上游是拓扑前缀推出来的，边上没有文字
    expect(edges.every((edge) => edge.label === undefined)).toBe(true)
  })
})

describe('CardNodeForm', () => {
  /** 常态 props：三个可改字段 + 只读输出 */
  function formProps(over: Record<string, unknown> = {}) {
    return {
      id: topology[0],
      name: nodes[topology[0]][K.KEY_NODE_NAME],
      duty: nodes[topology[0]][K.KEY_DUTY],
      output: nodes[topology[0]][K.KEY_OUTPUT],
      prompt: prompts[topology[0]],
      ...over,
    }
  }

  it('shows the three editable fields, the read-only output, and no error by default', () => {
    const w = render(CardNodeForm, { props: formProps() })

    expect((w.find('[data-card-name]').element as HTMLInputElement).value).toBe(
      nodes[topology[0]][K.KEY_NODE_NAME],
    )
    expect((w.find('[data-card-duty]').element as HTMLInputElement).value).toBe(
      nodes[topology[0]][K.KEY_DUTY],
    )
    expect((w.find('[data-card-prompt]').element as HTMLTextAreaElement).value).toBe(
      prompts[topology[0]].join('\n'),
    )
    expect(w.find('[data-card-output]').text()).toContain(
      JSON.stringify(nodes[topology[0]][K.KEY_OUTPUT], null, 2),
    )
    // 输出只读：这一块没有任何可改的输入
    expect(w.findAll('input')).toHaveLength(2)
    expect(w.find('[data-card-error]').exists()).toBe(false)
  })

  it('turns the multi-line prompt back into one entry per line on save', async () => {
    const w = render(CardNodeForm, { props: formProps() })

    await w.find('[data-card-name]').setValue('renamed')
    await w.find('[data-card-prompt]').setValue('first\n\nthird')
    await w.find('[data-card-save]').trigger('click')

    expect(w.emitted('save')?.[0]).toEqual([
      { name: 'renamed', duty: nodes[topology[0]][K.KEY_DUTY], prompt: ['first', '', 'third'] },
    ])
  })

  it('keeps the reason the parent handed back, so a failed save is never silent', () => {
    const w = render(CardNodeForm, { props: formProps({ error: 'card: duplicate node name' }) })
    expect(w.find('[data-card-error]').text()).toContain('card: duplicate node name')
  })
})

describe('CardEditor', () => {
  /** 打开着的卡图浮层：vue-flow 换成替身 */
  function editor() {
    return render(CardEditor, {
      props: { card, source: 'builtin' },
      global: { stubs: { VueFlow: VueFlowStub } },
    })
  }

  it('draws one node per node in the card topology', () => {
    const w = editor()
    expect(w.findAll('[data-node]').map((node) => node.attributes('data-node'))).toEqual(topology)
  })

  it('shows the form for the node that was clicked, and stores the edited prompt', async () => {
    const w = editor()
    const target = topology[0]
    expect(w.find('[data-card-form]').exists()).toBe(false)

    await w.find('[data-node="' + target + '"]').trigger('click')
    expect(w.find('[data-card-form]').exists()).toBe(true)
    // 表单对着的是点中的那个节点，字段是卡里的值
    expect((w.find('[data-card-prompt]').element as HTMLTextAreaElement).value).toBe(
      prompts[target].join('\n'),
    )

    await w.find('[data-card-prompt]').setValue('edited one\n\nedited three')
    await w.find('[data-card-save]').trigger('click')

    // 落盘的是整张卡：改的那一条提示词在，别处原样
    const stored = JSON.parse(localStorage.getItem(CARD_KEY) as string) as Record<string, any>
    expect(stored[K.KEY_PROMPT][K.KEY_NODES][target]).toEqual(['edited one', '', 'edited three'])
    expect(stored[K.KEY_CARD]).toEqual((card as Record<string, any>)[K.KEY_CARD])
    expect(w.emitted('saved')).toHaveLength(1)
  })

  it('refuses an edit that breaks the card and stores nothing, showing why', async () => {
    const w = editor()
    await w.find('[data-node="' + topology[0] + '"]').trigger('click')
    // 与第二个节点重名：卡校验器会拒
    await w.find('[data-card-name]').setValue(nodes[topology[1]][K.KEY_NODE_NAME])
    await w.find('[data-card-save]').trigger('click')

    expect(w.find('[data-card-error]').text()).toContain(t('card.saveFailed', { message: '' }).trim())
    expect(localStorage.getItem(CARD_KEY)).toBeNull()
    expect(w.emitted('saved')).toBeUndefined()
  })

  it('picks the error back up when another node is selected', async () => {
    const w = editor()
    await w.find('[data-node="' + topology[0] + '"]').trigger('click')
    await w.find('[data-card-name]').setValue(nodes[topology[1]][K.KEY_NODE_NAME])
    await w.find('[data-card-save]').trigger('click')
    expect(w.find('[data-card-error]').exists()).toBe(true)

    await w.find('[data-node="' + topology[1] + '"]').trigger('click')
    expect(w.find('[data-card-error]').exists()).toBe(false)
    expect((w.find('[data-card-name]').element as HTMLInputElement).value).toBe(
      nodes[topology[1]][K.KEY_NODE_NAME],
    )
  })

  it('closes itself by emitting close', async () => {
    const w = editor()
    await w.find('[data-card-close]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})

describe('CardSection', () => {
  it('says which card is in use and where it came from', () => {
    const w = render(CardSection)
    const meta = (card as Record<string, any>)[K.KEY_CARD]

    expect(w.text()).toContain(meta[K.KEY_NAME])
    expect(w.text()).toContain(meta[K.KEY_VERSION])
    expect(w.text()).toContain(t('card.sourceBuiltin'))
  })

  it('emits the four card actions instead of doing them itself', async () => {
    const w = render(CardSection)
    const actions = ['card-view', 'card-import', 'card-export', 'card-reset']
    const buttons = w.findAll('button')

    expect(buttons).toHaveLength(actions.length)
    for (const [index, action] of actions.entries()) {
      await buttons[index].trigger('click')
      expect(w.emitted('action')?.[index]).toEqual([action])
    }
  })

  it('says "imported" when the stored card is the one in use (fresh module = F5)', async () => {
    const stored = JSON.parse(readFileSync(EXAMPLE_CARD, 'utf8')) as Record<string, any>
    stored[K.KEY_CARD][K.KEY_NAME] = 'stored-card'
    localStorage.setItem(CARD_KEY, JSON.stringify(stored))

    // 选卡在模块加载期发生：重来一份模块图才是「刷新之后」的样子
    vi.resetModules()
    const [fresh, freshI18n] = await Promise.all([
      import('../src/components/CardSection.vue'),
      import('../src/i18n'),
    ])
    const w = render(fresh.default, { global: { plugins: [freshI18n.i18n] } })

    expect(w.text()).toContain('stored-card')
    expect(w.text()).toContain(freshI18n.i18n.global.t('card.sourceImported'))
    localStorage.removeItem(CARD_KEY)
  })
})
