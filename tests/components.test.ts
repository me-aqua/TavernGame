// @vitest-environment jsdom
/**
 * 组件测试：只测**契约**（渲染出什么、点击后 emit 什么），不测样式。
 *
 * 另有两组纯逻辑：界面侧的状态树走法（components/state-view.ts）与 store 的调试投影
 * （最近一轮的工具调用 / 要标红的节点）—— 后者靠「种一份存档再重来一份模块图」拿到。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import StoryPanel from '../src/components/StoryPanel.vue'
import StoryCover from '../src/components/StoryCover.vue'
import AppSidebar from '../src/components/AppSidebar.vue'
import WorldPanel from '../src/components/WorldPanel.vue'
import WorldCast from '../src/components/world/WorldCast.vue'
import WorldMap from '../src/components/world/WorldMap.vue'
import WorldPack from '../src/components/world/WorldPack.vue'
import WorldSelf from '../src/components/world/WorldSelf.vue'
import { world } from '../src/components/display-blocks'
import { entriesOf, isScalar, itemOf, linesOf, scalarText, textsOf } from '../src/components/state-view'
import GameComposer from '../src/components/GameComposer.vue'
import SettingsDrawer from '../src/components/SettingsDrawer.vue'
import type { Row, Status } from '../src/stores/game'
import { parseCard } from '../src/game/card'
import { instantiate } from '../src/game/card-state'
import { createInitialState } from '../src/game/save'
import { format } from '../src/game/card-calendar'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { i18n, t } from '../src/i18n'
import type { GameEvent } from '../src/types/state'

/** 组件要 t()，所以统一装上 i18n 插件；断言按中文写，固定用 zh-CN */
i18n.global.locale.value = 'zh-CN'

// 夹具写成具名常量（代码保持 ASCII）；产品真会输出的文案用 t() 构造，绝不抄一份字符串
const DEFAULT_LINE_TEXT = 'body text'
const NARRATION_TEXT = 'You are in the inn.'
const ACTION_TEXT = 'I push the door open and step outside'
const WARN_TEXT = t('store.warnLine', { message: 'watch out' })
const TOOL_TEXT = t('toolbar.toolCall', { tool: 'advance_time', args: '{}' })
const WRITE_TEXT = t('store.stateChangeLine', { path: 'time' })
const RAW_REPLY = 'raw model reply'
const RAW_SUMMARY = t('store.rawReply')
const XSS_TEXT = '<img src=x onerror=alert(1)>'
const PLAYER_INPUT = 'I head to the docks'
const BABEL_TEXT = '{"minutes":5}'

/** 示例卡（面板数据、节点名与状态树都从卡里现读） */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
const state = instantiate(card)
const topology = card.graph.topology
const nodes = card.graph.nodes

/** 状态树是卡定义的（unknown）：这几段用例里要读的具体形状在这里说清 */
const worldState = state.world as {
  map: Record<string, unknown>
  location: { area: string; spot: string; scene: string }
}

