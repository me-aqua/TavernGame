/**
 * 视觉巡检 —— 把「每个状态 × 每种屏幕」的真实渲染拍下来，顺手做结构检查。
 *
 * 两条判据：
 *   1. **结构断言**（无基线，最可靠）：横向溢出、元素伸出视口、点按目标 < 24px
 *   2. **像素基线**（少量、稳定、高价值的画面）：变了就红，防止悄悄改坏
 * 剩下的（间距、层次、可读性）由人看 artifacts/screenshots/index.html 总览页。
 *
 * 用法：npm run visual（不进 pre-commit：慢，而且要浏览器）
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { APP_PATH, CONFIG, event, fakeLlm, saveWith, seedStorage, type FakeMode } from './fixtures'
import { PROBE, expectClean, type Probe } from './probe'

const OUT = 'artifacts/screenshots'

/** 屏幕：mobile 决定 Chrome 用不用移动端视口规则；dsf 让手机图在被看时更清楚 */
const VIEWPORTS = [
  { name: 'phone', width: 360, height: 640, dsf: 2, mobile: true },
  { name: 'phone-lg', width: 430, height: 932, dsf: 2, mobile: true },
  { name: 'tablet', width: 768, height: 1024, dsf: 2, mobile: true },
  { name: 'laptop', width: 1280, height: 800, dsf: 1, mobile: false },
  { name: 'desktop', width: 1920, height: 1080, dsf: 1, mobile: false },
]

/** 建像素基线的画面：稳定（数据固定）且值得盯住 */
const BASELINE = new Set([
  'playing-zh--phone',
  'playing-zh--laptop',
  'playing-en--phone',
  'playing-en--laptop',
  'long-story--phone',
  'debug-on--laptop',
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
  event(
    'request',
    '📤 模型输入（2 条消息）',
    '{\n  "model": "demo-model",\n  "messages": [\n    { "role": "system", "content": "你是一个文字冒险游戏的主持人……" },\n    { "role": "user", "content": "玩家的行动：我推开酒馆的门。" }\n  ],\n  "temperature": 0.85\n}',
  ),
  event(
    'reply',
    '🔍 模型原始回复（1 次工具调用）',
    '{\n  "choices": [ { "message": { "tool_calls": [ … ] } } ]\n}',
  ),
  event('tool', '⚙ 调用 advance_time({"step":1,"unit":"day","reason":"在酒馆待到深夜"})'),
  event(
    'toolResult',
    '   → 🕐 时间推进：2026 年 9 月 14 日 · 星期一 · 晚上\n           → 2026 年 9 月 15 日 · 星期二 · 上午',
  ),
  ...STORY,
]

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
      save: saveWith({
        events: EN_STORY,
        scene: { name: 'Morningwind · Tavern', description: 'The hearth paints the walls honey.' },
      }),
    },
  },
  {
    name: 'long-story',
    seed: { config: CONFIG, save: saveWith({ events: LONG_STORY, meta: { turn: 21 } }) },
  },
  { name: 'debug-on', seed: { config: CONFIG, save: saveWith({ events: DEBUG_EVENTS }), debug: 'on' } },
  { name: 'corrupted-save', seed: { save: '{not valid json' } },
  {
    name: 'drawer-open',
    seed: { config: CONFIG, save: saveWith({ events: STORY }) },
    interact: "document.querySelector('button[data-settings]')?.click()",
    waitAfterMs: 400,
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

/** 一行巡检结果（最后汇总成总览页） */
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

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

test.describe('状态 × 屏幕', () => {
  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
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
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>截图巡检</title>',
    '<style>body{font:14px/1.6 system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:24px}',
    'h2{margin:28px 0 8px;font-size:15px;color:#9ad}section{display:flex;gap:16px;flex-wrap:wrap}',
    'figure{margin:0;background:#1c1c1c;border:1px solid #333;border-radius:8px;padding:8px;max-width:360px}',
    'img{width:100%;display:block;border-radius:4px;background:#000}figcaption{font-size:12px;color:#aaa;margin-top:6px}</style>',
    '</head><body><h1>截图巡检</h1>',
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
