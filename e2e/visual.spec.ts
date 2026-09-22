/**
 * 整页截图检查 —— 把「每个状态 × 每种屏幕」的真实渲染拍下来，顺手做页面结构检查。
 *
 * 两条判据：
 *   1. **结构检查**（不需要基线，最可靠）：横向溢出、元素伸出视口、点按目标 < 24px
 *   2. **像素基线**（少量、稳定、高价值的画面）：变了就红，防止悄悄改坏
 * 剩下的（间距、层次、可读性）由人看 artifacts/screenshots/index.html 总览页。
 *
 * 用法：npm run visual（不进 pre-commit：慢，而且要浏览器）
 */
import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  APP_PATH,
  CARD_IDENTITY,
  CONFIG,
  LEAD_NAME,
  PLACE_FIELDS,
  WHERE_KEY,
  event,
  fakeLlm,
  saveWith,
  seedStorage,
  writeEvent,
  type FakeMode,
} from './fixtures'
import { PROBE, expectClean, type Probe } from './probe'

const OUT = 'artifacts/screenshots'

/** 屏幕：mobile 决定 Chrome 用不用移动端视口规则；dsf 让手机图在被看时更清楚 */
const VIEWPORTS = [
  { name: 'phone', width: 360, height: 640, dsf: 2, mobile: true },
  { name: 'phone-lg', width: 430, height: 932, dsf: 2, mobile: true },
  { name: 'tablet', width: 768, height: 1024, dsf: 2, mobile: true },
  // 横屏手机：票 67（口径 8）新加的工位 —— 四栏最少要 750px（设计 §四.1 的算术），
  // 800px 下只剩 40px 给中栏 ⇒ 这一档量的不是"四栏"，是"一栏 + 抽屉"
  { name: 'phone-landscape', width: 800, height: 400, dsf: 2, mobile: true },
  // 票 69（S3 的条件 3）：窄笔记本 —— 落在设计点名的 **821–1279 死带**里。
  // 原来那套视口 {360, 430, 768, 800, 1280, 1920} **一档都不在这条带里** ⇒
  // "中栏被压成 35–193px"那条 follow-up 永远无法被证伪。这一档还跑 `expectClean`（横向溢出会红）。
  { name: 'laptop-sm', width: 1100, height: 800, dsf: 1, mobile: false },
  { name: 'laptop', width: 1280, height: 800, dsf: 1, mobile: false },
  { name: 'desktop', width: 1920, height: 1080, dsf: 1, mobile: false },
]

/**
 * 开着四栏外壳的那一屏（口径 8 与裁决 6 要的「编辑器状态」）。
 *
 * ⚠️ 它是**改名来的**：原来的 `card-open` 点的就是设置面板里那颗 `[data-card-view]`，
 *    而它打开的 `CardEditor` 正是编辑器浮层（`App.vue:385-389` 的 `v-if="cardOpen"`）
 *    ⇒ 再添一个"编辑器状态"只会是同一屏的第二份（裁决 6 明说不加第二个）。
 */
const EDITOR_STATE = 'editor-open'
/** 外壳只在口径说得清的那几个视口上量：≥821px 量四栏（口径 1–7），800×400 量降级（口径 8） */
const SHELL_VIEWPORTS = new Set(['laptop', 'desktop', 'phone-landscape'])

/** 建像素基线的画面：稳定（数据固定）且值得盯住 */
const BASELINE = new Set([
  'playing-zh--phone',
  'playing-zh--laptop',
  'playing-en--phone',
  'playing-en--laptop',
  'long-story--phone',
  'debug-on--laptop',
  'debug-panel-tools--laptop',
  'drawer-open--laptop',
  'dark--laptop',
])

/** 一屏是怎么造出来的：种子数据 + 假模型 + （可选）交互 */
interface State {
  name: string
  seed: Record<string, string | null>
  fake?: FakeMode
  waitMs?: number
  interact?: string
  waitAfterMs?: number
}

