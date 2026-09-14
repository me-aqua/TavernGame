// @vitest-environment jsdom
/**
 * 组件测试 —— 覆盖 Vue 那层（此前只有浏览器验证，没有回归网）。
 *
 * 只测**契约**（渲染出什么、点击后 emit 什么），不测样式。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StoryPanel from '../src/components/StoryPanel.vue'
import AppSidebar from '../src/components/AppSidebar.vue'
import GameComposer from '../src/components/GameComposer.vue'
import AppHeader from '../src/components/AppHeader.vue'
import SettingsDrawer from '../src/components/SettingsDrawer.vue'
import type { Row, Status } from '../src/stores/game'
import { i18n, t } from '../src/i18n'
import { realCalendar } from '../src/utils/calendar'

/** 组件要 t()，所以统一装上 i18n 插件；断言按中文写，固定用 zh-CN */
i18n.global.locale.value = 'zh-CN'

// Fixtures live here as named consts (code stays ASCII), and anything the
// product really emits is built with t() so its exact wording is never copied.
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
// Local-time construction keeps the label timezone independent.
const TIME_LABEL = realCalendar.format(new Date(2026, 8, 14, 14, 0, 0).toISOString())
const NOW_LABEL = 'now'
const TIMELINE_FROM = realCalendar.formatShort(new Date(2026, 8, 12, 9, 0, 0).toISOString())
const TIMELINE_TO = realCalendar.formatShort(new Date(2026, 8, 13, 20, 0, 0).toISOString())
const TIMELINE_REASON = 'slept through the night'
const PLAYER_INPUT = 'I head to the docks'
const STATUS_TEXT = 'connected'

/**
 * Mount a component with the real i18n instance attached.
 *
 * Typed loosely on purpose: components have different prop shapes, and
 * spelling out the generic per call site would be noise.
 */
function render<C>(component: C, options: Record<string, unknown> = {}) {
  return mount(
    component as Parameters<typeof mount>[0],
    { ...options, global: { plugins: [i18n] } } as Parameters<typeof mount>[1],
  )
}

/** 造一行故事数据（事件流的投影） */
function makeLine(over: Partial<Extract<Row, { debug: false }>> = {}): Row {
  return { id: 1, kind: 'narration', text: DEFAULT_LINE_TEXT, debug: false, ...over }
}

/** 造一行调试数据（模型 I/O、工具调用、警告） */
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
    expect(w.find('.scene-name').text()).toBe(SCENE_NAME)
    expect(w.text()).toContain(t('sidebar.turnCount'))
    expect(w.text()).toContain('3')
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

describe('AppHeader', () => {
  it('shows the status light in its ok and error states', async () => {
    const w = render(AppHeader, {
      props: { light: 'ok', statusText: STATUS_TEXT, theme: 'system', debug: false },
    })
    expect(w.find('.bg-accent').exists()).toBe(true)
    await w.setProps({ light: 'err' })
    expect(w.find('.bg-danger').exists()).toBe(true)
  })

  it('marks debug mode so the extra story lines are explainable', async () => {
    const w = render(AppHeader, {
      props: { light: 'ok', statusText: STATUS_TEXT, theme: 'system', debug: false },
    })
    expect(w.find('[data-debug]').exists()).toBe(false)
    await w.setProps({ debug: true })
    expect(w.find('[data-debug]').text()).toBe(t('header.debug'))
  })

  it('every header button emits its event (theme and language toggles included)', async () => {
    const w = render(AppHeader, {
      props: { light: 'ok', statusText: '', theme: 'system', language: 'system', debug: false },
    })
    const btns = w.findAll('header button')
    expect(btns).toHaveLength(6)
    for (const b of btns) await b.trigger('click')
    expect(w.emitted('toggleTheme')).toHaveLength(1)
    expect(w.emitted('toggleLanguage')).toHaveLength(1)
    expect(w.emitted('export')).toHaveLength(1)
    expect(w.emitted('import')).toHaveLength(1)
    expect(w.emitted('reset')).toHaveLength(1)
    expect(w.emitted('settings')).toHaveLength(1)
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
    // The step-limit label interpolates the slider value, so read it back first.
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
