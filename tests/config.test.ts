/**
 * 配置测试：配置是系统边界（用户手改 localStorage），所以脏数据必须被兜住。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, saveConfig, clearConfig, isConfigured, maskKey, PRESETS } from '../src/agent/config'
import { t } from '../src/i18n'

// 测试自己编的垃圾值：模拟用户在 localStorage 里手改出来的坏存档
const BROKEN_JSON = '{broken'

beforeEach(() => {
  clearConfig()
  localStorage.clear()
})

describe('loadConfig', () => {
  it('returns the defaults when nothing is stored (deepseek)', () => {
    const c = loadConfig()
    expect(c.provider).toBe('deepseek')
    expect(c.apiBase).toBe(PRESETS.deepseek.apiBase)
    expect(c.model).toBe(PRESETS.deepseek.models[0])
  })

  it('falls back to the defaults on broken JSON instead of throwing', () => {
    localStorage.setItem('tavernGame.config', BROKEN_JSON)
    expect(() => loadConfig()).not.toThrow()
    expect(loadConfig().provider).toBe('deepseek')
  })

  it('survives a stored array (which is not an object)', () => {
    localStorage.setItem('tavernGame.config', '[1,2,3]')
    expect(loadConfig().provider).toBe('deepseek')
  })

  it('lets values stored by the user override the defaults', () => {
    saveConfig({ provider: 'ollama', model: 'qwen2.5', temperature: 1.2 })
    const c = loadConfig()
    expect(c.provider).toBe('ollama')
    expect(c.model).toBe('qwen2.5')
    expect(c.temperature).toBe(1.2)
  })

  it('keeps the other fields on a partial update', () => {
    saveConfig({ apiKey: 'k1' })
    saveConfig({ model: 'm2' })
    expect(loadConfig().apiKey).toBe('k1')
    expect(loadConfig().model).toBe('m2')
  })
})

describe('isConfigured', () => {
  it('is not configured when the key is missing', () => {
    saveConfig({ provider: 'deepseek', apiKey: '', apiBase: 'https://x', model: 'm' })
    expect(isConfigured()).toBe(false)
  })

  it('is configured only when all three fields are present', () => {
    saveConfig({ provider: 'deepseek', apiKey: 'k', apiBase: 'https://x', model: 'm' })
    expect(isConfigured()).toBe(true)
  })

  it('counts a keyless service such as Ollama as configured with a base URL and a model', () => {
    saveConfig({ provider: 'ollama', apiKey: '', apiBase: 'http://localhost:11434/v1', model: 'qwen2.5' })
    expect(isConfigured()).toBe(true)
  })
})

describe('saveConfig when the write fails', () => {
  it('does not throw and still returns the merged config (private mode / quota full)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const result = saveConfig({ model: 'still-here' })
    expect(result.model).toBe('still-here')
    expect(warn).toHaveBeenCalled()

    spy.mockRestore()
    warn.mockRestore()
  })
})

describe('maskKey', () => {
  it('returns the locale message when no key is set', () => {
    expect(maskKey('')).toBe(t('config.notSet'))
  })

  it('masks a short key entirely (without leaking its length)', () => {
    expect(maskKey('short')).toBe('***')
  })

  it('shows only the head and the tail of a long key', () => {
    const masked = maskKey('sk-1234567890abcdef')
    expect(masked.startsWith('sk-123')).toBe(true)
    expect(masked.endsWith('cdef')).toBe(true)
    expect(masked).toContain('...')
    expect(masked).not.toContain('4567890')
  })
})
