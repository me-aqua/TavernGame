// @vitest-environment jsdom
/**
 * 组件测试：只测**契约**（渲染出什么、点击后 emit 什么），不测样式。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import StoryPanel from '../src/components/StoryPanel.vue'
import CardGraph from '../src/components/CardGraph.vue'
import cardGraphStory, { Failed, Running } from '../src/components/CardGraph.stories'
import AppSidebar from '../src/components/AppSidebar.vue'
import GameComposer from '../src/components/GameComposer.vue'
import SettingsDrawer from '../src/components/SettingsDrawer.vue'
import type { Row, Status } from '../src/stores/game'
import { parseCard } from '../src/game/card'
import { READ_LABEL, toGraph } from '../src/dev/card-graph'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { i18n, t } from '../src/i18n'
import { realCalendar } from '../src/utils/calendar'

/** 组件要 t()，所以统一装上 i18n 插件；断言按中文写，固定用 zh-CN */
i18n.global.locale.value = 'zh-CN'

// 夹具写成具名常量（代码保持 ASCII）；产品真会输出的文案用 t() 构造，绝不抄一份字符串
const DEFAULT_LINE_TEXT = 'body text'
const NARRATION_TEXT = 'You are in the inn.'
const ACTION_TEXT = 'I push the door open and step outside'
const WARN_TEXT = t('store.warnLine', { message: 'watch out' })
const TOOL_TEXT = t('toolbar.toolCall', { tool: 'advance_time', args: '{}' })
const RAW_REPLY = 'raw model reply'
const RAW_BLOCKS = 2
const RAW_SUMMARY = t('store.rawReply', { count: RAW_BLOCKS })
const XSS_TEXT = '<img src=x onerror=alert(1)>'
const SCENE_NAME = 'Riverside Inn'
const SCENE_DESCRIPTION = 'Voices downstairs.'
// 用本地时间构造，标签不受时区影响
const TIME_LABEL = realCalendar.format(new Date(2026, 8, 14, 14, 0, 0).toISOString())
const NOW_LABEL = 'now'
const TIMELINE_FROM = realCalendar.formatShort(new Date(2026, 8, 12, 9, 0, 0).toISOString())
const TIMELINE_TO = realCalendar.formatShort(new Date(2026, 8, 13, 20, 0, 0).toISOString())
const TIMELINE_REASON = 'slept through the night'
const PLAYER_INPUT = 'I head to the docks'

/**
 * 挂载组件并接上真实 i18n 实例。
 *
 * 类型故意放宽：各组件的 props 形状不同，逐处写出泛型只是噪音。
 * options.global 可以追加 stub —— 有的组件带着跑不起来的第三方件（见 CardGraph）。
 */
function render<C>(component: C, options: Record<string, unknown> = {}) {
  const global = { plugins: [i18n], ...(options.global as Record<string, unknown> | undefined) }
  return mount(
    component as Parameters<typeof mount>[0],
    { ...options, global } as Parameters<typeof mount>[1],
  )
}

function makeLine(over: Partial<Extract<Row, { debug: false }>> = {}): Row {
  return { id: 1, kind: 'narration', text: DEFAULT_LINE_TEXT, debug: false, ...over }
}

function makeDebug(over: Partial<Extract<Row, { debug: true }>> = {}): Row {
  return { id: 1, kind: 'tool', text: DEFAULT_LINE_TEXT, debug: true, ...over }
}

