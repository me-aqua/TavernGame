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

const LIGHT_BG = 'rgb(242, 244, 247)'

/**
 * Pin the UI language in localStorage before every navigation.
 *
 * ⚠️ Without this the app follows navigator.language, which in headless Chrome is
 * en-US — the previous version of this file asserted Chinese text and therefore
 * only passed because it never pinned anything and the assertions were wrong.
 * The UI language also decides the *model* language, so pinning keeps both sides
 * of the assertions on one locale.
 */
const LANG = 'zh-CN'
const SET_LANGUAGE = (mode) => `localStorage.setItem('tavernGame.lang', '${mode}')`

/**
 * Navigate, with localStorage writes applied on the app's own origin first.
 *
 * ⚠️ localStorage is denied on about:blank (opaque origin), so the very first
 * navigation must happen before anything is stored; every later one can seed
 * state and refresh.
 */
async function openWith(seed) {
  if (!seed.datasetReady) {
    await send('Page.navigate', { url: URL })
    await sleep(1500)
    seed.datasetReady = true
  }
  for (const stmt of seed.statements) await evaluate(stmt)
  await send('Page.navigate', { url: URL })
  await sleep(seed.waitMs ?? 2500)
}

/**
 * Translate through the app's own table, read out of the running page.
 *
 * The locale tables are not importable from Node (they are app sources), so the
 * strings are fetched over CDP instead of being copied here. A wording change
 * therefore cannot leave this suite asserting stale text.
 */
const T = async (key, named) =>
  evaluate(`window.__dshE2E.i18n.global.t(${JSON.stringify(key)}, ${JSON.stringify(named ?? {})})`)

/** Assertion collector: run everything, then report — one failure must not hide the rest */
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
}

if (!existsSync('dist/index.html')) {
  console.error('[e2e] no dist/ - run `npm run build` first')
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
  console.error('[e2e] cannot reach the Chrome debug port')
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
    throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed')
  }
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Network.enable')
await send('Page.enable')

// ---------- case 1: first paint ----------
// Pin the language first: the app otherwise follows navigator.language, and the
// model language follows the UI language, so both must be decided explicitly.
await openWith({ statements: [SET_LANGUAGE(LANG)], waitMs: 4000 })

const firstPaint = await evaluate(`(() => {
  const q = (s) => document.querySelector(s)
  return {
    href: location.href,
    mounted: !!q('#app')?.firstElementChild,
    sidebar: [...document.querySelectorAll('aside h2')].map((h) => h.textContent),
    time: q('.time-display')?.textContent?.trim() ?? null,
    status: q('header span:nth-child(2) span:last-child')?.textContent ?? null,
    // The debug switch is a dev-only affordance (localhost), not one of the app buttons
    buttons: [...document.querySelectorAll('header button:not([data-debug])')].map((b) =>
      b.textContent.trim(),
    ),
    storyLines: document.querySelectorAll('.line').length,
    // Notices and in-progress hints are a computed status row, never story lines
    notice: document.querySelector('[data-status]')?.textContent?.trim() ?? null,
    noticeKind: document.querySelector('[data-status]')?.getAttribute('data-status') ?? null,
    // localhost is a dev host, so the header must show the debug badge
    debugBadge: document.querySelector('[data-debug]')?.textContent?.trim() ?? null,
  }
})()`)

check('app mounts', firstPaint.mounted === true)
check(
  'sidebar shows time/place/turn',
  JSON.stringify(firstPaint.sidebar) ===
    JSON.stringify([await T('sidebar.time'), await T('sidebar.place'), await T('sidebar.turn')]),
  JSON.stringify(firstPaint.sidebar),
)
// The concrete date text is produced by the calendar, so it is checked as a
// shape: year/month/day + weekday + segment, in the pinned locale (zh-CN).
check(
  'time renders in the calendar format',
  /^\d{4} 年 \d+ 月 \d+ 日 · 星期[日一二三四五六] · (上午|下午|晚上)$/.test(firstPaint.time ?? ''),
  firstPaint.time,
)
check(
  'status bar says not-configured',
  firstPaint.status === (await T('app.statusUnconfigured')),
  firstPaint.status,
)
check(
  'all header buttons are present (the dev debug switch does not count)',
  firstPaint.buttons.length === 6,
  JSON.stringify(firstPaint.buttons),
)
check(
  'an unconfigured first paint shows the welcome notice (not a story line)',
  firstPaint.storyLines === 0 && firstPaint.notice === (await T('app.welcome')),
  `${firstPaint.storyLines} lines, notice=${firstPaint.notice}`,
)
check(
  'localhost turns debug mode on by default (switch reads "on")',
  firstPaint.debugBadge === (await T('header.debugToggleOn')),
  String(firstPaint.debugBadge),
)

