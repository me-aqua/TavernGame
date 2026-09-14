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
import type { StoryLine } from '../src/stores/game'
import { i18n } from '../src/i18n'

/** 组件要 t()，所以统一装上 i18n 插件；断言按中文写，固定用 zh-CN */
i18n.global.locale.value = 'zh-CN'
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

/** 造一行叙事流数据 */
function makeLine(over: Partial<StoryLine>): StoryLine {
  return { id: 1, kind: 'narration', text: '正文', ...over }
}

describe('StoryPanel', () => {
  it('按 kind 渲染每一行（kind 决定样式类）', () => {
    const lines = [
      makeLine({ id: 1, kind: 'narration', text: '你在客栈里。' }),
      makeLine({ id: 2, kind: 'action', text: '我推门出去' }),
      makeLine({ id: 3, kind: 'system', text: '（系统提示）' }),
      makeLine({ id: 4, kind: 'warn', text: '⚠ 注意' }),
    ]
    const w = render(StoryPanel, { props: { lines, thinking: false } })

    const divs = w.findAll('.line')
    expect(divs).toHaveLength(4)
    expect(divs[0].classes()).toContain('narration')
    expect(divs[1].classes()).toContain('action')
    expect(divs[2].classes()).toContain('system')
    expect(divs[3].classes()).toContain('warn')
    expect(w.text()).toContain('我推门出去')
  })

  it('调试模式的原始输出用 details 折叠，不进正文', () => {
    const w = render(StoryPanel, {
      props: {
        lines: [makeLine({ raw: '模型原文', rawBlocks: 2, text: '🔍 模型原始输出' })],
        thinking: false,
      },
    })
    expect(w.find('details').exists()).toBe(true)
    expect(w.find('details pre').text()).toBe('模型原文')
  })

  it('思考中有指示器，结束后消失', async () => {
    const w = render(StoryPanel, { props: { lines: [], thinking: true } })
    expect(w.find('.thinking').exists()).toBe(true)
    await w.setProps({ thinking: false })
    expect(w.find('.thinking').exists()).toBe(false)
  })

  it('模型输出走 textContent，不解析 HTML（XSS 防线）', () => {
    const w = render(StoryPanel, {
      props: { lines: [makeLine({ text: '<img src=x onerror=alert(1)>' })], thinking: false },
    })
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('<img src=x onerror=alert(1)>')
  })
})

describe('AppSidebar', () => {
  it('渲染时间 / 地点 / 回合三块', () => {
    const w = render(AppSidebar, {
      props: {
        timeLabel: '2026 年 9 月 14 日 · 星期一 · 下午',
        timeline: [],
        scene: { name: '临江客栈', description: '楼下有说话声。' },
        turn: 3,
      },
    })
    expect(w.find('.time-display').text()).toBe('2026 年 9 月 14 日 · 星期一 · 下午')
    expect(w.find('.scene-name').text()).toBe('临江客栈')
    expect(w.text()).toContain('已进行')
    expect(w.text()).toContain('3')
  })

  it('时间线渲染的是**起点**（有意设计，不是 bug）', () => {
    const w = render(AppSidebar, {
      props: {
        timeLabel: '现在',
        timeline: [
          { from: '9 月 12 日 · 上午', to: '9 月 13 日 · 晚上', reason: '睡了一觉', elapsedMs: 1, at: '' },
        ],
        scene: { name: 'a', description: 'b' },
        turn: 1,
      },
    })
    const timeline = w.find('.timeline')
    expect(timeline.text()).toContain('9 月 12 日 · 上午')
    expect(timeline.text()).not.toContain('9 月 13 日 · 晚上')
    expect(timeline.text()).toContain('睡了一觉')
  })
})

describe('GameComposer', () => {
  it('Enter 提交内容并清空输入框', async () => {
    const w = render(GameComposer, { props: { disabled: false, configured: true } })
    const ta = w.find('textarea')
    await ta.setValue('我去码头')
    await ta.trigger('keydown', { key: 'Enter' })

    expect(w.emitted('submit')?.[0]).toEqual(['我去码头'])
    expect((ta.element as HTMLTextAreaElement).value).toBe('')
  })

  it('空输入不提交', async () => {
    const w = render(GameComposer, { props: { disabled: false, configured: true } })
    await w.find('textarea').setValue('   ')
    await w.find('button').trigger('click')
    expect(w.emitted('submit')).toBeUndefined()
  })

  it('未配置时提示去设置，且输入框禁用', () => {
    const w = render(GameComposer, { props: { disabled: true, configured: false } })
    expect(w.text()).toContain('还没配置 API key')
    expect(w.find('textarea').attributes('disabled')).toBeDefined()
  })
})

describe('AppHeader', () => {
  it('状态灯有三种状态', async () => {
    const w = render(AppHeader, { props: { light: 'ok', statusText: '已连接', theme: 'system' } })
    expect(w.find('.bg-accent').exists()).toBe(true)
    await w.setProps({ light: 'err' })
    expect(w.find('.bg-danger').exists()).toBe(true)
  })

  it('五个按钮各自 emit 对应事件（含主题切换）', async () => {
    const w = render(AppHeader, { props: { light: 'ok', statusText: '', theme: 'system' } })
    const btns = w.findAll('header button')
    expect(btns).toHaveLength(5)
    for (const b of btns) await b.trigger('click')
    expect(w.emitted('toggleTheme')).toHaveLength(1)
    expect(w.emitted('export')).toHaveLength(1)
    expect(w.emitted('import')).toHaveLength(1)
    expect(w.emitted('reset')).toHaveLength(1)
    expect(w.emitted('settings')).toHaveLength(1)
  })
})

describe('SettingsDrawer', () => {
  it('关闭时不渲染任何东西', () => {
    const w = render(SettingsDrawer, { props: { open: false } })
    expect(w.find('.drawer').exists()).toBe(false)
  })

  it('打开时列出全部服务商与字段', () => {
    const w = render(SettingsDrawer, { props: { open: true } })
    expect(w.find('.drawer').exists()).toBe(true)
    const options = w.findAll('select option').map((o) => o.text())
    expect(options).toContain('DeepSeek 官方')
    expect(options).toContain('本地 Ollama（零成本）')
    expect(w.text()).toContain('API Key')
    expect(w.text()).toContain('每回合最多思考步数')
  })

  it('点遮罩关闭自己', async () => {
    const w = render(SettingsDrawer, { props: { open: true } })
    await w.find('.drawer').trigger('click')
    expect(w.emitted('update:open')?.[0]).toEqual([false])
  })

  it('点面板内部不会关闭', async () => {
    const w = render(SettingsDrawer, { props: { open: true } })
    await w.find('.sheet').trigger('click')
    expect(w.emitted('update:open')).toBeUndefined()
  })
})
