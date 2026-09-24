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
import AppSidebar from '../src/components/AppSidebar.vue'
import WorldPanel from '../src/components/WorldPanel.vue'
import { entriesOf, isScalar, itemOf, linesOf, scalarText, textsOf } from '../src/components/state-view'
import GameComposer from '../src/components/GameComposer.vue'
import SettingsDrawer from '../src/components/SettingsDrawer.vue'
import type { Row, Status } from '../src/stores/game'
import { parseCard } from '../src/game/card'
import { instantiate } from '../src/game/card-state'
import { clockIn } from '../src/game/card-time'
import { createInitialState } from '../src/game/save'
import { format } from '../src/game/card-calendar'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { nodeWith } from './support/card-replies'
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

/**
 * 痕迹里要用到的节点 id —— **从卡里查，不写下标**：拓扑里删掉一个节点，后面每一个的下标
 * 都往前挪一位，而"同一个下标换成了另一个节点"在读数是看不出来的。
 */
const TIME = nodeWith('advance_time', card)
const MAP = nodeWith('add_place', card)
const CAST = nodeWith('update_role', card)
const VERIFY = nodeWith('redo', card)

// 用卡自己的历法念时刻，标签不受时区影响（时刻那一格从卡的初值状态树里现取）
const TIME_LABEL = format(card.time.calendar, clockIn(instantiate(card)))
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
  /** 「当前所在」那一行的值：册子里主控那一条（区域 / 地点 / 场景），顺序即卡里的字段顺序 */
  const WHEREABOUTS = [SCENE.area, SCENE.spot, SCENE.scene]

  /** 常态 props；items 是**引擎自己的**状态行（时间 / 场景 / 回合），卡不再声明它们（R32） */
  function sidebarProps(over: Record<string, unknown> = {}) {
    return {
      items: ['time', 'scene', 'turn'],
      timeLabel: TIME_LABEL,
      timeline: [],
      scene: WHEREABOUTS,
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

  it('renders exactly the status rows it is handed, in that order', () => {
    const sceneOnly = render(AppSidebar, { props: sidebarProps({ items: ['scene'] }) })
    expect(sceneOnly.find('.scene-name').exists()).toBe(true)
    expect(sceneOnly.find('.time-display').exists()).toBe(false)
    expect(sceneOnly.find('[data-turn]').exists()).toBe(false)

    const sceneFirst = render(AppSidebar, { props: sidebarProps({ items: ['scene', 'time'] }) })
    const html = sceneFirst.html()
    expect(html.indexOf('scene-name')).toBeLessThan(html.indexOf('time-display'))
  })

  it('falls back to the one value the whereabouts book has', () => {
    const w = render(AppSidebar, { props: sidebarProps({ scene: [SCENE.area] }) })
    expect(w.find('.scene-name').text()).toBe(SCENE.area)
  })

  it('keeps the scene line the end-to-end run looks for (smoke.spec.ts:83)', () => {
    // e2e 断的是 `aside .scene-name` 里含**主控在册子里的那个 spot** ——
    // 值的来源由 store（`useGame().scene` 读册子里主控那一条）保证，这里保证**那一行还在**。
    const w = render(AppSidebar, { props: sidebarProps() })
    const line = w.find('.scene-name')
    expect(line.exists(), 'the sidebar lost its scene line').toBe(true)
    expect(line.text(), 'the scene line does not say where the lead is').toContain(SCENE.spot)
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
  /**
   * 面板画什么由**卡声明的侧栏条目**决定（路径 + 标题 + 一种预设格式 + 放哪一边），那一套判据只有一份，
   * 在 `tests/display-render-dom.test.ts`（顺序 / 三种格式 / 每个值自己一个元素 / 当前所在怎么标）
   * 与 `tests/display-side-dom.test.ts`（两栏 / 归属 / 空栏）。
   * 这里只剩**一栏自己**的契约：它带的 `side`、以及空栏那一句。
   *
   * ⚠️ 票 68（2026-09-24）换掉了原来那条「关得掉」：世界面板那层**抽屉整个撤了**
   *    （老板：「都常驻了，就不用展开按钮了」）⇒ `button[data-world-close]` 与 `emit('close')`
   *    都没有主语了。**一条断言都没减**，减的是那条不再存在的行为。
   */
  it('carries the side it was handed, and says so when it has no blocks', () => {
    const w = render(WorldPanel, { props: { side: 'right', blocks: [], state } })
    expect(w.attributes('data-side'), 'the column does not carry its side').toBe('right')
    expect(w.findAll('[data-block]')).toHaveLength(0)
    expect(w.find('[data-side-empty]').text(), 'an empty column must say it in the player text').toBe(
      String(t('play.emptySide')),
    )
  })
})

/**
 * 段 6 删掉的三组判据：`WorldCast` / `WorldMap` / `WorldPack` 三个**专用渲染器**的用例。
 *
 * R12/R13 把它们换成了三种**预设格式**的渲染器 ⇒ 这三组判据没有主体了（组件本身要删）。
 * 它们测过的行为由谁接住：
 *   · 每一条目都画出来、每个人的每一栏各一行 ⇒ `display-render-dom.test.ts` 的 15 / 16 / 17
 *     （按格式画：分组列表 / 列表 / 键值，值一个个现取）
 *   · 「当前所在」高亮、且只标它 ⇒ 同文件 18（按**值**标，不认字段名），端到端由 e2e `smoke.spec.ts:152-155` 收
 *   · 「当前所在」跟着状态树走（不是冻结在开局） ⇒ 同文件 22
 *   · 主动放弃的两条（内容形状的判断，正是 R13 要消灭的）：区域那一栏的"还没有固定地点"提示语、
 *     以及"对象条目哪一栏是简介" —— 界面不认字段名，这两条不再成立。
 */

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

  it('turns a list entry into a title or into detail lines, by shape alone', () => {
    expect(itemOf('rope')).toEqual({ title: 'rope', lines: [] })
    // 对象条目没有标题：整段摊成明细行，**一栏都不摘走**（没有「哪一栏是名称 / 数量」这套约定）
    expect(itemOf({ name: 'bread', count: 3, note: 'stale' })).toEqual({
      title: '',
      lines: [
        { key: 'name', text: 'bread' },
        { key: 'count', text: '3' },
        { key: 'note', text: 'stale' },
      ],
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
    nodeEvent(TIME),
    toolEvent(TIME, 'advance_time', BABEL_TEXT),
    writeEvent('time', { year: 2026, month: 9, day: 14, hour: 19, minute: 35 }),
    resultEvent(TIME, 'advance_time', 'time advanced'),
    toolEvent(VERIFY, 'redo', '{"from":"' + CAST + '","why":"missing"}'),
    resultEvent(VERIFY, 'redo', 'rolling back'),
    // 结果之后又冒出一条结果：没有调用在对，丢掉
    { kind: 'toolResult', text: 'stray', detail: 'stray' },
    // 一次失败的地图调用：它在图里是会标红的那个节点
    nodeEvent(MAP),
    toolEvent(MAP, 'add_place', '{"note":"late"}'),
    resultEvent(MAP, 'add_place', 'add_place: area must be a non-empty string (the map key)', true),
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
    expect(calls.map((call) => call.tool)).toEqual(['advance_time', 'redo', 'add_place'])
    expect(calls[0].node).toBe(TIME)
    expect(calls[0].args).toBe(BABEL_TEXT)
    expect(calls[0].result).toBe('time advanced')
    expect(calls[0].writes).toEqual([
      { path: 'time', value: { year: 2026, month: 9, day: 14, hour: 19, minute: 35 } },
    ])
    expect(calls[0].failed).toBe(false)

    // 退回重来：from 在参数里，图上要标红的是被退回去的那个节点
    expect(calls[1].redoFrom).toBe(CAST)
    expect(calls[1].failed).toBe(false)

    // 一个字节都没写成、引擎回了结构化错误 —— 失败这件事写在 failed 上
    expect(calls[2].node).toBe(MAP)
    expect(calls[2].writes).toEqual([])
    expect(calls[2].failed).toBe(true)
  })

  it('reads a write from the structured value, and writes the fold text itself', async () => {
    const data = createInitialState(card)
    data.events = [
      nodeEvent(MAP),
      toolEvent(MAP, 'add_place', '{"area":"x","note":"late"}'),
      writeEvent('world.map.x', { note: 'late' }),
      resultEvent(MAP, 'add_place', 'wrote it'),
    ].map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]

    const game = await freshGame(JSON.stringify(data))
    // 调试行只在调试模式进列表（叙事与它无关）
    game.debugMode.value = true

    expect(game.debugTools.value[0].writes).toEqual([{ path: 'world.map.x', value: { note: 'late' } }])
    // 展开体（给人看的原文）是从结构化值**现写**的：痕迹里没有第二份 JSON 文本
    const folded = game.rows.value.map((row) => ('detail' in row ? row.detail : '')).join('\n')
    expect(folded).toContain('"note": "late"')
  })

  it('survives a write trace whose detail is not JSON (hand-edited or imported save)', async () => {
    const data = createInitialState(card)
    data.events = [
      toolEvent(MAP, 'add_place', '{"area":"x"}'),
      // 外部数据：旧痕迹 / 手改过的存档里，写入那一行的 detail 可能只是一句人话
      { kind: 'stateChange', text: 'rendered however', detail: 'time advanced' },
      resultEvent(MAP, 'add_place', 'wrote it'),
    ].map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]

    const game = await freshGame(JSON.stringify(data))

    // 以前这里会把那句人话 JSON.parse 一遍 —— 在渲染期抛 SyntaxError，整个面板挂掉
    expect(() => game.debugTools.value).not.toThrow()
    expect(game.debugTools.value[0].writes).toEqual([{ path: '', value: undefined }])
  })

  it('marks a redo the engine refused as failed (a successful redo writes nothing either)', async () => {
    const data = createInitialState(card)
    data.events = [
      nodeEvent(VERIFY),
      // 成功的 redo：回滚不写状态，但引擎认下了（failed: false）
      toolEvent(VERIFY, 'redo', '{"from":"' + CAST + '","why":"missing"}'),
      resultEvent(VERIFY, 'redo', 'rolling back'),
      // 被拒的 redo：from 不在拓扑里，引擎回结构化错误
      toolEvent(VERIFY, 'redo', '{"from":"no-such-node","why":"nope"}'),
      resultEvent(VERIFY, 'redo', 'redo: from must be one of [...]', true),
    ].map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]

    const game = await freshGame(JSON.stringify(data))
    const [accepted, refused] = game.debugTools.value
    expect(accepted.failed).toBe(false)
    expect(refused.failed).toBe(true)
    // 被退回去的那个节点标红（成功的 redo），被拒的那次标红的是**发起它的节点**
    expect(game.debugFailedNodes.value).toEqual([CAST, VERIFY])
  })

  it('reads the structured fields, not the rendered line (the line may be any language)', async () => {
    const data = createInitialState(card)
    data.events = [
      { kind: 'tool', text: 'rendered however', node: MAP, tool: 'add_place', detail: '{"area":"x"}' },
      { kind: 'stateChange', text: 'rendered however', path: 'world.map.x', value: { note: 'late' } },
      {
        kind: 'toolResult',
        text: 'rendered however',
        node: MAP,
        tool: 'add_place',
        detail: 'wrote it',
      },
    ].map((event) => ({ at: '2026-09-15T10:00:00.000Z', ...event })) as GameEvent[]

    const [call] = (await freshGame(JSON.stringify(data))).debugTools.value
    expect(call.node).toBe(MAP)
    expect(call.tool).toBe('add_place')
    expect(call.result).toBe('wrote it')
    expect(call.writes).toEqual([{ path: 'world.map.x', value: { note: 'late' } }])
  })

  it('marks the nodes to redraw in red: the failed one and the node a redo rolled back', async () => {
    const game = await freshGame(saveWithTrace())
    expect(game.debugFailedNodes.value).toEqual([MAP, CAST])
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
      nodeEvent(VERIFY),
      toolEvent(VERIFY, 'redo', '{not json'),
      writeEvent('roles'),
      resultEvent(VERIFY, 'redo', 'rolled back'),
      // 合法 JSON、但不是对象：一样读不出 from（模型给的参数是外部数据）
      toolEvent(VERIFY, 'redo', '[]'),
      resultEvent(VERIFY, 'redo', 'rolled back'),
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
