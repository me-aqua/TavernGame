/**
 * 组件故事的巡检（SPEC §6）：每个故事 × 浅/深两档主题，固定 **1280×720**。
 *
 * 做四件事：
 *   1. 在真实浏览器里打开 Storybook 的 `iframe.html`（开发者看到的同一个画面）；
 *   2. 跑结构检查（横向溢出 / 出界 / 24px 点按 / 遮挡）+ 三档字号（`probe.mjs`）；
 *   3. 每个组合拍一张 PNG（**不建像素基线**：组件这层只留下图给人看）；
 *   4. 生成总览页 `artifacts/stories/index.html`，一眼看完全部组合。
 *
 * ⚠️ 浅深两档要**真的**生效才算过：`html[data-theme]` 与 `color-scheme` 各断言一次
 *    （老站踩过：深色那一半截图其实全是浅色）。
 * ⚠️ 与 `v2:e2e` 不许并发跑（两边都写 `v2/test-results`）：一条一条来。
 * ⚠️ 断言文案与用例名用英文：这一份在 ascii 钩子的管辖范围内。
 *
 * 用法：`npm run v2:stories`（先 `v2:build-storybook`）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { expectClean, expectTierFonts, PROBE } from './probe.mjs'
import { startStaticServer } from './static-server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const V2 = join(HERE, '..', '..')
const INDEX = join(V2, 'storybook-static', 'index.json')
// 产物落在仓库根的 artifacts/ 下（与旧站巡检同一个父目录、不同子目录）：
//   · `.gitignore` 已经忽略 `artifacts/`；
//   · 生成物不住在 v2/ 里 —— 文件长度闸只量手写文件，PNG 不该进它的视野。
const OUT = join(V2, '..', 'artifacts', 'v2-stories')
const PORT = 4177
const VIEWPORT = { width: 1280, height: 720 }
const THEMES = ['light', 'dark']

/** Storybook 构建时写下的清单：故事列表以它为准，这里不另抄一份 */
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : { entries: {} }
const stories = Object.values(index.entries).filter((entry) => entry.type === 'story')

const shots = []
let server = null

test.use({ baseURL: `http://127.0.0.1:${PORT}` })

test.beforeAll(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  server = await startStaticServer({ port: PORT, root: join(V2, 'storybook-static') })
})

test.afterAll(() => {
  if (server) server.close()
  writeContactSheet()
})

/** 总览页：按组件分组，把每个组合摆出来给人看 */
function writeContactSheet() {
  const byTitle = new Map()
  for (const shot of shots) {
    const list = byTitle.get(shot.title) ?? []
    list.push(shot)
    byTitle.set(shot.title, list)
  }
  const html = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>v2 component stories</title>',
    '<style>body{font:14px/1.6 system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:24px}',
    'h2{margin:28px 0 8px;font-size:15px;color:#9ad}section{display:flex;gap:14px;flex-wrap:wrap}',
    'figure{margin:0;background:#1c1c1c;border:1px solid #333;border-radius:8px;padding:8px;max-width:420px}',
    'img{width:100%;display:block;border-radius:4px}figcaption{font-size:12px;color:#aaa;margin-top:6px}</style>',
    '</head><body><h1>v2 component stories</h1>',
    '<p>1280x720, light/dark. Structural checks: overflow / out-of-bounds / 24px targets / overlap / three font tiers.</p>',
  ]
  for (const [title, list] of byTitle) {
    html.push(`<h2>${title}</h2><section>`)
    for (const shot of list) {
      html.push(
        `<figure><img src="${shot.file}" alt="${shot.file}"><figcaption>${shot.name} - ${shot.theme}</figcaption></figure>`,
      )
    }
    html.push('</section>')
  }
  html.push('</body></html>')
  writeFileSync(join(OUT, 'index.html'), html.join('\n'))
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(shots, null, 2))
}

if (stories.length === 0) {
  test('story index is empty: run npm run v2:build-storybook first', () => {
    expect(stories.length, `${INDEX} has no stories`).toBeGreaterThan(0)
  })
}

test.describe('component story matrix', () => {
  for (const story of stories) {
    for (const theme of THEMES) {
      test(`${story.id} [${theme}]`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: 1,
          locale: 'zh-CN',
          timezoneId: 'Asia/Shanghai',
          reducedMotion: 'reduce',
        })
        const page = await context.newPage()
        await page.goto(`/iframe.html?id=${story.id}&globals=theme:${theme}`)
        await expect(page.locator('#storybook-root > *').first()).toBeVisible()

        // The theme must really land on <html> (otherwise both halves are silently light)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const probe = await page.evaluate(PROBE)
        expect(probe.colorScheme, `color-scheme must follow the ${theme} theme`).toBe(theme)

        const file = `${story.id.replace(/[^a-zA-Z0-9]+/g, '-')}--${theme}.png`
        await page.screenshot({ path: join(OUT, file), animations: 'disabled' })
        shots.push({ story: story.id, title: story.title, name: story.name, theme, file })

        expectClean(probe)
        expectTierFonts(probe, story.id)
        await context.close()
      })
    }
  }
})