const STORY = [
  event('action', '我推开酒馆的门，看看里面都有谁。'),
  event(
    'narration',
    '门轴发出一声长叹。暖黄的光从屋里涌出来，混着麦酒、木炭和湿羊毛的味道。\n\n柜台后站着一位头发花白的女人，她正把一只锡杯擦得发亮。靠窗的位子坐着三个猎人，脚边堆着沾泥的靴子。',
  ),
  event('action', '我走向柜台，问她最近镇上有没有什么怪事。'),
  event(
    'narration',
    '她停下手里的活，抬眼看了看你，又看了看窗边那桌。\n\n「怪事？」她把声音压低了些，「码头算不算。三天里，两条船回来都是空的——人没了，货还在。」',
  ),
]

const LONG_STORY = [
  ...STORY,
  ...Array.from({ length: 14 }, (_, i) => [
    event('action', `第 ${i + 2} 次行动：我沿着码头往北走，看看有没有人值夜。`),
    event(
      'narration',
      '潮水把木栈道泡得发黑。你数到第七根柱子时，听见有人在低声说话——两个影子蹲在最后一条船的阴影里，其中一个手里握着什么东西，反了一下月光。',
    ),
  ]).flat(),
]

const DEBUG_EVENTS = [
  event('node', '🧩 节点：时间'),
  event(
    'request',
    '📤 模型输入（2 条消息）',
    '{\n  "model": "demo-model",\n  "messages": [\n    { "role": "system", "content": "你是一个文字冒险游戏的主持人……" },\n    { "role": "user", "content": "玩家的行动：我推开酒馆的门。" }\n  ],\n  "temperature": 0.85\n}',
  ),
  event('model', '🔍 模型原始回复', '{\n  "choices": [ { "message": { "tool_calls": [ … ] } } ]\n}'),
  event(
    'tool',
    '⚙ 调用 advance_time({"minutes":5,"reason":"在酒馆待到深夜"})',
    '{"minutes":5,"reason":"在酒馆待到深夜"}',
  ),
  writeEvent('✎ 写入 world.time', { year: 2026, month: 9, day: 14, hour: 19, minute: 35 }),
  event('toolResult', '   → 🕐 时间推进：5 分钟', '🕐 时间推进：5 分钟'),
  ...STORY,
]

/** 提交一次行动（假模型会把卡里的图跑一遍）—— 调试面板的活卡图与工具调用靠它出内容 */
const SUBMIT_TURN = `(async () => {
  const ta = document.querySelector('textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '我去铁匠铺找萨伦')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  ;[...document.querySelectorAll('.composer-row button')].at(-1).click()
})()`

/** 打开调试面板（入口就在调试开关旁边） */
const OPEN_DEBUG_PANEL = "document.querySelector('button[data-debug-panel-toggle]')?.click()"

/**
 * 换掉存档里状态树的「当前所在」—— **R20：它在 `whoIsWhere` 那本册子的主控那一条上**
 * （`world.location` 那一枝与 `move_to` 都没了），每一条是三栏，**栏名从卡里现读**
 * （`PLACE_FIELDS`：作者起的名字，写错栏目名这张存档会被判成不合形状）。
 *
 * ⚠️ 覆盖 meta 时一定要带上卡身份（CARD_IDENTITY）：存档认亲比 id / version / format，
 *    少一个字段就会被判成「不属于这张卡」，整局退回空白开局（长故事那一屏曾因此拍成报错页）。
 */
function withWhereabouts(save: string, place: Record<string, string>): string {
  const data = JSON.parse(save) as { state: Record<string, any> }
  // 册子的键从卡自己的动作现读（段 3 之后它是中文的「谁在哪」）
  data.state.world[WHERE_KEY] = { ...data.state.world[WHERE_KEY], [LEAD_NAME]: place }
  return JSON.stringify(data)
}