// 用卡自己的历法念时刻，标签不受时区影响
const TIME_LABEL = format(card.time.calendar, card.time.initial)
const NOW_LABEL = 'now'
const TIMELINE_FROM = '9 \u6708 12 \u65e5 \u00b7 \u665a\u4e0a'
const TIMELINE_TO = '9 \u6708 13 \u65e5 \u00b7 \u4e0a\u5348'
const TIMELINE_REASON = 'slept through the night'
const SCENE = {
  area: '\u6668\u98ce\u9547',
  spot: '\u9189\u732b\u65c5\u5e97',
  scene: '\u65c5\u5e97\u5927\u5802',
}

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
      makeDebug({ id: 5, kind: 'stateChange', text: WRITE_TEXT }),
      makeLine({ id: 6, kind: 'narration', text: ACTION_TEXT }),
    ]
    const w = render(StoryPanel, { props: { rows, status: null } })

    // 顺序就是数组顺序：调试行夹在两段叙事之间，而不是被堆到末尾
    const text = w.text()
    expect(text.indexOf(NARRATION_TEXT)).toBeLessThan(text.indexOf(TOOL_TEXT))
    expect(text.indexOf(TOOL_TEXT)).toBeLessThan(text.indexOf(ACTION_TEXT))

    expect(w.findAll('.line')).toHaveLength(2)
    expect(w.findAll('.trace')).toHaveLength(4)
    expect(w.findAll('.trace')[0].classes()).toContain('tool')
    expect(w.findAll('.trace')[1].classes()).toContain('warn')
    // 带原始内容的那一条折成 details，排在它自己的位置上
    expect(w.findAll('.trace')[2].classes()).toContain('request')
    expect(w.findAll('.trace')[3].classes()).toContain('stateChange')
    expect(w.find('details pre').text()).toBe(RAW_REPLY)
  })

  it('styles every debug kind the engine writes (a missing one would render unstyled)', () => {
    const kinds = [
      'node',
      'thinking',
      'request',
      'model',
      'tool',
      'toolResult',
      'stateChange',
      'warn',
    ] as const
    const rows = kinds.map((kind, index) => makeDebug({ id: index, kind, text: kind }))
    const w = render(StoryPanel, { props: { rows, status: null } })

    expect(w.findAll('.trace')).toHaveLength(kinds.length)
    for (const [index, kind] of kinds.entries()) {
      expect(w.findAll('.trace')[index].classes()).toContain(kind)
    }
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
          makeDebug({ id: 2, kind: 'model', text: RAW_SUMMARY, detail: XSS_TEXT }),
        ],
        status: { kind: 'info', text: XSS_TEXT },
      },
    })
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain(XSS_TEXT)
  })
})

describe('AppSidebar', () => {
  /** 常态 props；items 由每个用例按「卡声明了哪几条」给 */
  function sidebarProps(over: Record<string, unknown> = {}) {
    return {
      items: ['time', 'scene', 'turn'],
      timeLabel: TIME_LABEL,
      timeline: [],
      scene: SCENE,
      turn: 3,
      ...over,
    }
  }

  it('renders the time, place and turn blocks', () => {
    const w = render(AppSidebar, { props: sidebarProps() })
    expect(w.find('.time-display').text()).toBe(TIME_LABEL)
    expect(w.find('.scene-name').text()).toContain(SCENE.spot)
    expect(w.find('.scene-name').text()).toContain(SCENE.scene)
    expect(w.find('[data-turn]').text()).toBe('3')
    expect(w.find('.timeline').exists()).toBe(false)
  })

  it('renders exactly the items the card declares, in the declared order', () => {
    const sceneOnly = render(AppSidebar, { props: sidebarProps({ items: ['scene'] }) })
    expect(sceneOnly.find('.scene-name').exists()).toBe(true)
    expect(sceneOnly.find('.time-display').exists()).toBe(false)
    expect(sceneOnly.find('[data-turn]').exists()).toBe(false)

    const sceneFirst = render(AppSidebar, { props: sidebarProps({ items: ['scene', 'time'] }) })
    const html = sceneFirst.html()
    expect(html.indexOf('scene-name')).toBeLessThan(html.indexOf('time-display'))
  })

  it('falls back to the area when the state tree only knows that much', () => {
    const w = render(AppSidebar, {
      props: sidebarProps({ scene: { area: SCENE.area, spot: '', scene: '' } }),
    })
    expect(w.find('.scene-name').text()).toBe(SCENE.area)
  })

  it('renders the start point of a timeline entry (intentional design, not a bug)', () => {
    const w = render(AppSidebar, {
      props: sidebarProps({
        timeLabel: NOW_LABEL,
        timeline: [{ from: TIMELINE_FROM, to: TIMELINE_TO, reason: TIMELINE_REASON, minutes: 60, at: '' }],
        turn: 1,
      }),
    })
    const timeline = w.find('.timeline')
    expect(timeline.text()).toContain(TIMELINE_FROM)
    expect(timeline.text()).not.toContain(TIMELINE_TO)
    expect(timeline.text()).toContain(TIMELINE_REASON)
  })
})

