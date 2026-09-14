/**
 * src/agent/config.ts —— 配置管理：纯前端方案，API key 存在浏览器 localStorage，不经过服务器。
 *
 * ⚠️ localStorage 按域名隔离（GitHub Pages 与 localhost 上的 key 是两份）；
 *    同一台电脑上能读浏览器数据的程序/扩展也能读到这个 key，别在公用电脑上填。
 */

import { isRecord } from '../game/save'
import { t } from '../i18n'

const STORAGE_KEY = 'tavernGame.config'

/** 服务商预设（label 文案在 src/locales） */
interface ProviderPreset {
  apiBase: string
  models: string[]
  keyUrl: string
  /** true = 实测允许浏览器直连；false = 不行；null = 未实测 */
  corsOk: boolean | null
  /** 这个服务不需要 key（本地 Ollama） */
  noKey?: boolean
}

export interface GameConfig {
  provider: string
  apiKey: string
  apiBase: string
  model: string
  temperature: number
  maxAgentSteps: number
}

/**
 * 各家 LLM 服务的预设。
 * 经过实测：除 Groq 外，其余都返回了 CORS 允许头，浏览器可直连。
 */
export const PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    apiBase: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    corsOk: true,
  },
  siliconflow: {
    apiBase: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    corsOk: true,
  },
  openrouter: {
    apiBase: 'https://openrouter.ai/api/v1',
    models: ['deepseek/deepseek-chat', 'anthropic/claude-3.5-sonnet'],
    keyUrl: 'https://openrouter.ai/keys',
    corsOk: true,
  },
  mistral: {
    apiBase: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys/',
    corsOk: true,
  },
  ollama: {
    apiBase: 'http://localhost:11434/v1',
    models: ['qwen2.5', 'llama3.1'],
    keyUrl: 'https://ollama.com/download',
    corsOk: true,
    noKey: true,
  },
  custom: {
    apiBase: '',
    models: [],
    keyUrl: '',
    corsOk: null, // 未知，需要用户自己试
  },
}

const DEFAULTS: GameConfig = {
  provider: 'deepseek',
  apiKey: '',
  apiBase: PRESETS.deepseek.apiBase,
  model: PRESETS.deepseek.models[0],
  temperature: 0.85,
  // 实测：开场时模型常常要用 3-4 步设置场景，之后才有余力写叙事。
  // 上限给太少会导致「工具调完了、字没写」。
  maxAgentSteps: 10,
}

let cache: GameConfig | null = null

/** 读取配置（带缓存） */
export function loadConfig(): GameConfig {
  if (cache) return cache

  let stored: Partial<GameConfig> = {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (isRecord(parsed)) {
      stored = parsed as Partial<GameConfig>
    }
  } catch {
    // 配置读不出来就当没配过：这里失败只影响「用哪个服务商」，
    // 而且马上会被 DEFAULTS 覆盖，没有需要玩家知道的信息
    stored = {}
  }

  cache = { ...DEFAULTS, ...stored }
  return cache
}

/** 保存配置 */
export function saveConfig(patch: Partial<GameConfig>): GameConfig {
  cache = { ...loadConfig(), ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch (err) {
    // 隐私模式/配额满：本次会话仍能用（cache 已更新），只是刷新后要重填。
    // 保留 warn 让排查看得见，不弹给玩家
    console.warn('[config] save failed (private mode?)', err)
  }
  return cache
}

/** 清空配置（用于「忘记密钥」） */
export function clearConfig(): void {
  cache = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
}

/** 当前配置是否够用（能发起请求） */
export function isConfigured(): boolean {
  const c = loadConfig()
  const preset = PRESETS[c.provider]
  if (preset?.noKey) return Boolean(c.apiBase && c.model)
  return Boolean(c.apiKey && c.apiBase && c.model)
}

/** 把 key 打码，用于界面显示 */
export function maskKey(key: string): string {
  if (!key) return t('config.notSet')
  if (key.length <= 10) return '***'
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}