describe('StoryPanel', () => {
  it('renders story rows by kind (kind picks the style class)', () => {
    const rows = [
      makeLine({ id: 1, kind: 'narration', text: NARRATION_TEXT }),
      makeLine({ id: 2, kind: 'action', text: ACTION_TEXT }),
    ]
    const w = render(StoryPanel, { props: { rows, status: null } })

    const divs = w.findAll('.line')
    expect(divs).toHaveLength(2)
    expect(divs[0].classes()).toContain('narration')
    expect(divs[1].classes()).toContain('action')
    expect(w.text()).toContain(ACTION_TEXT)
  })

  it('renders debug rows in place, folding raw payloads into details', () => {
    const rows = [
      makeLine({ id: 1, kind: 'narration', text: NARRATION_TEXT }),
      makeDebug({ id: 2, kind: 'tool', text: TOOL_TEXT }),
      makeDebug({ id: 3, kind: 'warn', text: WARN_TEXT }),
      makeDebug({ id: 4, kind: 'request', text: RAW_SUMMARY, detail: RAW_REPLY }),
      makeLine({ id: 5, kind: 'narration', text: ACTION_TEXT }),
    ]
    const w = render(StoryPanel, { props: { rows, status: null } })

    // 顺序就是数组顺序：调试行夹在两段叙事之间，而不是被堆到末尾
    const text = w.text()
    expect(text.indexOf(NARRATION_TEXT)).toBeLessThan(text.indexOf(TOOL_TEXT))
    expect(text.indexOf(TOOL_TEXT)).toBeLessThan(text.indexOf(ACTION_TEXT))

    expect(w.findAll('.line')).toHaveLength(2)
    expect(w.findAll('.trace')).toHaveLength(3)
    expect(w.findAll('.trace')[0].classes()).toContain('tool')
    expect(w.findAll('.trace')[1].classes()).toContain('warn')
    expect(w.find('details pre').text()).toBe(RAW_REPLY)
  })

  it('shows the busy status row while a turn runs and drops it afterwards', async () => {
    const busy: Status = { kind: 'busy', text: NARRATION_TEXT }
    const w = render(StoryPanel, { props: { rows: [], status: busy } })
    expect(w.find('.thinking').exists()).toBe(true)
    expect(w.find('[data-status]').attributes('data-status')).toBe('busy')

    await w.setProps({ status: null })
    expect(w.find('.thinking').exists()).toBe(false)
    expect(w.find('[data-status]').exists()).toBe(false)
  })

  it('renders a notice, marking errors so the style can differ', () => {
    const w = render(StoryPanel, {
      props: { rows: [], status: { kind: 'error', text: WARN_TEXT } as Status },
    })
    const row = w.find('[data-status]')
    expect(row.attributes('data-status')).toBe('error')
    expect(row.classes()).toContain('notice')
    expect(row.text()).toBe(WARN_TEXT)
  })

  it('sends model output through textContent, never parsing HTML (XSS defence)', () => {
    const w = render(StoryPanel, {
      props: {
        rows: [
          makeLine({ text: XSS_TEXT }),
          makeDebug({ id: 2, kind: 'reply', text: RAW_SUMMARY, detail: XSS_TEXT }),
        ],
        status: { kind: 'info', text: XSS_TEXT },
      },
    })
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain(XSS_TEXT)
  })
})

describe('AppSidebar', () => {
  it('renders the time, place and turn blocks', () => {
    const w = render(AppSidebar, {
      props: {
        timeLabel: TIME_LABEL,
        timeline: [],
        scene: { name: SCENE_NAME, description: SCENE_DESCRIPTION },
        turn: 3,
      },
    })
    expect(w.find('.time-display').text()).toBe(TIME_LABEL)
    expect(w.find('.scene-name').text()).toContain(SCENE_NAME)
    expect(w.find('[data-turn]').text()).toBe('3')
    expect(w.find('.timeline').exists()).toBe(false)
  })

  it('renders the start point of a timeline entry (intentional design, not a bug)', () => {
    const w = render(AppSidebar, {
      props: {
        timeLabel: NOW_LABEL,
        timeline: [
          {
            from: TIMELINE_FROM,
            to: TIMELINE_TO,
            reason: TIMELINE_REASON,
            elapsedMs: 1,
            at: '',
          },
        ],
        scene: { name: 'a', description: 'b' },
        turn: 1,
      },
    })
    const timeline = w.find('.timeline')
    expect(timeline.text()).toContain(TIMELINE_FROM)
    expect(timeline.text()).not.toContain(TIMELINE_TO)
    expect(timeline.text()).toContain(TIMELINE_REASON)
  })
})

describe('GameComposer', () => {
  it('submits on Enter and clears the textarea', async () => {
    const w = render(GameComposer, { props: { disabled: false, configured: true } })
    const ta = w.find('textarea')
    await ta.setValue(PLAYER_INPUT)
    await ta.trigger('keydown', { key: 'Enter' })

    expect(w.emitted('submit')?.[0]).toEqual([PLAYER_INPUT])
    expect((ta.element as HTMLTextAreaElement).value).toBe('')
  })

  it('does not submit empty input', async () => {
    const w = render(GameComposer, { props: { disabled: false, configured: true } })
    await w.find('textarea').setValue('   ')
    await w.find('button').trigger('click')
    expect(w.emitted('submit')).toBeUndefined()
  })

  it('points at the settings and disables the textarea when unconfigured', () => {
    const w = render(GameComposer, { props: { disabled: true, configured: false } })
    expect(w.text()).toContain(t('composer.hintBefore'))
    expect(w.find('textarea').attributes('disabled')).toBeDefined()
  })
})

