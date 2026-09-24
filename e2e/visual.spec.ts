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
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
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
  translate,
  writeEvent,
  type FakeMode,
} from './fixtures'
import { FONT_TIERS, PROBE, expectClean, type Probe } from './probe'
// 只读卡的 JSON：不 import 应用模块（那条链会拖进 i18n 的 .json，
// Playwright 的 ESM 加载器需要 import attribute，而 Vite 构建不需要）
import cardJson from '../cards/morningwind.json' with { type: 'json' }

/** 卡里声明的侧栏条目（哪一块放哪一边）—— 票 68 的期望值全部从卡现取，不在这里抄一份内容 */
const DECLARED = (cardJson as unknown as Record<string, any>).display.sidebar as Array<Record<string, string>>

const OUT = 'artifacts/screenshots'

/** 屏幕：mobile 决定 Chrome 用不用移动端视口规则；dsf 让手机图在被看时更清楚 */
const VIEWPORTS = [
  { name: 'phone', width: 360, height: 640, dsf: 2, mobile: true },
  { name: 'phone-lg', width: 430, height: 932, dsf: 2, mobile: true },
  { name: 'tablet', width: 768, height: 1024, dsf: 2, mobile: true },
  // 横屏手机：票 67（口径 8）新加的工位 —— 四栏最少要 750px（设计 §四.1 的算术），
  // 800px 下只剩 40px 给中栏 ⇒ 这一档量的不是"四栏"，是"一栏 + 抽屉"
  { name: 'phone-landscape', width: 800, height: 400, dsf: 2, mobile: true },
  // 票 74：窄横屏的**第二格**（480×320 ——「已经横过来的老手机」）。降级档的覆盖面从 1 格变 2 格。
  // ⚠️ 它是**可编辑档里最窄的承诺工位**：`max-width: 599px` 成立、`orientation: portrait` 不成立
  //    ⇒ 竖屏那道闸门**不该**把它关掉（`contract-74.md` §二 的 J10 就是钉这一件事）。
  { name: 'phone-landscape-sm', width: 480, height: 320, dsf: 2, mobile: true },
  // 票 69（S3 的条件 3）：窄笔记本 —— 落在设计点名的 **821–1279 死带**里。
  // 原来那套视口 {360, 430, 768, 800, 1280, 1920} **一档都不在这条带里** ⇒
  // "中栏被压成 35–193px"那条 follow-up 永远无法被证伪。这一档还跑 `expectClean`（横向溢出会红）。
  { name: 'laptop-sm', width: 1100, height: 800, dsf: 1, mobile: false },
  // 票 68（2026-09-24）：**老板点名的「最差承诺工位」—— 720p**（原话：「我们玩家用的最差最差
  // 也是个 720p 屏幕」）⇒ 玩家屏那两条栏**要认真守的就是这一格**。
  // ⚠️ **只加不换**：上面那八格是协作者定的口径，一个都不动（`npm run e2e` 用的 Desktop Chrome
  //    本来就是 1280×720 ⇒ 加这一格让整页巡检与冒烟量的是同一块屏幕）。
  { name: 'laptop-720', width: 1280, height: 720, dsf: 1, mobile: false },
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
/** 外壳只在口径说得清的那几个视口上量：≥821px 量四栏（口径 1–7），800×400 与 480×320 量降级（口径 8） */
const SHELL_VIEWPORTS = new Set(['laptop', 'desktop', 'phone-landscape', 'phone-landscape-sm'])

/** 只跑编辑器那一屏的横屏工位（别的状态在这两档不归任何票验） */
const LANDSCAPE_ONLY = new Set(['phone-landscape', 'phone-landscape-sm'])

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
    // 票 68（2026-09-24）：这个状态原来点的是右上角那颗 `button[data-world]` —— 那颗按钮
    // **本票撤了**（老板：「都常驻了，就不用展开按钮了」）⇒ `?.click()` 会**静默变成空动作**，
    // 状态名开始说谎。**状态本身不删**（`STATES` 是协作者定的口径），改成"世界那几块现在常驻"
    // ⇒ 它与 `playing-zh` 拍的是同一屏（没有交互步骤了，这一行留在这里说明为什么）。
    name: 'world-open',
    seed: { config: CONFIG, save: saveWith({ events: STORY }) },
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
 * 中栏是不是真的能长滚动（口径 3）：塞两块东西进去再量，量完就撤。
 *
 * jsdom 没有布局，这一条只有在真浏览器里才量得到：`scrollHeight > clientHeight`（滚得动）。
 *
 * ⚠️ **票 71 的 ⑧②**：原来只塞一块**高**的（`height:3000px`、宽 `auto`）——
 *    宽 `auto` 的块级盒子**永远不会把容器撑宽** ⇒ 跟着那句 `scrollWidth <= clientWidth`
 *    **咬不到注入物**（空断言：删掉 `[data-mid]` 的横向裁剪它也不会红）。
 *    现在塞两块：一块高的（量滚得动）+ 一块**固定宽 3000px** 的（量"宽东西进来会怎么样"）。
 *    断言也跟着换成两条**有对象**的：`[data-mid]` 必须横着**裁掉**（`overflow-x: hidden`），
 *    而且那块宽的进来之后**页面也不许被撑横**。原来那句 `scrollWidth <= clientWidth` **删掉** ——
 *    注入物有宽度之后它必然红，留着就是一条永久红的判据。
 */
const MID_SCROLL_PROBE = `(() => {
  const mid = document.querySelector('[data-mid]')
  if (!mid) return null
  const tall = document.createElement('div')
  tall.style.height = '3000px'
  tall.style.flex = 'none'
  const wide = document.createElement('div')
  wide.style.width = '3000px'
  wide.style.flex = 'none'
  const probe = document.createElement('div')
  probe.style.flex = 'none'
  probe.appendChild(tall)
  probe.appendChild(wide)
  mid.appendChild(probe)
  mid.scrollTop = 99999
  const out = {
    scrollHeight: mid.scrollHeight,
    clientHeight: mid.clientHeight,
    scrollTop: mid.scrollTop,
    scrollWidth: mid.scrollWidth,
    clientWidth: mid.clientWidth,
    overflowY: getComputedStyle(mid).overflowY,
    overflowX: getComputedStyle(mid).overflowX,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
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
 * 中栏到底有多宽 —— **票 71 的 ④：防劣化基线，不是设计意图**。
 *
 * 这三个数是组长用**活 DOM**（`npx vite preview` 服已有的 `dist/` + Chromium 直连）量出来的
 * （`.tools/leader71-measure.log`），量的是**栅格第三条轨**（`[data-col="edit"]`）：
 * `1100 → 218` · `1280 → 478` · `1920 → 638`。
 * ⚠️ 我先前从 PNG 像素反推的是 220 / 480 / 640（每条高 2px —— 面板边缘那一个像素的差），
 *    **以活 DOM 为准**：按 220 断会在 1100 当场红。
 * ⚠️ **它们不是"应该这么宽"** —— 那张字段表**五列排成一行**需要的中栏宽度是 **408px**（设计口径），
 *    而 821–1279 那条死带今天只有 37–218px（`980` 这个上限正好等于 `1004 − 24`）；1100 那档
 *    **每一行折成两行**（行高 49 而不是 24）、1280 一步跳 260px。改布局是**布局票**的事；
 *    本票（票 71）连 `src/` 一个字节都不许动。⇒ 这组数只干一件事：**谁把宽度档改窄，当场红**。
 * ⚠️ **成因**：`SHELL_VIEWPORTS`（:56）从来**没有** `laptop-sm` ⇒ 这一档一直没有过活 DOM 读数，
 *    只能从照片反推（所以才反推出两个数）。这一条判据把 1100 纳进"读外壳"那条线，
 *    但**不**把它塞进 `SHELL_VIEWPORTS` —— 那一套里有一句"中栏必须长得比框高"（口径 3 的长滚动），
 *    而 1100×800 下那张表根本不够高（5 行 × 49 + 表头 ≈ 320px，中栏有 ≈600px）⇒ 塞进去会**为别的原因红**。
 */
const MID_WIDTH_FLOOR: Record<string, number> = {
  'laptop-sm': 218,
  laptop: 478,
  desktop: 638,
}

/**
 * 四栏那几段到底多宽（口径 1 的数值面）—— 票 71 让 `laptop-sm`（1100，死带）也走这一条。
 *
 * 断的与 `expectWideShell` 的 ① 同一组东西（四轨、两端的固定宽、中栏弹性），
 * **但不带**那一套里的长滚动 / 字号 / 点按区 —— 那些在 1100 上没有对象（见上面那段）。
 */
async function expectShellWidths(page: Page, name: string): Promise<void> {
  const floor = MID_WIDTH_FLOOR[name]
  if (floor === undefined) return
  const r = await readShell(page)
  const cols = r.cols.filter((c) => c.visible)
  expect(
    cols.map((c) => c.col),
    'the shell must still be four columns at this width',
  ).toEqual(['content', 'flow', 'edit', 'prompts'])
  // J12（票 74）：两颗抽屉开关属于 ≤820 那条横带 —— ≥821 这一档**一颗都不许看见**。
  // 它们的默认态本来就是 `display: none`（只在 ≤820 的分支里现形）⇒ 这是条**守卫**，
  // 挡的是"为了窄档把它们挪出来、顺手在宽屏也露了脸"。
  const toggles = page.locator('[data-drawer-toggle]')
  await expect(toggles, 'one toggle per drawer panel, both of them in the DOM').toHaveCount(2)
  await expect(toggles.nth(0), 'a drawer toggle must not show up on a wide screen').toBeHidden()
  await expect(toggles.nth(1), 'a drawer toggle must not show up on a wide screen').toBeHidden()
  const tracks = (r.grid?.template ?? '').split(' ').filter(Boolean)
  expect(tracks.length, 'the shell must be a four-track grid').toBe(4)
  expect(tracks[0], 'the content column width').toBe('300px')
  expect(tracks[1], 'the workflow strip width').toBe('120px')
  expect(tracks[3], 'the prompts column width').toBe('290px')
  const mid = r.cols.find((c) => c.col === 'edit')
  expect(mid?.visible, 'the mid column is off screen, so its width says nothing').toBe(true)
  expect(
    Math.round(mid?.w ?? 0),
    'the mid track shrank below the floor pinned in contract-71 (see MID_WIDTH_FLOOR)',
  ).toBeGreaterThanOrEqual(floor)
}

/**
 * 点中左栏第一格（＝ 让中栏从空态变成那张字段表）。
 *
 * ⚠️ **抽出来是因为有两条路都要它**：
 *   ① `expectWideShell` 在断完"点节点态三个＋"之后点（顺序不能反 —— 那一态只在点之前断得到）；
 *   ② 跑不了那套断言的 **≥821px** 工位（今天只有 `laptop-sm`）也得点：不然它的照片里中栏永远是
 *      空态，而加这一档的理由正是"**中栏那张表要有照片**"（票 69 S3 的条件 4）。
 */
async function pickFirstBranch(page: Page): Promise<void> {
  const first = page.locator('[data-branch-node]').first()
  await expect(first, 'the left tree must show up before the mid table can have anything in it').toBeVisible({
    timeout: 15_000,
  })
  await first.click()
}

/**
 * 编辑器那一屏：除了跑外壳断言的那几档，**还有哪些工位要在截图前补"点中一格"**。
 *
 * 今天是 `laptop-sm`（1100×800）—— 它落在设计点名的 **821–1279 死带**里，但不跑 `expectWideShell`
 * （那会把整套宽屏断言顺带跑一遍，超出本票范围）。⇒ 它只借"点一格"这一步，
 * 让那张照片拍到**挤在窄档里的字段表**，而不是空态。
 *
 * ⚠️ **<821px 那一族不点树**：那里左栏是**收起来的抽屉**（口径 8），树根本不在屏幕上 ——
 *    点了也拍不到表。⚠️ 但横屏那一档**点细条那一步**了（票 73 · 段 8c-① · 裁决 9：
 *    `expectLandscapeShell` 末尾确认中栏跟着换）⇒ 那张照片是「**选中一步之后**」的观感，
 *    不再是票 69 那个「没选中」的。
 */
function shootsPickedViewport(vp: { name: string; width: number }): boolean {
  return vp.width >= 821 && !SHELL_VIEWPORTS.has(vp.name)
}

/**
 * ≥821px：四栏 + 标尺逐个对齐 + 中栏长滚动 + 两态的「＋」+ 三档字号（口径 1/2/3/5/6/7）。
 *
 * ⚠️ 票 69：这一条**自己会把左栏树上的一格点中**（在断完"点节点态三个＋"之后）——
 *    于是调用方紧接着拍的那张照片里，**中栏是那张字段表**，不是空态（S3 的条件 4）。
 *    两态都断到具体是哪一个＋（见下面那段注释）。
 */
async function expectWideShell(page: Page, name: string): Promise<void> {
  // ④（票 71）：这一档的四栏宽度不许低于活 DOM 量到的基线 —— 这一句在下面点那一格**之前**
  await expectShellWidths(page, name)
  // ① 点节点态（还没选中任何一枝）：三路「＋」都在
  const before = await readShell(page)
  expect(before.branchMode, 'nothing is picked yet, so the editor is not in branch mode').toBe(false)
  expect(
    before.adds.map((a) => a.what).sort(),
    'picking a node: exactly the branch, action and step plus buttons',
  ).toEqual(['action', 'branch', 'step'])
  expectTapTargets(before.adds)

  // ② 点中左栏第一格（＝ 进编枝态）：这一态**要挡住"某一枝真的编不了"那种回归**
  await pickFirstBranch(page)

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
    overflowX: string
    pageOverflow: number
  } | null
  expect(scroll, 'the mid body could not be measured').not.toBeNull()
  expect(scroll?.scrollHeight ?? 0, 'the mid body must grow taller than its box').toBeGreaterThan(
    (scroll?.clientHeight ?? 0) + 1,
  )
  expect(scroll?.scrollTop ?? 0, 'the mid body must really scroll').toBeGreaterThan(0)
  // ⑧②（票 71）：一块**固定宽 3000px** 的东西进来之后 —— 中栏必须横着**裁掉**（不是横着滚），
  // 而且页面也不许被撑横。⚠️ 原来那句 `scrollWidth <= clientWidth` 是空断言（注入物宽 `auto`），
  // **已删**：注入物有宽度之后它必然红，留着就是一条永久红的判据。
  expect(scroll?.overflowX, 'the mid body must clip sideways, not scroll sideways').toBe('hidden')
  expect(
    scroll?.pageOverflow ?? 1,
    'a wide child inside the mid column must not push the page sideways',
  ).toBeLessThanOrEqual(1)

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

  // 口径 6/7：外壳自己的文字只有三档（14 / 12.5 / 11），一档都不许少、更不许有第四档。
  // ⚠️ 三档那一串住 `probe.ts` 的 `FONT_TIERS`（阈值只写一份）；这一屏**照不到 `<option>`**
  //    （它从不按「＋」）—— 那一条由组件故事那一层守，见 `probe.ts` 的 `expectTierFonts`。
  expect(r.fonts, 'the shell text must use the three scale tiers').toEqual(FONT_TIERS)
}

/** ≤820px 横屏：只剩中栏 + 两个抽屉默认关着（口径 8 / 裁决 5） */
async function expectLandscapeShell(page: Page): Promise<void> {
  const r = await readShell(page)
  expect(
    r.cols.filter((c) => c.visible).map((c) => c.col),
    'exactly one column may stay on screen in landscape',
  ).toEqual(['edit'])

  // ② （票 71）：细条 120 收成**顶栏下那条横带** —— 上一句已经断出细条那一栏不在了，
  //    这一句断"它换了个形态**还在屏上**"，两句合起来才是裁决 5 的那一条降级。
  //    ⚠️ 那一块**没有 `data-*` 钩子**（`EditorShell.vue:128-137` 只有一个 `.band` 类），
  //    而本票不许动 `src/` ⇒ 只能按类选。它在 DOM 里**永远存在**（宽屏由媒体查询 `display:none` 藏起来），
  //    所以"在屏上"这件事只有这一层量得到 —— jsdom 那条（`tests/editor-shell-dom.test.ts` 的 S10）
  //    断的是它的内容与交互，断不了可见性。
  const band = page.locator('.band')
  await expect(band, 'the strip is gone in landscape, so the band must be there instead').toBeVisible()
  //    ⚠️ 横带那几颗按钮**没有 `data-*` 钩子**（`EditorShell.vue` 只有一个 `.band` 类），
  //    按结构认：头一颗是开合器，后面几颗按顺序是卡里那几步。
  //    ⚠️ 票 74 的重钉（T1）：横带里多了两颗 `[data-drawer-toggle]`（A 形态把面板开关搬进来），
  //    所以"数出来几个"一律把它们**排除在外** —— 数出来仍是「开合器 + 卡里那几步」。
  //    **一条断言都没减**，减的只是数数时混进来的东西。
  const bandButtons = () => band.locator('button:not([data-drawer-toggle])')
  //    ⚠️ 这一句**断的就是它说的那件事**：开合器报的是**当前那一步**。此刻还没选任何一步，
  //    所以它报的必须是那句"还没选"—— 文案从**应用自己的 i18n 表**取（`translate`），不在这里抄一份。
  await expect(
    bandButtons().first(),
    'nothing is picked yet, so the band must say so on its pager',
  ).toHaveText(await translate(page, 'card.stepNone'))

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

  // ③（票 73 · 8c-① · S0 裁决 9 的两条判据）：横屏下细条整栏 `display:none`，
  //    **横带是换步的唯一入口** ⇒ 从它选一步，横带要报出那一步、中栏要真的换成那一屏。
  //    ⚠️ 顺序：放在最后 —— 它换掉了中栏的内容，而上面那几条（抽屉、标尺）都与中栏无关。
  //    ⚠️ 数数走上面那个 `bandButtons()`（它把两颗抽屉开关排除在外）。选中的名字从**按钮自己的
  //    文字**取，不在这里抄一份卡。
  await bandButtons().first().click()
  const listed = bandButtons()
  await expect(listed, 'opening the band must list every step of the card').not.toHaveCount(1)
  const want = ((await listed.nth(1).textContent()) ?? '').trim()
  expect(want.length, 'the band hands out a step without a name').toBeGreaterThan(0)
  await listed.nth(1).click()
  await expect(band.locator('button').first(), 'the band must name the step that is current').toHaveText(want)
  await expect(
    page.locator('[data-step-form]'),
    'the band is the only entry in landscape: the mid column must follow it',
  ).toBeVisible()
  await expect(page.locator('[data-step-node]')).toHaveAttribute('data-step-node', /.+/)
  // ③（票 73 · 8c-② · S3 的 F-2）：横屏这一档原本**没断"细条那一轴亮着"**（只有冒烟那条断了）
  //    ⇒ 从横带选一步之后，亮着的那一项**恰好一个**（亮两处 = 两条轴又同时亮）。
  await expect(
    page.locator('[data-step-on]'),
    'picking from the band must light exactly one step of the strip',
  ).toHaveCount(1)
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
      // 横屏那两个工位只跑编辑器那一屏：口径 8 要证的是一栏 + 抽屉能开关，
      // 别的状态在 800×400 / 480×320 下不归任何票验（裁决 6：不加第二个状态、也不铺满矩阵）
      if (LANDSCAPE_ONLY.has(vp.name) && state.name !== EDITOR_STATE) continue
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
        if (state.name === EDITOR_STATE) {
          if (SHELL_VIEWPORTS.has(vp.name)) {
            if (vp.width >= 821) await expectWideShell(page, vp.name)
            else await expectLandscapeShell(page)
          } else if (shootsPickedViewport(vp)) {
            // 票 70：不跑外壳断言、但树在屏幕上的那一档（`laptop-sm`＝821–1279 死带）——
            // 不补这一步，它的照片永远是空态，而加这一档的理由正是"中栏那张表要有照片"。
            await pickFirstBranch(page)
            // 票 71 的 ④：这一档正是死带 —— 把活 DOM 量到的四栏宽度**钉成防劣化基线**
            // （`MID_WIDTH_FLOOR`；此前这一档从来没量过外壳，只能从照片反推）
            await expectShellWidths(page, vp.name)
            // …而且**顺手把它断下来**：这一步的全部目的就是"照片里中栏是表"，
            // 少了这一句，表整条不在时也只有人眼看得出来（这一处正是这么被发现的）。
            await expect(
              page.locator('[data-branch-form] [data-field-row]').first(),
              'the mid column must show the field table, not the empty state',
            ).toBeVisible()
          }
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

/* ==================== 票 74 · 窄屏那三件（J1–J15）====================
 *
 * 契约 `.team/test/2026-09-24/contract-74.md`；设计 `.team/design/2026-09-24/票74-窄档形态.md`；
 * 定形 `.team/leader/2026-09-24/票74-S0.md`（**§九 订正过 §二 的工位表**）。
 *
 * 两条形状上的要点：
 *   · **闸门（竖屏不给编辑）是活媒体查询** ⇒ 旋转那些判据写成**一条用例里的 `setViewportSize`**：
 *     不刷新、不重开浮层。这一条同时证明"它不是开屏算一次"。
 *   · **语言要能单独钉**：en 那一列的按钮比 zh 宽（`Prompt resources` 一颗 123.11px），
 *     窄档的账全压在它身上 —— 而本文件原来那些窄档工位**只跑 zh**（`locale` 没设成 en），
 *     ⇒ 那条路从来没被扫过。契约 §四 有那一列读数。
 */

/** 窄档的工位：语言单独钉（`en` 是最宽的那一列） */
interface NarrowStation {
  width: number
  height: number
  lang: string
}

/** 顶栏那一组格子：三个工位 × 两种语言（zh 是反面控制 —— 它今天就在框内） */
const NARROW_TOP_STATIONS: NarrowStation[] = [
  { width: 360, height: 640, lang: 'en' },
  { width: 360, height: 640, lang: 'zh-CN' },
  { width: 430, height: 932, lang: 'en' },
  { width: 430, height: 932, lang: 'zh-CN' },
  { width: 480, height: 320, lang: 'en' },
  { width: 480, height: 320, lang: 'zh-CN' },
]

/** 窄档那一屏的读数（J1–J15 吃这一份） */
interface NarrowReading {
  id: { w: number; h: number; visible: boolean } | null
  name: { sw: number; cw: number } | null
  close: { right: number; visible: boolean } | null
  card: { right: number } | null
  rotate: { visible: boolean; text: string } | null
  visibleButtons: number
  visibleControls: number
  shell: boolean | null
  mid: boolean | null
  band: { visible: boolean; clientH: number } | null
  ruler: boolean | null
  save: boolean | null
  resources: boolean | null
  toggles: Array<{ name: string | null; inBand: boolean; visible: boolean }>
  drawers: Array<{ name: string | null; display: string; visible: boolean }>
  cols: Array<string | null>
}

/**
 * 窄档读数：顶栏 / 闸门 / 横带 / 抽屉一次取齐。
 *
 * ⚠️ 可见性一律用"有没有矩形"（宽高都 > 0.5），不读 `display` —— `display:none` 的元素矩形是 0，
 *    而"被别的规则顶掉"与"根本没渲染"在这一层是同一件事。
 * ⚠️ 这一段在**模板字符串**里：注释里别写反引号 + 美元花括号，那会被当成插值求值（踩过一次）。
 */
const NARROW_PROBE = `(() => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, right: r.right, visible: r.width > 0.5 && r.height > 0.5 }
  }
  const vis = (sel) => { const el = document.querySelector(sel); return el ? box(el).visible : null }
  const editor = document.querySelector('[data-card-editor]')
  const band = document.querySelector('.band')
  const rotate = document.querySelector('[data-rotate]')
  const name = document.querySelector('.top-name')
  const buttons = editor ? [...editor.querySelectorAll('button')] : []
  const controls = editor ? [...editor.querySelectorAll('input, textarea, select, [contenteditable]')] : []
  return {
    id: box(document.querySelector('.top-id')),
    name: name ? { sw: name.scrollWidth, cw: name.clientWidth } : null,
    close: box(document.querySelector('[data-card-close]')),
    card: box(document.querySelector('[data-card-editor] > div')),
    rotate: rotate ? { visible: box(rotate).visible, text: (rotate.textContent || '').trim() } : null,
    visibleButtons: buttons.filter((el) => box(el).visible).length,
    visibleControls: controls.filter((el) => box(el).visible).length,
    shell: vis('[data-shell]'),
    mid: vis('[data-mid]'),
    band: band ? { visible: box(band).visible, clientH: band.clientHeight } : null,
    ruler: vis('[data-ruler]'),
    save: vis('[data-card-save]'),
    resources: vis('[data-card-resources-open]'),
    toggles: [...document.querySelectorAll('[data-drawer-toggle]')].map((el) => ({
      name: el.getAttribute('data-drawer-toggle'),
      inBand: el.closest('.band') !== null,
      ...box(el),
    })),
    drawers: [...document.querySelectorAll('[data-drawer]')].map((el) => ({
      name: el.getAttribute('data-drawer'),
      display: getComputedStyle(el).display,
      ...box(el),
    })),
    cols: [...document.querySelectorAll('[data-col]')].filter((el) => box(el).visible).map((el) => el.getAttribute('data-col')),
  }
})()`

/** 读一屏窄档读数 */
async function readNarrow(page: Page): Promise<NarrowReading> {
  return (await page.evaluate(NARROW_PROBE)) as NarrowReading
}

/** 按工位建一个自己的 context（语言与方向都要能单独钉），并把编辑器浮层打开 */
async function openEditorAt(
  browser: Browser,
  one: NarrowStation,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: one.width, height: one.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: one.lang === 'en' ? 'en-US' : 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await seedStorage(page, {
    'tavernGame.lang': one.lang,
    'tavernGame.theme': null,
    'tavernGame.debug': null,
    'tavernGame.config': CONFIG,
    'tavernGame.save': saveWith({ events: STORY }),
  })
  await page.goto(APP_PATH)
  await expect(page.locator('#app > *')).toHaveCount(1)
  await page.waitForTimeout(600)
  await page.evaluate(`(async () => {
    document.querySelector('button[data-settings]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 200))
    document.querySelector('button[data-card-view]')?.click()
  })()`)
  await page.waitForTimeout(900)
  return { context, page }
}

/** 转屏幕：等媒体查询与栅格都落定再读（`setViewportSize` 是异步的） */
async function turnTo(page: Page, width: number, height: number): Promise<NarrowReading> {
  await page.setViewportSize({ width, height })
  await page.waitForTimeout(350)
  return readNarrow(page)
}

for (const station of [
  { width: 360, height: 640 },
  { width: 430, height: 932 },
]) {
  test(`J1/J2/J5/J6/J7 the rotate gate @ ${station.width}x${station.height}`, async ({ browser }) => {
    const { context, page } = await openEditorAt(browser, { ...station, lang: 'zh-CN' })
    try {
      const title = await translate(page, 'card.rotateTitle')
      const body = await translate(page, 'card.rotateBody')
      const r = await readNarrow(page)
      // J5 —— 闸门真的生效：提示块在，而且说的就是 i18n 表里那两句
      expect.soft(r.rotate, 'the notice must be in the DOM even while it is hidden (no v-if)').not.toBeNull()
      expect.soft(r.rotate?.visible, 'narrow AND portrait: the gate must be up').toBe(true)
      expect.soft(r.rotate?.text ?? '', 'the notice must spell the title').toContain(title)
      expect.soft(r.rotate?.text ?? '', 'the notice must spell the body').toContain(body)
      // J1/J2 —— 身份块的地板（这一屏的满足者是闸门形态，不是顶栏改造）
      expect.soft(r.id, 'the top bar has no identity block').not.toBeNull()
      expect
        .soft(Math.round(r.id?.w ?? 0), 'the identity block is narrower than the 96px floor')
        .toBeGreaterThanOrEqual(96)
      // J6 —— 这一屏不给编辑
      expect
        .soft(
          [r.shell, r.mid, r.band?.visible ?? null, r.ruler, r.save, r.resources],
          'the gate must take the shell, the band, the ruler and the save/resources buttons away',
        )
        .toEqual([false, false, false, false, false, false])
      expect
        .soft(
          r.toggles.map((t) => t.visible),
          'the drawer toggles live in the band, so the gate takes them away too',
        )
        .toEqual([false, false])
      expect.soft(r.visibleControls, 'the gate screen must offer zero editable controls').toBe(0)
      expect.soft(r.cols, 'the gate screen must not keep a single column').toEqual([])
      // J7 —— 出路：这一屏只剩一颗按钮，而它就是 ✕（不给编辑 ≠ 把人关在里面）
      expect.soft(r.visibleButtons, 'the gate screen must leave exactly one button: the close one').toBe(1)
      expect.soft(r.close?.visible, 'the close button must be the one that is left').toBe(true)
      await page.evaluate(`document.querySelector('[data-card-close]')?.click()`)
      await page.waitForTimeout(400)
      await expect
        .soft(page.locator('[data-card-editor]'), 'the close button must really get you out of the gate')
        .toHaveCount(0)
    } finally {
      await context.close()
    }
  })
}

for (const one of NARROW_TOP_STATIONS) {
  test(`J3 the identity block and the close button @ ${one.width}x${one.height} ${one.lang}`, async ({
    browser,
  }) => {
    const { context, page } = await openEditorAt(browser, one)
    try {
      const r = await readNarrow(page)
      expect.soft(r.id, 'the top bar has no identity block').not.toBeNull()
      expect
        .soft(Math.round(r.id?.w ?? 0), 'the identity block is narrower than the 96px floor')
        .toBeGreaterThanOrEqual(96)
      expect.soft(r.close?.visible, 'the close button must stay visible').toBe(true)
      expect.soft(r.card, 'the card box could not be measured').not.toBeNull()
      expect
        .soft(
          Math.round(((r.card?.right ?? 0) - (r.close?.right ?? 0)) * 100) / 100,
          'the close button must stay inside the card instead of being pushed off it',
        )
        .toBeGreaterThanOrEqual(1)
    } finally {
      await context.close()
    }
  })
}

test('J4 a 320x240 window must not swallow the title', async ({ browser }) => {
  const { context, page } = await openEditorAt(browser, { width: 360, height: 640, lang: 'en' })
  try {
    const r = await turnTo(page, 320, 240)
    expect.soft(r.id, 'the top bar has no identity block').not.toBeNull()
    expect
      .soft(Math.round(r.id?.w ?? 0), 'the identity block must not be squeezed away to nothing')
      .toBeGreaterThan(0)
    expect.soft(r.name?.cw ?? 0, 'the title has no box to sit in').toBeGreaterThan(0)
    expect
      .soft(r.name?.sw ?? 0, 'the title is clipped sideways instead of being shown whole')
      .toBeLessThanOrEqual((r.name?.cw ?? 0) + 1)
  } finally {
    await context.close()
  }
})

test('J8/J9/J10/J11/J13/J15 one phone that turns: the gate is a live media query', async ({ browser }) => {
  const { context, page } = await openEditorAt(browser, { width: 360, height: 640, lang: 'zh-CN' })
  try {
    // J9 正：599 还是"窄且竖"
    const at599 = await turnTo(page, 599, 900)
    expect.soft(at599.rotate?.visible, '599x900 is narrow AND portrait: the gate must be up').toBe(true)
    // J9 反：600 就不再窄了 —— 这就是"600"这个数的牙
    const at600 = await turnTo(page, 600, 900)
    expect.soft(at600.rotate, 'the notice must stay in the DOM (no v-if), only hidden').not.toBeNull()
    expect.soft(at600.rotate?.visible, '600x900 is not narrow any more: the gate must be down').toBe(false)
    expect.soft(at600.cols, 'wide enough to edit again').toEqual(['edit'])
    // J10 反：窄但横着 ⇒ 可编（闸门看的是"窄且竖"，不是"窄"）
    const landscape = await turnTo(page, 480, 320)
    expect.soft(landscape.rotate, 'the notice must stay in the DOM (no v-if), only hidden').not.toBeNull()
    expect
      .soft(landscape.rotate?.visible, '480x320 is already sideways: the notice would contradict itself')
      .toBe(false)
    expect.soft(landscape.cols, 'a narrow landscape window must stay editable').toEqual(['edit'])
    // J11：两颗开关住在横带里，点一下开、再点一下关
    expect
      .soft(
        landscape.toggles.map((t) => t.inBand),
        'both drawer toggles must live inside the band',
      )
      .toEqual([true, true])
    expect
      .soft(
        landscape.toggles.map((t) => t.visible),
        'both drawer toggles must be visible in landscape',
      )
      .toEqual([true, true])
    const widths: Record<string, number> = { content: 300, prompts: 290 }
    for (const t of landscape.toggles) {
      const name = t.name ?? ''
      const opened = await toggleDrawer(page, name)
      expect.soft(opened.visible, 'the ' + name + ' drawer must open from its band toggle').toBe(true)
      expect
        .soft(Math.abs(opened.w - widths[name]), 'the ' + name + ' drawer keeps its column width')
        .toBeLessThanOrEqual(1)
      const shut = await toggleDrawer(page, name)
      expect.soft(shut.display, 'the ' + name + ' drawer must go back to display:none').toBe('none')
    }
    // J13：横带仍然是一行 —— 两颗开关不许把它顶成两行
    const banded = await readNarrow(page)
    expect.soft(banded.band?.visible, 'the band must be on screen at this width').toBe(true)
    expect
      .soft(banded.band?.clientH ?? 99, 'the band grew to two lines: the two extra toggles do not fit')
      .toBeLessThanOrEqual(40)
    // J8 反：同一台手机转过来就能编（不刷新、不重开浮层）
    const turned = await turnTo(page, 640, 360)
    expect.soft(turned.rotate, 'the notice must stay in the DOM (no v-if), only hidden').not.toBeNull()
    expect.soft(turned.rotate?.visible, 'turned sideways: the notice must go away').toBe(false)
    expect.soft(turned.cols, 'turned sideways: exactly the mid column is editable').toEqual(['edit'])
    expect.soft(turned.band?.visible, 'turned sideways: the band replaces the strip').toBe(true)
    const band = page.locator('.band')
    const bandButtons = () => band.locator('button:not([data-drawer-toggle])')
    await bandButtons().first().click()
    await expect.soft(bandButtons(), 'opening the band must list every step of the card').not.toHaveCount(1)
    await bandButtons().nth(1).click()
    await expect
      .soft(
        page.locator('[data-step-form]'),
        'the band is the only entry here: the mid column must follow it',
      )
      .toBeVisible()
    // J15 反：抽屉先开着，再转回竖屏 —— 闸门必须压得住 <=820 那句 .is-open
    const reopened = await toggleDrawer(page, 'content')
    expect.soft(reopened.visible, 'the content drawer must open while still sideways').toBe(true)
    const back = await turnTo(page, 360, 640)
    expect
      .soft(
        back.drawers.map((d) => d.visible),
        'the gate must hide both drawers, including the one that was open',
      )
      .toEqual([false, false])
  } finally {
    await context.close()
  }
})

/* ==================== 票 68 · 玩家屏的两条栏与竖屏闸门（P / G / H）====================
 *
 * 契约 `.team/test/2026-09-24/contract-68.md` §三（三档形状）· §五.3（P/G/H）· §七（闸门）。
 * 口径源 `.team/leader/2026-09-24/票68-S0.md` 的八项 + 老板 2026-09-24 的三条：
 * 「最差最差也是个 720p 屏幕」·「以后肯定要让用户拖拽改变左右栏宽度」·「手机上一律强制横屏」。
 *
 * 🔴 **这是 S1 的红判据**：S2 落地之前一个 `[data-side]` 都不在（今天那是 `v-if="worldOpen"` 的抽屉）。
 * ⚠️ **三档的"档位"只有真浏览器量得到**（jsdom 没有布局）⇒ 结构那一半在
 *    `tests/display-side-dom.test.ts`；这一节断的是**几何关系**与**闸门**。
 * ⚠️ 🔴 **判据不许钉栏宽**（老板：「以后咱们肯定要让用户拖拽改变左右栏宽度的，现在都是过渡版本」）
 *    ⇒ 只断三样：**两条栏在 + 块归属对 + 正文不低于地板**。
 * ⚠️ **`≤820` 那几档是过渡形态**（老板：「不用太纠结低分辨率屏幕的显示效果」）⇒ 那一档只断结构、
 *    不溢出、闸门与地板，**不钉具体高度/宽度**。
 * ⚠️ 序列里的断言一律 `expect.soft`（票 74 的返工教训：硬断言撞到第一条就停 ⇒ 后面几条**一次都没被评到**）；
 *    每条用例开头那条**守卫**是硬的（前置条件不成立就不该往下读）。
 */

/** 正文那一行的硬地板（设计 v5：`--story-min = 120px`，`120 − 32 ≈ 3` 行正文） */
const STORY_FLOOR = 120
/** 两栏档的行宽地板：实测 68ch = 498px（`leader68-probe4.log` 每档第 ③ 行，与浏览器解出的值差 0px） */
const STORY_WIDTH_FLOOR = 498

/** 一个盒子（四边 + 可见性；可见 = 有矩形） */
interface PlayerBox {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
  visible: boolean
}

/** 玩家屏那一屏的读数（P/G/H 吃这一份） */
interface PlayerReading {
  columns: Array<PlayerBox & { side: string | null }>
  blocks: Array<{ path: string | null; side: string | null }>
  story: PlayerBox | null
  rotate: { visible: boolean; text: string } | null
  composer: boolean | null
  drawer: { panel: boolean; toggle: boolean; close: boolean }
}

/**
 * 玩家屏读数：两条栏 / 每块落哪一栏 / 正文那一列 / 闸门那一块 / 输入框 / 抽屉的三个钩子。
 *
 * ⚠️ **可见性一律用"有没有矩形"**（宽高都 > 0.5），不读 `display` —— `display:none` 的元素
 *    矩形是 0，而"被别的规则顶掉"与"根本没渲染"在这一层是同一件事。
 * ⚠️ 这一段在**模板字符串**里：注释里别写反引号 + 美元花括号，那会被当成插值求值（踩过一次）。
 */
const PLAYER_PROBE = `(() => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const round = (n) => Math.round(n * 100) / 100
    return {
      left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom),
      width: round(r.width), height: round(r.height),
      visible: r.width > 0.5 && r.height > 0.5,
    }
  }
  const sideOf = (el) => {
    const column = el.closest('[data-side]')
    return column ? column.getAttribute('data-side') : null
  }
  const rotate = document.querySelector('[data-play-rotate]')
  const composer = document.querySelector('.composer-row')
  return {
    columns: [...document.querySelectorAll('[data-side]')].map((el) => ({
      side: el.getAttribute('data-side'),
      ...box(el),
    })),
    blocks: [...document.querySelectorAll('[data-block]')].map((el) => ({
      path: el.getAttribute('data-block'),
      side: sideOf(el),
    })),
    story: box(document.querySelector('[data-story]')),
    rotate: rotate ? { visible: box(rotate).visible, text: (rotate.textContent || '').trim() } : null,
    composer: composer ? box(composer).visible : null,
    drawer: {
      panel: document.querySelector('[data-world-panel]') !== null,
      toggle: document.querySelector('[data-world]') !== null,
      close: document.querySelector('[data-world-close]') !== null,
    },
  }
})()`

/**
 * 结构检查（`probe.ts` 那四条阈值，**这一节不新增任何阈值**）。
 *
 * ⚠️ 用软失败包住只为**保住后面的读数** —— 它照样让这条用例红（票 74 的返工：两个块都撞到第一条就停）。
 */
function expectCleanSoft(probe: Probe, where: string): void {
  try {
    expectClean(probe)
  } catch (error) {
    expect.soft(false, where + ' 那一屏没过结构检查：' + (error as Error).message).toBe(true)
  }
}

/** 按工位开一屏玩家屏（语言单独钉；不打开任何浮层 —— 两条栏是常驻的） */
async function openPlayerAt(
  browser: Browser,
  one: { width: number; height: number; lang: string },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: one.width, height: one.height },
    deviceScaleFactor: 1,
    locale: one.lang === 'en' ? 'en-US' : 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await seedStorage(page, {
    'tavernGame.lang': one.lang,
    'tavernGame.theme': null,
    'tavernGame.debug': null,
    'tavernGame.config': CONFIG,
    'tavernGame.save': saveWith({ events: STORY }),
  })
  await page.goto(APP_PATH)
  await expect(page.locator('#app > *')).toHaveCount(1)
  await page.waitForTimeout(600)
  return { context, page }
}

/** 读一屏玩家屏（顺带跑那四条结构检查） */
async function readPlayer(page: Page, where: string): Promise<PlayerReading> {
  const reading = (await page.evaluate(PLAYER_PROBE)) as PlayerReading
  expectCleanSoft((await page.evaluate(PROBE)) as Probe, where)
  return reading
}

/** 换屏幕尺寸（媒体查询与栅格都落定再读） */
async function sizeTo(page: Page, width: number, height: number): Promise<PlayerReading> {
  await page.setViewportSize({ width, height })
  await page.waitForTimeout(350)
  return readPlayer(page, width + 'x' + height)
}

/** 一栏的盒子 */
function columnOf(r: PlayerReading, side: string): (PlayerBox & { side: string | null }) | undefined {
  return r.columns.find((column) => column.side === side)
}

/**
 * **归属 + 顺序**（这一票唯一真正有牙的那条）：每块恰好一份、落在声明那一栏里、栏内保持声明相对顺序。
 *
 * ⚠️ 两边都断：`left` 的块不许落在右栏、`right` 的块不许落在左栏 ——
 *    只断"有两条栏"抓不住"分错边"这半个 bug（S0 R3 逐字）。
 */
function expectOwnership(r: PlayerReading, where: string): void {
  for (const entry of DECLARED) {
    const found = r.blocks.filter((block) => block.path === entry.path)
    expect.soft(found.length, where + '：块 ' + entry.path + ' 在屏上的份数不是 1').toBe(1)
    expect.soft(found[0]?.side, where + '：块 ' + entry.path + ' 画在了错误的栏里').toBe(entry.side)
  }
  for (const side of ['left', 'right']) {
    const wanted = DECLARED.filter((entry) => entry.side === side).map((entry) => entry.path)
    const shown = r.blocks.filter((block) => block.side === side).map((block) => block.path)
    expect.soft(shown, where + '：' + side + ' 栏里的块与声明顺序对不上').toEqual(wanted)
  }
}

/** 抽屉那一层撤了：三个钩子一个都不许在（老板：「都常驻了，就不用展开按钮了」） */
function expectNoDrawer(r: PlayerReading, where: string): void {
  expect
    .soft(r.drawer, where + '：世界面板抽屉的钩子还在（面板 / 右上角开关 / 收起按钮）')
    .toEqual({ panel: false, toggle: false, close: false })
}

test('P1/P2/P3 两栏档：两条栏、归属、顺序、正文地板 @ 1280x720 起', async ({ browser }) => {
  const { context, page } = await openPlayerAt(browser, { width: 1280, height: 720, lang: 'zh-CN' })
  try {
    const first = await readPlayer(page, '1280x720')
    // 守卫（硬）：这一档是游戏屏、不是闸门屏 —— 后面那些读数才有对象
    expect(first.rotate?.visible ?? false, '1280x720 不是窄且竖，闸门不该成立').toBe(false)
    for (const [width, height] of [
      [1280, 720],
      [1280, 800],
      [1440, 900],
      [1920, 1080],
    ] as const) {
      const where = width + 'x' + height
      const r = width === 1280 && height === 720 ? first : await sizeTo(page, width, height)
      const left = columnOf(r, 'left')
      const right = columnOf(r, 'right')
      expect
        .soft(r.columns.map((column) => column.side).sort(), where + '：两条栏不在')
        .toEqual(['left', 'right'])
      expect.soft(left?.visible && right?.visible, where + '：两条栏有一条不可见').toBe(true)
      expect.soft(r.story?.visible, where + '：正文那一列不可见').toBe(true)
      // 左 < 正文 < 右：比的是左右沿，**不钉任何宽度**（拖拽那一票落地时这三句不用改）
      expect.soft((left?.right ?? 1e9) <= (r.story?.left ?? -1) + 1, where + '：左栏不在正文左边').toBe(true)
      expect
        .soft((right?.left ?? -1e9) >= (r.story?.right ?? 1e9) - 1, where + '：右栏不在正文右边')
        .toBe(true)
      // 地板：正文那一行不低于 120px；两栏档再加一条行宽地板（68ch = 498px）
      expect.soft((r.story?.height ?? 0) >= STORY_FLOOR, where + '：正文那一行低于 120px 的地板').toBe(true)
      expect
        .soft((r.story?.width ?? 0) >= STORY_WIDTH_FLOOR, where + '：正文列比 68ch（498px）还窄')
        .toBe(true)
      expectOwnership(r, where)
      expectNoDrawer(r, where)
    }
  } finally {
    await context.close()
  }
})

test('P4/P5 一条栏档：两段住同一条栏（右在上），1279 与 1280 是一对牙', async ({ browser }) => {
  const { context, page } = await openPlayerAt(browser, { width: 1100, height: 800, lang: 'zh-CN' })
  try {
    const first = await readPlayer(page, '1100x800')
    expect(first.rotate?.visible ?? false, '1100x800 是宽屏，闸门不该成立').toBe(false)
    for (const [width, height] of [
      [1100, 800],
      [1279, 800],
    ] as const) {
      const where = width + 'x' + height
      const r = width === 1100 && height === 800 ? first : await sizeTo(page, width, height)
      const left = columnOf(r, 'left')
      const right = columnOf(r, 'right')
      expect.soft(left?.visible && right?.visible, where + '：两段都该在屏上').toBe(true)
      // 同一条栏：两段的左沿相同（这就是"一条栏"与"两条栏"在几何上的分界，不钉栏宽）
      expect
        .soft(Math.abs((left?.left ?? 0) - (right?.left ?? 1e9)) <= 1, where + '：两段不在同一条栏里')
        .toBe(true)
      // 右在上、左在下（组长 2026-09-24 拍的：窄窗先给"我现在有什么、我在哪"）
      expect.soft((right?.top ?? 1e9) < (left?.top ?? -1), where + '：这条栏里右在上、左在下').toBe(true)
      // 那一条栏在正文右边
      expect
        .soft((left?.left ?? -1e9) >= (r.story?.right ?? 1e9) - 1, where + '：那条栏不在正文右边')
        .toBe(true)
      expect.soft((r.story?.height ?? 0) >= STORY_FLOOR, where + '：正文那一行低于 120px 的地板').toBe(true)
      expectOwnership(r, where)
      expectNoDrawer(r, where)
    }
    // 1280 一步跨过去就是两栏 —— 这就是"1280"这个数的牙（与上面 1279 那一格成对）
    const wide = await sizeTo(page, 1280, 800)
    const left = columnOf(wide, 'left')
    const right = columnOf(wide, 'right')
    expect
      .soft(
        (left?.right ?? 1e9) <= (wide.story?.left ?? -1) + 1 &&
          (right?.left ?? -1e9) >= (wide.story?.right ?? 1e9) - 1,
        '1280：这一档必须是两条栏（左在正文左边、右在右边）',
      )
      .toBe(true)
    expectOwnership(wide, '1280x800')
  } finally {
    await context.close()
  }
})

test('P6/H1/H2 块带档与矮窗兜底 @ 768x1024 / 600x900 / 800x400 / 480x320 / 640x360', async ({ browser }) => {
  const { context, page } = await openPlayerAt(browser, { width: 768, height: 1024, lang: 'zh-CN' })
  try {
    // 高窗（≥481px）：正文在上、两条带接在下面（左先右后），各占满宽
    const tall = await readPlayer(page, '768x1024')
    const tallLeft = columnOf(tall, 'left')
    const tallRight = columnOf(tall, 'right')
    expect.soft(tall.story?.visible, '768x1024：正文那一列不可见').toBe(true)
    expect.soft((tall.story?.top ?? 1e9) < (tallLeft?.top ?? -1), '768x1024：正文在上').toBe(true)
    expect.soft((tallLeft?.top ?? 1e9) < (tallRight?.top ?? -1), '768x1024：正文下面左先右后').toBe(true)
    expect
      .soft(
        Math.abs((tallLeft?.left ?? 0) - (tall.story?.left ?? 1e9)) <= 1 &&
          Math.abs((tallLeft?.right ?? 0) - (tall.story?.right ?? 1e9)) <= 1,
        '768x1024：带要跟正文一样宽（满宽带）',
      )
      .toBe(true)
    expect.soft((tall.story?.height ?? 0) >= STORY_FLOOR, '768x1024：正文那一行低于 120px 的地板').toBe(true)
    expectOwnership(tall, '768x1024')
    expectNoDrawer(tall, '768x1024')
    // H2 反面控制：高窗上**左带必须看得见**（矮窗兜底不许扩到高窗）
    expect.soft(tallLeft?.visible, 'H2：高窗上左带必须看得见 —— 矮窗兜底不许扩到高窗').toBe(true)

    // H2 第二格：600×900（闸门不成立的那一格，高 900 > 480）
    const six = await sizeTo(page, 600, 900)
    expect.soft(six.rotate?.visible, '600x900：这一档不是闸门').toBe(false)
    expect.soft(columnOf(six, 'left')?.visible, 'H2：600x900 上左带必须看得见').toBe(true)
    expect.soft(columnOf(six, 'right')?.visible, '600x900 上右带必须看得见').toBe(true)

    // H1 矮窗（`max-height: 480px`：800×400 / 480×320 / 640×360）—— **只画右带**
    for (const [width, height] of [
      [800, 400],
      [480, 320],
      [640, 360],
    ] as const) {
      const where = width + 'x' + height
      const r = await sizeTo(page, width, height)
      expect
        .soft(columnOf(r, 'left')?.visible, where + '：矮窗上左带必须不出现（这是选择的形状，不是没做）')
        .toBe(false)
      expect.soft(columnOf(r, 'right')?.visible, where + '：矮窗上右带要在').toBe(true)
      expect
        .soft(r.story?.visible && (r.story?.height ?? 0) >= STORY_FLOOR, where + '：正文要有地板')
        .toBe(true)
      // 归属不因降级而变：`left` 的块仍在左栏里（只是那一栏这一档不显示）
      expectOwnership(r, where)
      expectNoDrawer(r, where)
    }
  } finally {
    await context.close()
  }
})

for (const lang of ['zh-CN', 'en'] as const) {
  test('G1/G2/G3/G4 竖屏闸门 @ 360x640（' + lang + '）', async ({ browser }) => {
    const { context, page } = await openPlayerAt(browser, { width: 360, height: 640, lang })
    try {
      const title = await translate(page, 'play.rotateTitle')
      const body = await translate(page, 'play.rotateBody')
      const gated = await readPlayer(page, '360x640')
      expect.soft(gated.rotate, '闸门那一块必须在 DOM 里（它是媒体查询，不是 v-if）').not.toBeNull()
      expect.soft(gated.rotate?.visible, '360x640 是窄且竖：闸门必须成立').toBe(true)
      expect.soft(gated.rotate?.text ?? '', '闸门要说出标题那一句').toContain(title)
      expect.soft(gated.rotate?.text ?? '', '闸门要说出正文那一句').toContain(body)
      expect.soft(gated.columns.filter((column) => column.visible).length, '闸门屏上不许还有栏').toBe(0)
      expect.soft(gated.story?.visible ?? false, '闸门屏上不许还有正文').toBe(false)
      expect.soft(gated.composer, '闸门屏上不许还有输入框').not.toBe(true)
      // ⚠️ 闸门档**不断正文高度**：正文根本不显示（设计自拼页在那一档量到的那 110px 是"没显示"的读数）

      // G3：599 还是闸门、600 就不是 —— "599"这个数的牙
      const narrow = await sizeTo(page, 599, 900)
      expect.soft(narrow.rotate?.visible, '599x900 还是窄且竖：闸门必须成立').toBe(true)
      const wide = await sizeTo(page, 600, 900)
      expect.soft(wide.rotate?.visible, '600x900 不再窄：闸门必须撤').toBe(false)
      expect
        .soft(
          wide.story?.visible && (wide.story?.height ?? 0) >= STORY_FLOOR,
          '600x900：正文回来且不低于地板',
        )
        .toBe(true)

      // G2：同一台手机转过来就能玩（不刷新、不重开）
      const turned = await sizeTo(page, 640, 360)
      expect.soft(turned.rotate?.visible, '转过来了：闸门必须撤').toBe(false)
      expect.soft(columnOf(turned, 'right')?.visible, '转过来之后右带要在').toBe(true)
      expect
        .soft(turned.story?.visible && (turned.story?.height ?? 0) >= STORY_FLOOR, '转过来之后正文要有地板')
        .toBe(true)
      expectOwnership(turned, '640x360')
    } finally {
      await context.close()
    }
  })
}

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
