/**
 * 极简静态服务器 —— 只用来托管 Storybook 的构建产物。
 *
 * 为什么不用 vite preview：项目的 vite.config.ts 有 base: '/TavernGame/'，
 * 那会让 Storybook 的产物挂在 /TavernGame/ 下，而 Storybook 自己按根路径取资源。
 * 二十行 Node 原生 http 反而更准（也零依赖）。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

/** 常见类型的 Content-Type；认不出来按二进制发 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/** 处理一次请求：路径越界拒绝、文件读不到 404、其余按类型返回 */
async function handleRequest(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname === '/' ? '/index.html' : url.pathname
  const file = join(root, path)
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden')
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}

/** 起一个只读静态服务器；返回的 close() 用来收尾 */
export async function startStaticServer(options: { port: number; root: string }) {
  const root = resolve(options.root)
  // ⚠️ 用非 async 的处理器包一层：http 的处理器签名是 void，直接传 async 会吞掉 rejection
  const server = createServer((req, res) => {
    void handleRequest(root, req, res)
  })
  await new Promise<void>((done) => {
    server.listen(options.port, () => done())
  })
  return { close: () => server.close() }
}