// The switch is what lets a developer see the normal (non-debug) UI: click it off,
// check the label, the status row and the remembered choice, then click it back on.
await evaluate(`document.querySelector('button[data-debug]')?.click()`)
await sleep(300)
const debugOff = await evaluate(`(() => ({
  label: document.querySelector('[data-debug]')?.textContent?.trim() ?? null,
  status: document.querySelector('[data-status]')?.textContent?.trim() ?? null,
  stored: localStorage.getItem('tavernGame.debug'),
}))()`)
check(
  'clicking the switch turns debug off',
  debugOff.label === (await T('header.debugToggleOff')),
  String(debugOff.label),
)
check(
  'the off state is announced in the status row',
  debugOff.status === (await T('app.debugOff')),
  String(debugOff.status),
)
check('the explicit choice is remembered', debugOff.stored === 'off', String(debugOff.stored))

await evaluate(`document.querySelector('button[data-debug]')?.click()`)
await sleep(300)
check(
  'clicking again turns it back on',
  (await evaluate(`document.querySelector('[data-debug]')?.textContent?.trim() ?? null`)) ===
    (await T('header.debugToggleOn')),
)

// ---------- case 2: settings drawer ----------
await evaluate(
  `[...document.querySelectorAll('header button')]
     .find((b) => b.hasAttribute('data-settings'))?.click()`,
)
await sleep(500)
const drawer = await evaluate(`(() => {
  const d = document.querySelector('.drawer')
  if (!d) return { open: false }
  return {
    open: true,
    providerCount: d.querySelectorAll('select option').length,
    labelCount: d.querySelectorAll('label').length,
    // Collected as raw values and compared in Node: the page has no i18n helper
    // of its own, and comparing here keeps the assertion in one place.
    hasTestButton: !!d.querySelector('button[data-test-connection]'),
  }
})()`)
check('settings drawer opens', drawer.open === true)
check('six providers selectable', drawer.providerCount === 6, String(drawer.providerCount))
check('settings has provider/key/url/model/steps fields', drawer.labelCount >= 5, String(drawer.labelCount))
check('has a test-connection button', drawer.hasTestButton === true)

// ---------- case 3: close the drawer ----------
await evaluate(`document.querySelector('.drawer')?.click()`)
await sleep(400)
check(
  'clicking the backdrop closes the drawer',
  (await evaluate(`!!document.querySelector('.drawer')`)) === false,
)

// ---------- case 4: a corrupted save must not blank the page ----------
await openWith({
  statements: [SET_LANGUAGE(LANG), `localStorage.setItem('tavernGame.save', '{not valid json')`],
  waitMs: 3500,
})
const corrupted = await evaluate(`(() => ({
  mounted: !!document.querySelector('#app')?.firstElementChild,
  errors: [...document.querySelectorAll('[data-status="error"]')].map((d) => d.textContent.slice(0, 40)),
  backups: Object.keys(localStorage).filter((k) => k.includes('.broken-')).length,
}))()`)
check('corrupted save does not blank the page', corrupted.mounted === true)
check(
  'the UI explains the save is corrupted (error notice)',
  corrupted.errors.length === 1,
  JSON.stringify(corrupted.errors),
)
check('bad data is backed up', corrupted.backups === 1, String(corrupted.backups))

