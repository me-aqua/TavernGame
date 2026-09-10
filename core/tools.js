/**
 * core/tools.js —— 工具定义与执行
 *
 * 设计原则（重要）：
 *   工具越少，模型越能把注意力放在「写故事」上。
 *   每多一个工具，就要多输出一段 JSON、多一次往返、多一分走神。
 *
 * 所以这里**只保留一个**：时间推进。
 *   时间是最底层的引擎 —— 它驱动节奏、事件、NPC 作息，
 *   而且它只有一个状态（一个绝对时刻），不需要背包/属性那样的账本。
 *
 * 引擎持有事实的原则仍然成立：模型只能「申请」推进时间，
 * 真正改状态、并且拦住非法推进（倒退、手滑的超大跨度）的都是这里。
 */

import { SEGMENTS } from './calendar.js';

/** 时间推进的合法单位。新增单位要同步改 calendar.js 的 advance() */
export const TIME_UNITS = ['segment', 'hour', 'day', 'week', 'month', 'year'];

export const TOOLS = {
  advance_time: {
    desc:
      '推进故事内的时间。**只在剧情确实经过了一段时间时才调用** ' +
      '（例如：赶路、交谈很久、睡了一觉、等到天黑、修养数日）。\n' +
      '如果这一回合只是几句话、几个动作，就**不要调用**。\n' +
      '跨度没有上限 —— 「等了七天」「修养一个月」都是正常剧情。',
    args: {
      step: '推进的数量，正整数。默认 1',
      unit:
        '单位，可选：`segment`（一个时段，默认，约 4 小时）/ `hour`（小时）/ ' +
        '`day`（天）/ `week`（周）/ `month`（月）/ `year`（年）。\n' +
        '例如「等了七天」用 {step: 1, unit: "week"}；' +
        '「睡了三天」用 {step: 3, unit: "day"}；' +
        '「到了下午」用 {step: 1}',
      reason: '为什么时间会流逝（会记录在时间线里，例如「连夜赶路」）',
    },
    run: (state, a) => state.advanceTime(a.step, a.unit, a.reason),
  },
};

/**
 * 生成给模型看的工具说明。
 */
export function toolsPrompt() {
  const lines = ['## 你可以调用的工具', ''];
  for (const [name, t] of Object.entries(TOOLS)) {
    lines.push(`### ${name}`);
    lines.push(t.desc);
    for (const [arg, desc] of Object.entries(t.args)) {
      lines.push(`- \`${arg}\`：${desc}`);
    }
    lines.push('');
  }
  lines.push(`一天分三段：${SEGMENTS.join(' → ')}。`);
  lines.push('');
  return lines.join('\n');
}

/**
 * 执行一个工具。
 * @returns {string} 执行结果（会被回传给模型）
 */
export function runTool(state, name, args) {
  const tool = TOOLS[name];
  if (!tool) {
    return `❌ 没有名为「${name}」的工具。可用工具：${Object.keys(TOOLS).join('、')}`;
  }

  // advance_time 的 step 有默认值，所以空参数是合法的
  const keys = Object.keys(args || {});
  if (keys.length === 0 && name !== 'advance_time') {
    const need = Object.keys(tool.args).join('、');
    return `❌ ${name} 没有收到任何参数，所以什么都没做。\n   需要提供：${need}`;
  }

  try {
    return String(tool.run(state, args || {}));
  } catch (err) {
    return `❌ 工具执行出错：${err.message}`;
  }
}

/**
 * 从模型回复里解析出工具调用块。
 *
 * 约定格式（模型被告知要这样写）：
 *   ```tool
 *   {"tool": "advance_time", "args": {"step": 1, "unit": "week", "reason": "等了七天"}}
 *   ```
 *
 * 为什么不用各家 API 的原生 function calling？
 *   1. 各家格式不统一，接入新服务商就要改代码
 *   2. 纯文本协议便于排查问题 —— 你能直接看到模型想干什么
 *
 * @returns {{blocks: Array<{tool: string, args: object}>, clean: string, errors: string[]}}
 */
export function parseToolCalls(text) {
  const blocks = [];
  const errors = [];

  const re = /```(?:tool|json)\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = re.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item.tool === 'string') {
          blocks.push({ tool: item.tool, args: item.args || {} });
        }
      }
    } catch (err) {
      if (raw.includes('"tool"')) {
        errors.push(`解析失败：${err.message}｜原文：${raw.slice(0, 120)}`);
      }
    }
  }

  const clean = text.replace(re, '').replace(/\n{3,}/g, '\n\n').trim();
  return { blocks, clean, errors };
}
