// @vitest-environment jsdom
/**
 * 卡界面与调试面板的组件测试：卡图（节点数、默认只画主干、指到谁才画谁的上游）、
 * 编辑表单（改了什么就抛什么、声明只读）、调试面板（三块 + 只读），以及
 * 「点节点 → 改提示词 → 保存」这条完整链路。
 *
 * 保存那一步断言的是**真的落到 localStorage 垫片上**的那一刻（组件只 emit saved，
 * reload 是外层 App 的事）—— 不依赖真实下载，也不依赖真实 reload。
 *
 * vue-flow 要 ResizeObserver 量尺寸，jsdom 里没有 —— 换成替身：它把每个节点画成一个
 * 按钮、点了把 nodeClick 抛上来、进出把 nodeMouseEnter / nodeMouseLeave 抛上来，
 * 于是「点节点出表单」与「指到谁看谁的上游」都测得到。画面本身归组件故事巡检
 * （npm run stories）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import CardGraph from '../src/components/CardGraph.vue'
import CardNodeForm from '../src/components/CardNodeForm.vue'
import CardSection from '../src/components/CardSection.vue'
import DebugPanel from '../src/components/DebugPanel.vue'
import cardGraphStory, { Failed, Running, Selected } from '../src/components/CardGraph.stories'
import { parseCard } from '../src/game/card'
import { toGraph } from '../src/game/card-layout'
import { instantiate } from '../src/game/card-state'
import { format } from '../src/game/card-calendar'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { nodeWith } from './support/card-replies'
import { i18n, t } from '../src/i18n'

/** 示例卡（节点数、名字、提示词与声明全部从卡里现读：卡是唯一事实来源） */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
const graph = toGraph(card)
const topology = card.graph.topology
const nodes = card.graph.nodes

/**
 * 痕迹里要用到的节点 id —— **从卡里查，不写下标**：拓扑里删掉一个节点，后面每一个的下标
 * 都往前挪一位，"同一个下标换成了另一个节点"在读数是看不出来的。
 */
const TIME = nodeWith('advance_time', card)
const MAP = nodeWith('add_place', card)
const CAST = nodeWith('update_role', card)
const VERIFY = nodeWith('redo', card)

/** 活动卡的存储键（与产品一致） */
const CARD_KEY = 'tavernGame.card'

/** 图里三种边的类名（与 CardGraph 的样式约定一致） */
const READ_EDGE = 'card-graph-read'

/** 替身看到的一个节点（只用到这几处） */
interface StubNode {
  id: string
  data: {
    label: string
    role: string | null
    tools: string
    reads: string
    active: boolean
    failed: boolean
    selected: boolean
    prefix: boolean
    faded: boolean
  }
}