const EN_STORY = [
  event('action', 'I push the tavern door open and look around.'),
  event(
    'narration',
    'The hinges sigh. Warm light spills out, thick with ale, charcoal and wet wool.\n\nBehind the counter stands a grey-haired woman polishing a tin cup. Three hunters sit by the window, muddy boots piled under the table.',
  ),
]

const STATES: State[] = [
  { name: 'unconfigured', seed: {} },
  { name: 'opening-busy', seed: { config: CONFIG, fake: 'slow' }, fake: 'slow', waitMs: 900 },
  { name: 'playing-zh', seed: { config: CONFIG, save: saveWith({ events: STORY }) } },
  {
    name: 'playing-en',
    seed: {
      lang: 'en',
      config: CONFIG,
      save: withWhereabouts(saveWith({ events: EN_STORY }), {
        [PLACE_FIELDS.area]: 'Morningwind',
        [PLACE_FIELDS.spot]: 'Tavern',
        [PLACE_FIELDS.scene]: 'Common room',
      }),
    },
  },
  {
    name: 'long-story',
    seed: {
      config: CONFIG,
      save: saveWith({ events: LONG_STORY, meta: { turn: 21, card: CARD_IDENTITY } }),
    },
  },
  { name: 'debug-on', seed: { config: CONFIG, save: saveWith({ events: DEBUG_EVENTS }), debug: 'on' } },
  { name: 'corrupted-save', seed: { save: '{not valid json' } },
  {
    name: 'drawer-open',
    seed: { config: CONFIG, save: saveWith({ events: STORY }) },
    interact: "document.querySelector('button[data-settings]')?.click()",
    waitAfterMs: 400,
  },
  {
    name: 'world-open',
    seed: { config: CONFIG, save: saveWith({ events: STORY }) },
    interact: "document.querySelector('button[data-world]')?.click()",
    waitAfterMs: 400,
  },
  {
    // 四栏外壳那一屏：设置面板的「卡」一节打开编辑器浮层 —— 那正是外壳的家。
    // ⚠️ 票 69：**只把浮层打开**，**选中一格那一步挪进了 test body**（在 `expectWideShell` 之前）。
    //    理由（S3 采纳的补法）：两态口径要在**真浏览器**这一层都有人守 ——
    //    "点节点态 3 个＋"只能在**点那一格之前**断到；把点击留在 state 里，那一态就没人守了。
    name: EDITOR_STATE,
    seed: { config: CONFIG, save: saveWith({ events: STORY }) },
    interact: `(async () => {
      document.querySelector('button[data-settings]')?.click()
      await new Promise((resolve) => setTimeout(resolve, 200))
      document.querySelector('button[data-card-view]')?.click()
    })()`,
    waitAfterMs: 900,
  },
  {
    // 活的卡图：面板开着、一轮正在跑（高亮 = 正在跑的那个节点）
    name: 'debug-panel-live',
    seed: { config: CONFIG, save: saveWith({ events: STORY }), debug: 'on' },
    fake: 'narration',
    interact: `(async () => {
      ${OPEN_DEBUG_PANEL}
      await new Promise((resolve) => setTimeout(resolve, 200))
      ;${SUBMIT_TURN}
    })()`,
    waitAfterMs: 900,
  },
  {
    // 工具调用：一轮跑完之后切到「工具调用」那一页（哪个节点、什么工具、原始参数、写入）
    name: 'debug-panel-tools',
    seed: { config: CONFIG, save: saveWith({ events: STORY }), debug: 'on' },
    fake: 'narration',
    interact: `(async () => {
      ${SUBMIT_TURN}
      await new Promise((resolve) => setTimeout(resolve, 4000))
      ;${OPEN_DEBUG_PANEL}
      await new Promise((resolve) => setTimeout(resolve, 300))
      document.querySelector('[data-debug-tab="tools"]')?.click()
    })()`,
    waitAfterMs: 900,
  },
  { name: 'dark', seed: { theme: 'dark', config: CONFIG, save: saveWith({ events: STORY }) } },
  {
    name: 'turn-error',
    seed: { config: CONFIG, save: saveWith({ events: STORY }), fake: 'error' },
    fake: 'error',
    interact: `(() => {
      const ta = document.querySelector('textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '我去码头看看')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      const send = [...document.querySelectorAll('.composer-row button')].at(-1)
      send.click()
    })()`,
    waitAfterMs: 900,
  },
]

