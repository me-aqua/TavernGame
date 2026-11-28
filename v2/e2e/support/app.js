/**
 * e2e 共用件：应用路径、hash 路由、种子数据、结构探针、拖拽。
 *
 * 三条约定（与旧站那套一致的教训，别重新发明）：
 *   · **找元素只用 `data-*` 钩子**：界面文案随实现变，按文字找元素等于把测试钉死在一种措辞上；
 *   · **种子数据只写一次**（`sessionStorage` 打标记）：否则 `reload()` 会把用户刚存的进度重置掉，
 *     「刷新后还在」那条判据会静默假绿；
 *   · **浏览器侧的代码一律写成模板串**（`PROBE` / 种子脚本）：这一段在页面里跑，
 *     写成一个普通函数会被 lint 的 `no-undef` 拦下（那里确实没有 `window`）。
 *
 * 夹具（卡 / 存档 / 预设）只有一份：`v2/tests/support/fixtures.js` —— 单测与 e2e 共用。
 */
import { expect } from '@playwright/test'
import {
  MOCK_PRESET,
  MOCK_PRESET_B,
  OPENING_PROMPT,
  freshCard,
  makeCard,
  makeNode,
  makeSave,
  nodeModelsFor,
  turnEvents,
} from '../../tests/support/fixtures.js'

export {
  MOCK_PRESET,
  MOCK_PRESET_B,
  OPENING_PROMPT,
  freshCard,
  makeCard,
  makeNode,
  makeSave,
  nodeModelsFor,
  turnEvents,
}

/** 线上/本地产物都挂在这个路径下（`v2/vite.config.mjs` 的 base） */
export const APP_PATH = '/TavernGame/v2/'

/** 与产品代码共用同一份键名；写错了这里会当场变红（读不到东西） */
export const KEYS = {
  cards: 'tg2.cards',
  saves: 'tg2.saves',
  presets: 'tg2.presets',
  settings: 'tg2.settings',
  nodeModels: 'tg2.nodeModels',
}

/** 中文正则：断言「这句人话是中文」而不抄一份字面量（ascii 钩子也不许源码里出现中文） */
export const CJK = /[\u4e00-\u9fff]/

/** hash 路由（SPEC §1） */
export const route = {
  home: '#/',
  settings: '#/settings',
  edit: (cardId) => `#/edit/${cardId}`,
  editSave: (saveId) => `#/edit-save/${saveId}`,
  play: (cardId, saveId) => `#/play/${cardId}/${saveId}`,
}

/**
 * 编辑器里的两种读眼睛（CONTRACT §8.2）：
 *   · 公共提示词的眼睛在**右栏**：`[data-prompt-read][data-prompt-id]`
 *   · 上游的眼睛在**工作流细条**上：`[data-read-upstream][data-upstream-id]`（只有前面的节点有）
 */
export const promptRead = (promptId) => `[data-prompt-read][data-prompt-id="${promptId}"]`
export const upstreamRead = (upstreamId) => `[data-read-upstream][data-upstream-id="${upstreamId}"]`

/**
 * 故事流里的调试读数（CONTRACT §8.3）：**一个节点一张 trace 卡片**，卡片带节点 id 与回合号。
 * 提示词 / 预设这类读数都住在卡片里，所以必须带节点那一格 —— 拿全局 `[data-trace-prompt]`
 * 去读会命中多张（strict mode 直接红）。
 */
export const traceCard = (nodeId, turn) =>
  turn === undefined
    ? `[data-trace][data-trace-node="${nodeId}"]`
    : `[data-trace][data-trace-node="${nodeId}"][data-trace-turn="${turn}"]`
export const tracePrompt = (nodeId) => `${traceCard(nodeId)} [data-trace-prompt]`
export const tracePreset = (nodeId) => `${traceCard(nodeId)} [data-trace-preset]`

/** 一回合的合计读数行（紧凑一行：回合 / 总 token / 总耗时 / t/s），永远在 */
export const turnStatsRow = (turn) => `[data-turn-stats][data-turn-stats-turn="${turn}"]`

/**
 * 首次打开会种一张内置示例卡（晨风镇），标记住 `tg2.settings.sampleSeeded`（README/契约 §2.4）。
 *
 * 所以 `boot()` 默认**先把「已经种过了」的标记写进去**：已有用例的前提都是
 * 「首页上没有示例卡」（空态 / 只有自己种的那张卡），它们不该被这张卡影响。
 * 只有 `sample: true` 的那条用例**不写标记** —— 那是唯一该看见「首次打开」的用例。
 */
export const SEEDED_MARKER = { sampleSeeded: true }

/**
 * 打开应用。`storage` 里给的对象会被 JSON 序列化后写进 localStorage，
 * **只在第一次导航时写**（刷新不再写，否则持久化判据是假的）。
 *
 * @param {object}  options
 * @param {object?} options.storage  种进 `tg2.*` 的键（对象会被 JSON 序列化）
 * @param {string?} options.hash     打开的路由
 * @param {string?} options.query    `?debug=1` 这类查询串（放在 hash 之前）
 * @param {boolean} options.sample   true = **不写** sampleSeeded 标记（这条用例要看首次打开）
 */
