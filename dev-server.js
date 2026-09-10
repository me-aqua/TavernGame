/**
 * dev-server.js —— 本地调试服务器
 *
 * 和直接开 index.html 的区别：
 *   - 用 HTTP 提供文件，ES 模块才能正常加载（file:// 会被浏览器拦）
 *
 * 和开始用的 `npx serve` 的区别：
 *   - **彻底禁用缓存**（no-store），改完代码刷新即生效。
 *     这是本地调试最关键的一点 —— 否则浏览器可能一直在跑旧 JS，
 *     让人误以为「代码改了没作用」。
 *   - 零依赖，不用等 npx 下载
 *
 * 线上（GitHub Pages）不需要这个东西 —— 那是一个静态站点，
 * 浏览器直接取文件就行。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

const log = (status, url, ms) => {
  const c = status >= 400 ? '\x1b[33m' : '\x1b[32m';
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`  ${t}  ${String(status).padStart(3)}  ${ms}ms  ${c}${url}\x1b[0m`);
};

async function resolve(urlPath) {
  let clean;
  try {
    clean = decodeURIComponent((urlPath || '/').split('?')[0]);
  } catch {
    return null;
  }

  const rel = clean.replace(/^\/+/, '');
  let target = path.resolve(ROOT, rel === '' ? 'index.html' : rel);

  // 穿越防护：解析后必须仍在项目根目录内
  const relToRoot = path.relative(ROOT, target);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return null;

  // 不提供后端源码、文档、Git 数据 —— 调试时也只暴露网站资源
  const first = relToRoot.split(path.sep)[0];
  if (['.git', '.tools', 'node_modules'].includes(first)) return null;
  if (first.endsWith('.md') || first === 'package.json') return null;
  // 屏蔽服务器自己的源码（否则它会被当成静态文件提供出去）
  if (relToRoot === 'dev-server.js') return null;

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      target = path.join(target, 'index.html');
      const inner = await stat(target);
      if (!inner.isFile()) return null;
    } else if (!info.isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  return target;
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const target = await resolve(req.url);

  if (!target) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><meta charset="utf-8"><title>404</title>'
      + '<body style="background:#0d0f1a;color:#e8ecf5;font-family:system-ui;'
      + 'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">'
      + '<div style="text-align:center"><h1 style="font-size:52px;margin:0">404</h1>'
      + `<p style="color:#8b95b0">${req.url}</p>`
      + '<p><a href="/" style="color:#7dd3fc">← 回游戏</a></p></div>');
    log(404, req.url, Date.now() - started);
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': mimeOf(target),
      'Content-Length': body.length,
      // ⚠️ 关键：本地调试禁用一切缓存。
      // 否则改了 prompts.js 刷新却还是旧行为，能让人排查半天。
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(body);
    log(200, req.url, Date.now() - started);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('读取文件失败：' + err.message);
    log(500, req.url, Date.now() - started);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ❌ 端口 ${PORT} 已被占用`);
    console.error(`     换个端口：\x1b[33m$env:PORT=3001; npm run dev\x1b[0m\n`);
  } else {
    console.error('  ❌ 启动失败：' + err.message);
  }
  process.exit(1);
});

if (!existsSync(path.join(ROOT, 'index.html'))) {
  console.error('  ❌ 找不到 index.html，请在项目根目录运行。');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  \x1b[36m╭────────────────────────────────────────────╮\x1b[0m');
  console.log('  \x1b[36m│\x1b[0m  🛠  TavernGame 本地调试服务器            \x1b[36m│\x1b[0m');
  console.log('  \x1b[36m╰────────────────────────────────────────────╯\x1b[0m');
  console.log('');
  console.log(`    游戏地址  \x1b[32mhttp://localhost:${PORT}/\x1b[0m`);
  console.log(`    介绍页    \x1b[32mhttp://localhost:${PORT}/about.html\x1b[0m`);
  console.log('');
  console.log('    \x1b[33m缓存已禁用\x1b[0m —— 改完代码直接刷新，不用硬刷新');
  console.log('    \x1b[33m注意\x1b[0m 本地与线上的 API key 是分开存的，初次要重新填一次');
  console.log('');
  console.log(`    停止服务  \x1b[33mCtrl + C\x1b[0m`);
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n  👋 已停止\n');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800).unref();
});
