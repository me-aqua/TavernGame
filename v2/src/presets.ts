import type { Preset } from './core/types'

/**
 * 新装时铺的两条默认预设：预设名 = 模型名，Key 空着（绝不内置任何 Key）。
 * 只在新装（`tg2.presets` 这个键不存在）时由 `main.ts` 写一次；之后玩家自己改。
 */
export const DEFAULT_PRESETS: Preset[] = [
  {
    id: 'p-deepseek-flash',
    name: 'deepseek-flash',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    apiKey: '',
    reasoning: 'medium',
  },
  {
    id: 'p-deepseek-v4-pro',
    name: 'deepseek-v4-pro',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    apiKey: '',
    reasoning: 'off',
  },
]
