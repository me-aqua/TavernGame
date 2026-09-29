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
 * 🔴 票 70（S3 的条件 2）：这一层**还管一条字号判据** —— 中栏那张表（含 `<option>`）的文字
 *    只许用三档。整页矩阵那次普查**只在 `editor-open` 那一屏跑**，而那一屏**从不按「＋」**
 *    ⇒ 它照不到 `<option>`；这一层的故事里真有（`Editing` / `Refused` 带着新行）。
 *
 * 🔴 阶段 3（搬纹章 / 剪影）：文件末尾还管一条**动效判据** —— 剪影在 reduced motion 下必须静止。
 *    它同样只有这一层看得见（组件层是 jsdom、截图那步把动画冻住），详见 `probe.ts` 的
 *    `expectSigilStill`。它单独成块，因为要**两个动效上下文对撞**，塞进下面那个矩阵会把
 *    每个故事都跑两遍。
 *
 * 用法：npm run stories（会先 storybook build）
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  PROBE,
  expectClean,
  expectSigilStill,
  expectTierFonts,
  fontCensus,
  sigilCensus,
  type Probe,
} from './probe'
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

          // 主题类要等它真的落到 <html> 上再 probe/截图 ——
          // 否则「深色」那一半截图其实全是浅色（32 对 PNG 的 sha256 一模一样，实测发现）
          if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
          else await expect(page.locator('html')).not.toHaveClass(/dark/)

          const probe = (await page.evaluate(PROBE)) as Probe
          const file = `${story.id.replace(/[^a-zA-Z0-9]+/g, '-')}--${theme}--${locale}.png`
          await page.screenshot({ path: `${OUT}/${file}`, animations: 'disabled' })
          shots.push({ story: story.id, title: story.title, name: story.name, theme, locale, file })

          expectClean(probe)
          // 票 70：中栏那张表的文字只用三档字号 —— **`<option>` 也在这条里**。
          // 🔴 这条判据的现场只能在这一层：整页巡检的字号普查只在 `editor-open` 那一屏跑，
          //    而那一屏从不按「＋」⇒ 屏上 `select = 0 / option = 0` ⇒ "visual 85/85 绿"对它零信息量。
          //    这一层真有 `<option>`（`Editing` / `Refused` 两个故事带着新行）。
          // ⚠️ 作用域与反面控制都写在 `probe.ts` 的 `expectTierFonts` 里（表不在屏上就不适用）。
          expectTierFonts(await page.evaluate(fontCensus), story.id)
          await context.close()
        })
      }
    }
  }
})

/**
 * 剪影的呼吸动效在 reduced motion 下必须静止 —— `SceneSigil.vue` 文件头里写的就是这一条。
 *
 * 三个"为什么只能在这一层"（判据本体与正反两半都在 `probe.ts` 的 `expectSigilStill`）：
 *   · 组件层是 jsdom，`matchMedia` 恒为 `false` ⇒ 那条媒体查询永远不匹配，看不见；
 *   · 上面那个矩阵的截图带 `animations: 'disabled'`，Playwright 会把动画冻住 ⇒ 看图看不出；
 *   · 只有**真浏览器 + 两个动效上下文对撞**（reduce / no-preference）能把它钉住。
 *
 * ⚠️ 单开一块、而不是塞进上面那个矩阵：上面那一趟**本来就跑在 `reducedMotion: 'reduce'` 里**
 *    ⇒ 只有一半；把第二个上下文塞进去会把每个故事都多跑一遍。
 * ⚠️ 动效不吃语言 ⇒ 这一层只跑一种语言（省一半）；浅深两档照跑（它是 CSS 级联的一部分）。
 */
test.describe('剪影在 reduced motion 下静止', () => {
  /** 剪影那四个故事（按故事标题认，不去拼 id） */
  const sigilStories = stories.filter((entry) => entry.title === '组件/SceneSigil')
  /** 照到过剪影的屏数（收尾要断它 —— 一条都没照到就是空转） */
  let seen = 0

  test('剪影的故事在清单里（照不到 ≠ 通过）', () => {
    expect(sigilStories.length, '清单里一个剪影故事都没有 —— 这一条什么也没验').toBeGreaterThan(0)
  })

  for (const story of sigilStories) {
    for (const theme of THEMES) {
      test(`${story.id} [${theme}]`, async ({ browser }) => {
        /** 同一个故事、同一个主题，**只在动效偏好上不同** —— 这一条就是那两个上下文对撞 */
        const censusIn = async (reducedMotion: 'reduce' | 'no-preference') => {
          const context = await browser.newContext({
            viewport: VIEWPORT,
            deviceScaleFactor: 1,
            locale: 'zh-CN',
            timezoneId: 'Asia/Shanghai',
            reducedMotion,
          })
          const page = await context.newPage()
          await page.goto(`/iframe.html?id=${story.id}&globals=theme:${theme};locale:zh-CN`)
          await expect(page.locator('#storybook-root > *').first()).toBeVisible()
          const census = await page.evaluate(sigilCensus)
          await context.close()
          return census
        }
        if (expectSigilStill(await censusIn('reduce'), await censusIn('no-preference'), story.id)) {
          seen += 1
        }
      })
    }
  }

  test.afterAll(() => {
    expect(seen, '整趟一块剪影都没照到 —— 这一条空转了').toBeGreaterThan(0)
  })
})
