/**
 * utils.js —— 通用小工具函数
 *
 * 单独抽出来的好处：这些函数和游戏逻辑无关，以后做别的项目也能直接复用。
 */

/** 限制数值范围：把 value 夹在 min 和 max 之间 */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** 生成 [min, max) 之间的随机小数 */
export function rand(min, max) {
  return min + Math.random() * (max - min);
}

/** 生成 [min, max] 之间的随机整数 */
export function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

/** 从数组里随机取一个元素 */
export function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/** 向量长度（勾股定理） */
export function length(x, y) {
  return Math.hypot(x, y);
}

/**
 * 把向量变成单位长度（长度为 1），即「只保留方向，丢掉大小」。
 * 这样不管鼠标离得多远，子弹速度都一致。
 */
export function normalize(x, y) {
  const len = Math.hypot(x, y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

/** 求从 (ax,ay) 指向 (bx,by) 的夹角，单位弧度 */
export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

/**
 * 圆形碰撞检测：判断两个圆是否相交。
 * 游戏里所有物体都当作圆处理，这样判定既简单又自然。
 */
export function circleHit(ax, ay, ar, bx, by, br) {
  const dx = bx - ax;
  const dy = by - ay;
  const radiusSum = ar + br;
  // 用「距离平方」比较，可以省掉一次开方运算，性能更好
  return dx * dx + dy * dy <= radiusSum * radiusSum;
}