/** 一张截图的结果（最后汇总成总览页） */
interface Shot {
  state: string
  viewport: string
  width: number
  height: number
  file: string
  rows: number
  traces: number
  notice: string | null
}

const shots: Shot[] = []

/** 造一屏：种子 → 打开 → 交互 → 等稳定 */
async function openState(page: Page, state: State): Promise<void> {
  if (state.fake) await fakeLlm(page, state.fake)
  await seedStorage(page, {
    'tavernGame.lang': state.seed.lang ?? 'zh-CN',
    'tavernGame.theme': state.seed.theme ?? null,
    'tavernGame.debug': state.seed.debug ?? null,
    'tavernGame.config': state.seed.config ?? null,
    'tavernGame.save': state.seed.save ?? null,
  })
  await page.goto(APP_PATH)
  await expect(page.locator('#app > *')).toHaveCount(1)
  await page.waitForTimeout(state.waitMs ?? 600)
  if (state.interact) {
    await page.evaluate(state.interact)
    await page.waitForTimeout(state.waitAfterMs ?? 400)
  }
}

/** 四栏外壳在浏览器里的读数（口径 1/2/3/5/6/7 —— 只读，不改页面） */
interface ShellReading {
  cols: Array<{ col: string; w: number; h: number; cx: number; visible: boolean; flex: string }>
  grid: { template: string; gap: string } | null
  ruler: { display: string; template: string; text: string; segs: Array<{ w: number; cx: number }> } | null
  mid: { overflowY: string; w: number; h: number } | null
  adds: Array<{ what: string; w: number; h: number }>
  /** 编枝态：左栏树上**有一行亮着**（票 69 裁决 12 —— 那一态下「编辑」栏的 ＋ 收起来） */
  branchMode: boolean
  drawers: Array<{
    name: string
    present: boolean
    display: string | null
    visible: boolean
    w: number
    expanded: string | null
  }>
  fonts: string[]
}

/**
 * 外壳那几条判据的读数脚本。
 *
 * 四样都在这里量：栅格的四段（口径 1）· 标尺四段（口径 2）· 中栏那个滚动体（口径 3）·
 * 三个「＋」的可点区域（口径 5 的 24×24）· 外壳自己用到的字号（口径 7 的三档）。
 */
const SHELL_PROBE = `(() => {
  const vis = (r) => r.width > 0.5 && r.height > 0.5 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { w: r.width, h: r.height, cx: r.left + r.width / 2 }
  }
  const shell = document.querySelector('[data-shell]')
  const cols = [...document.querySelectorAll('[data-col]')].map((el) => ({
    col: el.getAttribute('data-col'),
    ...box(el),
    visible: vis(el.getBoundingClientRect()),
    flex: getComputedStyle(el).flexDirection,
  }))
  const ruler = document.querySelector('[data-ruler]')
  const mid = document.querySelector('[data-mid]')
  // 外壳自己的文字只用三档字号：插进来的既有组件（卡图 / 表单 / 资源库）不算
  const legacy = '[data-card-form], [data-card-resources], .card-graph'
  const fonts = new Set()
  for (const el of document.querySelectorAll('[data-card-editor] *')) {
    if (el.closest(legacy)) continue
    if (el.children.length || !(el.textContent || '').trim()) continue
    fonts.add(getComputedStyle(el).fontSize)
  }
  return {
    cols,
    grid: shell ? { template: getComputedStyle(shell).gridTemplateColumns, gap: getComputedStyle(shell).columnGap } : null,
    ruler: ruler
      ? {
          display: getComputedStyle(ruler).display,
          template: getComputedStyle(ruler).gridTemplateColumns,
          text: (ruler.textContent || '').trim(),
          segs: [...ruler.querySelectorAll('[data-ruler-seg]')].map((el) => box(el)),
        }
      : null,
    mid: mid ? { overflowY: getComputedStyle(mid).overflowY, ...box(mid) } : null,
    adds: [...document.querySelectorAll('[data-add]')].map((el) => ({ what: el.getAttribute('data-add'), ...box(el) })),
    // 编枝态判据：树上亮着一行（[data-branch-on]）＝ 正在编一枝 ⇒ 裁决 12 要收起「编辑」栏那个 ＋
    // ⚠️ 这一段在**模板字符串**里：注释里别写反引号 + 美元花括号，那会被当成插值求值（踩过一次）
    branchMode: document.querySelector('[data-branch-on]') !== null,
    drawers: ['content', 'prompts'].map((name) => {
      const el = document.querySelector('[data-drawer="' + name + '"]')
      const toggle = document.querySelector('[data-drawer-toggle="' + name + '"]')
      return {
        name,
        present: !!el,
        display: el ? getComputedStyle(el).display : null,
        visible: el ? vis(el.getBoundingClientRect()) : false,
        w: el ? el.getBoundingClientRect().width : 0,
        expanded: toggle ? toggle.getAttribute('aria-expanded') : null,
      }
    }),
    fonts: [...fonts].sort(),
  }
})()`

