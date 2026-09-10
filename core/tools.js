/**
 * core/tools.js —— 工具定义与执行
 *
 * 这是「引擎持有事实」原则的落地点。
 *
 * 模型不能直接改数据，它只能**申请**调用某个工具。
 * 工具在这里被真正执行，并且：
 *   - 数值被 clamp（模型改不出 999 血）
 *   - 每个改动都返回一句人类可读的结果
 *   - 未知工具会被拒绝，不会静默忽略
 */

/**
 * 工具清单。
 *
 * args 里每项写清楚含义和范围 —— 这份说明会被拼进提示词给模型看，
 * 所以描述质量直接决定模型用得对不对。
 */
export const TOOLS = {
  set_stat: {
    desc: '把某个属性设为指定值（会自动限制在合法范围内）',
    args: {
      name: '属性名，可选：hp 或 STR / DEX / WIS / CHA',
      value: '目标数值（整数）',
    },
    run: (state, a) => state.setStat(a.name, Number(a.value)),
  },

  adjust_stat: {
    desc: '在现有数值上增减（受伤用负数、恢复用正数），比 set_stat 更常用',
    args: {
      name: '属性名，可选：hp 或 STR / DEX / WIS / CHA',
      delta: '变化量，例如 -2 表示减少 2',
    },
    run: (state, a) => state.adjustStat(a.name, Number(a.delta)),
  },

  roll_check: {
    desc: '做一次属性检定，由引擎掷骰（1d20 + 属性修正）。用这个来决定成败，不要自己编结果',
    args: {
      stat: '用来检定的属性，可选：STR / DEX / WIS / CHA',
      difficulty: '难度值，常见 8（容易）/ 12（普通）/ 16（困难）/ 20（极难）',
      reason: '这次检定在做什么（会显示给玩家）',
    },
    run: (state, a) => {
      const stat = String(a.stat || '').toUpperCase();
      const base = state.player.stats[stat];
      if (typeof base !== 'number') return `❌ 未知属性：${a.stat}（可选 STR/DEX/WIS/CHA）`;

      const difficulty = Number(a.difficulty) || 12;
      const die = 1 + Math.floor(Math.random() * 20);   // 1d20，引擎掷的，模型无法预测
      const mod = Math.floor((base - 10) / 2);          // 属性修正值
      const total = die + mod;
      const success = total >= difficulty;

      return [
        `🎲 ${stat} 检定（${a.reason || '未说明'}）`,
        `   骰子 ${die} ${mod >= 0 ? '+' : ''}${mod}（${stat} ${base}）= ${total}`,
        `   难度 ${difficulty} → ${success ? '✅ 成功' : '❌ 失败'}`,
      ].join('\n');
    },
  },

  add_item: {
    desc: '把一件物品放进玩家背包',
    args: { item: '物品名称' },
    run: (state, a) => state.addItem(a.item),
  },

  remove_item: {
    desc: '从玩家背包移除一件物品',
    args: { item: '物品名称，必须与背包中已有的完全一致' },
    run: (state, a) => state.removeItem(a.item),
  },

  set_scene: {
    desc: '切换或更新当前场景',
    args: {
      name: '场景名称',
      description: '场景的一句话描述',
    },
    run: (state, a) => state.setScene(a.name, a.description),
  },

  set_npc: {
    desc: '记录或更新一个重要人物',
    args: {
      name: '人物名称',
      note: '关于这个人的要点',
      attitude: '对玩家的态度，例如：友好 / 警惕 / 敌对 / 中立',
    },
    run: (state, a) => state.setNpc(a.name, a.note, a.attitude),
  },

  set_flag: {
    desc: '记录一个剧情标记，用于后续保持一致（例如「已答应帮忙」）',
    args: {
      key: '标记名',
      value: '标记值，可以是文字或 true/false',
    },
    run: (state, a) => state.setFlag(a.key, a.value),
  },
};

/**
 * 生成给模型看的工具说明。
 * 会被拼进 system prompt。
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
 *   {"tool": "roll_check", "args": {"stat": "DEX", "difficulty": 12}}
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

  // 匹配 ```tool ... ``` 或 ```json ... ```（带 tool 字段的）
  const re = /```(?:tool|json)\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = re.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      // 允许单个对象或对象数组
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item.tool === 'string') {
          blocks.push({ tool: item.tool, args: item.args || {} });
        }
      }
    } catch (err) {
      // 只对看起来像工具调用的块报错，避免把普通 JSON 例子也算进来
      if (raw.includes('"tool"')) {
        errors.push(`解析失败：${err.message}｜原文：${raw.slice(0, 120)}`);
      }
    }
  }

  // 移除工具块，得到干净的叙事文本
  const clean = text.replace(re, '').replace(/\n{3,}/g, '\n\n').trim();

  return { blocks, clean, errors };
}