/** vue-flow 的替身：只记 props，节点渲染成按钮（点 = 选中，进出 = 悬停） */
const VueFlowStub = defineComponent({
  name: 'VueFlow',
  props: { nodes: { type: Array, required: true }, edges: { type: Array, required: true } },
  emits: ['nodeClick', 'nodeMouseEnter', 'nodeMouseLeave'],
  /** 画一层 div，里面每个节点一个按钮（点了、进去了、出来了都把事件抛上去） */
  setup:
    (props, { emit }) =>
    () =>
      h(
        'div',
        { class: 'flow-stub' },
        (props.nodes as StubNode[]).map((node) =>
          h(
            'button',
            {
              'data-node': node.id,
              onClick: () => emit('nodeClick', { node }),
              onMouseenter: () => emit('nodeMouseEnter', { node }),
              onMouseleave: () => emit('nodeMouseLeave', { node }),
            },
            node.data.label,
          ),
        ),
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

/** 画卡图（vue-flow 换成替身） */
function drawGraph(props: Record<string, unknown> = {}) {
  return render(CardGraph, { props: { card, ...props }, global: { stubs: { VueFlow: VueFlowStub } } })
}

/** 交给 vue-flow 的那份节点数据（高亮是数据里的标记，样式归故事巡检） */
function flowNodes(props: Record<string, unknown> = {}): StubNode[] {
  return drawGraph(props).findComponent(VueFlowStub).props('nodes') as StubNode[]
}

/** 交给 vue-flow 的那份边（类名区分主干与读边） */
function flowEdges(props: Record<string, unknown> = {}) {
  return drawGraph(props).findComponent(VueFlowStub).props('edges') as Array<{
    source: string
    target: string
    class: string
    label?: string
  }>
}

describe('CardGraph', () => {
  it('hands the parsed card to vue-flow as numbered nodes', () => {
    const drawn = flowNodes()
    expect(drawn.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id))
    expect(drawn[0].data.label).toBe(graph.nodes[0].label)
    expect(drawn[0].data.label).toContain('\u2460')
  })

  it('draws only the chain by default: no upstream dashed edges at all', () => {
    const chain = graph.edges.filter((edge) => edge.kind !== 'read')
    const edges = flowEdges()
    expect(edges).toHaveLength(chain.length)
    expect(edges.filter((edge) => edge.class === READ_EDGE)).toHaveLength(0)
    // 折行那条带着序号，主干边上没有别的文字
    const wraps = edges.filter((edge) => edge.label !== undefined)
    expect(wraps).toHaveLength(chain.filter((edge) => edge.kind === 'wrap').length)
    expect(wraps[0].label).toBe('\u2465')
  })

  it('draws exactly the upstream of the selected node', () => {
    const target = graph.nodes[3].id
    const edges = flowEdges({ selected: target })
    const reads = edges.filter((edge) => edge.class === READ_EDGE)
    expect(reads.map((edge) => edge.source)).toEqual(topology.slice(0, 3))
    expect(reads.every((edge) => edge.target === target)).toBe(true)
  })

  it('draws the upstream of the pointed node on hover, and takes it back on leave', async () => {
    const target = graph.nodes[2].id
    const w = drawGraph()
    const button = w.find('[data-node="' + target + '"]')

    await button.trigger('mouseenter')
    const hovering = w.findComponent(VueFlowStub).props('edges') as Array<{ class: string; target: string }>
    expect(hovering.filter((edge) => edge.class === READ_EDGE).map((edge) => edge.target)).toEqual([
      target,
      target,
    ])

    await button.trigger('mouseleave')
    const left = w.findComponent(VueFlowStub).props('edges') as Array<{ class: string }>
    expect(left.filter((edge) => edge.class === READ_EDGE)).toHaveLength(0)
  })

  it('marks the upstream prefix and fades everything else while a node is focused', () => {
    const target = graph.nodes[3].id
    const drawn = flowNodes({ selected: target })
    const prefix = drawn.filter((node) => node.data.prefix).map((node) => node.id)
    expect(prefix).toEqual(topology.slice(0, 3))
    // 被看的那个既不在前缀里也不淡出；其余全部淡出
    expect(drawn.find((node) => node.id === target)?.data.faded).toBe(false)
    expect(drawn.filter((node) => node.data.faded).map((node) => node.id)).toEqual(topology.slice(4))
  })

  it('writes the declarations the card made on each node', () => {
    const drawn = flowNodes()
    const storyId = topology.find((id) => nodes[id].role === 'story') as string
    const story = drawn.find((node) => node.id === storyId)

    // 故事节点：声明了 role，tools 是一个都不给（空表 = 一个都没有，不是「没写」），reads 只列三块状态
    expect(story?.data.role).toBe('story')
    expect(story?.data.tools).toBe(t('card.declNone'))
    expect(story?.data.reads).toBe((nodes[storyId].reads ?? []).join(' '))

    const first = nodes[topology[0]]
    expect(drawn[0].data.tools).toBe((first.tools ?? []).join(' '))
    expect(drawn[0].data.reads).toBe((first.reads ?? []).join(' '))
    expect(drawn[0].data.role).toBe(null)
  })

  it('writes "all" where the card left the declaration out (undefined, not an empty list)', () => {
    // 卡没写 tools / reads = 这个节点什么动作都能用、什么状态都看得见
    const bare = {
      ...card,
      graph: {
        topology,
        nodes: {
          ...nodes,
          [topology[0]]: { ...nodes[topology[0]], tools: undefined, reads: undefined },
        },
      },
    } as typeof card
    const w = render(CardGraph, { props: { card: bare }, global: { stubs: { VueFlow: VueFlowStub } } })
    const drawn = w.findComponent(VueFlowStub).props('nodes') as StubNode[]

    expect(drawn[0].data.tools).toBe(t('card.declAll'))
    expect(drawn[0].data.reads).toBe(t('card.declAll'))
  })

  it('flags exactly the running node, and nothing when the props are omitted', () => {
    const running = graph.nodes[4].id

    const drawn = flowNodes({ active: running })
    expect(drawn.filter((node) => node.data.active).map((node) => node.id)).toEqual([running])
    expect(drawn.every((node) => !node.data.failed && !node.data.selected)).toBe(true)

    const plain = flowNodes()
    expect(plain.every((node) => !node.data.active && !node.data.failed)).toBe(true)
  })

  it('flags the failed nodes, and failure wins over running', () => {
    const broken = graph.nodes[2].id
    // 挂掉的节点同时就是「正在跑」的那一个：只该亮失败色
    const drawn = flowNodes({ active: broken, failed: [broken] })

    expect(drawn.filter((node) => node.data.failed).map((node) => node.id)).toEqual([broken])
    expect(drawn.filter((node) => node.data.active)).toEqual([])
  })

  it('flags the selected node so the editor can show which one it is editing', () => {
    const picked = graph.nodes[1].id
    const drawn = flowNodes({ selected: picked })

    expect(drawn.filter((node) => node.data.selected).map((node) => node.id)).toEqual([picked])
  })

  it('lets a click on a node out as select', async () => {
    const w = drawGraph()
    await w.find('[data-node="' + topology[0] + '"]').trigger('click')

    expect(w.emitted('select')?.[0]).toEqual([topology[0]])
  })

  it('highlights nodes that exist in the card (the stories do not hardcode ids)', () => {
    for (const id of [Running.args?.active, ...(Failed.args?.failed ?? []), Selected.args?.selected]) {
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
})

describe('CardNodeForm', () => {
  /** 常态 props：三个可改字段 + 四个只读声明 */
  function formProps(over: Record<string, unknown> = {}) {
    const id = topology[0]
    return {
      id,
      name: nodes[id].name,
      duty: nodes[id].duty,
      prompt: nodes[id].prompt,
      role: nodes[id].role ?? null,
      tools: nodes[id].tools ?? null,
      reads: nodes[id].reads ?? null,
      uses: nodes[id].uses ?? null,
      ...over,
    }
  }

  it('shows the three editable fields, the read-only declarations, and no error by default', () => {
    const props = formProps()
    const w = render(CardNodeForm, { props })

    expect((w.find('[data-card-name]').element as HTMLInputElement).value).toBe(props.name)
    expect((w.find('[data-card-duty]').element as HTMLInputElement).value).toBe(props.duty)
    expect((w.find('[data-card-prompt]').element as HTMLTextAreaElement).value).toBe(props.prompt.join('\n'))
    // 声明只读：这一块没有任何可改的输入（两个 input + 一个 textarea 就是全部）
    expect(w.findAll('input')).toHaveLength(2)
    expect(w.findAll('textarea')).toHaveLength(1)
    expect(w.find('[data-card-error]').exists()).toBe(false)
  })

  it('spells the declarations, saying "all" / "none" where the card wrote nothing', () => {
    const w = render(CardNodeForm, {
      props: formProps({ role: null, tools: null, reads: null, uses: null }),
    })
    const text = w.find('[data-card-declarations]').text()

    expect(text).toContain(t('card.declAllTools'))
    expect(text).toContain(t('card.declAllReads'))
    expect(text).toContain(t('card.declNoUses'))
    expect(text).toContain(t('card.declNone'))
  })

  it('lists the tools / reads / uses the card declares', () => {
    const w = render(CardNodeForm, {
      props: formProps({ tools: ['set_profile'], reads: ['player', 'world'], uses: ['gen'], role: 'story' }),
    })
    const text = w.find('[data-card-declarations]').text()

    expect(text).toContain('set_profile')
    expect(text).toContain('player world')
    expect(text).toContain('gen')
    expect(text).toContain('story')
  })

  it('says "none" for a declaration that is an empty list (judge declares tools: [])', () => {
    const w = render(CardNodeForm, {
      props: formProps({ role: 'story', tools: [], reads: [], uses: [] }),
    })
    const rows = w.findAll('[data-card-declarations] > div')
    /** 取某一行声明的值那一格（dt 是键、dd 是值） */
    const valueOf = (key: string) =>
      rows
        .find((row) => row.text().startsWith(t(key)))
        ?.find('dd')
        .text()

    // 空表 = 一个都没有。画成空白会让读卡的人以为这块漏写了
    expect(valueOf('card.declTools')).toBe(t('card.declNone'))
    expect(valueOf('card.declReads')).toBe(t('card.declNone'))
    expect(valueOf('card.declUses')).toBe(t('card.declNone'))
  })

  it('turns the multi-line prompt back into one entry per line on save', async () => {
    const props = formProps()
    const w = render(CardNodeForm, { props })

    await w.find('[data-card-name]').setValue('renamed')
    await w.find('[data-card-prompt]').setValue('first\n\nthird')
    await w.find('[data-card-save]').trigger('click')

    expect(w.emitted('save')?.[0]).toEqual([
      { name: 'renamed', duty: props.duty, prompt: ['first', '', 'third'] },
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
    const target = topology[1]
    expect(w.find('[data-card-form]').exists()).toBe(false)

    await w.find('[data-node="' + target + '"]').trigger('click')
    expect(w.find('[data-card-form]').exists()).toBe(true)
    // 表单对着的是点中的那个节点，字段是卡里的值
    expect((w.find('[data-card-prompt]').element as HTMLTextAreaElement).value).toBe(
      nodes[target].prompt.join('\n'),
    )

    await w.find('[data-card-prompt]').setValue('edited one\n\nedited three')
    await w.find('[data-card-save]').trigger('click')

    // 落盘的是整张卡：改的那一条提示词在，**同一节点的其它键**与别处原样
    const stored = JSON.parse(localStorage.getItem(CARD_KEY) as string) as typeof card
    expect(stored.graph.nodes[target].prompt).toEqual(['edited one', '', 'edited three'])
    expect(stored.graph.nodes[target].tools).toEqual(nodes[target].tools)
    expect(stored.graph.nodes[target].reads).toEqual(nodes[target].reads)
    expect(stored.card).toEqual(card.card)
    expect(w.emitted('saved')).toHaveLength(1)
  })

  it('refuses an edit that breaks the card and stores nothing, showing why', async () => {
    const w = editor()
    await w.find('[data-node="' + topology[0] + '"]').trigger('click')
    // 与第二个节点重名：卡校验器会拒
    await w.find('[data-card-name]').setValue(nodes[topology[1]].name)
    await w.find('[data-card-save]').trigger('click')

    expect(w.find('[data-card-error]').text()).toContain(t('card.saveFailed', { message: '' }).trim())
    expect(localStorage.getItem(CARD_KEY)).toBeNull()
    expect(w.emitted('saved')).toBeUndefined()
  })

  it('picks the error back up when another node is selected', async () => {
    const w = editor()
    await w.find('[data-node="' + topology[0] + '"]').trigger('click')
    await w.find('[data-card-name]').setValue(nodes[topology[1]].name)
    await w.find('[data-card-save]').trigger('click')
    expect(w.find('[data-card-error]').exists()).toBe(true)

    await w.find('[data-node="' + topology[1] + '"]').trigger('click')
    expect(w.find('[data-card-error]').exists()).toBe(false)
    expect((w.find('[data-card-name]').element as HTMLInputElement).value).toBe(nodes[topology[1]].name)
  })

  it('closes itself by emitting close', async () => {
    const w = editor()
    await w.find('[data-card-close]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})

describe('DebugPanel', () => {
  /** 面板的常态 props：真状态树 + 编出来的这一轮痕迹 */
  function panelProps(over: Record<string, unknown> = {}) {
    const state = instantiate(card)
    return {
      card,
      state,
      timeLabel: format(card.time.calendar, card.time.initial),
      turn: 2,
      draft: null,
      writes: [{ path: 'time', value: { minute: 35 } }],
      tools: [
        {
          node: TIME,
          tool: 'advance_time',
          args: '{"minutes":5}',
          result: 'ok',
          writes: [{ path: 'time', value: { minute: 35 } }],
          failed: false,
          redoFrom: null,
        },
        {
          node: MAP,
          tool: 'add_place',
          args: '{"note":"late"}',
          result: 'add_place: area must be a non-empty string (the map key)',
          writes: [],
          failed: true,
          redoFrom: null,
        },
      ],
      running: null,
      failed: [],
      ...over,
    }
  }

  /** 面板里挂着卡图：vue-flow 一样换成替身 */
  function panel(over: Record<string, unknown> = {}) {
    return render(DebugPanel, {
      props: panelProps(over),
      global: { stubs: { VueFlow: VueFlowStub } },
    })
  }

  it('opens on the live card graph and can switch between the three blocks', async () => {
    const w = panel()
    expect(w.find('[data-debug-tab="graph"]').attributes('aria-pressed')).toBe('true')
    expect(w.findAll('[data-node]')).toHaveLength(topology.length)

    await w.find('[data-debug-tab="state"]').trigger('click')
    expect(w.find('[data-debug-branch]').exists()).toBe(true)
    expect(w.findAll('[data-node]')).toHaveLength(0)

    await w.find('[data-debug-tab="tools"]').trigger('click')
    expect(w.findAll('[data-tool-call]')).toHaveLength(2)

    await w.find('[data-debug-tab="graph"]').trigger('click')
    expect(w.findAll('[data-node]')).toHaveLength(topology.length)
  })

  it('shows the engine state: every top-level branch, the time, the turn and the writes', () => {
    const w = panel({ initialTab: 'state' })
    const state = instantiate(card)

    expect(w.findAll('[data-debug-branch]').map((el) => el.attributes('data-debug-branch'))).toEqual(
      Object.keys(state),
    )
    expect(w.text()).toContain(format(card.time.calendar, card.time.initial))
    expect(w.text()).toContain('2')
    expect(w.findAll('[data-debug-write]')).toHaveLength(1)
    expect(w.find('[data-debug-write]').text()).toContain('time')
  })

  it('switches to the working draft, and says so when there is no turn in flight', async () => {
    const draft = {
      meta: { turn: 9, card: card.card },
      time: { year: 2026, month: 9, day: 15, hour: 8, minute: 0 },
      state: instantiate(card),
      events: [],
      timeline: [],
    }
    const w = panel({ initialTab: 'state', draft })

    expect(w.find('[data-debug-draft]').attributes('aria-pressed')).toBe('false')
    await w.find('[data-debug-draft]').trigger('click')
    expect(w.find('[data-debug-draft]').attributes('aria-pressed')).toBe('true')
    expect(w.text()).toContain('9')
    expect(w.text()).toContain(format(card.time.calendar, draft.time))

    // 没有工作副本时按钮点不动，并说明为什么
    const idle = panel({ initialTab: 'state' })
    expect(idle.find('[data-debug-draft]').attributes('disabled')).toBeDefined()
    await idle.find('[data-debug-draft]').trigger('click')
    expect(idle.find('[data-debug-draft-empty]').exists()).toBe(false)
  })

  it('lists tool calls: node, tool, raw arguments, result and the paths it wrote', () => {
    const w = panel({ initialTab: 'tools' })
    const calls = w.findAll('[data-tool-call]')

    const first = calls[0].text()
    expect(first).toContain(nodes[TIME].name)
    expect(first).toContain('advance_time')
    expect(first).toContain('{"minutes":5}')
    expect(first).toContain('ok')
    expect(first).toContain('time')

    // 失败的那次：标红 + 写着引擎回传的结构化错误
    const second = calls[1]
    expect(second.find('[data-tool-failed]').exists()).toBe(true)
    expect(second.text()).toContain(nodes[MAP].name)
    expect(second.text()).toContain('must be a non-empty string')
  })

  it('marks a redo call with the node it rolled back to', () => {
    const w = panel({
      initialTab: 'tools',
      tools: [
        {
          node: VERIFY,
          tool: 'redo',
          args: '{"from":"' + CAST + '","why":"x"}',
          result: 'ok',
          writes: [],
          failed: false,
          redoFrom: CAST,
        },
      ],
    })
    expect(w.find('[data-tool-redo]').text()).toContain(nodes[CAST].name)
  })

  it('says so when the latest turn made no tool calls', () => {
    const w = panel({ initialTab: 'tools', tools: [], writes: [] })
    expect(w.find('[data-debug-tools-empty]').exists()).toBe(true)

    const stale = panel({ initialTab: 'state', tools: [], writes: [] })
    expect(stale.find('[data-debug-writes-empty]').exists()).toBe(true)
  })

  /**
   * 只读：面板里没有任何一颗按钮会改游戏状态。
   * 判据是「点遍所有按钮，除了 close 什么都不抛」+「props 一个字节没动」。
   */
  it('is read-only: no button changes the game state', async () => {
    const props = panelProps({ initialTab: 'state', initialDraft: true, draft: null })
    const before = JSON.stringify(props)
    const w = render(DebugPanel, {
      props,
      global: { stubs: { VueFlow: VueFlowStub } },
    })

    for (const button of w.findAll('button')) await button.trigger('click')
    await w.find('[data-debug-close]').trigger('click')

    expect(JSON.stringify(props)).toBe(before)
    // 面板自己只会抛 close；click 是触发 DOM 按钮时记下的原生事件，不是面板的动作
    expect(Object.keys(w.emitted()).filter((name) => name !== 'click')).toEqual(['close'])
  })
})

describe('CardSection', () => {
  it('says which card is in use and where it came from', () => {
    const w = render(CardSection)

    expect(w.text()).toContain(card.card.name)
    expect(w.text()).toContain(card.card.version)
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
    stored.card.name = 'stored-card'
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