/**
 * 中栏是不是真的能长滚动（口径 3）：塞一块高的进去再量，量完就撤。
 *
 * jsdom 没有布局，这一条只有在真浏览器里才量得到：`scrollHeight > clientHeight`（滚得动）
 * 且 `scrollWidth <= clientWidth`（不横向溢出）。
 */
const MID_SCROLL_PROBE = `(() => {
  const mid = document.querySelector('[data-mid]')
  if (!mid) return null
  const probe = document.createElement('div')
  probe.style.height = '3000px'
  probe.style.flex = 'none'
  mid.appendChild(probe)
  mid.scrollTop = 99999
  const out = {
    scrollHeight: mid.scrollHeight,
    clientHeight: mid.clientHeight,
    scrollTop: mid.scrollTop,
    scrollWidth: mid.scrollWidth,
    clientWidth: mid.clientWidth,
    overflowY: getComputedStyle(mid).overflowY,
  }
  probe.remove()
  mid.scrollTop = 0
  return out
})()`

/** 读一屏外壳 */
async function readShell(page: Page): Promise<ShellReading> {
  return (await page.evaluate(SHELL_PROBE)) as ShellReading
}

/** 点一下开合按钮（用 DOM 点击：遮罩盖住顶栏时也照样点得到），再把那个抽屉读回来 */
async function toggleDrawer(page: Page, name: string) {
  await page.evaluate(`document.querySelector('[data-drawer-toggle="${name}"]')?.click()`)
  await page.waitForTimeout(200)
  const after = await readShell(page)
  return after.drawers.find((d) => d.name === name) as ShellReading['drawers'][number]
}

/** 三个「＋」的可点区域 ≥ 24×24（口径 5 / 裁决 4：视觉上可以仍是小方块，点得到的范围不许小） */
function expectTapTargets(adds: ShellReading['adds']): void {
  for (const add of adds) {
    expect(add.w, 'the "' + add.what + '" plus is narrower than 24px').toBeGreaterThanOrEqual(24)
    expect(add.h, 'the "' + add.what + '" plus is shorter than 24px').toBeGreaterThanOrEqual(24)
  }
}

/**
 * ≥821px：四栏 + 标尺逐个对齐 + 中栏长滚动 + 两态的「＋」+ 三档字号（口径 1/2/3/5/6/7）。
 *
 * ⚠️ 票 69：这一条**自己会把左栏树上的一格点中**（在断完"点节点态三个＋"之后）——
 *    于是调用方紧接着拍的那张照片里，**中栏是那张字段表**，不是空态（S3 的条件 4）。
 *    两态都断到具体是哪一个＋（见下面那段注释）。
 */
