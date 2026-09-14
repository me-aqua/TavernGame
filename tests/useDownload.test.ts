// @vitest-environment jsdom
/**
 * useDownload 测试 —— 浏览器原生下载。
 *
 * 这里断言的是**副作用契约**：下载靠造一个隐藏 <a download> 并点击它，
 * 以及 blob URL 必须在下一个事件循环才释放（同步释放会让部分浏览器撤销还没启动的下载）。
 *
 * ⚠️ jsdom 没有真实的文件选择框与下载，所以用 vi 打桩验证调用序列，
 *    而不是假装能触发真下载。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadText, pickFile } from '../src/composables/useDownload'

/** 造一个可控的 <a>：记录 href/download，并记录 click 是否发生 */
function stubAnchor() {
  const clicked: string[] = []
  const anchor = {
    href: '',
    download: '',
    click: () => clicked.push('click'),
  }
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'a') return anchor as unknown as HTMLElement
    return document.createElement.bind(document)(tag)
  })
  return { anchor, clicked, restore: () => spy.mockRestore() }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('downloadText', () => {
  it('creates a blob URL, points an <a download> at it, and clicks it', () => {
    const createUrl = vi.fn(() => 'blob:fake')
    const revokeUrl = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl })
    const { anchor, clicked, restore } = stubAnchor()

    downloadText('save.json', '{"a":1}')

    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe('save.json')
    expect(anchor.href).toBe('blob:fake')
    expect(clicked).toEqual(['click'])
    restore()
    vi.unstubAllGlobals()
  })

  it('releases the blob URL on the next tick, not synchronously', () => {
    // ⚠️ 同步释放会让部分浏览器在下载真正启动前撤销 blob —— 这条守住那个延迟
    vi.useFakeTimers()
    const revokeUrl = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:fake', revokeObjectURL: revokeUrl })
    const { restore } = stubAnchor()

    downloadText('save.json', 'x')
    expect(revokeUrl, 'must not revoke in the same tick as click').not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake')
    restore()
    vi.unstubAllGlobals()
  })
})

describe('pickFile', () => {
  it('resolves with the chosen file', async () => {
    const file = new File(['{}'], 'save.json', { type: 'application/json' })
    const input = {
      type: '',
      accept: '',
      onchange: null as null | (() => void),
      files: [file],
      /** 模拟用户选了文件：点击后立刻触发 change */
      click() {
        this.onchange?.()
      },
    }
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'input' ? (input as unknown as HTMLElement) : document.createElement.bind(document)(tag),
    )

    await expect(pickFile()).resolves.toBe(file)
    expect(input.type).toBe('file')
    expect(input.accept).toContain('.json')
  })

  it('resolves with null when the dialog is dismissed', async () => {
    const input = {
      type: '',
      accept: '',
      onchange: null as null | (() => void),
      files: null,
      /** 模拟用户关掉对话框（change 仍然会触发，但 files 为空） */
      click() {
        this.onchange?.()
      },
    }
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'input' ? (input as unknown as HTMLElement) : document.createElement.bind(document)(tag),
    )

    await expect(pickFile()).resolves.toBeNull()
  })
})