describe('WorldPanel', () => {
  it('renders the declared blocks in the declared order', () => {
    const w = render(WorldPanel, { props: { blocks: world, state } })
    expect(w.findAll('[data-block]').map((el) => el.attributes('data-block'))).toEqual(
      card.display.sidebar.map((block) => block.block),
    )
  })

  it('follows the blocks it is handed, not an order of its own', () => {
    const reversed = [...world].reverse()
    const w = render(WorldPanel, { props: { blocks: reversed, state } })
    expect(w.findAll('[data-block]').map((el) => el.attributes('data-block'))).toEqual(
      reversed.map((block) => block.name),
    )
  })

  it('draws the world out of the state tree (not out of the card preset)', () => {
    const w = render(WorldPanel, { props: { blocks: world, state } })
    const areas = Object.keys(worldState.map)
    const cast = Object.keys(state.roles as Record<string, unknown>)
    const pack = (state.lead as { pack: unknown[] }).pack

    expect(w.findAll('[data-area]')).toHaveLength(areas.length)
    expect(w.findAll('[data-item]')).toHaveLength(pack.length)
    expect(w.text()).toContain(cast[0])
    expect(w.text()).toContain(areas[0])
  })

  it('marks the current area and place from world.location, and only those', () => {
    const w = render(WorldPanel, { props: { blocks: world, state } })
    const location = worldState.location

    const here = w.findAll('[data-place][data-current]')
    expect(here).toHaveLength(1)
    expect(here[0].text()).toBe(location.spot)
    expect(w.findAll('[data-area][data-current]')).toHaveLength(1)
  })

  it('follows the state tree when the lead moves (the panel is not frozen at the opening)', () => {
    const moved = JSON.parse(JSON.stringify(state)) as typeof state
    ;(moved.world as { location: unknown }).location = {
      area: '\u9547\u90ca',
      spot: '\u6797\u95f4\u5c0f\u9053',
      scene: '\u5c94\u8def\u53e3',
    }
    const w = render(WorldPanel, { props: { blocks: world, state: moved } })

    expect(w.findAll('[data-place][data-current]')[0].text()).toBe('\u6797\u95f4\u5c0f\u9053')
    expect(w.findAll('[data-area][data-current]')[0].text()).toContain('\u9547\u90ca')
  })

  it('closes itself by emitting close', async () => {
    const w = render(WorldPanel, { props: { blocks: world, state } })
    await w.find('button[data-world-close]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})

describe('WorldCast', () => {
  it('draws each person as a name plus the lines of their sections', () => {
    const w = render(WorldCast, {
      props: {
        cast: { '\u8389\u5a1c': { title: 'keeper', traits: ['calm', 'sharp'], sealed: { deep: 1 } } },
      },
    })

    expect(w.findAll('[data-cast]')).toHaveLength(1)
    const text = w.find('[data-cast]').text()
    expect(text).toContain('\u8389\u5a1c')
    expect(text).toContain('keeper')
    expect(text).toContain('calm / sharp')
    // 嵌套对象不展开：面板是给人扫一眼的，不是状态树的全文
    expect(text).not.toContain('sealed')
    expect(text).not.toContain('deep')
  })

  it('writes a person whose whole section is one string as one line', () => {
    const w = render(WorldCast, { props: { cast: { '\u964c\u751f\u4eba': 'a hooded stranger' } } })
    expect(w.find('[data-cast]').text()).toContain('a hooded stranger')
    expect(w.findAll('[data-cast] li')).toHaveLength(0)
  })

  it('draws nothing when the cast is not a dictionary of people', () => {
    const w = render(WorldCast, { props: { cast: ['\u8389\u5a1c'] } })
    expect(w.findAll('[data-cast]')).toHaveLength(0)
  })

  it('takes the note of a person whose section is a record, and does not print it twice', () => {
    const w = render(WorldCast, {
      props: { cast: { Salen: { note: 'red hair, twenty-six', role: 'smith' } } },
    })
    const text = w.find('[data-cast]').text()

    // 卡把角色写成对象（示例卡就是这样）：简介读条目里的 note，明细行里不再重复一遍
    expect(text).toContain('red hair, twenty-six')
    expect(text.match(/red hair, twenty-six/g)).toHaveLength(1)
    expect(text).toContain('smith')
  })
})

describe('WorldSelf', () => {
  const lead = state.lead as { name: string; now: { wearing: string } }

  it('draws the protagonist as a name plus the authored fields', () => {
    const w = render(WorldSelf, { props: { lead } })

    expect(w.find('[data-self-name]').text()).toContain(lead.name)
    expect(w.find('[data-self-field="now"]').text()).toContain(lead.now.wearing)
    // 固有段按形状摊成键值行（面板认识形状，不认识「魔法」这个具体字段）
    expect(w.find('[data-self-field="traits"]').text()).toContain('magic')
  })

  it('hides a field another panel already shows, without hiding the rest', () => {
    const w = render(WorldSelf, { props: { lead, hidden: ['pack'] } })

    expect(w.find('[data-self-field="pack"]').exists()).toBe(false)
    expect(w.find('[data-self-field="now"]').exists()).toBe(true)
  })

  it('draws nothing when the lead is not a record', () => {
    const w = render(WorldSelf, { props: { lead: ['not', 'a', 'person'] } })
    expect(w.find('[data-self]').exists()).toBe(false)
  })
})

describe('StoryCover', () => {
  const cover = {
    name: 'Demo',
    summary: 'A quiet inn at dusk.',
    configured: false,
    busy: false,
    status: null,
  }

  it('shows the welcome status and offers settings before a key is configured', async () => {
    const welcome: Status = { kind: 'info', text: t('app.welcome') }
    const w = render(StoryCover, { props: { ...cover, status: welcome } })

    expect(w.find('[data-status]').text()).toBe(t('app.welcome'))
    expect(w.find('[data-cover-start]').exists()).toBe(false)

    await w.find('[data-cover-configure]').trigger('click')
    expect(w.emitted('configure')).toHaveLength(1)
  })

  it('offers start when configured and idle, and emits it', async () => {
    const w = render(StoryCover, { props: { ...cover, configured: true } })

    const start = w.find('[data-cover-start]')
    expect(start.exists()).toBe(true)
    await start.trigger('click')
    expect(w.emitted('start')).toHaveLength(1)
  })

  it('shows the opening progress instead of a start button while busy', () => {
    const busy: Status = { kind: 'busy', text: 'opening' }
    const w = render(StoryCover, { props: { ...cover, configured: true, busy: true, status: busy } })

    expect(w.find('[data-status="busy"]').text()).toContain('opening')
    expect(w.find('[data-cover-start]').exists()).toBe(false)
  })
})

describe('WorldMap', () => {
  it('marks the current area and place, and only those', () => {
    const w = render(WorldMap, {
      props: {
        areas: { '\u6668\u98ce\u9547': { spots: ['\u9152\u9986', '\u6e2f\u53e3'] }, '\u90ca\u5916': {} },
        location: { area: '\u6668\u98ce\u9547', spot: '\u6e2f\u53e3', scene: '\u6e2f\u53e3' },
      },
    })

    expect(w.findAll('[data-area]')).toHaveLength(2)
    expect(w.findAll('[data-area][data-current]')).toHaveLength(1)
    const place = w.findAll('[data-place][data-current]')
    expect(place).toHaveLength(1)
    expect(place[0].text()).toBe('\u6e2f\u53e3')
    // 还没有固定地点的区域：说清是没有，不是界面坏了
    expect(w.findAll('[data-area]')[1].text()).toContain(t('world.growingPlaces'))
  })

  it('takes the note of an area whose section is one string, and survives a missing location', () => {
    const w = render(WorldMap, {
      props: { areas: { '\u6e2f\u53e3': 'a foggy pier' }, location: undefined },
    })
    expect(w.find('[data-area]').text()).toContain('a foggy pier')
    expect(w.findAll('[data-current]')).toHaveLength(0)
  })

  it('takes the note of an area whose section is a record (what the example card looks like)', () => {
    const w = render(WorldMap, {
      props: {
        areas: { port: { kind: 'authored', note: 'a town of three hundred', spots: ['inn'] } },
        location: undefined,
      },
    })
    const text = w.find('[data-area]').text()

    // 作者写在条目里的那句话必须画出来（只认「整段是字符串」的话，它永远不会出现）
    expect(text).toContain('a town of three hundred')
    expect(text).toContain('inn')
  })
})

describe('WorldPack', () => {
  it('draws list items with their count, and keeps the rest as detail lines', () => {
    const w = render(WorldPack, {
      props: { items: [{ name: 'dirk', count: 2, wear: 'chipped' }, 'rope'] },
    })

    const items = w.findAll('[data-item]')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('dirk')
    expect(items[0].text()).toContain(t('world.itemCount', { count: 2 }))
    expect(items[0].text()).toContain('chipped')
    // 数量只出现一次：name / count 已经当标题与数量画过了，不再重复成明细行
    expect(items[0].text().split(t('world.itemCount', { count: 2 }))).toHaveLength(2)
    expect(items[1].text()).toContain('rope')
    expect(items[1].text()).not.toContain(t('world.itemCount', { count: 2 }))
  })

  it('draws a pack written as a dictionary by its keys', () => {
    const w = render(WorldPack, { props: { items: { rope: { count: 3 } } } })
    const item = w.find('[data-item]')
    expect(item.text()).toContain('rope')
    expect(item.text()).toContain(t('world.itemCount', { count: 3 }))
  })

  it('draws nothing when the pack is neither a list nor a dictionary', () => {
    const w = render(WorldPack, { props: { items: 'rope' } })
    expect(w.findAll('[data-item]')).toHaveLength(0)
  })
})

describe('state-view: the shape walkers behind the world panel', () => {
  it('walks a record into key/value entries, and nothing else', () => {
    expect(entriesOf({ a: 1, b: 'x' })).toEqual([
      { key: 'a', value: 1 },
      { key: 'b', value: 'x' },
    ])
    expect(entriesOf(['a'])).toEqual([])
    expect(entriesOf('a')).toEqual([])
    expect(entriesOf(null)).toEqual([])
  })

  it('knows a scalar from a container, and writes it as one line', () => {
    expect(isScalar('x')).toBe(true)
    expect(isScalar(3)).toBe(true)
    expect(isScalar(false)).toBe(true)
    expect(isScalar(['x'])).toBe(false)
    expect(isScalar({ a: 1 })).toBe(false)
    expect(isScalar(null)).toBe(false)
    expect(scalarText(3)).toBe('3')
    expect(scalarText(['x'])).toBe('')
  })

  it('collects a string list, whether it is the value itself or a field inside it', () => {
    expect(textsOf(['a', 'b'])).toEqual(['a', 'b'])
    expect(textsOf({ spots: ['a', 'b'], note: 'x' })).toEqual(['a', 'b'])
    expect(textsOf({ note: 'x' })).toEqual([])
    expect(textsOf('a')).toEqual([])
  })

  it('turns a record into lines, joining text lists and skipping nested objects', () => {
    expect(linesOf({ tier: 'major', spots: ['a', 'b'], nested: { x: 1 } })).toEqual([
      { key: 'tier', text: 'major' },
      { key: 'spots', text: 'a / b' },
    ])
  })

  it('turns a list entry into title / count / details, by the two interface conventions', () => {
    expect(itemOf('rope')).toEqual({ title: 'rope', count: '', lines: [] })
    expect(itemOf({ name: 'bread', count: 3, note: 'stale' })).toEqual({
      title: 'bread',
      count: '3',
      lines: [{ key: 'note', text: 'stale' }],
    })
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
    expect(w.find('input[type="range"]').exists()).toBe(false)
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

// ---------- store 的调试投影 ----------

/** 一行节点痕迹（产品就是这么写的：渲染好的行 + 节点 id） */
function nodeEvent(id: string): Record<string, unknown> {
  return { kind: 'node', text: t('store.nodeLine', { node: nodes[id]?.name ?? id }), node: id }
}

/** 一行工具调用痕迹（结构化字段：哪个节点、什么工具；detail 是协议原样的参数） */
function toolEvent(node: string, tool: string, args: string): Record<string, unknown> {
  return { kind: 'tool', text: t('toolbar.toolCall', { tool, args }), node, tool, detail: args }
}

/**
 * 一行写入痕迹（结构化字段：路径 + 写成的值）。
 *
 * ⚠️ 值存的是**真值**（`value`），不是一份 JSON 文本 —— 界面要文本时自己现写。
 */
function writeEvent(path: string, value?: unknown): Record<string, unknown> {
  const event: Record<string, unknown> = {
    kind: 'stateChange',
    text: t('store.stateChangeLine', { path }),
    path,
  }
  if (value !== undefined) event.value = value
  return event
}

/**
 * 一行工具结果（结构化字段：哪个节点、什么工具；detail 是回传的原文）。
 *
 * failed 由**引擎**写在痕迹上（参数不合法 / 不在白名单 / 动作不存在）—— 面板只读它，
 * 所以夹具也必须把它写出来，不然造出来的是「旧存档里没有这个字段的那种痕迹」。
 */
function resultEvent(node: string, tool: string, result: string, failed = false): Record<string, unknown> {
  return {
    kind: 'toolResult',
    text: t('store.toolResultLine', { result }),
    node,
    tool,
    detail: result,
    failed,
  }
}

/** 一份存档：一整轮的工具痕迹（含一次失败、一次退回重来），前面还压着上一轮的故事 */
function saveWithTrace(): string {
  const data = createInitialState(card)
  data.meta.turn = 4
  const events: Array<Record<string, unknown>> = [
    // 上一轮的痕迹：不该进「最近一轮」的投影
    { kind: 'action', text: 'older action' },
    toolEvent(topology[0], 'set_profile', '{not json'),
    resultEvent(topology[0], 'set_profile', 'bad arguments', true),
    { kind: 'action', text: 'this turn action' },
    // 没有调用在飞的时候也会有写入：它不该被算到任何一次调用头上
    writeEvent('time'),
    nodeEvent(topology[4]),
    toolEvent(topology[4], 'advance_time', BABEL_TEXT),
    writeEvent('time', { year: 2026, month: 9, day: 14, hour: 19, minute: 35 }),
    resultEvent(topology[4], 'advance_time', 'time advanced'),
    toolEvent(topology[8], 'redo', '{"from":"' + topology[6] + '","why":"missing"}'),
    resultEvent(topology[8], 'redo', 'rolling back'),
    // 结果之后又冒出一条结果：没有调用在对，丢掉
    { kind: 'toolResult', text: 'stray', detail: 'stray' },
    // 一次失败的地图调用：它在图里是会标红的那个节点
    nodeEvent(topology[5]),
    toolEvent(topology[5], 'move_to', '{"area":"x"}'),
    resultEvent(topology[5], 'move_to', 'move_to: spot is required', true),
  ]
  data.events = events.map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]
  return JSON.stringify(data)
}

/**
 * 种一份存档再拿一个全新的 store（投影在模块加载期读存档）。
 *
 * ⚠️ 重来一份模块图 = 重来一份 i18n：不把它的语言也钉在 zh-CN，store 投影就会拿
 *    另一种语言的文案外壳去读事件流（本文件造事件用的是上面那份 zh-CN 的 t）。
 */
async function freshGame(save: string) {
  localStorage.clear()
  localStorage.setItem('tavernGame.save', save)
  vi.resetModules()
  const [i18nModule, store] = await Promise.all([import('../src/i18n'), import('../src/stores/game')])
  ;(i18nModule.i18n.global.locale as unknown as { value: string }).value = 'zh-CN'
  return store.useGame()
}

describe('store: the debug projections', () => {
  it('projects the latest round of events into tool calls (node, args, result, writes)', async () => {
    const game = await freshGame(saveWithTrace())
    const calls = game.debugTools.value

    // 上一轮那次 set_profile 不在里面：投影只看最近一轮
    expect(calls).toHaveLength(3)
    expect(calls.map((call) => call.tool)).toEqual(['advance_time', 'redo', 'move_to'])
    expect(calls[0].node).toBe(topology[4])
    expect(calls[0].args).toBe(BABEL_TEXT)
    expect(calls[0].result).toBe('time advanced')
    expect(calls[0].writes).toEqual([
      { path: 'time', value: { year: 2026, month: 9, day: 14, hour: 19, minute: 35 } },
    ])
    expect(calls[0].failed).toBe(false)

    // 退回重来：from 在参数里，图上要标红的是被退回去的那个节点
    expect(calls[1].redoFrom).toBe(topology[6])
    expect(calls[1].failed).toBe(false)

    // 一个字节都没写成、引擎回了结构化错误 —— 失败这件事写在 failed 上
    expect(calls[2].node).toBe(topology[5])
    expect(calls[2].writes).toEqual([])
    expect(calls[2].failed).toBe(true)
  })

  it('reads a write from the structured value, and writes the fold text itself', async () => {
    const data = createInitialState(card)
    data.events = [
      nodeEvent(topology[6]),
      toolEvent(topology[6], 'move_to', '{"area":"x","spot":"y","scene":"z"}'),
      writeEvent('world.location', { area: 'x', spot: 'y', scene: 'z' }),
      resultEvent(topology[6], 'move_to', 'wrote it'),
    ].map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]

    const game = await freshGame(JSON.stringify(data))
    // 调试行只在调试模式进列表（叙事与它无关）
    game.debugMode.value = true

    expect(game.debugTools.value[0].writes).toEqual([
      { path: 'world.location', value: { area: 'x', spot: 'y', scene: 'z' } },
    ])
    // 展开体（给人看的原文）是从结构化值**现写**的：痕迹里没有第二份 JSON 文本
    const folded = game.rows.value.map((row) => ('detail' in row ? row.detail : '')).join('\n')
    expect(folded).toContain('"area": "x"')
  })

  it('survives a write trace whose detail is not JSON (hand-edited or imported save)', async () => {
    const data = createInitialState(card)
    data.events = [
      toolEvent(topology[6], 'move_to', '{"area":"x"}'),
      // 外部数据：旧痕迹 / 手改过的存档里，写入那一行的 detail 可能只是一句人话
      { kind: 'stateChange', text: 'rendered however', detail: 'time advanced' },
      resultEvent(topology[6], 'move_to', 'wrote it'),
    ].map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]

    const game = await freshGame(JSON.stringify(data))

    // 以前这里会把那句人话 JSON.parse 一遍 —— 在渲染期抛 SyntaxError，整个面板挂掉
    expect(() => game.debugTools.value).not.toThrow()
    expect(game.debugTools.value[0].writes).toEqual([{ path: '', value: undefined }])
  })

  it('marks a redo the engine refused as failed (a successful redo writes nothing either)', async () => {
    const data = createInitialState(card)
    data.events = [
      nodeEvent(topology[8]),
      // 成功的 redo：回滚不写状态，但引擎认下了（failed: false）
      toolEvent(topology[8], 'redo', '{"from":"' + topology[6] + '","why":"missing"}'),
      resultEvent(topology[8], 'redo', 'rolling back'),
      // 被拒的 redo：from 不在拓扑里，引擎回结构化错误
      toolEvent(topology[8], 'redo', '{"from":"no-such-node","why":"nope"}'),
      resultEvent(topology[8], 'redo', 'redo: from must be one of [...]', true),
    ].map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]

    const game = await freshGame(JSON.stringify(data))
    const [accepted, refused] = game.debugTools.value
    expect(accepted.failed).toBe(false)
    expect(refused.failed).toBe(true)
    // 被退回去的那个节点标红（成功的 redo），被拒的那次标红的是**发起它的节点**
    expect(game.debugFailedNodes.value).toEqual([topology[6], topology[8]])
  })

  it('reads the structured fields, not the rendered line (the line may be any language)', async () => {
    const data = createInitialState(card)
    data.events = [
      { kind: 'tool', text: 'rendered however', node: topology[6], tool: 'move_to', detail: '{"area":"x"}' },
      { kind: 'stateChange', text: 'rendered however', path: 'world.location', value: { area: 'x' } },
      {
        kind: 'toolResult',
        text: 'rendered however',
        node: topology[6],
        tool: 'move_to',
        detail: 'wrote it',
      },
    ].map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]

    const [call] = (await freshGame(JSON.stringify(data))).debugTools.value
    expect(call.node).toBe(topology[6])
    expect(call.tool).toBe('move_to')
    expect(call.result).toBe('wrote it')
    expect(call.writes).toEqual([{ path: 'world.location', value: { area: 'x' } }])
  })

  it('marks the nodes to redraw in red: the failed one and the node a redo rolled back', async () => {
    const game = await freshGame(saveWithTrace())
    expect(game.debugFailedNodes.value).toEqual([topology[5], topology[6]])
  })

  it('has nothing to show when no turn has run yet, and knows the turn is idle', async () => {
    const game = await freshGame(JSON.stringify(createInitialState(card)))
    expect(game.debugTools.value).toEqual([])
    expect(game.debugFailedNodes.value).toEqual([])
    expect(game.runningNode.value).toBe(null)
    expect(game.debugWrites.value).toEqual([])
  })

  it('shows no node and no path for traces written before those fields existed', async () => {
    const data = createInitialState(card)
    data.events = [
      { kind: 'tool', text: 'a line from an older save' },
      { kind: 'stateChange', text: 'a line from an older save', value: { year: 2026 } },
      { kind: 'toolResult', text: 'a line from an older save' },
    ].map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]

    const game = await freshGame(JSON.stringify(data))
    const [call] = game.debugTools.value
    expect(call.node).toBe(null)
    expect(call.tool).toBe('')
    expect(call.args).toBe('')
    expect(call.result).toBe('')
    expect(call.writes).toEqual([{ path: '', value: { year: 2026 } }])
    // 旧痕迹里没有 failed 这个字段（它是后来才加的）：不当成失败，图上也就没有要标红的
    expect(call.failed).toBe(false)
    expect(game.debugFailedNodes.value).toEqual([])
  })

  it('reads a write with no value, and a redo whose arguments are not JSON', async () => {
    const data = createInitialState(card)
    data.events = [
      nodeEvent(topology[6]),
      toolEvent(topology[6], 'redo', '{not json'),
      writeEvent('roles'),
      resultEvent(topology[6], 'redo', 'rolled back'),
      // 合法 JSON、但不是对象：一样读不出 from（模型给的参数是外部数据）
      toolEvent(topology[6], 'redo', '[]'),
      resultEvent(topology[6], 'redo', 'rolled back'),
    ].map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]

    const game = await freshGame(JSON.stringify(data))
    const [broken, array] = game.debugTools.value
    expect(broken.writes).toEqual([{ path: 'roles', value: undefined }])
    expect(broken.redoFrom).toBe(null)
    // 这一次调用写成了「一条没有值」的路径：不算失败，也没有节点要标红
    expect(broken.failed).toBe(false)
    expect(array.redoFrom).toBe(null)
    expect(game.debugFailedNodes.value).toEqual([])
  })
})