async function expectWideShell(page: Page): Promise<void> {
  // ① 点节点态（还没选中任何一枝）：三路「＋」都在
  const before = await readShell(page)
  expect(before.branchMode, 'nothing is picked yet, so the editor is not in branch mode').toBe(false)
  expect(
    before.adds.map((a) => a.what).sort(),
    'picking a node: exactly the branch, action and step plus buttons',
  ).toEqual(['action', 'branch', 'step'])
  expectTapTargets(before.adds)

  // ② 点中左栏第一格（＝ 进编枝态）：这一态**要挡住"某一枝真的编不了"那种回归**
  const first = page.locator('[data-branch-node]').first()
  await expect(first, 'the left tree must show up before the mid table can have anything in it').toBeVisible({
    timeout: 15_000,
  })
  await first.click()

  const r = await readShell(page)
  const cols = r.cols.filter((c) => c.visible)
  expect(
    cols.map((c) => c.col),
    'four columns must be on screen at this width',
  ).toEqual(['content', 'flow', 'edit', 'prompts'])
  expect(cols[2].flex, 'the mid column must be a single column').toBe('column')

  // 口径 1：四段逐段相等（自适应那一段只断言"是弹性的"），栏间距 10px
  const tracks = (r.grid?.template ?? '').split(' ').filter(Boolean)
  expect(tracks.length, 'the shell must be a four-track grid').toBe(4)
  expect(tracks[0], 'the content column width').toBe('300px')
  expect(tracks[1], 'the workflow strip width').toBe('120px')
  expect(tracks[3], 'the prompts column width').toBe('290px')
  expect(Number.parseFloat(tracks[2]), 'the edit column must take the rest').toBeGreaterThan(0)
  expect(r.grid?.gap, 'the gap between columns').toBe('10px')

  // 口径 2：标尺四段与上面四栏逐个对齐（宽度与中心都对齐）
  expect(r.ruler?.segs.length, 'the ruler must have four segments').toBe(4)
  cols.forEach((col, i) => {
    const seg = (r.ruler?.segs ?? [])[i]
    expect(
      Math.abs((seg?.w ?? 0) - col.w),
      'ruler segment ' + i + ' is not as wide as its column',
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs((seg?.cx ?? 0) - col.cx),
      'ruler segment ' + i + ' does not line up with its column',
    ).toBeLessThanOrEqual(1)
  })

  // 口径 3：中栏塞得下长内容 —— 滚得动、且不横向溢出
  expect(r.mid, 'the mid column has no scroll body').not.toBeNull()
  expect(['auto', 'scroll'], 'the mid body must scroll').toContain(r.mid?.overflowY)
  const scroll = (await page.evaluate(MID_SCROLL_PROBE)) as {
    scrollHeight: number
    clientHeight: number
    scrollTop: number
    scrollWidth: number
    clientWidth: number
  } | null
  expect(scroll, 'the mid body could not be measured').not.toBeNull()
  expect(scroll?.scrollHeight ?? 0, 'the mid body must grow taller than its box').toBeGreaterThan(
    (scroll?.clientHeight ?? 0) + 1,
  )
  expect(scroll?.scrollTop ?? 0, 'the mid body must really scroll').toBeGreaterThan(0)
  expect(scroll?.scrollWidth ?? 0, 'the mid body must not scroll sideways').toBeLessThanOrEqual(
    (scroll?.clientWidth ?? 0) + 1,
  )

  // 口径 5 / 裁决 4：各路的「＋」都在屏幕上，可点区域 ≥ 24×24。
  //
  // ⚠️ 票 69 让这里**分两态**（S0 裁决 12：「编枝时那个 `add-action` 的 ＋ **隐藏**」）——
  //    原来那句 `toBe(3)` 是 8a 的口径（点节点编一步那一态），选中一枝之后屏上真的只剩 2 个。
  //    **没有放宽**：两态都断**点名到具体哪一个**（`toEqual` 逐项相等），
  //    所以"某一路的入口悄悄没了"照样红 —— 那正是 8a 这条判据的用意。
  //    "点节点态 3 个"在**上面点那一格之前**已经断过了（那才是它唯一能断到的时机）。
  expect(r.branchMode, 'the row was just clicked, so the editor must be in branch mode now').toBe(true)
  expect(
    r.adds.map((a) => a.what).sort(),
    'editing a branch: exactly the branch plus and the strip plus, and the action plus must be gone',
  ).toEqual(['branch', 'step'])
  expect(r.adds.length, 'a plus that is hidden must really leave the screen').toBe(2)
  expectTapTargets(r.adds)

  // 口径 6/7：外壳自己的文字只有三档（14 / 12.5 / 11），一档都不许少、更不许有第四档
  expect(r.fonts, 'the shell text must use the three scale tiers').toEqual(['11px', '12.5px', '14px'])
}

