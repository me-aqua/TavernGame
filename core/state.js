/**
 * core/state.js —— 世界状态与存档
 *
 * ## 状态只有两样
 *
 * 1. **场景**（现在在哪、什么样）
 * 2. **时间**（唯一的结构化引擎状态）
 *
 * 早期版本有属性、背包、NPC、剧情标记等一堆字段，逼着模型每回合
 * 输出大量 JSON 去维护它们，反而挤掉了「写故事」的注意力。
 *
 * ## 时间怎么存
 *
 * 存一个**绝对时刻（ISO 字符串）+ 用哪个历法**。
 * 怎么显示由历法模块决定 —— 所以换历法不用迁移存档，
 * 同一个时刻在现实历和奇幻历下会显示成不同的文字。
 *
 * ## 存档
 *
 * - 主存 localStorage（自动保存，刷新不丢）
 * - 备份：导出 JSON 文件 / 从文件导入
 */

import {
  getCalendar, nowIso, DEFAULT_CALENDAR_ID, SEGMENTS,
} from './calendar.js';

const SAVE_KEY = 'tavernGame.save.v3';
const LEGACY_KEYS = ['tavernGame.save.v2', 'tavernGame.save.v1'];

/** 最后一次「大跨度跳跃」的显示阈值：超过半年就不显示「过去了多久」 */
const LONG_JUMP_MS = 180 * 86400000;

