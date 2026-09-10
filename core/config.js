/**
 * core/config.js —— 配置管理
 *
 * 纯前端方案下，API key 存在**浏览器本地**（localStorage），
 * 不经过任何服务器。这是安全的：key 是你自己的，只存在你自己的电脑上。
 *
 * ⚠️ 但要理解两件事：
 *   1. localStorage 按「域名」隔离。GitHub Pages 上的 key 和
 *      本地 localhost 上的 key 是两份，互不影响。
 *   2. 同一台电脑上，能读你浏览器数据的程序/扩展也能读到这个 key。
 *      所以别在公用电脑上填。
 */

const STORAGE_KEY = 'tavernGame.config';

/**
 * 各家 LLM 服务的预设。
 * 经过实测：除 Groq 外，其余都返回了 CORS 允许头，浏览器可直连。
 */
export const PRESETS = {
  deepseek: {
    label: 'DeepSeek 官方',
    apiBase: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    corsOk: true,
  },
  siliconflow: {
    label: '硅基流动 SiliconFlow',
    apiBase: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    corsOk: true,
  },
  openrouter: {
    label: 'OpenRouter',
    apiBase: 'https://openrouter.ai/api/v1',
    models: ['deepseek/deepseek-chat', 'anthropic/claude-3.5-sonnet'],
    keyUrl: 'https://openrouter.ai/keys',
    corsOk: true,
  },
  mistral: {
    label: 'Mistral',
    apiBase: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys/',
    corsOk: true,
  },
  ollama: {
    label: '本地 Ollama（零成本）',
    apiBase: 'http://localhost:11434/v1',
    models: ['qwen2.5', 'llama3.1'],
    keyUrl: 'https://ollama.com/download',
    corsOk: true,
    noKey: true,
  },
  custom: {
    label: '自定义（任意 OpenAI 兼容接口）',
    apiBase: '',
    models: [],
    keyUrl: '',
    corsOk: null,   // 未知，需要用户自己试
  },
};

const DEFAULTS = {
  provider: 'deepseek',
  apiKey: '',
  apiBase: PRESETS.deepseek.apiBase,
  model: PRESETS.deepseek.models[0],
  temperature: 0.85,
  // 实测：开场时模型常常要用 3-4 步设置场景、NPC、物品、标记，
  // 之后才有余力写叙事。上限给太少会导致「工具调完了、字没写」。
  maxAgentSteps: 10,
};

let cache = null;

/** 读取配置（带缓存） */
export function loadConfig() {
  if (cache) return cache;

  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    stored = {};
  }

  cache = { ...DEFAULTS, ...stored };
  return cache;
}

/** 保存配置 */
export function saveConfig(patch) {
  cache = { ...loadConfig(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('配置保存失败（可能是隐私模式）：', err);
  }
  return cache;
}

/** 清空配置（用于「忘记密钥」） */
export function clearConfig() {
  cache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* 忽略 */ }
}

/** 当前配置是否够用（能发起请求） */
export function isConfigured() {
  const c = loadConfig();
  const preset = PRESETS[c.provider];
  if (preset?.noKey) return Boolean(c.apiBase && c.model);
  return Boolean(c.apiKey && c.apiBase && c.model);
}

/** 把 key 打码，用于界面显示 */
export function maskKey(key) {
  if (!key) return '（未设置）';
  if (key.length <= 10) return '***';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