/** ≤820px 横屏：只剩中栏 + 两个抽屉默认关着（口径 8 / 裁决 5） */
async function expectLandscapeShell(page: Page): Promise<void> {
  const r = await readShell(page)
  expect(
    r.cols.filter((c) => c.visible).map((c) => c.col),
    'exactly one column may stay on screen in landscape',
  ).toEqual(['edit'])

  // 标尺压成一行文字也要在位（四段对齐那条判据只属于 ≥821px）
  expect(r.ruler !== null && r.ruler.display !== 'none', 'the ruler must stay in place').toBe(true)
  expect((r.ruler?.text ?? '').length, 'the ruler must still say what the widths are').toBeGreaterThan(0)

  // 两个抽屉默认关着，而且"关着"必须是 display:none —— 靠 transform 挪出屏会被探针记成伸出去的元素
  for (const d of r.drawers) {
    expect(d.present, 'the ' + d.name + ' drawer must exist').toBe(true)
    expect(d.visible, 'the ' + d.name + ' drawer must start closed').toBe(false)
    expect(d.display, 'a closed drawer must be display:none, not parked off screen').toBe('none')
    expect(d.expanded, 'the ' + d.name + ' toggle must say it is collapsed').toBe('false')
  }
  // 开 → 可见、宽 = 它本来的那一栏宽；再点 → 回到不可见
  const widths: Record<string, number> = { content: 300, prompts: 290 }
  for (const name of ['content', 'prompts']) {
    const open = await toggleDrawer(page, name)
    expect(open.visible, 'the ' + name + ' drawer must open').toBe(true)
    expect(open.display, 'an open drawer must be laid out').not.toBe('none')
    expect(
      Math.abs(open.w - widths[name]),
      'the ' + name + ' drawer keeps its column width',
    ).toBeLessThanOrEqual(1)
    const shut = await toggleDrawer(page, name)
    expect(shut.display, 'the ' + name + ' drawer must go back to display:none').toBe('none')
  }
  // ⚠️ 这里**不放**"可见的＋ ≥24×24"那一句 —— 它在横屏是**空断言**：
  //    横屏只剩中栏，左右两栏 `display:none`、细条也收成横带，而「编辑」栏那个 ＋ 又被
  //    裁决 12 在编枝时收起 ⇒ **屏幕上真一个「＋」都没有** ⇒ 传进去的是空数组、
  //    `for` 一次都不跑、**空着通过**。留着一句永远空跑的断言就是"静默失效的检查"。
  //    点按区那一条只在 **≥821px** 那档断（见 `expectWideShell`）；
  //    另外 `expectClean(probe)` 的 `smallTargets` 对**所有可见按钮**都查 ≥24×24，
  //    横屏这一屏不会漏 —— 所以删掉它**不减覆盖面**。
}

