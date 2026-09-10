/**
 * core/state.js —— 世界状态与存档
 *
 * 设计原则：**状态越少，模型越自由。**
 *
 * 早期版本有属性、背包、NPC、剧情标记等一堆字段，逼着模型每回合
 * 输出一堆 JSON 去维护它们，反而挤掉了「写故事」的注意力。
 * 现在只留两样：
 *   1. 场景（现在在哪、什么样）
 *   2. 时间（第几天、什么时段）—— 唯一的引擎状态
 *
 * 存档方案：
 *   - 主存 localStorage（自动保存，刷新不丢）
 *   - 备份：导出 JSON 文件 / 从文件导入
 */

import { SEGMENTS } from './tools.js';

const SAVE_KEY = 'tavernGame.save.v2';

/** 新游戏的初始状态 */
export function createInitialState() {
  return {
    meta: {
      version: 2,
      createdAt: new Date().toISOString(),
      turn: 0,
    },
    player: {
      name: '无名者',
    },
    scene: {
      name: '未知之地',
      description: '你睁开眼睛，不记得自己是怎么来到这里的。',
    },
    // 唯一的结构化引擎状态
    time: {
      day: 1,
      segment: 0,        // 索引，对应 SEGMENTS[0] = 上午
    },
    // 叙事日志，用于刷新后恢复故事
    log: [],
    // 时间推进记录（只用作叙事参考）
    timeline: [],
  };
}

const MAX_LOG = 80;
const MAX_TIMELINE = 40;

export class GameState {
  constructor(data) {
    this.data = data || createInitialState();
  }

  // ---------- 存档 ----------

