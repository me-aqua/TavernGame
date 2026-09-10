/**
 * core/llm.js —— LLM 调用层
 *
 * 只做一件事：把消息发出去，把回复拿回来。
 * 不认识游戏规则，也不碰世界状态 —— 那些是 agent.js 和 state.js 的事。
 *
 * 纯前端意味着：请求直接从浏览器发往服务商。
 * 已实测主要服务商都返回 CORS 允许头，所以浏览器不会拦截。
 */

import { loadConfig, PRESETS } from './config.js';

/**
 * 调用对话接口。
 *
 * @param {Array<{role: string, content: string}>} messages 对话消息
 * @param {object} options
 * @param {AbortSignal} [options.signal] 用于中途取消
 * @returns {Promise<string>} 模型回复的纯文本
 */
export async function chat(messages, options = {}) {
  const cfg = loadConfig();
  const preset = PRESETS[cfg.provider];

  if (!cfg.apiBase) throw new Error('还没配置接口地址，请先在设置里填写');
  if (!preset?.noKey && !cfg.apiKey) throw new Error('还没填 API key，请先在设置里填写');

  // 拼接请求地址：兼容用户填带不带 /v1 的情况
  const base = cfg.apiBase.replace(/\/+$/, '');
  const url = base.endsWith('/chat/completions')
    ? base
    : `${base}/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const body = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    stream: false,
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    // 网络层失败最常见的原因就是 CORS —— 给一句能指导行动的提示
    if (err.name === 'TypeError') {
      throw new Error(
        `请求发不出去。可能原因：\n` +
        `• 该服务商不允许浏览器直连（CORS 拦截）\n` +
        `• 接口地址写错了：${url}\n` +
        `• 网络不通或需要代理`
      );
    }
    throw err;
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || j?.message || JSON.stringify(j).slice(0, 300);
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`接口返回 ${res.status} ${res.statusText}\n${detail}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`回复格式看不懂：${JSON.stringify(data).slice(0, 300)}`);
  }
  return content;
}

/**
 * 测试当前配置能否跑通。
 * 用一个最省的请求验证：能拿到回复就算成功。
 */
export async function testConnection() {
  const started = Date.now();
  const reply = await chat([
    { role: 'system', content: '你是一个测试助手。' },
    { role: 'user', content: '只回复两个字：可用' },
  ]);
  return {
    ok: true,
    ms: Date.now() - started,
    reply: reply.trim().slice(0, 40),
  };
}
