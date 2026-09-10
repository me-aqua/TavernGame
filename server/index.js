/**
 * server/index.js —— TavernGame 的本地服务器
 *
 * 这是那个「小后端」。它现在只做一件事：把 public/ 目录当网站提供出去。
 * 后续会在这里挂上 agent 循环（对话、掷骰、世界状态）。
 *
 * 设计原则：
 *   1. 零依赖 —— 只用 Node 内置模块，不装任何包
 *   2. 单进程 —— 一个命令启动，Ctrl+C 停止
 *   3. 只暴露 public/ —— 后端代码和存档绝不对外可见
 *   4. 失败要说人话 —— 端口占用、找不到目录都要给出提示
 *
 * 常用配置（用环境变量覆盖）：
 *   PORT=3000   换端口
 *   HOST=0.0.0.0  允许局域网其他设备访问（默认只允许本机）
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- 路径与配置 ----------

// import.meta.url 是当前文件的网址形式，转成普通路径，
// 再往上退一层就到项目根目录（server/ 的上一级）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ASSETS_DIR = path.join(ROOT, 'assets');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

// ---------- 文件类型表 ----------
// 浏览器靠 Content-Type 决定怎么处理文件。
// 类型报错会出现「网页变成下载」「CSS 不生效」这类怪问题。
const MIME_TYPES = {
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
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/** 取文件扩展名对应的 MIME，认不出来就当二进制流 */
function mimeOf(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// ---------- 请求日志 ----------
// 每次请求打一行，方便你看清「服务器到底在干什么」。
// 这是新手调试最实用的工具之一。
function logRequest(method, url, status, ms) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const color = status >= 500 ? '\x1b[31m'      // 红：服务器错误
    : status >= 400 ? '\x1b[33m'                // 黄：找不到或无权访问
      : '\x1b[32m';                             // 绿：正常
  console.log(`  ${time}  ${method.padEnd(4)} ${String(status).padStart(3)}  ${ms}ms  ${color}${url}\x1b[0m`);
}

// ---------- 静态文件服务 ----------

/**
 * 把 URL 路径解析成磁盘上的真实文件路径。
 * 返回 null 表示「不该访问」（越界或不是普通文件）。
 *
 * ⚠️ 路径穿越防护：
 *    请求 /../../config.json 这种恶意路径时，
 *    解析后的路径会跑到 public/ 外面。必须挡住。
 *    这是 web 服务器最基本的安全底线。
 */
async function resolveFile(urlPath) {
  // 去掉查询字符串，解码 %20 之类的转义
  let cleanPath;
  try {
    cleanPath = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;   // 非法转义，直接拒绝
  }

  // "/" 和 "/play" 都当成目录，去找里面的 index.html
  const relative = cleanPath.replace(/^\/+/, '');
  const target = relative === '' ? 'index.html' : relative;

  let filePath = path.resolve(PUBLIC_DIR, target);

  // 关键防线：解析后的路径必须仍在 PUBLIC_DIR 里面
  const relativeToPublic = path.relative(PUBLIC_DIR, filePath);
  if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic)) {
    return null;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      // 目录 → 尝试里面的 index.html
      filePath = path.join(filePath, 'index.html');
      const inner = await stat(filePath);
      if (!inner.isFile()) return null;
    } else if (!info.isFile()) {
      return null;
    }
  } catch {
    return null;   // 文件不存在
  }

  return filePath;
}

/**
 * 往 HTML 里注入一小段脚本。
 *
 * 为什么这么做？这样 public/index.html 本身可以保持纯净的静态页面，
 * 而「本地服务器正在运行」这个提示由服务器自己加上去。
 * 部署到 GitHub Pages 时没有服务器，这段自然就不存在了。
 */
function injectDevBadge(html) {
  const badge = `
  <!-- 由本地服务器注入，GitHub Pages 上不会有这段 -->
  <script>
    window.__DEV_SERVER__ = true;
    window.addEventListener('DOMContentLoaded', () => {
      const box = document.createElement('div');
      box.textContent = '⚙️ 本地服务器运行中 · localhost:${PORT}';
      box.style.cssText = [
        'position:fixed', 'left:14px', 'bottom:14px', 'z-index:999',
        'padding:6px 12px', 'border-radius:999px',
        'background:rgba(110,231,183,0.14)',
        'border:1px solid rgba(110,231,183,0.35)',
        'color:#6ee7b7', 'font-size:11px',
        'font-family:system-ui,sans-serif', 'letter-spacing:0.04em',
        'pointer-events:none', 'user-select:none',
      ].join(';');
      document.body.appendChild(box);
    });
  </script>
`;
  return html.includes('</body>') ? html.replace('</body>', `${badge}</body>`) : html + badge;
}

