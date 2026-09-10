/**
 * player.js —— 玩家角色（酒馆守卫）
 *
 * 职责：记住自己的位置/生命/射击冷却，并负责把自己画出来。
 * 它不关心敌人在哪、游戏何时结束 —— 那些由 game.js 统一调度。
 */

import { clamp, normalize, angleTo } from './utils.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.radius = 15;
    this.speed = 295;          // 每秒移动的像素数
    this.maxHp = 100;
    this.fireInterval = 0.14;  // 射击间隔（秒），越小越快
    this.reset();
  }

  /** 把角色恢复到初始状态（开始新一局时调用） */
  reset() {
    this.x = window.innerWidth / 2;
    this.y = window.innerHeight / 2;
    this.vx = 0;
    this.vy = 0;
    this.hp = this.maxHp;
    this.cooldown = 0;
    this.angle = -Math.PI / 2;
    this.invuln = 0;           // 受伤后的短暂无敌时间，避免被连续扣血
  }

  /**
   * 每帧更新。
   * @param {number} dt   距离上一帧过了多少秒
   * @param {object} keys 按键状态表，例如 { w: true, a: false }
   */
  update(dt, keys) {
    // --- 1. 读取输入方向 ---
    let dx = 0;
    let dy = 0;
    if (keys.w || keys.arrowup) dy -= 1;
    if (keys.s || keys.arrowdown) dy += 1;
    if (keys.a || keys.arrowleft) dx -= 1;
    if (keys.d || keys.arrowright) dx += 1;

    // --- 2. 移动（归一化保证斜着走不会更快）---
    const dir = normalize(dx, dy);
    this.vx = dir.x * this.speed;
    this.vy = dir.y * this.speed;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // --- 3. 限制在画面内，别跑出边界 ---
    const w = this.game.width;
    const h = this.game.height;
    this.x = clamp(this.x, this.radius, w - this.radius);
    this.y = clamp(this.y, this.radius, h - this.radius);

    // --- 4. 计时器倒数 ---
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);

    // --- 5. 朝向鼠标（只要鼠标在画面内，就一直看着它）---
    const m = this.game.mouse;
    if (m.inside) {
      this.angle = angleTo(this.x, this.y, m.x, m.y);
    }
  }

  /**
   * 尝试开火。冷却没走完就什么都不做。
   * @returns {boolean} 这一帧是否真的射出了子弹
   */
  tryShoot() {
    if (this.cooldown > 0 || !this.game.running) return false;
    this.cooldown = this.fireInterval;

    // 子弹从角色边缘飞出，而不是从身体中心，视觉上更自然
    const muzzle = this.radius + 8;
    const bx = this.x + Math.cos(this.angle) * muzzle;
    const by = this.y + Math.sin(this.angle) * muzzle;

    // 先创建一个写完整段，再推到游戏对象上 —— 可读性优先
    this.game.bullets.push({
      x: bx,
      y: by,
      vx: Math.cos(this.angle) * 720,
      vy: Math.sin(this.angle) * 720,
      radius: 3.5,
      damage: 1,
      life: 1.6,   // 存活时间（秒），超时自动消失
    });

    // 枪口火花：纯装饰
    this.game.spawnParticles(bx, by, 5, '#fbbf24', 170);
    return true;
  }

  /** 扣血，用来判断受伤后是否还有无敌帧 */
  takeDamage(amount) {
    if (this.invuln > 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = 0.7;
    this.game.shake = Math.min(14, this.game.shake + 7);  // 屏幕震动
    this.game.spawnParticles(this.x, this.y, 16, '#f87171', 240);
    return true;
  }

  /** 把自己画到画布上 */
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    // 受伤无敌期间闪烁，给玩家明确的反馈
    if (this.invuln > 0) {
      ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(this.invuln * 22));
    }

    // 身体光晕
    ctx.beginPath();
    ctx.arc(0, 0, this.radius + 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(110, 231, 183, 0.13)';
    ctx.fill();

    // 身体
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#e8ecf5';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#6ee7b7';
    ctx.stroke();

    // 枪管：指向鼠标方向，让操作有「瞄准」的感觉
    ctx.rotate(this.angle);
    ctx.beginPath();
    ctx.roundRect(this.radius - 4, -4, 20, 8, 4);
    ctx.fillStyle = '#6ee7b7';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(14, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();

    ctx.restore();
  }
}
