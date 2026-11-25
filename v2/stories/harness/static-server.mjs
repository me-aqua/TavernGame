/**
 * 给组件故事的构建产物（`v2/storybook-static`）用的极简静态服务器。
 *
 * 为什么不用 `file://`：`iframe.html` 用 ESM 加载 bundle，`file://` 下被 CORS 挡死
 * （老站那条 `serve-artifacts` 的教训同源）。这里只做三件事：按扩展名给 content-type、
 * 目录回落 index.html、关掉缓存。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

export function startStaticServer({ port, root }) {
  const server = createServer((request, response) => {
    // 只要路径那一段（查询串忽略）；手动切不用 new URL —— 这里是 node 侧的极简件
    const pathname = (request.url ?? '/').split('?')[0]
    let target = join(root, normalize(decodeURIComponent(pathname)))
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html')
    if (!existsSync(target)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    createReadStream(target).pipe(response)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}