  static load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return new GameState(createInitialState());
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.player) {
        console.warn('存档格式不对，已忽略');
        return new GameState(createInitialState());
      }
      return new GameState(GameState.migrate(parsed));
    } catch (err) {
      console.warn('读档失败：', err);
      return new GameState(createInitialState());
    }
  }

  /**
   * 兼容旧存档。
   * 旧版本有 hp / stats / inventory / npcs / flags —— 那些字段现在不用了，
   * 直接丢掉，保留还能用的部分（场景、日志、回合数）。
   */
  static migrate(old) {
    const fresh = createInitialState();
    return {
      meta: { ...fresh.meta, turn: old.meta?.turn ?? 0 },
      player: { name: old.player?.name || fresh.player.name },
      scene: {
        name: old.scene?.name || fresh.scene.name,
        description: old.scene?.description || fresh.scene.description,
      },
      time: {
        day: old.time?.day ?? 1,
        segment: old.time?.segment ?? 0,
      },
      log: Array.isArray(old.log) ? old.log.slice(-MAX_LOG) : [],
      timeline: Array.isArray(old.timeline) ? old.timeline.slice(-MAX_TIMELINE) : [],
    };
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
      return true;
    } catch (err) {
      console.warn('存档失败（可能是隐私模式或空间不足）：', err);
      return false;
    }
  }

  reset() {
    this.data = createInitialState();
    this.save();
  }

  export() {
    return JSON.stringify(this.data, null, 2);
  }

  import(json) {
    const parsed = JSON.parse(json);
    if (!parsed || !parsed.player) throw new Error('这不是有效的存档文件');
    this.data = GameState.migrate(parsed);
    this.save();
  }

  // ---------- 日志 ----------

  addLog(kind, text) {
    this.data.log.push({ kind, text, at: new Date().toISOString() });
    if (this.data.log.length > MAX_LOG) {
      this.data.log.splice(0, this.data.log.length - MAX_LOG);
    }
  }

  // ---------- 便捷读取 ----------

  get player() { return this.data.player; }
  get scene() { return this.data.scene; }
  get turn() { return this.data.meta.turn; }
  get day() { return this.data.time.day; }
  get segmentIndex() { return this.data.time.segment; }
  get segmentName() { return SEGMENTS[this.data.time.segment] || SEGMENTS[0]; }

  /** 「第 3 天 · 下午」 */
  get timeLabel() {
    return `第 ${this.data.time.day} 天 · ${this.segmentName}`;
  }

  // ---------- 工具：时间推进 ----------

  /**
   * 推进时间。这是**唯一的工具**。
   *
   * 引擎在这里做把关，模型不能乱推：
   *   - step 不是正整数 → 拒绝
   *   - 一次推太多段 → 夹到合理范围
   *
   * @param {number} step 推进几段（1 = 下一段，3 = 睡一觉到第二天同一段）
   * @param {string} reason 原因（记录用）
   */
  advanceTime(step, reason) {
    const raw = Number(step);
    const n = Number.isFinite(raw) ? Math.round(raw) : 1;

    if (n <= 0) {
      return `⚠ 时间是单向的，不能倒退或原地不动。（当前：${this.timeLabel}）`;
    }
    if (n > 6) {
      return `⚠ 一次最多推进 6 段（两天）。请分几次推进，或直接用 3 表示「睡一觉到第二天」。（当前：${this.timeLabel}）`;
    }

    const before = this.timeLabel;
    const perDay = SEGMENTS.length;

    // 用总段数计算，避免跨天时出错
    let total = this.data.time.day * perDay + this.data.time.segment;
    total += n;
    this.data.time.day = Math.floor(total / perDay);
    this.data.time.segment = total % perDay;

    // 天从 1 开始（上面的算法会从 0 起，修正一下）
    if (this.data.time.segment === 0 && this.data.time.day === 0) {
      this.data.time.day = 1;
    }

    const after = this.timeLabel;
    this.data.timeline.push({
      from: before,
      to: after,
      reason: reason || '',
      at: new Date().toISOString(),
    });
    if (this.data.timeline.length > MAX_TIMELINE) {
      this.data.timeline.splice(0, this.data.timeline.length - MAX_TIMELINE);
    }

    return `🕐 时间推进：${before} → ${after}` +
      (reason ? `（${reason}）` : '') +
      (n >= perDay ? '\n   （新的一天开始了）' : '');
  }

  // ---------- 场景 ----------

  setScene(name, description) {
    const before = this.data.scene.name;
    if (name) this.data.scene.name = name;
    if (description) this.data.scene.description = description;
    // 名字没变就不算切换，避免模型反复调同一个值刷屏
    if (name && name === before) {
      return `场景描述已更新（仍在「${before}」）`;
    }
    return `场景：${before} → ${this.data.scene.name}`;
  }

  endTurn() {
    this.data.meta.turn += 1;
    return `回合 +1（当前第 ${this.data.meta.turn} 回合）`;
  }

  // ---------- 给模型看的快照 ----------

  /**
   * 世界状态快照 —— 模型了解现状的主要途径。
   * @param {Array} [history] 最近几轮对话（刷新后为空，会回退到日志）
   */
  snapshot(history = []) {
    const lines = [
      `【第 ${this.turn} 回合】`,
      `时间：${this.timeLabel}`,
      `地点：${this.data.scene.name}`,
      `　　${this.data.scene.description}`,
    ];

    // 最近发生的事：优先用对话历史，没有就回退到日志。
    // 这是「刷新页面后剧情还能接上」的关键。
    const recent = history.filter((h) => typeof h.content === 'string').slice(-4);
    if (recent.length) {
      lines.push('', '### 最近发生的事');
      for (const h of recent) {
        const who = h.role === 'user' ? '玩家' : '你(GM)';
        lines.push(`- ${who}：${h.content.replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    } else if (this.data.log.length) {
      lines.push('', '### 最近发生的事');
      for (const entry of this.data.log.slice(-4)) {
        const text = String(entry.text).replace(/\s+/g, ' ').slice(0, 160);
        lines.push(`- ${text}`);
      }
    }

    // 时间线（如果推进过）
    if (this.data.timeline.length) {
      lines.push('', '### 时间线');
      for (const t of this.data.timeline.slice(-5)) {
        lines.push(`- ${t.from} → ${t.to}${t.reason ? `（${t.reason}）` : ''}`);
      }
    }

    return lines.join('\n');
  }
}
