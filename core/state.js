/**
 * core/state.js —— 世界状态与存档
 *
 * 核心设计：**引擎持有事实，模型只能提出改动建议。**
 *
 * 模型通过工具（比如 set_stat、add_item）请求修改状态，
 * 但真正写入的是这里的代码。所以模型没法凭空让血量变 999。
 *
 * 存档方案（纯前端）：
 *   - 主存：localStorage（自动保存，刷新不丢）
 *   - 备份：导出为 JSON 文件 / 从文件导入
 *   这样做是因为 localStorage 会随浏览器缓存一起被清掉，
 *   导出的文件才是真正属于玩家的东西。
 */

const SAVE_KEY = 'tavernGame.save.v1';

/** 新游戏的初始状态 */
export function createInitialState() {
  return {
    meta: {
      version: 1,
      createdAt: new Date().toISOString(),
      turn: 0,
    },
    // 玩家角色
    player: {
      name: '无名者',
      hp: 10,
      hpMax: 10,
      stats: {
        STR: 10,   // 力量
        DEX: 10,   // 敏捷
        WIS: 10,   // 感知
        CHA: 10,   // 魅力
      },
      inventory: [],
    },
    // 当前场景
    scene: {
      name: '未知之地',
      description: '你睁开眼睛，不记得自己是怎么来到这里的。',
    },
    // 已登场的 NPC：{ name, note, attitude }
    npcs: [],
    // 剧情标记：自由键值对，由模型通过工具写入
    flags: {},
    // 叙事日志（只留最近若干条，避免无限增长）
    log: [],
  };
}

/** 日志最多保留多少条 */
const MAX_LOG = 60;

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
      // 简单校验，防止坏数据把界面搞崩
      if (!parsed || typeof parsed !== 'object' || !parsed.player) {
        console.warn('存档格式不对，已忽略');
        return new GameState(createInitialState());
      }
      return new GameState(parsed);
    } catch (err) {
      console.warn('读档失败：', err);
      return new GameState(createInitialState());
    }
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

  /** 导出成 JSON 文本，供玩家下载 */
  export() {
    return JSON.stringify(this.data, null, 2);
  }

  /** 从 JSON 文本导入 */
  import(json) {
    const parsed = JSON.parse(json);
    if (!parsed || !parsed.player) throw new Error('这不是有效的存档文件');
    this.data = parsed;
    this.save();
  }

  // ---------- 日志 ----------

  addLog(kind, text) {
    this.data.log.push({
      kind,               // 'narration' | 'action' | 'system'
      text,
      at: new Date().toISOString(),
    });
    // 超长就裁掉最老的
    if (this.data.log.length > MAX_LOG) {
      this.data.log.splice(0, this.data.log.length - MAX_LOG);
    }
  }

  // ---------- 便捷读取 ----------

  get player() { return this.data.player; }
  get scene() { return this.data.scene; }
  get turn() { return this.data.meta.turn; }

  // ---------- 供模型调用的工具操作 ----------

  /**
   * 修改数值。clamp 到 [0, hpMax]，所以模型改不出负数或超上限。
   * @returns {string} 人类可读的结果说明
   */
  setStat(name, value) {
    const p = this.data.player;
    if (name === 'hp') {
      const before = p.hp;
      p.hp = Math.max(0, Math.min(p.hpMax, Math.round(value)));
      return `HP: ${before} → ${p.hp}`;
    }
    if (name in p.stats) {
      const before = p.stats[name];
      p.stats[name] = Math.max(1, Math.min(30, Math.round(value)));
      return `${name}: ${before} → ${p.stats[name]}`;
    }
    return `未知属性：${name}`;
  }

  /** 增减数值（相对变化），比绝对赋值更常用 */
  adjustStat(name, delta) {
    const p = this.data.player;
    if (name === 'hp') return this.setStat('hp', p.hp + delta);
    if (name in p.stats) return this.setStat(name, p.stats[name] + delta);
    return `未知属性：${name}`;
  }

  addItem(item) {
    if (!item) return '物品名称为空';
    if (!this.data.player.inventory.includes(item)) {
      this.data.player.inventory.push(item);
      return `获得物品：${item}`;
    }
    return `已经有「${item}」了`;
  }

  removeItem(item) {
    const idx = this.data.player.inventory.indexOf(item);
    if (idx === -1) return `背包里没有「${item}」`;
    this.data.player.inventory.splice(idx, 1);
    return `失去物品：${item}`;
  }

  setScene(name, description) {
    const before = this.data.scene.name;
    this.data.scene.name = name || before;
    if (description) this.data.scene.description = description;
    return `场景：${before} → ${this.data.scene.name}`;
  }

  setNpc(name, note, attitude) {
    if (!name) return 'NPC 名称为空';
    const existing = this.data.npcs.find((n) => n.name === name);
    if (existing) {
      if (note) existing.note = note;
      if (attitude) existing.attitude = attitude;
      return `更新 NPC：${name}`;
    }
    this.data.npcs.push({ name, note: note || '', attitude: attitude || '中立' });
    return `新 NPC：${name}`;
  }

  setFlag(key, value) {
    if (!key) return '标记名为空';
    this.data.flags[key] = value;
    return `记录标记：${key} = ${JSON.stringify(value)}`;
  }

  getFlag(key) {
    return this.data.flags[key];
  }

  endTurn() {
    this.data.meta.turn += 1;
    return `回合 +1（当前第 ${this.data.meta.turn} 回合）`;
  }

  /**
   * 生成给模型看的「世界状态快照」。
   * 这是模型了解现状的唯一途径 —— 它看不到原始 JSON。
   */
  snapshot() {
    const p = this.data.player;
    const lines = [
      `【第 ${this.data.meta.turn} 回合】`,
      `角色：${p.name}  HP ${p.hp}/${p.hpMax}`,
      `属性：${Object.entries(p.stats).map(([k, v]) => `${k} ${v}`).join('  ')}`,
      `背包：${p.inventory.length ? p.inventory.join('、') : '（空）'}`,
      `场景：${this.data.scene.name} —— ${this.data.scene.description}`,
    ];
    if (this.data.npcs.length) {
      lines.push(`在场/已知人物：${this.data.npcs.map((n) => `${n.name}(${n.attitude})`).join('、')}`);
    }
    const flagKeys = Object.keys(this.data.flags);
    if (flagKeys.length) {
      lines.push(`剧情标记：${flagKeys.map((k) => `${k}=${JSON.stringify(this.data.flags[k])}`).join('  ')}`);
    }
    return lines.join('\n');
  }
}
