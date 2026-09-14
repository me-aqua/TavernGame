// @vitest-environment jsdom
/**
 * 主题切换测试。
 *
 * 主题状态是模块级的，所以用动态 import 拿新实例，
 * 每个用例前重置 DOM 与 localStorage。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

/** 一个不是合法主题模式的存储值（fixture，不是产品文案） */
const JUNK_THEME = 'rainbow'

/** 造一个可控的 matchMedia（jsdom 默认没有） */
function mockMatchMedia(prefersDark: boolean) {
  const listeners: Array<() => void> = []
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: () => {},
    })),
  )
  return { listeners }
}

/** 每个用例拿一个全新的模块实例（重置内部状态） */
async function freshUseTheme() {
  vi.resetModules()
  const mod = await import('../src/composables/useTheme')
  return mod.useTheme()
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  mockMatchMedia(false)
})

describe('useTheme - initial state', () => {
  it('defaults to following the system when nothing is stored', async () => {
    const { mode } = await freshUseTheme()
    expect(mode.value).toBe('system')
  })

  it('adds .dark when following the system and the system prefers dark', async () => {
    mockMatchMedia(true)
    await freshUseTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('omits .dark when following the system and the system prefers light', async () => {
    mockMatchMedia(false)
    await freshUseTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('reads a preference that was stored in localStorage', async () => {
    localStorage.setItem('tavernGame.theme', 'dark')
    const { mode } = await freshUseTheme()
    expect(mode.value).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('falls back to system when localStorage holds junk', async () => {
    localStorage.setItem('tavernGame.theme', JUNK_THEME)
    const { mode } = await freshUseTheme()
    expect(mode.value).toBe('system')
  })
})

describe('useTheme - cycling', () => {
  it('system -> light -> dark -> system', async () => {
    const { mode, cycle } = await freshUseTheme()
    expect(mode.value).toBe('system')
    cycle()
    expect(mode.value).toBe('light')
    cycle()
    expect(mode.value).toBe('dark')
    cycle()
    expect(mode.value).toBe('system')
  })

  it('adds .dark to the DOM when switching to dark and removes it when switching back to light', async () => {
    const { cycle } = await freshUseTheme()
    cycle() // light
    await nextTick() // watcher 是异步刷新的，等它落到 DOM
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    cycle() // dark
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    cycle() // system（系统偏好浅色）
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('writes a manual choice to localStorage so the next page load remembers it', async () => {
    const { cycle } = await freshUseTheme()
    cycle() // light
    await new Promise((r) => setTimeout(r, 0)) // 等 watcher 落盘
    expect(localStorage.getItem('tavernGame.theme')).toBe('light')
    cycle() // dark
    await new Promise((r) => setTimeout(r, 0))
    expect(localStorage.getItem('tavernGame.theme')).toBe('dark')
  })
})

describe('useTheme - system theme changes', () => {
  it('follows the system theme while in system mode', async () => {
    mockMatchMedia(false)
    const { mode } = await freshUseTheme()
    expect(mode.value).toBe('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('does not register the listener twice when useTheme is called again (idempotent)', async () => {
    const mod = await import('../src/composables/useTheme')
    const first = mod.useTheme()
    const second = mod.useTheme()
    expect(first.mode).toBe(second.mode)
  })
})
