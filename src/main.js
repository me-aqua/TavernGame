/**
 * main.js —— 程序入口
 *
 * 「入口」的意思是：浏览器加载 index.html 时，
 * 会先找到这一行 <script type="module" src="src/main.js">，
 * 然后从这里开始执行，其他文件都是被它 import 进来的。
 *
 * 保持入口文件简短是好习惯 —— 出问题时先看这里，一眼能看清流程。
 */

import { Game, STATE } from './game.js';

/**
 * requestAnimationFrame 是浏览器提供的「下一帧」接口。
 * 它比 setInterval 更好，因为：
 *   1. 屏幕刷新率是多少，就回调多少次（60Hz / 144Hz 都合适）
 *   2. 切到后台标签页时会自动降频，不浪费电
 *
 * dt = delta time = 距离上一帧过了多少秒。
 * 用「每秒速度 × dt」来移动，游戏速度就和刷新率无关了。
 */
function startLoop(game) {
  let last = performance.now();

  function frame(now) {
    // 限制单帧最大 0.05 秒，防止切回窗口时「瞬移」一大段
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    game.update(dt);
    game.draw();

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

/** 启动一切 */
function init() {
  const game = new Game();
  game.resize();

  // 按钮在开始、暂停、结束三种状态下有不同行为，所以集中判断
  game.el.button.addEventListener('click', () => {
    if (game.state === STATE.PAUSED) game.togglePause();
    else game.start();
  });

  // 切到别的标签页时自动暂停，避免回来发现自己已经死了
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === STATE.RUNNING) game.togglePause();
  });

  startLoop(game);

  // 挂到 window 上，方便你在浏览器控制台里调试，例如：
  //   gameRef.state
  //   gameRef.enemies.length
  window.gameRef = game;

  console.info(
    '%cTavernGame 已启动',
    'color:#6ee7b7;font-weight:600',
    '\n在控制台输入 gameRef 可以查看游戏对象'
  );
}

init();
