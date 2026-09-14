/**
 * 配置测试 —— 此前 0% 覆盖。
 * 配置是系统边界（用户手改 localStorage），所以脏数据必须被兜住。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, saveConfig, clearConfig, isConfigured, maskKey, PRESETS } from '../src/core/config'

beforeEach(() => {
  clearConfig()
  localStorage.clear()
})

describe('loadConfig', () => {
  it('没有配置时给默认值（deepseek）', () => {
    const c = loadConfig()
    expect(c.provider).toBe('deepseek')
    expect(c.apiBase).toBe(PRESETS.deepseek.apiBase)
    expect(c.model).toBe(PRESETS.deepseek.models[0])
    expect(c.maxAgentSteps).toBeGreaterThan(0)
  })

  it('存档里是坏 JSON 时回退到默认，而不是抛错', () => {
    localStorage.setItem('tavernGame.config', '{坏掉的')
    expect(() => loadConfig()).not.toThrow()
    expect(loadConfig().provider).toBe('deepseek')
  })

  it('存档里是数组时也不崩（不是对象）', () => {
    localStorage.setItem('tavernGame.config', '[1,2,3]')
    expect(loadConfig().provider).toBe('deepseek')
  })

  it('用户存过的值会覆盖默认值', () => {
    saveConfig({ provider: 'ollama', model: 'qwen2.5', temperature: 1.2 })
    const c = loadConfig()
    expect(c.provider).toBe('ollama')
    expect(c.model).toBe('qwen2.5')
    expect(c.temperature).toBe(1.2)
  })

  it('部分更新不会丢掉其他字段', () => {
    saveConfig({ apiKey: 'k1' })
    saveConfig({ model: 'm2' })
    expect(loadConfig().apiKey).toBe('k1')
    expect(loadConfig().model).toBe('m2')
  })
})

describe('isConfigured', () => {
  it('缺 key 时未配置', () => {
    saveConfig({ provider: 'deepseek', apiKey: '', apiBase: 'https://x', model: 'm' })
    expect(isConfigured()).toBe(false)
  })

  it('三项齐全才算配置好', () => {
    saveConfig({ provider: 'deepseek', apiKey: 'k', apiBase: 'https://x', model: 'm' })
    expect(isConfigured()).toBe(true)
  })

  it('Ollama 这类不需要 key 的服务：有地址和模型就算配好', () => {
    saveConfig({ provider: 'ollama', apiKey: '', apiBase: 'http://localhost:11434/v1', model: 'qwen2.5' })
    expect(isConfigured()).toBe(true)
  })
})

describe('maskKey', () => {
  it('未设置时的文案', () => {
    expect(maskKey('')).toBe('（未设置）')
  })

  it('短 key 整体打码（不泄漏长度细节）', () => {
    expect(maskKey('short')).toBe('***')
  })

  it('长 key 只露头尾', () => {
    const masked = maskKey('sk-1234567890abcdef')
    expect(masked.startsWith('sk-123')).toBe(true)
    expect(masked.endsWith('cdef')).toBe(true)
    expect(masked).toContain('…')
    expect(masked).not.toContain('4567890')
  })
})
