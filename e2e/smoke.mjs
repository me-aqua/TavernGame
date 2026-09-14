/**
 * 端到端冒烟测试 —— 用真实 Chrome 跑构建产物。
 *
 * 为什么不装 Playwright：本机已有 Chrome，用 CDP（Node 自带 WebSocket）
 * 就够了，零下载、零新依赖。做法与调试时一致（见 skill: browser-debug）。
 *
 * 自带 preview 服务器：脚本自己起、自己关，独立可跑。
 *
 * 用法：npm run e2e
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 4173
const URL = `http://localhost:${PORT}/TavernGame/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 断言收集器：全部跑完再统一报，避免一个失败遮住后面的 */
const 结果 = []
function 检查(name, ok, detail = '') {
  结果.push({ name, ok, detail })
}

if (!existsSync('dist/index.html')) {
  console.error('✖ 没有 dist/ —— 先跑 npm run build')
  process.exit(1)
}

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'ignore',
})
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    // 每次运行用独立 profile：复用 profile 会让「备份键数量」这类断言被历史状态污染
    `--user-data-dir=/tmp/taverngame-e2e-${process.pid}`,
    '--remote-debugging-port=9444',
    'about:blank',
  ],
  { stdio: 'ignore', detached: true },
)

function 清理() {
  // 进程可能已经自己退了，杀不到不是错误
  try {
    chrome.kill('SIGKILL')
  } catch {
    /* 成功路径：进程已退出 */
  }
  try {
    preview.kill('SIGKILL')
  } catch {
    /* 成功路径：进程已退出 */
  }
}
process.on('exit', 清理)

// ---------- 连上 CDP ----------
let wsUrl = null
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  await sleep(300)
  try {
    const list = await (await fetch('http://127.0.0.1:9444/json/list')).json()
    const page = list.find((t) => t.type === 'page')
    if (page) wsUrl = page.webSocketDebuggerUrl
  } catch {
    // 成功路径：调试端口还没监听，下一轮重试
  }
}
if (!wsUrl) {
  console.error('✖ 连不上 Chrome 的调试端口')
  清理()
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
await new Promise((r) => {
  ws.onopen = r
})
let id = 0
const pending = new Map()
const 异常 = []
const 坏请求 = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    异常.push(
      (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 160),
    )
  }
  if (
    m.method === 'Network.responseReceived' &&
    m.params.response.status >= 400 &&
    !m.params.response.url.includes('favicon')
  ) {
    坏请求.push(`${m.params.response.status} ${m.params.response.url}`)
  }
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const 求值 = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails)
    throw new Error(r.result.exceptionDetails.exception?.description ?? '求值失败')
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Network.enable')
await send('Page.enable')

// ---------- 用例 1：首屏 ----------
await send('Page.navigate', { url: URL })
await sleep(4000)

const 首屏 = await 求值(`(() => {
  const q = (s) => document.querySelector(s)
  return {
    地址: location.href,
    挂载: !!q('#app')?.firstElementChild,
    侧栏: [...document.querySelectorAll('.sidebar .card h2')].map((h) => h.textContent),
    时间: q('.time-display')?.textContent ?? null,
    状态: q('header .status span:last-child')?.textContent ?? null,
    按钮: [...document.querySelectorAll('header button')].map((b) => b.textContent.trim()),
    故事行: document.querySelectorAll('.story .line').length,
  }
})()`)

检查('页面挂载成功', 首屏.挂载 === true)
检查(
  '侧栏是时间/地点/回合',
  JSON.stringify(首屏.侧栏) === JSON.stringify(['时间', '地点', '回合']),
  JSON.stringify(首屏.侧栏),
)
检查(
  '时间显示为公历格式',
  /^\d{4} 年 \d+ 月 \d+ 日 · 星期[日一二三四五六] · (上午|下午|晚上)$/.test(首屏.时间 ?? ''),
  首屏.时间,
)
检查('未配置时状态栏提示未配置', 首屏.状态 === '未配置', 首屏.状态)
检查('四个存档/设置按钮都在', 首屏.按钮.length === 4, JSON.stringify(首屏.按钮))
检查('首屏有欢迎提示', 首屏.故事行 >= 1, `${首屏.故事行} 行`)

// ---------- 用例 2：设置面板 ----------
await 求值(
  `[...document.querySelectorAll('header button')].find((b) => b.textContent.includes('设置'))?.click()`,
)
await sleep(500)
const 面板 = await 求值(`(() => {
  const d = document.querySelector('.drawer')
  if (!d) return { 打开: false }
  return {
    打开: true,
    服务商数: d.querySelectorAll('select option').length,
    字段: [...d.querySelectorAll('.field label')].map((l) => l.textContent.trim()).length,
    有测试连接: [...d.querySelectorAll('button')].some((b) => b.textContent.includes('testConnection')),
  }
})()`)
检查('设置面板能打开', 面板.打开 === true)
检查('六个服务商可选', 面板.服务商数 === 6, String(面板.服务商数))
检查('五个配置字段', 面板.字段 === 5, String(面板.字段))
检查('有「testConnection」按钮', 面板.有测试连接 === true)

// ---------- 用例 3：关闭面板 ----------
await 求值(`document.querySelector('.drawer')?.click()`)
await sleep(400)
检查('点遮罩能关闭面板', (await 求值(`!!document.querySelector('.drawer')`)) === false)

// ---------- 用例 4：损坏存档不白屏 ----------
await 求值(`localStorage.setItem('tavernGame.save.v3', '{这不是合法 JSON')`)
await send('Page.navigate', { url: URL })
await sleep(3500)
const 损坏 = await 求值(`(() => ({
  挂载: !!document.querySelector('#app')?.firstElementChild,
  报错行: [...document.querySelectorAll('.story .line.error')].map((d) => d.textContent.slice(0, 40)),
  备份: Object.keys(localStorage).filter((k) => k.includes('.broken-')).length,
}))()`)
检查('损坏存档不白屏', 损坏.挂载 === true)
检查('界面说明了存档损坏', 损坏.报错行.length === 1, JSON.stringify(损坏.报错行))
检查('坏数据被备份', 损坏.备份 === 1, String(损坏.备份))

// ---------- 全局断言 ----------
检查('没有运行时异常', 异常.length === 0, 异常.join(' | '))
检查('没有 4xx/5xx 请求', 坏请求.length === 0, 坏请求.join(' | '))

// ---------- 汇总 ----------
清理()
const 失败 = 结果.filter((r) => !r.ok)
for (const r of 结果)
  console.log(`${r.ok ? '✓' : '✖'} ${r.name}${r.detail && !r.ok ? ' —— ' + r.detail : ''}`)
console.log(`\n${结果.length - 失败.length}/${结果.length} 通过`)
process.exit(失败.length ? 1 : 0)
