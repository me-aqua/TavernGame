// @vitest-environment jsdom
/**
 * 古书视图的契约：最新一页是哪一跨页、旧页能不能翻回去、落笔状态长在右页。
 *
 * 分组/分页的纯逻辑在 tests/book.test.ts；这里只测组件把叶子摆上书架后的行为。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BookPanel from '../src/components/BookPanel.vue'
import BookPage from '../src/components/BookPage.vue'
import type { BookLeaf } from '../src/components/book'
import type { Row, Status } from '../src/stores/game'
import { i18n, t } from '../src/i18n'

i18n.global.locale.value = 'zh-CN'

function line(kind: 'action' | 'narration', text: string, id = 0): Row {
  return { id, kind, text, debug: false }
}

function render<C>(component: C, props: Record<string, unknown>) {
  return mount(component as Parameters<typeof mount>[0], {
    props,
    global: { plugins: [i18n] },
  })
}

const SCENE = { area: 'Town', spot: 'Inn', scene: 'Common room' }
const PANEL = {
  turn: 6,
  busy: false,
  status: null,
  scene: SCENE,
  timeLabel: 'Morning',
  cardName: 'Demo',
}
const A1 = 'First action.'
const N1 = 'First answer.'
const A2 = 'Second action.'
const N2 = 'Second answer.'
const TWO_TURNS = [
  line('action', A1, 1),
  line('narration', N1, 2),
  line('action', A2, 3),
  line('narration', N2, 4),
]

const LEAF: BookLeaf = {
  turn: 1,
  action: 'Open the door.',
  narration: 'Once upon a time.\n\nThe door was old.',
}
const PAGE = {
  leaf: LEAF,
  folio: 2,
  sceneLabel: 'Inn',
  timeLabel: 'Morning',
  cardName: 'Demo',
  busy: false,
  status: null,
  reveal: true,
  revealKey: 1,
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('BookPanel', () => {
  it('opens on the latest spread and disables the forward page', () => {
    const w = render(BookPanel, { ...PANEL, rows: TWO_TURNS })

    expect(w.find('[data-book-page="left"] .line.action').text()).toBe(A2)
    expect(w.find('[data-book-page="right"] .line.narration').text()).toContain(N2)
    expect(w.find('[data-book-page="left"] .book-page-foot').text()).toContain('3')
    expect(w.find('[data-book-page="right"] .book-page-foot').text()).toContain('4')
    expect(w.find('[data-book-prev]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-book-next]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-book-latest]').exists()).toBe(false)
  })

  it('flips a leaf back to the older turn, then returns to the latest', async () => {
    vi.useFakeTimers()
    const w = render(BookPanel, { ...PANEL, rows: TWO_TURNS })

    await w.find('[data-book-prev]').trigger('click')
    await nextTick()
    expect(w.find('.book-leaf').exists()).toBe(true)
    expect(w.find('[data-book-page="left"] .line.action').text()).toBe(A1)
    expect(w.find('[data-book-latest]').exists()).toBe(true)

    vi.advanceTimersByTime(800)
    await nextTick()
    expect(w.find('.book-leaf').exists()).toBe(false)

    await w.find('[data-book-latest]').trigger('click')
    await nextTick()
    expect(w.find('[data-book-page="left"] .line.action').text()).toBe(A2)
    w.unmount()
  })

  it('does not turn a leaf when the player prefers reduced motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    )
    const w = render(BookPanel, { ...PANEL, rows: TWO_TURNS })

    await w.find('[data-book-prev]').trigger('click')
    await nextTick()
    expect(w.find('[data-book-page="left"] .line.action').text()).toBe(A1)
    expect(w.find('.book-leaf').exists()).toBe(false)
  })
})

describe('BookPage', () => {
  it('writes the narration in paragraphs and marks the latest page', () => {
    const w = render(BookPage, { ...PAGE, side: 'right' })

    const narration = w.find('.line.narration')
    expect(narration.text()).toContain('Once upon a time.')
    expect(narration.text()).toContain('The door was old.')
    expect(w.findAll('.ink-para')).toHaveLength(2)
    expect(w.find('.drop-cap').text()).toBe('O')
    expect(w.find('.book-narration').classes()).toContain('writing')
  })

  it('shows the action on the left page, sealed in wax', () => {
    const w = render(BookPage, { ...PAGE, side: 'left' })

    expect(w.find('.line.action').text()).toBe(LEAF.action)
    expect(w.find('.book-wax-seal').text()).toBe(t('book.actionSeal'))
    expect(w.find('.line.narration').exists()).toBe(false)
  })

  it('shows the opening as a prologue page on the left', () => {
    const prologue = render(BookPage, {
      ...PAGE,
      side: 'left',
      leaf: { turn: 0, action: '', narration: '' },
    })

    expect(prologue.find('.book-prologue-title').text()).toBe('Demo')
    expect(prologue.find('.line.action').exists()).toBe(false)
  })

  it('shows busy ink while the model writes, and an error note when it fails', () => {
    const busy: Status = { kind: 'busy', text: 'Writing' }
    const empty = { ...PAGE, side: 'right' as const, leaf: { ...LEAF, narration: '' } }

    const writing = render(BookPage, { ...empty, busy: true, status: busy })
    expect(writing.find('[data-status="busy"]').text()).toContain('Writing')

    const failed = render(BookPage, {
      ...empty,
      busy: false,
      status: { kind: 'error', text: 'Boom' },
    })
    expect(failed.find('[data-status="error"]').text()).toContain('Boom')
  })
})