export async function boot(page, { storage = null, hash = route.home, query = '', sample = false } = {}) {
  const seed = { ...(storage ?? {}) }
  if (!sample) {
    // 与调用方给的 settings 合并（别把 theme / editorColumns 冲掉），再补上「已种过」标记
    const given = seed[KEYS.settings]
    seed[KEYS.settings] = { ...(given && typeof given === 'object' ? given : {}), ...SEEDED_MARKER }
  }
  if (Object.keys(seed).length > 0) {
    const payload = JSON.stringify(seed)
    await page.addInitScript(`
      (() => {
        if (window.sessionStorage.getItem('tg2-e2e-seeded') === '1') return
        window.sessionStorage.setItem('tg2-e2e-seeded', '1')
        const seed = ${payload}
        for (const key of Object.keys(seed)) {
          const value = seed[key]
          window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
        }
      })()
    `)
  }
  await page.goto(`${APP_PATH}${query}${hash}`)
}

/** 读一个 localStorage 键（解析成对象）；键不存在读回 null */
export async function readStorage(page, key) {
  return page.evaluate(`JSON.parse(window.localStorage.getItem(${JSON.stringify(key)}) ?? 'null')`)
}

/**
 * 读一个 localStorage 键的**原始字符串**（不解析）。
 * 旧数据安全判据要靠它：坏数据没有被「顺手回写成一份新的」，字节必须逐字相同。
 */
export async function readRaw(page, key) {
  return page.evaluate(`window.localStorage.getItem(${JSON.stringify(key)})`)
}

/** 当前 localStorage 用到的键（看有没有往 tg2.* 之外写） */
export async function storageKeys(page) {
  return page.evaluate('Object.keys(window.localStorage).sort()')
}

/**
 * 结构探针：横向溢出 + 元素伸出视口。
 * 与旧站 `e2e/probe.ts` 同一套判据（阈值也同一份），但这一份只认 v2 的钩子。
 */
export const PROBE = `(() => {
  const vw = window.innerWidth
  const offenders = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width <= 0.5 || r.height <= 0.5) continue
    if (r.right > vw + 1 || r.left < -1) {
      const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : ''
      const tag = el.tagName.toLowerCase() + (cls ? '.' + cls : '')
      offenders.push(tag + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']')
    }
  }
  return {
    overflow: document.documentElement.scrollWidth - vw,
    offenders: [...new Set(offenders)].slice(0, 8),
    page: document.querySelector('[data-page]') ? document.querySelector('[data-page]').getAttribute('data-page') : null,
  }
})()`

/** 三条结构判据里 v2 这一刻用得上的两条（24px 点按目标归组件故事那一层） */
export function expectClean(probe) {
  expect(probe.overflow, '不能横向溢出').toBeLessThanOrEqual(1)
  expect(probe.offenders, '元素不能伸出视口').toEqual([])
}

/** 拖一个分隔条（相对当前位置横向拖 dx 像素） */
export async function dragSplitter(page, which, dx) {
  const handle = page.locator(`[data-splitter="${which}"]`)
  const box = await handle.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 10 })
  await page.mouse.up()
}

/** 量一个元素当前的宽（四舍五入到整数像素） */
export async function widthOf(page, selector) {
  const box = await page.locator(selector).boundingBox()
  return Math.round(box.width)
}

/**
 * 走一个回合：写行动 → 点发送 → 等这条行动对应的正文出现。
 * `expected` 是这一回合跑完之后**故事流里正文的条数**（不是回合数）。
 */
export async function playTurn(page, action, expectedNarrationCount) {
  await page.locator('[data-action-input]').fill(action)
  await page.locator('[data-send]').click()
  await expect(page.locator('[data-line="narration"]')).toHaveCount(expectedNarrationCount, {
    timeout: 15_000,
  })
  await expect(page.locator('[data-stop]')).toHaveCount(0)
}

/**
 * 进对话页（可带 `?debug=1`，那只是调试开关的**初始状态**）。
 *
 * 🔴 没有封面、没有开始按钮（CONTRACT §8.3）：打开就看见故事流与输入区。
 */
export async function openStory(page, cardId, saveId, { debug = false } = {}) {
  await page.goto(`${APP_PATH}${debug ? '?debug=1' : ''}${route.play(cardId, saveId)}`)
  await expect(page.locator('[data-page="play"]')).toBeVisible()
  await expect(page.locator('[data-story]')).toBeVisible()
}

/**
 * 从首页给某张卡新建一个存档，返回新存档的 id。
 * 新建的存档排在列表末尾（`tg2.saves` 也是这个顺序）—— 这里读盘取最后一个，不靠界面文案。
 */
export async function createSave(page, cardId) {
  await page.goto(`${APP_PATH}${route.home}`)
  await page.locator(`[data-card-id="${cardId}"]`).click()
  await page.locator('[data-new-save]').click()
  const saves = await readStorage(page, KEYS.saves)
  return saves[saves.length - 1].id
}

/** mock 预设的一个慢速版本（让「流式中 / 可停止」这两件事在界面上真的看得见） */
export function slowMock(delayMs = 40) {
  return { ...MOCK_PRESET, mockChunkDelayMs: delayMs }
}

/**
 * OpenAI 风格的 SSE 正文（只发正文增量）—— 给 `page.route` 顶替服务商用。
 * 与真实服务商同一形状：`data: {...chunk}` 若干帧 + `data: [DONE]`。
 */
export function openAiSse(chunks) {
  const frames = chunks.map((text) =>
    JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fake-model',
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    }),
  )
  frames.push(
    JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fake-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }),
  )
  return frames.map((frame) => `data: ${frame}\n\n`).join('') + 'data: [DONE]\n\n'
}
