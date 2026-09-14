/**
 * End-to-end smoke test — runs the built bundle in a real Chrome.
 *
 * Why not install Playwright: Chrome is already on this machine, and CDP over
 * Node's built-in WebSocket is enough — zero downloads, zero new dependencies.
 * Same approach used while debugging (see skill: browser-debug).
 *
 * Spawns and cleans up its own preview server, so it runs standalone.
 *
 * Usage: npm run e2e
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 4173
const URL = `http://localhost:${PORT}/TavernGame/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Assertion collector: run everything, then report — one failure must not hide the rest */
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
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
    // Fresh profile per run: a reused one lets old state pollute assertions
    `--user-data-dir=/tmp/taverngame-e2e-${process.pid}`,
    '--remote-debugging-port=9444',
    'about:blank',
  ],
  { stdio: 'ignore', detached: true },
)

function cleanup() {
  // Processes may have exited on their own; failing to kill is not an error
  try {
    chrome.kill('SIGKILL')
  } catch {
    /* success path: process already exited */
  }
  try {
    preview.kill('SIGKILL')
  } catch {
    /* success path: process already exited */
  }
}
process.on('exit', cleanup)

// ---------- connect to CDP ----------
let wsUrl = null
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  await sleep(300)
  try {
    const list = await (await fetch('http://127.0.0.1:9444/json/list')).json()
    const page = list.find((t) => t.type === 'page')
    if (page) wsUrl = page.webSocketDebuggerUrl
  } catch {
    // success path: debug port not listening yet, retry next round
  }
}
if (!wsUrl) {
  console.error('✖ 连不上 Chrome 的调试端口')
  cleanup()
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
await new Promise((r) => {
  ws.onopen = r
})
let id = 0
const pending = new Map()
const runtimeErrors = []
const badRequests = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(
      (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 160),
    )
  }
  if (
    m.method === 'Network.responseReceived' &&
    m.params.response.status >= 400 &&
    !m.params.response.url.includes('favicon')
  ) {
    badRequests.push(`${m.params.response.status} ${m.params.response.url}`)
  }
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? '求值失败')
  }
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Network.enable')
await send('Page.enable')

// ---------- case 1: first paint ----------
await send('Page.navigate', { url: URL })
await sleep(4000)

const firstPaint = await evaluate(`(() => {
  const q = (s) => document.querySelector(s)
  return {
    href: location.href,
    mounted: !!q('#app')?.firstElementChild,
    sidebar: [...document.querySelectorAll('aside h2')].map((h) => h.textContent),
    time: q('.time-display')?.textContent?.trim() ?? null,
    status: q('header span:nth-child(2) span:last-child')?.textContent ?? null,
    buttons: [...document.querySelectorAll('header button')].map((b) => b.textContent.trim()),
    storyLines: document.querySelectorAll('.line').length,
  }
})()`)

check('页面挂载成功', firstPaint.mounted === true)
check(
  '侧栏是时间/地点/回合',
  JSON.stringify(firstPaint.sidebar) === JSON.stringify(['时间', '地点', '回合']),
  JSON.stringify(firstPaint.sidebar),
)
check(
  '时间显示为公历格式',
  /^\d{4} 年 \d+ 月 \d+ 日 · 星期[日一二三四五六] · (上午|下午|晚上)$/.test(firstPaint.time ?? ''),
  firstPaint.time,
)
check('未配置时状态栏提示未配置', firstPaint.status === '未配置', firstPaint.status)
check('存档与设置按钮都在', firstPaint.buttons.length === 5, JSON.stringify(firstPaint.buttons))
check('首屏有欢迎提示', firstPaint.storyLines >= 1, `${firstPaint.storyLines} 行`)

// ---------- case 2: settings drawer ----------
await evaluate(
  `[...document.querySelectorAll('header button')].find((b) => b.textContent.includes('设置'))?.click()`,
)
await sleep(500)
const drawer = await evaluate(`(() => {
  const d = document.querySelector('.drawer')
  if (!d) return { open: false }
  return {
    open: true,
    providerCount: d.querySelectorAll('select option').length,
    labelCount: d.querySelectorAll('label').length,
    hasTestButton: [...d.querySelectorAll('button')].some((b) => b.textContent.includes('测试连接')),
  }
})()`)
check('设置面板能打开', drawer.open === true)
check('六个服务商可选', drawer.providerCount === 6, String(drawer.providerCount))
check('配置项够用（服务商+密钥+地址+模型+步数）', drawer.labelCount >= 5, String(drawer.labelCount))
check('有「测试连接」按钮', drawer.hasTestButton === true)

// ---------- case 3: close the drawer ----------
await evaluate(`document.querySelector('.drawer')?.click()`)
await sleep(400)
check('点遮罩能关闭面板', (await evaluate(`!!document.querySelector('.drawer')`)) === false)

// ---------- case 4: a corrupted save must not blank the page ----------
await evaluate(`localStorage.setItem('tavernGame.save.v3', '{这不是合法 JSON')`)
await send('Page.navigate', { url: URL })
await sleep(3500)
const corrupted = await evaluate(`(() => ({
  mounted: !!document.querySelector('#app')?.firstElementChild,
  errorLines: [...document.querySelectorAll('.line.error')].map((d) => d.textContent.slice(0, 40)),
  backups: Object.keys(localStorage).filter((k) => k.includes('.broken-')).length,
}))()`)
check('损坏存档不白屏', corrupted.mounted === true)
check('界面说明了存档损坏', corrupted.errorLines.length === 1, JSON.stringify(corrupted.errorLines))
check('坏数据被备份', corrupted.backups === 1, String(corrupted.backups))

// ---------- case 5: theme switching ----------
await evaluate(`localStorage.setItem('tavernGame.theme', 'dark')`)
await send('Page.navigate', { url: URL })
await sleep(2500)
const dark = await evaluate(`(() => ({
  hasDarkClass: document.documentElement.classList.contains('dark'),
  pageBg: getComputedStyle(document.body).backgroundColor,
}))()`)
check('深色模式生效（html 上有 .dark）', dark.hasDarkClass === true)
check('深色背景与浅色不同', dark.pageBg !== 'rgb(242, 244, 247)', dark.pageBg)

await evaluate(`localStorage.setItem('tavernGame.theme', 'light')`)
await send('Page.navigate', { url: URL })
await sleep(2500)
const light = await evaluate(`(() => ({
  hasDarkClass: document.documentElement.classList.contains('dark'),
  pageBg: getComputedStyle(document.body).backgroundColor,
}))()`)
check('浅色模式生效', light.hasDarkClass === false)
check('浅色背景正确', light.pageBg === 'rgb(242, 244, 247)', light.pageBg)

// ---------- global assertions ----------
check('没有运行时异常', runtimeErrors.length === 0, runtimeErrors.join(' | '))
check('没有 4xx/5xx 请求', badRequests.length === 0, badRequests.join(' | '))

// ---------- report ----------
cleanup()
const failed = results.filter((r) => !r.ok)
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✖'} ${r.name}${r.detail && !r.ok ? ' —— ' + r.detail : ''}`)
}
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
