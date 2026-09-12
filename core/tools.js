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
  // ⚠️ 必须用 Object.hasOwn，不能写成 `const tool = TOOLS[name]` —— 那样
  // `constructor` / `toString` / `valueOf` / `__proto__` / `hasOwnProperty`
  // 会从 Object.prototype 上取到**真值**，绕过「没有这个工具」的判断，
  // 随后读 `tool.args` 抛 TypeError；而这个异常会穿出 runTurn，
  // 让 endTurn/save/addLog 全都不执行 —— 玩家看到的叙事不落盘、时间却已改。
  if (typeof name !== 'string' || !Object.hasOwn(TOOLS, name)) {
    return `❌ 没有名为「${name}」的工具。可用工具：${Object.keys(TOOLS).join('、')}`;
  }
  const tool = TOOLS[name];

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

  // 围栏允许两种写法：换行的 ```tool\n{...}\n```，以及同行的 ```tool {...}```
  const re = /```(tool|json)[ \t]*\r?\n?([\s\S]*?)```/g;
  let match;
  const ranges = [];   // 需要从正文里**删掉**的区间

  while ((match = re.exec(text)) !== null) {
    const lang = match[1];
    const raw = match[2].trim();
    const start = match.index;
    const end = start + match[0].length;
    if (!raw) { ranges.push([start, end]); continue; }

    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      let 收到工具 = false;
      for (const item of items) {
        if (item && typeof item.tool === 'string') { blocks.push({ tool: item.tool, args: item.args || {} }); 收到工具 = true; }
      }
      // 解析成功且是工具块 → 从正文里删掉；否则（普通 json 数据块）**保留**
      if (收到工具) ranges.push([start, end]);
      else if (lang === 'tool') {
        errors.push(`工具块里没有 "tool" 字段，已忽略：${raw.slice(0, 120)}`);
        ranges.push([start, end]);
      }
    } catch (err) {
      // 解析失败一律要出声 —— 否则模型以为调了工具（时间没动、故事却说「七天后」），
      // 而玩家什么提示都看不到。会解析失败的块都删掉：留着只会把裸 JSON 当正文显示。
      errors.push(`工具块解析失败：${err.message}｜原文：${raw.slice(0, 120)}`);
      ranges.push([start, end]);
    }
  }

  // 从后往前删，避免影响前面的下标
  let clean = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    clean = clean.slice(0, ranges[i][0]) + clean.slice(ranges[i][1]);
  }
  clean = clean.replace(/\n{3,}/g, '\n\n').trim();

  return { blocks, clean, errors };
}