// ---------- case 4b: an ongoing save resumes silently ----------
// The turn number lives in the sidebar, which is derived from the data and therefore
// reactive. There used to be a "Resuming (turn N)" notice: it was a *snapshot* of the
// turn taken at load time and could only appear on a refresh (same fact told twice),
// so it was deleted — this case is the regression net for that.
const ONGOING_SAVE = JSON.stringify({
  meta: { turn: 6 },
  player: { name: 'tester' },
  scene: { name: '', description: '' },
  time: { iso: '2026-09-14T10:00:00.000Z' },
  events: [{ kind: 'narration', text: 'an old story line', at: '2026-09-14T10:00:00.000Z' }],
  timeline: [],
})
const FAKE_CONFIG = JSON.stringify({
  provider: 'custom',
  apiKey: 'k',
  apiBase: 'https://example.test/v1',
  model: 'm',
  temperature: 0.85,
  maxAgentSteps: 3,
})
await openWith({
  statements: [
    SET_LANGUAGE(LANG),
    `localStorage.setItem('tavernGame.config', JSON.stringify(${FAKE_CONFIG}))`,
    `localStorage.setItem('tavernGame.save', JSON.stringify(${ONGOING_SAVE}))`,
  ],
})
const ongoing = await evaluate(`(() => ({
  notice: document.querySelector('[data-status]')?.textContent?.trim() ?? null,
  story: [...document.querySelectorAll('.line')].map((p) => p.textContent.trim()),
  sidebar: document.querySelector('aside')?.innerText.replace(/\\n/g, ' ') ?? '',
}))()`)
check('an ongoing save resumes with no announcement', ongoing.notice === null, String(ongoing.notice))
check('the old story is on screen', ongoing.story.length === 1, JSON.stringify(ongoing.story))
check(
  'the turn number is in the sidebar (the reactive place)',
  ongoing.sidebar.includes('6'),
  ongoing.sidebar.slice(0, 60),
)

// ---------- case 5: theme switching ----------
await openWith({ statements: [SET_LANGUAGE(LANG), `localStorage.setItem('tavernGame.theme', 'dark')`] })
const dark = await evaluate(`(() => ({
  hasDarkClass: document.documentElement.classList.contains('dark'),
  pageBg: getComputedStyle(document.body).backgroundColor,
}))()`)
check('dark mode applies (.dark on <html>)', dark.hasDarkClass === true)
check('dark background differs from light', dark.pageBg !== LIGHT_BG, dark.pageBg)

await openWith({ statements: [SET_LANGUAGE(LANG), `localStorage.setItem('tavernGame.theme', 'light')`] })
const light = await evaluate(`(() => ({
  hasDarkClass: document.documentElement.classList.contains('dark'),
  pageBg: getComputedStyle(document.body).backgroundColor,
}))()`)
check('light mode applies', light.hasDarkClass === false)
check('light background is correct', light.pageBg === LIGHT_BG, light.pageBg)

// ---------- case 6: the language toggle actually switches the UI ----------
// The model language follows the UI language, so this is a functional switch,
// not cosmetics (see doc/DESIGN.md). It also covers "the stored choice wins over
// navigator.language" — headless Chrome reports en-US, the store says zh-CN.
const snapshotUi = () =>
  evaluate(`(() => ({
    htmlLang: document.documentElement.lang,
    headings: [...document.querySelectorAll('aside h2')].map((h) => h.textContent),
    settingsLabel: document.querySelector('header button[aria-label]')?.getAttribute('aria-label'),
  }))()`)
const clickLanguage = () =>
  evaluate(`
    [...document.querySelectorAll('header button')]
      .find((b) => b.hasAttribute('data-language'))?.click()`)

await openWith({ statements: [SET_LANGUAGE('zh-CN')] })
const zhUi = await snapshotUi()
check('stored language wins over navigator.language', zhUi.htmlLang === 'zh-CN', zhUi.htmlLang)
check(
  'UI renders in Chinese when zh-CN is pinned',
  zhUi.headings[0] === '时间',
  JSON.stringify(zhUi.headings),
)

await clickLanguage()
await sleep(600)
const enUi = await snapshotUi()
check(
  'language button switches the UI to English',
  enUi.headings[0] === 'Time',
  JSON.stringify(enUi.headings),
)
check('switching language updates <html lang>', enUi.htmlLang === 'en', enUi.htmlLang)
check(
  'language choice is persisted for the next visit',
  (await evaluate(`localStorage.getItem('tavernGame.lang')`)) === 'en',
)

// ---------- global assertions ----------
check('no runtime exceptions', runtimeErrors.length === 0, runtimeErrors.join(' | '))
check('no 4xx/5xx responses', badRequests.length === 0, badRequests.join(' | '))

// ---------- report ----------
cleanup()
const failed = results.filter((r) => !r.ok)
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✖'} ${r.name}${r.detail && !r.ok ? ' —— ' + r.detail : ''}`)
}
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