/**
 * ⚠️ **截图目录的清理不在这里** —— 它在 `e2e/visual-setup.ts`（`globalSetup`，且只在这一趟是整页巡检时清）。
 *    写在模块顶层的话：**一条用例失败 ⇒ worker 重启 ⇒ 模块重新加载 ⇒ 顶层清理再跑一次**
 *    ⇒ 目录里只剩"最后一次重启之后"写的那一段（票 69 实测：85 条只剩 20 张、分属 4 个状态）。
 *    **不是"worker 互相删"** —— 配置本来就是 `workers: 1`。见那个文件的头注释。
 */
test.describe('状态 × 屏幕', () => {
  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      // 横屏那一个新工位只跑编辑器那一屏：口径 8 要证的是一栏 + 抽屉能开关，
      // 别的状态在 800×400 下不归这一票验（裁决 6：不加第二个状态、也不铺满矩阵）
      if (vp.name === 'phone-landscape' && state.name !== EDITOR_STATE) continue
      test(`${state.name} @ ${vp.name}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: vp.dsf,
          isMobile: vp.mobile,
          hasTouch: vp.mobile,
          locale: state.seed.lang === 'en' ? 'en-US' : 'zh-CN',
          timezoneId: 'Asia/Shanghai',
          reducedMotion: 'reduce',
        })
        const page = await context.newPage()
        await openState(page, state)

        // 票 67/69：开着外壳的那一屏要先过它自己那几条（口径 1/2/3/5/6/7/8）——
        // ⚠️ **必须在截图之前**：宽屏那一条会在**先断完"点节点态三个＋"之后**点中左栏一枝，
        //    于是下面那张照片拍到的才是**有字段表的中栏**（票 69 S3 的条件 4）。
        if (state.name === EDITOR_STATE && SHELL_VIEWPORTS.has(vp.name)) {
          if (vp.width >= 821) await expectWideShell(page)
          else await expectLandscapeShell(page)
        }

        const probe = (await page.evaluate(PROBE)) as Probe
        const name = `${state.name}--${vp.name}`
        await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' })

        if (BASELINE.has(name)) {
          await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: false })
        }

        shots.push({
          state: state.name,
          viewport: vp.name,
          width: vp.width,
          height: vp.height,
          file: `${name}.png`,
          rows: probe.rows,
          traces: probe.traces,
          notice: probe.notice,
        })

        expectClean(probe)

        await context.close()
      })
    }
  }
})

test.afterAll(() => {
  const byState = new Map<string, Shot[]>()
  for (const shot of shots) {
    const list = byState.get(shot.state) ?? []
    list.push(shot)
    byState.set(shot.state, list)
  }
  const html = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>整页截图</title>',
    '<style>body{font:14px/1.6 system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:24px}',
    'h2{margin:28px 0 8px;font-size:15px;color:#9ad}section{display:flex;gap:16px;flex-wrap:wrap}',
    'figure{margin:0;background:#1c1c1c;border:1px solid #333;border-radius:8px;padding:8px;max-width:360px}',
    'img{width:100%;display:block;border-radius:4px;background:#000}figcaption{font-size:12px;color:#aaa;margin-top:6px}</style>',
    '</head><body><h1>整页截图</h1>',
    '<p>每个状态 × 每种屏幕。带 ⭐ 的另有像素基线（npm run visual 会自动比对）。</p>',
  ]
  for (const [state, list] of byState) {
    html.push(`<h2>${state}</h2><section>`)
    for (const shot of list) {
      const starred = BASELINE.has(`${shot.state}--${shot.viewport}`) ? ' ⭐' : ''
      html.push(
        `<figure><img src="${shot.file}" alt="${shot.file}"><figcaption>${shot.width}×${shot.height}（${shot.viewport}）${starred}<br>` +
          `故事行 ${shot.rows} · 调试行 ${shot.traces}${shot.notice ? ' · 状态行：' + shot.notice : ''}</figcaption></figure>`,
      )
    }
    html.push('</section>')
  }
  html.push('</body></html>')
  writeFileSync(`${OUT}/index.html`, html.join('\n'))
  writeFileSync(`${OUT}/report.json`, JSON.stringify(shots, null, 2))
})
