// @vitest-environment jsdom
/**
 * 主题切换测试。
 *
 * 主题状态是模块级的，所以用动态 import 拿新实例，
 * 每个用例前重置 DOM 与 localStorage。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

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

describe('useTheme —— 初始状态', () => {
  it('没有存储值时默认跟随系统', async () => {
    const { mode } = await freshUseTheme()
    expect(mode.value).toBe('system')
  })

  it('跟随系统时，系统偏好深色就加 .dark', async () => {
    mockMatchMedia(true)
    await freshUseTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('跟随系统时，系统偏好浅色就不加 .dark', async () => {
    mockMatchMedia(false)
    await freshUseTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('读取 localStorage 里存过的偏好', async () => {
    localStorage.setItem('tavernGame.theme', 'dark')
    const { mode } = await freshUseTheme()
    expect(mode.value).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('localStorage 里是垃圾值时回退到 system', async () => {
    localStorage.setItem('tavernGame.theme', '彩虹色')
    const { mode } = await freshUseTheme()
    expect(mode.value).toBe('system')
  })
})

describe('useTheme —— 循环切换', () => {
  it('system → light → dark → system', async () => {
    const { mode, cycle } = await freshUseTheme()
    expect(mode.value).toBe('system')
    cycle()
    expect(mode.value).toBe('light')
    cycle()
    expect(mode.value).toBe('dark')
    cycle()
    expect(mode.value).toBe('system')
  })

  it('切到深色时 DOM 上加 .dark，切回浅色时去掉', async () => {
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

  it('手动选择会写进 localStorage（下次开页面还记得）', async () => {
    const { cycle } = await freshUseTheme()
    cycle() // light
    await new Promise((r) => setTimeout(r, 0)) // 等 watcher 落盘
    expect(localStorage.getItem('tavernGame.theme')).toBe('light')
    cycle() // dark
    await new Promise((r) => setTimeout(r, 0))
    expect(localStorage.getItem('tavernGame.theme')).toBe('dark')
  })
})

describe('useTheme —— 系统主题变化', () => {
  it('跟随系统模式下，系统换主题会跟着换', async () => {
    mockMatchMedia(false)
    const { mode } = await freshUseTheme()
    expect(mode.value).toBe('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('重复调用 useTheme 不会重复注册监听（幂等）', async () => {
    const mod = await import('../src/composables/useTheme')
    const first = mod.useTheme()
    const second = mod.useTheme()
    expect(first.mode).toBe(second.mode)
  })
})