/** 新游戏的初始状态 */
export function createInitialState() {
  return {
    meta: {
      version: 3,
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
    // 唯一的引擎状态：一个绝对时刻 + 用哪个历法
    time: {
      iso: nowIso(),
      calendar: DEFAULT_CALENDAR_ID,
    },
    // 叙事日志，用于刷新后恢复故事
    log: [],
    // 时间推进记录
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
      // 优先读新版
      let raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        // 尝试从旧版本迁移
        for (const key of LEGACY_KEYS) {
          const legacy = localStorage.getItem(key);
          if (legacy) {
            console.info(`检测到旧存档（${key}），正在迁移…`);
            const migrated = GameState.migrateLegacy(JSON.parse(legacy));
            const gs = new GameState(migrated);
            gs.save();
            return gs;
          }
        }
        return new GameState(createInitialState());
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.player) {
        console.warn('存档格式不对，已忽略');
        return new GameState(createInitialState());
      }
      return new GameState(GameState.normalize(parsed));
    } catch (err) {
      console.warn('读档失败：', err);
      return new GameState(createInitialState());
    }
  }

  /**
   * 补齐缺失字段（比如存档里没有 time.calendar）。
   * 这比整套迁移更稳，因为大部分情况下只是少了个别字段。
   */
  static normalize(saved) {
    const fresh = createInitialState();
    return {
      meta: { ...fresh.meta, ...(saved.meta || {}), version: 3 },
      player: { name: saved.player?.name || fresh.player.name },
      scene: {
        name: saved.scene?.name || fresh.scene.name,
        description: saved.scene?.description || fresh.scene.description,
      },
      time: {
        iso: saved.time?.iso || fresh.time.iso,
        calendar: saved.time?.calendar || DEFAULT_CALENDAR_ID,
      },
      log: Array.isArray(saved.log) ? saved.log.slice(-MAX_LOG) : [],
      timeline: Array.isArray(saved.timeline) ? saved.timeline.slice(-MAX_TIMELINE) : [],
    };
  }

  /**
   * 从 v1 / v2 存档迁移。
   * 旧版的时间和现在的表示完全不同：旧版是「第 N 天 · 第 M 段」，
   * 新版是一个绝对时刻。无法精确换算，所以**从今天重新开始计时**，
   * 但保留场景、日志、回合数。
   */
  static migrateLegacy(old) {
    const fresh = createInitialState();
    return {
      meta: { ...fresh.meta, turn: old.meta?.turn ?? 0, version: 3 },
      player: { name: old.player?.name || fresh.player.name },
      scene: {
        name: old.scene?.name || fresh.scene.name,
        description: old.scene?.description || fresh.scene.description,
      },
      time: { iso: fresh.time.iso, calendar: DEFAULT_CALENDAR_ID },
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
    this.data = GameState.normalize(parsed);
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

  /** 当前使用的历法（对象） */
  get calendar() {
    return getCalendar(this.data.time.calendar);
  }

  /** 当前时刻（ISO） */
  get iso() {
    return this.data.time.iso;
  }

  /** 完整时间标签，由历法决定格式 */
  get timeLabel() {
    return this.calendar.format(this.data.time.iso);
  }

  /** 简短时间标签 */
  get timeLabelShort() {
    return this.calendar.formatShort(this.data.time.iso);
  }

  /** 当前时段名（上午/下午/晚上），部分历法也有这个概念 */
  get segmentName() {
    const d = new Date(this.data.time.iso);
    const h = d.getHours();
    return SEGMENTS[h < 12 ? 0 : h < 18 ? 1 : 2];
  }

  /**
   * 换历法（同一时刻，换个显示方式）。
   * 这是「做卡」功能的一部分 —— 卡里写 calendar: "fantasy-12x30" 就换了。
   */
  setCalendar(id) {
    const before = this.calendar.label;
    this.data.time.calendar = id;
    const after = this.calendar.label;
    this.save();
    return `历法：${before} → ${after}\n现在的时间显示为：${this.timeLabel}`;
  }

  // ---------- 工具：时间推进 ----------

  /**
   * 推进时间。这是**唯一的工具**。
   *
   * 设计取舍：
   *   - **不设上限** —— 「等了七天」「修养一个月」都是正常剧情
   *   - **保留单向性检查** —— 那不是限制，是在拦模型的错误输入
   *
   * @param {number} step 推进多少（配合 unit）
   * @param {string} [unit] 'segment'（默认）/ 'hour' / 'day' / 'week' / 'month' / 'year'
   * @param {string} [reason] 原因（记录用）
   */
  advanceTime(step, unit = 'segment', reason = '') {
    const cal = this.calendar;

    // 兼容旧调用签名 advanceTime(step, reason)
    const KNOWN_UNITS = ['segment', 'hour', 'day', 'week', 'month', 'year'];
    if (typeof unit === 'string' && !KNOWN_UNITS.includes(unit)) {
      reason = unit;
      unit = 'segment';
    }
    if (!KNOWN_UNITS.includes(unit)) unit = 'segment';

    const raw = Number(step);
    const n = Number.isFinite(raw) ? Math.round(raw) : 1;

    // 唯一保留的检查：时间不能倒退。这是在拦错误输入，不是限制玩法。
    if (n <= 0) {
      if (n < 0) {
        return `⚠ 时间是单向的，不能倒退。（当前：${this.timeLabel}）`;
      }
      return `⚠ 时间是单向的，不能原地不动。（当前：${this.timeLabel}）`;
    }

    // 防呆：拦住「推十万年」这种明显是模型手滑的输入
    const MAX_YEARS = 1000;
    const yearsPerUnit = { segment: 4 / 8760, hour: 1 / 8760, day: 1 / 365, week: 7 / 365, month: 1 / 12, year: 1 };
    if (n * yearsPerUnit[unit] > MAX_YEARS) {
      return `⚠ 一次推进跨度太大（${n} ${unit}），已忽略。当前：${this.timeLabel}`;
    }

    const before = this.timeLabel;
    const beforeIso = this.data.time.iso;   // 推进前的时刻：时间线要用它记起点
    let result;
    try {
      result = cal.advance(this.data.time.iso, n, unit);
    } catch (err) {
      return `⚠ 推进失败：${err.message}（当前：${before}）`;
    }

    this.data.time.iso = result.iso;
    const after = this.timeLabel;

    // 时间线只记录「值得记」的跳跃，避免每回合都堆一条。
    // 阈值必须 ≤ 一个 segment（4 小时），否则默认单位的推进永远进不了时间线 ——
    // 侧栏那块就一直是空的。
    const isNotable = result.elapsedMs >= 4 * 3600000 || this.data.timeline.length < 3;
    if (isNotable) {
      // 只存「简短」的起止，侧栏空间有限；完整时间抬头看得到。
      // ⚠️ from 必须是**推进前**的时刻：这里 this.data.time.iso 已经被覆盖成结果了，
      //    用它会让 from === to，起止就失去意义。
      this.data.timeline.push({
        from: cal.formatShort(beforeIso),
        to: cal.formatShort(result.iso),
        reason: reason || '',
        elapsedMs: result.elapsedMs,
        at: new Date().toISOString(),
      });
      if (this.data.timeline.length > MAX_TIMELINE) {
        this.data.timeline.splice(0, this.data.timeline.length - MAX_TIMELINE);
      }
    }

    const elapsed = result.elapsedMs < LONG_JUMP_MS
      ? cal.describeElapsed(result.elapsedMs)
      : '';

    return `🕐 时间推进：${before}\n           → ${after}` +
      (elapsed ? `\n   （${elapsed}）` : '') +
      (reason ? `\n   原因：${reason}` : '');
  }

  // ---------- 场景 ----------

  setScene(name, description) {
    const before = this.data.scene.name;
    if (name) this.data.scene.name = name;
    if (description) this.data.scene.description = description;
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

    if (this.data.timeline.length) {
      lines.push('', '### 时间线');
      for (const t of this.data.timeline.slice(-5)) {
        lines.push(`- ${t.to}${t.reason ? `（${t.reason}）` : ''}`);
      }
    }

    return lines.join('\n');
  }
}