describe('SettingsDrawer', () => {
  it('renders nothing while closed', () => {
    const w = render(SettingsDrawer, { props: { open: false, language: 'system' } })
    expect(w.find('.drawer').exists()).toBe(false)
  })

  it('lists every provider and field while open', () => {
    const w = render(SettingsDrawer, { props: { open: true, language: 'system' } })
    expect(w.find('.drawer').exists()).toBe(true)
    const options = w.findAll('select option').map((o) => o.text())
    expect(options).toContain(t('provider.deepseek'))
    expect(options).toContain(t('provider.ollama'))
    expect(w.text()).toContain(t('settings.apiKey'))
    // 步数上限文案会插值滑块的值，所以先把它读回来
    const steps = Number((w.find('input[type="range"]').element as HTMLInputElement).value)
    expect(w.text()).toContain(t('settings.stepsLimit', { count: steps }))
  })

  it('closes itself when the backdrop is clicked', async () => {
    const w = render(SettingsDrawer, { props: { open: true, language: 'system' } })
    await w.find('.drawer').trigger('click')
    expect(w.emitted('update:open')?.[0]).toEqual([false])
  })

  it('emits the chosen language from the language buttons', async () => {
    const w = render(SettingsDrawer, { props: { open: true, language: 'system' } })
    const options = w.findAll('button[data-language-option]')
    expect(options).toHaveLength(3)
    await options[2].trigger('click')
    expect(w.emitted('language')?.[0]).toEqual(['en'])
  })

  it('emits save-file actions instead of doing them itself', async () => {
    const w = render(SettingsDrawer, { props: { open: true, language: 'system' } })
    await w.find('button[data-export]').trigger('click')
    expect(w.emitted('action')?.[0]).toEqual(['export'])
  })

  it('stays open when the sheet itself is clicked', async () => {
    const w = render(SettingsDrawer, { props: { open: true, language: 'system' } })
    await w.find('.sheet').trigger('click')
    expect(w.emitted('update:open')).toBeUndefined()
  })
})

/**
 * vue-flow 要 ResizeObserver 量尺寸，jsdom 里没有 —— 换成只记 props 的替身。
 * 这里测「组件把什么交给了 vue-flow」；画面本身由组件故事巡检负责（npm run stories）。
 */
const VueFlowStub = defineComponent({
  name: 'VueFlow',
  props: { nodes: { type: Array, required: true }, edges: { type: Array, required: true } },
  template: '<div class="flow-stub" />',
})

describe('CardGraph', () => {
  const graph = toGraph(parseCard(readFileSync(EXAMPLE_CARD, 'utf8')))

  it('hands the parsed card to vue-flow as nodes and edges', () => {
    const w = render(CardGraph, { global: { stubs: { VueFlow: VueFlowStub } } })
    const flow = w.findComponent(VueFlowStub)
    const nodes = flow.props('nodes') as Array<{ id: string; data: { label: string } }>
    expect(nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id))
    expect(nodes[0].data.label).toBe(graph.nodes[0].label)
    expect(flow.props('edges')).toHaveLength(graph.edges.length)
  })

  /**
   * 交给 vue-flow 的那份节点数据 —— 高亮是样式，组件测试不测样式，
   * 所以断言的是数据里的标记（模板按它上色）。
   */
  function flowNodes(props: Record<string, unknown> = {}) {
    const w = render(CardGraph, { props, global: { stubs: { VueFlow: VueFlowStub } } })
    return w.findComponent(VueFlowStub).props('nodes') as Array<{
      id: string
      data: { active: boolean; failed: boolean }
    }>
  }

  it('flags exactly the running node, and nothing when the props are omitted', () => {
    const running = graph.nodes[4].id

    const nodes = flowNodes({ active: running })
    expect(nodes.filter((node) => node.data.active).map((node) => node.id)).toEqual([running])
    expect(nodes.every((node) => !node.data.failed)).toBe(true)

    const plain = flowNodes()
    expect(plain.every((node) => !node.data.active && !node.data.failed)).toBe(true)
  })

  it('flags the failed node, and failure wins over running', () => {
    const broken = graph.nodes[2].id
    // 挂掉的节点同时就是「正在跑」的那一个：只该亮失败色
    const nodes = flowNodes({ active: broken, failed: broken })

    expect(nodes.filter((node) => node.data.failed).map((node) => node.id)).toEqual([broken])
    expect(nodes.filter((node) => node.data.active)).toEqual([])
  })

  it('highlights nodes that exist in the card (the stories do not hardcode ids)', () => {
    for (const id of [Running.args?.active, Failed.args?.failed]) {
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

  it('marks read edges for the dashed style and leaves the rest solid', () => {
    const w = render(CardGraph, { global: { stubs: { VueFlow: VueFlowStub } } })
    const edges = w.findComponent(VueFlowStub).props('edges') as Array<{ class: string }>
    const reads = graph.edges.filter((edge) => edge.label === READ_LABEL).length
    expect(edges.filter((edge) => edge.class === 'card-graph-read')).toHaveLength(reads)
    expect(edges.filter((edge) => edge.class === 'card-graph-flow')).toHaveLength(graph.edges.length - reads)
  })
})
