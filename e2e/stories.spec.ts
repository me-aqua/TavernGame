/**
 * 组件故事的截图检查 —— 每个故事 × 主题（浅/深）× 语言（中/英）。
 *
 * 做三件事：
 *   1. 在真实浏览器里打开 Storybook 的 iframe（就是开发者看到的那个画面）
 *   2. 跑页面结构检查（横向溢出 / 元素出界 / 点按目标过小）—— 与整页检查同一套判据
 *   3. 每个组合拍一张 PNG，最后生成总览页供人看
 *
 * ⚠️ 组件故事这一层**不建像素基线**：组件改动频繁，基线会变成天天刷新的噪音。
 *    真正的像素回归放在整页矩阵里（8 张稳定画面，见 e2e/visual.spec.ts）。
 *
 * 用法：npm run stories（会先 storybook build）
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { PROBE, expectClean, type Probe } from './probe'
import { startStaticServer } from './static-server'

const PORT = 4175
const OUT = 'artifacts/stories'
const INDEX = 'storybook-static/index.json'
const VIEWPORT = { width: 1280, height: 800 }
const THEMES = ['light', 'dark']
const LOCALES = ['zh-CN', 'en']

interface StoryEntry {
  id: string
  title: string
  name: string
  type: string
}

/** Storybook 构建时写下的清单：故事列表以它为准，不在测试里再抄一份 */
const index: { entries: Record<string, StoryEntry> } = existsSync(INDEX)
  ? (JSON.parse(readFileSync(INDEX, 'utf8')) as { entries: Record<string, StoryEntry> })
  : { entries: {} }
const stories = Object.values(index.entries).filter((entry) => entry.type === 'story')

interface Shot {
  story: string
  title: string
  name: string
  theme: string
  locale: string
  file: string
}

const shots: Shot[] = []
let server: { close: () => void } | null = null

test.use({ baseURL: `http://localhost:${PORT}` })

test.beforeAll(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  server = await startStaticServer({ port: PORT, root: 'storybook-static' })
})

test.afterAll(() => {
  server?.close()
  writeContactSheet()
})

/** 总览页：按组件分组，一眼看完全部组合 */
function writeContactSheet(): void {
  const byTitle = new Map<string, Shot[]>()
  for (const shot of shots) {
    const list = byTitle.get(shot.title) ?? []
    list.push(shot)
    byTitle.set(shot.title, list)
  }
  const html = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>组件故事</title>',
    '<style>body{font:14px/1.6 system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:24px}',
    'h2{margin:28px 0 8px;font-size:15px;color:#9ad}section{display:flex;gap:14px;flex-wrap:wrap}',
    'figure{margin:0;background:#1c1c1c;border:1px solid #333;border-radius:8px;padding:8px;max-width:420px}',
    'img{width:100%;display:block;border-radius:4px}figcaption{font-size:12px;color:#aaa;margin-top:6px}</style>',
    '</head><body><h1>组件故事</h1><p>每个故事 × 主题 × 语言。结构检查与整页检查同一套判据。</p>',
  ]
  for (const [title, list] of byTitle) {
    html.push(`<h2>${title}</h2><section>`)
    for (const shot of list) {
      html.push(
        `<figure><img src="${shot.file}" alt="${shot.file}"><figcaption>${shot.name} · ${shot.theme} · ${shot.locale}</figcaption></figure>`,
      )
    }
    html.push('</section>')
  }
  html.push('</body></html>')
  writeFileSync(`${OUT}/index.html`, html.join('\n'))
  writeFileSync(`${OUT}/report.json`, JSON.stringify(shots, null, 2))
}

if (!stories.length) {
  test('故事清单为空：先跑 npm run build-storybook', () => {
    expect(stories.length, `${INDEX} 里一个故事都没有`).toBeGreaterThan(0)
  })
}

test.describe('组件故事', () => {
  for (const story of stories) {
    for (const theme of THEMES) {
      for (const locale of LOCALES) {
        test(`${story.id} [${theme}/${locale}]`, async ({ browser }) => {
          const context = await browser.newContext({
            viewport: VIEWPORT,
            deviceScaleFactor: 1,
            locale,
            timezoneId: 'Asia/Shanghai',
            reducedMotion: 'reduce',
          })
          const page = await context.newPage()
          await page.goto(`/iframe.html?id=${story.id}&globals=theme:${theme};locale:${locale}`)
          await expect(page.locator('#storybook-root > *').first()).toBeVisible()

          const probe = (await page.evaluate(PROBE)) as Probe
          const file = `${story.id.replace(/[^a-zA-Z0-9]+/g, '-')}--${theme}--${locale}.png`
          await page.screenshot({ path: `${OUT}/${file}`, animations: 'disabled' })
          shots.push({ story: story.id, title: story.title, name: story.name, theme, locale, file })

          expectClean(probe)
          await context.close()
        })
      }
    }
  }
})
