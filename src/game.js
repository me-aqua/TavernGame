/**
 * game.js —— 游戏核心：把所有零件组装起来并驱动整个循环
 *
 * 这是整份代码里最重要的一环。它负责：
 *   1. 记录时间（dt），让游戏速度不受屏幕刷新率影响
 *   2. 更新所有物体（玩家、敌人、子弹、粒子）
 *   3. 检测碰撞、结算分数
 *   4. 把一切画到画布上
 *   5. 同步左上角的信息面板
 */

import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { clamp, rand, pick, circleHit } from './utils.js';

/** 游戏状态常量：用常量代替魔法字符串，写错时更容易发现 */
export const STATE = {
  READY: 'ready',
  RUNNING: 'running',
  PAUSED: 'paused',
  OVER: 'over',
};

export class Game {
  constructor() {
    this.canvas = document.querySelector('#game');
    this.ctx = this.canvas.getContext('2d');

    // 画布的逻辑尺寸（像素）与设备像素比
    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    // 输入状态
    this.keys = {};
    this.mouse = { x: 0, y: 0, inside: false, down: false };

    // 游戏对象
    this.player = new Player(this);
    this.enemies = [];
    this.bullets = [];
    this.particles = [];

    // 进度与难度
    this.state = STATE.READY;
    this.time = 0;
    this.spawnTimer = 0;
    this.score = 0;
    this.shake = 0;          // 屏幕震动强度
    this.best = this.loadBest();
    this.hudTimer = 0;

    // 界面元素
    this.el = {
      score: document.querySelector('#score'),
      time: document.querySelector('#time'),
      hp: document.querySelector('#hp'),
      best: document.querySelector('#best'),
      hud: document.querySelector('#hud'),
      overlay: document.querySelector('#overlay'),
      overlayTitle: document.querySelector('.overlay-title'),
      overlayDesc: document.querySelector('#overlay-desc'),
      button: document.querySelector('#btn-start'),
    };

    this.bindInput();
  }

  /** 兼容旧浏览器的圆角矩形（新版浏览器已内置） */
  roundRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 读取历史最高分（localStorage 是浏览器提供的本地小仓库） */
  loadBest() {
    try {
      return Number(localStorage.getItem('tavernGame.best') || 0);
    } catch {
      return 0;   // 隐私模式下可能不允许存储，忽略即可
    }
  }

  saveBest() {
    try {
      localStorage.setItem('tavernGame.best', String(this.best));
    } catch { /* 忽略 */ }
  }