// ---------- 主处理函数 ----------

async function handleRequest(req, res) {
  const started = Date.now();

  // ---------- 状态接口 ----------
  // 前端靠它判断「后端到底有什么能力」。
  // 现在 agent 还没接，所以如实返回 not-ready。
  if ((req.url || '').split('?')[0] === '/api/healthz') {
    const payload = JSON.stringify({
      ok: true,
      server: 'tavern-game',
      version: '0.3.0-dev',
      agent: false,                       // ← 第 2 步会变成 true
      message: '服务器已在运行，但 agent 循环尚未接入',
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(payload);
    logRequest(req.method, '/api/healthz', 200, Date.now() - started);
    return;
  }

  // ---------- 静态资源：/assets/ ----------
  // 图片素材放在仓库根的 assets/ 下，这样 GitHub Pages 和本地服务器
  // 都能用到同一份文件，不必复制两份。
  if ((req.url || '').startsWith('/assets/')) {
    const rel = decodeURIComponent((req.url || '').slice('/assets/'.length).split('?')[0]);
    const assetPath = path.resolve(ASSETS_DIR, rel);
    const relToAssets = path.relative(ASSETS_DIR, assetPath);

    // 同样的穿越防护：不能跳出 assets/ 目录
    if (!relToAssets.startsWith('..') && !path.isAbsolute(relToAssets)) {
      try {
        const info = await stat(assetPath);
        if (info.isFile()) {
          const content = await readFile(assetPath);
          res.writeHead(200, {
            'Content-Type': mimeOf(assetPath),
            'Content-Length': content.length,
            'Cache-Control': 'no-cache',
          });
          res.end(content);
          logRequest(req.method, req.url, 200, Date.now() - started);
          return;
        }
      } catch {
        // 落下去走正常的 404 流程
      }
    }
  }

  const filePath = await resolveFile(req.url || '/');

  if (!filePath) {
    const body = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>404</title>
<style>body{background:#0d0f1a;color:#e8ecf5;font-family:system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
code{color:#6ee7b7}a{color:#7dd3fc}</style></head>
<body><div>
<h1 style="font-size:56px;margin:0">404</h1>
<p style="color:#8b95b0">这里什么都没有</p>
<p><a href="/">← 回到首页</a></p>
<p style="font-size:12px;color:#555e78">${req.url}</p>
</div></body></html>`;
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
    logRequest(req.method, req.url, 404, Date.now() - started);
    return;
  }

  try {
    const type = mimeOf(filePath);
    let content = await readFile(filePath);

    // HTML 才需要注入，图片之类的不能碰
    if (type.startsWith('text/html')) {
      content = Buffer.from(injectDevBadge(content.toString('utf8')), 'utf8');
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',   // 开发期不缓存，改了刷新就能看到
    });
    res.end(content);
    logRequest(req.method, req.url, 200, Date.now() - started);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`服务器读文件失败：${err.message}`);
    logRequest(req.method, req.url, 500, Date.now() - started);
  }
}

// ---------- 启动 ----------

function printBanner(port) {
  const url = `http://localhost:${port}`;
  console.log('');
  console.log('  \x1b[36m╭──────────────────────────────────────────╮\x1b[0m');
  console.log('  \x1b[36m│\x1b[0m  🎲  TavernGame 本地服务器              \x1b[36m│\x1b[0m');
  console.log('  \x1b[36m╰──────────────────────────────────────────╯\x1b[0m');
  console.log('');
  console.log(`    测试页    \x1b[32m${url}/\x1b[0m`);
  console.log(`    游戏界面  \x1b[32m${url}/play.html\x1b[0m`);
  console.log('');
  console.log(`    静态目录  ${PUBLIC_DIR}`);
  console.log(`    停止服务  \x1b[33mCtrl + C\x1b[0m`);
  console.log('');
}

async function main() {
  if (!existsSync(PUBLIC_DIR)) {
    console.error('');
    console.error(`  ❌ 找不到目录：${PUBLIC_DIR}`);
    console.error('     请确认你在项目根目录运行，且 public/ 目录存在。');
    console.error('');
    process.exit(1);
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('  处理请求时发生未预期错误：', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    });
  });

  // 端口被占用时给一句人话，而不是抛一堆栈
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error(`  ❌ 端口 ${PORT} 已被占用`);
      console.error(`     可能已经有一个服务器在跑了。`);
      console.error(`     换个端口：\x1b[33m$env:PORT=3001; npm start\x1b[0m`);
      console.error('');
    } else {
      console.error('  ❌ 服务器启动失败：', err.message);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => printBanner(PORT));

  // Ctrl+C 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n  👋 服务器已停止\n');
    server.close(() => process.exit(0));
    // 万一有连接卡住，1 秒后强制退出
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

main();
