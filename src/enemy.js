/**
 * enemy.js —— 敌人
 *
 * 用「配置表 + 一个类」的方式实现多种敌人：
 * 想加新怪，只要往下面的表中加一行，不用改任何逻辑代码。
 * 这种写法叫「数据驱动」，是游戏开发里非常常用的技巧。
 */

import { circleHit } from './utils.js';

/** 敌人种类配置表 */
const ENEMY_TYPES = {
  slime: {
    color: '#a78bfa',
    radius: 20,
    hp: 2,
    speed: 82,
    score: 10,
  },
  bat: {
    color: '#f472b6',
    radius: 13,
    hp: 1,
    speed: 178,
    score: 16,
  },
};

export class Enemy {
  /**
   * @param {object} game
   * @param {string} typeKey ENEMY_TYPES 里的键名
   */
  constructor(game, typeKey) {
    // 用展开语法把配置复制到自己身上，之后可以单独改某个敌人的属性
    Object.assign(this, ENEMY_TYPES[typeKey]);
    this.game = game;
    this.type = typeKey;
    this.maxHp = this.hp;
    this.hitFlash = 0;   // 被打中时闪白，持续一小段时间
    this.flip = Math.random() < 0.5 ? 1 : -1;

    this.spawnAtEdge();
  }

  /**
   * 从画面外随机一边出现。
   * 这样玩家看不到「凭空冒出来」，体验更自然。
   */
  spawnAtEdge() {
    const w = this.game.width;
    const h = this.game.height;
    const margin = 60;

    switch (Math.floor(Math.random() * 4)) {
      case 0: this.x = Math.random() * w; this.y = -margin; break;        // 上
      case 1: this.x = w + margin;        this.y = Math.random() * h; break; // 右
      case 2: this.x = Math.random() * w; this.y = h + margin; break;     // 下
      default:this.x = -margin;           this.y = Math.random() * h;      // 左
    }
  }

  /** 每帧更新：朝玩家移动 */
  update(dt) {
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    const target = this.game.player;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;

    // 朝玩家的方向走一步
    this.x += (dx / dist) * this.speed * dt;
    this.y += (dy / dist) * this.speed * dt;

    // 碰到玩家就造成伤害，然后自己消失
    if (circleHit(this.x, this.y, this.radius, target.x, target.y, target.radius)) {
      this.dead = true;
      target.takeDamage(this.type === 'bat' ? 8 : 14);
    }
  }

  /** 扣血，返回本次是否被击杀 */
  takeDamage(amount) {
    this.hp -= amount;
    this.hitFlash = 0.12;
    if (this.hp <= 0) {
      this.dead = true;
      return true;
    }
    return false;
  }

  draw(ctx) {
    const color = this.hitFlash > 0 ? '#ffffff' : this.color;

    ctx.save();
    ctx.translate(this.x, this.y);

    // 光晕
    ctx.beginPath();
    ctx.arc(0, 0, this.radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = this.hexToRgba(this.color, 0.14);
    ctx.fill();

    // 身体
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.hexToRgba(this.color, 0.85);
    ctx.stroke();

    // 眼睛：朝向玩家，让敌人看起来「有意识」
    const target = this.game.player;
    const angle = Math.atan2(target.y - this.y, target.x - this.x);
    const ex = Math.cos(angle) * this.radius * 0.32;
    const ey = Math.sin(angle) * this.radius * 0.32;
    const eyeR = Math.max(2, this.radius * 0.16);

    for (const side of [-1, 1]) {
      const px = ex + Math.cos(angle + Math.PI / 2) * side * this.radius * 0.36;
      const py = ey + Math.sin(angle + Math.PI / 2) * side * this.radius * 0.36;
      ctx.beginPath();
      ctx.arc(px, py, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = '#11131f';
      ctx.fill();
    }

    ctx.restore();
  }

  /** 把 #rrggbb 转成带透明度的 rgba()，用于半透明效果 */
  hexToRgba(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}

export { ENEMY_TYPES };