  /** 挂载所有输入监听 */
  bindInput() {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.keys[key] = true;

      if (key === ' ' || key === 'spacebar') {
        e.preventDefault();          // 阻止空格把页面往下滚
        if (this.state === STATE.RUNNING) this.player.tryShoot();
        else if (this.state !== STATE.PAUSED) this.start();
      }
      if (key === 'p') this.togglePause();
      if (key === 'enter' && this.state === STATE.OVER) this.start();
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
      this.mouse.inside = true;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.mouse.inside = false;
      this.mouse.down = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.mouse.down = true;
      if (this.state === STATE.RUNNING) this.player.tryShoot();
      else if (this.state === STATE.READY) this.start();
    });

    window.addEventListener('mouseup', () => { this.mouse.down = false; });

    // 触屏支持：手指移动即瞄准+开火
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = t.clientX - rect.left;
      this.mouse.y = t.clientY - rect.top;
      this.mouse.inside = true;
    }, { passive: false });
    this.canvas.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = t.clientX - rect.left;
      this.mouse.y = t.clientY - rect.top;
      this.mouse.inside = true;
      if (this.state === STATE.READY) this.start();
      else this.player.tryShoot();
    });

    // 窗口尺寸变化时重新适配画布
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * 适配画布尺寸与高分屏。
   * 手机和 4K 屏的 pixelRatio 大于 1，如果直接按 CSS 像素绘制会糊，
   * 所以内部按比例放大，再用 ctx.scale 把坐标缩回来。
   */
  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  /** 开始新一局 */
  start() {
    this.enemies.length = 0;
    this.bullets.length = 0;
    this.particles.length = 0;
    this.time = 0;
    this.score = 0;
    this.spawnTimer = 0.8;
    this.shake = 0;
    this.player.reset();
    this.state = STATE.RUNNING;
    this.setOverlay(false);
    this.syncHud();
  }

  /** 游戏结束 */
  end() {
    this.state = STATE.OVER;
    if (this.score > this.best) {
      this.best = this.score;
      this.saveBest();
    }
    this.syncHud();

    this.el.overlayTitle.textContent = '你倒下了';
    this.el.overlayDesc.innerHTML =
      `本局得分 <strong>${this.score}</strong> · 存活 <strong>${this.time.toFixed(1)} 秒</strong>` +
      `<br />历史最高分 <strong>${this.best}</strong>`;
    this.el.button.textContent = '再来一局';
    this.setOverlay(true);
  }

  togglePause() {
    if (this.state === STATE.RUNNING) {
      this.state = STATE.PAUSED;
      this.el.overlayTitle.textContent = '已暂停';
      this.el.overlayDesc.innerHTML = '按 <kbd>P</kbd> 或点击下方按钮继续';
      this.el.button.textContent = '继续游戏';
      this.setOverlay(true);
    } else if (this.state === STATE.PAUSED) {
      this.state = STATE.RUNNING;
      this.setOverlay(false);
    }
  }

  /** 显示 / 隐藏遮罩层 */
  setOverlay(visible) {
    this.el.overlay.classList.toggle('is-hidden', !visible);
    this.el.hud.classList.toggle('is-hidden', !visible && this.state === STATE.READY);
  }

  /** 屏幕震动效果 */
  applyShake() {
    if (this.shake <= 0.1) return;
    const sx = rand(-this.shake, this.shake);
    const sy = rand(-this.shake, this.shake);
    this.ctx.translate(sx, sy);
  }

  /**
   * 生成粒子（爆炸、火花等装饰效果）。
   * 粒子纯粹是视觉糖，不参与任何碰撞判定。
   */
  spawnParticles(x, y, count, color, speed = 200) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = rand(speed * 0.15, speed);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: rand(0.25, 0.65),
        maxLife: 0.65,
        radius: rand(1.5, 3.5),
        color,
      });
    }
  }

  /** 从画面外放出一只敌人 */
  spawnEnemy() {
    // 每 16 秒进入一个「新阶段」，蝙蝠比例逐渐上升，变难
    const stage = Math.floor(this.time / 16);
    const isBat = Math.random() < Math.min(0.65, 0.2 + stage * 0.09);
    this.enemies.push(new Enemy(this, isBat ? 'bat' : 'slime'));
  }

  /** 只要鼠标按住不放，就持续射击 */
  handleAutoFire() {
    if (this.state !== STATE.RUNNING) return;
    if (this.mouse.down || this.keys[' ']) this.player.tryShoot();
  }

  /** 每帧更新逻辑 */
  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 42);

    // 待机状态下只播撒装饰粒子，让画面不至于太空
    if (this.state === STATE.READY) {
      if (Math.random() < 0.06) {
        this.spawnParticles(rand(0, this.width), rand(0, this.height), 1, '#6ee7b7', 60);
      }
      this.updateParticles(dt);
      return;
    }

    if (this.state !== STATE.RUNNING) {
      this.updateParticles(dt);
      return;
    }

    // --- 时间与难度 ---
    this.time += dt;
    this.spawnTimer -= dt;
    // 出怪间隔从 1.1 秒逐渐压缩到 0.3 秒
    const interval = Math.max(0.3, 1.1 - this.time * 0.016);
    if (this.spawnTimer <= 0) {
      this.spawnEnemy();
      this.spawnTimer = interval * rand(0.75, 1.25);
    }

    // --- 玩家 ---
    this.player.update(dt, this.keys);
    this.handleAutoFire();

    // --- 子弹：移动 + 超时销毁 ---
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -40 || b.x > this.width + 40 || b.y < -40 || b.y > this.height + 40) {
        b.dead = true;
      }
    }

    // --- 敌人 ---
    for (const e of this.enemies) e.update(dt);

    // --- 碰撞检测：每颗子弹对每只敌人 ---
    for (const b of this.bullets) {
      if (b.dead) continue;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (circleHit(b.x, b.y, b.radius, e.x, e.y, e.radius)) {
          b.dead = true;
          this.spawnParticles(b.x, b.y, 6, e.color, 210);
          if (e.takeDamage(b.damage)) {
            // 击杀：加分 + 爆炸
            this.score += e.score;
            this.spawnParticles(e.x, e.y, 18, e.color, 300);
            this.shake = Math.min(10, this.shake + 2.5);
          }
          break;   // 一颗子弹只打中一个敌人
        }
      }
    }

    // --- 清理已销毁对象 ---
    // 用 filter 重建数组：写法清晰，且不会漏删
    this.bullets = this.bullets.filter((b) => !b.dead);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.updateParticles(dt);

    // --- 死亡判定 ---
    if (this.player.hp <= 0) this.end();

    // --- 刷新界面数字（每 0.08 秒一次，避免每帧操作 DOM）---
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.08;
      this.syncHud();
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;   // 空气阻力
      p.vy *= 0.94;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  /** 把数据同步到 HTML 面板上 */
  syncHud() {
    this.el.score.textContent = String(this.score);
    this.el.time.textContent = `${this.time.toFixed(1)}s`;
    this.el.hp.textContent = String(Math.ceil(this.player.hp));
    this.el.best.textContent = String(this.best);
  }

  /** 绘制一帧 */
  draw() {
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.applyShake();

    // --- 背景网格：提供空间参照 ---
    this.drawGrid(ctx);

    // --- 粒子（放在最底层，像光影）---
    for (const p of this.particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // --- 子弹：拉长的光条，看起来更快 ---
    for (const b of this.bullets) {
      const dir = Math.atan2(b.vy, b.vx);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(dir);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-16, -3, 20, 6);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff7d6';
      ctx.fillRect(-4, -2, 9, 4);
      ctx.restore();
    }

    // --- 敌人 ---
    for (const e of this.enemies) e.draw(ctx);

    // --- 玩家 ---
    this.player.draw(ctx);

    ctx.restore();

    // --- 暂停时的提示条 ---
    if (this.state === STATE.PAUSED) {
      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#6ee7b7';
      ctx.font = '600 14px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已暂停 · 按 P 继续', this.width / 2, this.height - 28);
      ctx.restore();
    }
  }

  drawGrid(ctx) {
    const step = 64;
    ctx.save();
    ctx.strokeStyle = 'rgba(110, 231, 183, 0.055)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = 0; y <= this.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
