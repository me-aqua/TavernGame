/**
 * 接线票（甲档）· **B / C / D 三组**：主控徽记接在右栏 · 开场封面挂在「还没有故事」上 · 不许挤坏。
 *
 * 契约与逐条理由：`.team/test/2026-09-30/契约-接线.md`；
 * 形态与验收口径：`.team/design/2026-09-30/接线票-形态方案.md` §六（S1 组长采纳为全组口径）。
 * 起点红原文：`.team/test/2026-09-30/start-red-wiring-BCD.log`；验牙读数：`teeth-probe.log`。
 *
 * 🔴 **只断"继承不下来"的计算值**（承重纪律）：`color` / `font-family` 这类**继承属性**是最弱的一把尺。
 * 🔴 **为什么只能在真浏览器里**：jsdom 没有布局、`matchMedia` 恒为 `false`
 *    ⇒ 组件层那两件判据（`tests/world-sigil-dom.test.ts` / `tests/story-cover-dom.test.ts`）
 *    自己就写着"这一件不测样式"。这里补的正是那个洞。
 *
 * ⚠️ 这一层读的是**构建产物**（`dist/`）：`src/` 改了必须重新构建才看得见。
 * ⚠️ **A 组在同目录的 `wiring.spec.ts`**（同一票，按组长 2026-09-30 的裁决拆成两份
 *    —— 一个文件一次交不上去：那道体积门是按"这一笔加了多少行"算的）。
 */
import { expect, test, type Page } from '@playwright/test'
import {
  APP_PATH,
  CONFIG,
  CONFIG_KEY,
  DEBUG_KEY,
  LANG_KEY,
  LEAD_NAME,
  SAVE_KEY,
  THEME_KEY,
  fakeLlm,
  saveWith,
  seedStorage,
} from './fixtures'
import { PROBE, expectClean, type Probe } from './probe'

/** 最差承诺工位（老板：「我们玩家用的最差最差也是个 720p 屏幕」）· 与整页巡检同一块屏幕 */
const LAPTOP_720 = { width: 1280, height: 720 }

/**
 * 假但**必然连不上**的配置：让「有配置 ⇒ 自动跑开场」这条老行为一旦回来就**当场可见**。
 * `https://127.0.0.1:9/v1` 在保留端口上，没有服务在听 ⇒ 请求当场失败，不会挂在那儿转圈。
 */
const UNREACHABLE = JSON.stringify({
  provider: 'custom',
  apiKey: 'sk-demo',
  apiBase: 'https://127.0.0.1:9/v1',
  model: 'demo-model',
  temperature: 0.85,
})

/** 名字 → 一个非负整数（`CharacterSigil.vue` 里那一份是同一个函数） */
function hash(text: string): number {
  let value = 0
  for (let i = 0; i < text.length; i += 1) value = ((value << 5) - value + text.charCodeAt(i)) | 0
  return Math.abs(value)
}

/**
 * 开一屏时要种的那几样（**键名不在这里写** —— 由这个函数自己拼，见下）。
 *
 * ⚠️ 这里用四个具名可选字段、**不是** `Record<string, string | null>`：后者会让
 *    `{ config: CONFIG }` 这种**拼错的键**静默通过类型检查，而它在浏览器里只是"没种上"
 *    （页面照样挂载、只是拿不到配置/存档）—— 判据会红在**别的原因**上。踩过一次，记在这儿。
 */
interface Seed {
  lang?: string
  theme?: string | null
  debug?: string | null
  config?: string | null
  save?: string | null
}

/**
 * 开一屏（与 `fixtures.ts` 的 `openApp` 同一条路：种数据 → goto → 等挂载；默认值也跟它一致）。
 * ⚠️ 不自己写挂载判据 —— 那是 `e2e/fixtures.ts` 的事。
 */
async function openPlayer(page: Page, seed: Seed): Promise<void> {
  await seedStorage(page, {
    [LANG_KEY]: seed.lang ?? 'zh-CN',
    [THEME_KEY]: seed.theme ?? null,
    [DEBUG_KEY]: seed.debug ?? null,
    [CONFIG_KEY]: seed.config ?? null,
    [SAVE_KEY]: seed.save ?? null,
  })
  await page.goto(APP_PATH)
  await expect(page.locator('#app > *')).toHaveCount(1)
  // 媒体查询与栅格落定（与 `visual.spec.ts` 的 openPlayerAt 同一口径）
  await page.waitForTimeout(600)
}

test.describe('B 组 · 主控徽记接在右栏', () => {
  test.use({ viewport: LAPTOP_720 })

  test('B1-B3 徽记画的是卡说的人，尺寸与非继承的样式都在', async ({ page }) => {
    await openPlayer(page, { config: CONFIG, save: saveWith() })

    const facts = (await page.evaluate(`(() => {
      const right = document.querySelector('[data-side="right"]')
      const el = right ? right.querySelector('.sigil') : null
      if (!el) return { count: right ? right.querySelectorAll('.sigil').length : -1, rect: null, cls: '', label: '', ringFill: null, ringStroke: null, you: false, crown: false, markPath: '' }
      const r = el.getBoundingClientRect()
      const ring = el.querySelector('.sigil-ring')
      return {
        count: right.querySelectorAll('.sigil').length,
        rect: { width: Math.round(r.width), height: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) },
        cls: String(el.className || ''),
        label: el.getAttribute('aria-label') || '',
        ringFill: ring ? getComputedStyle(ring).fill : null,
        ringStroke: ring ? getComputedStyle(ring).stroke : null,
        you: el.classList.contains('sigil-you'),
        crown: el.querySelector('.sigil-crown') !== null,
        markPath: (el.querySelector('.sigil-mark') || { getAttribute: () => '' }).getAttribute('d') || '',
      }
    })()`)) as {
      count: number
      rect: { width: number; height: number; left: number; right: number } | null
      cls: string
      label: string
      ringFill: string | null
      ringStroke: string | null
      you: boolean
      crown: boolean
      markPath: string
    }
    console.log('B group reading: ' + JSON.stringify(facts))

    // B1 · 在不在 + 尺寸（`sm` = 2rem = 32px）
    expect(facts.count, 'B1: no character sigil in the right column - the rest is vacuous').toBeGreaterThan(0)
    expect
      .soft(facts.rect!.width >= 32, 'B1: the sigil is under 32px wide (the sm size is not applied)')
      .toBe(true)
    expect
      .soft(facts.rect!.height >= 32, 'B1: the sigil is under 32px tall (the sm size is not applied)')
      .toBe(true)
    expect.soft(facts.cls.includes('sigil-you'), 'B1: the lead mark is not marked as the player').toBe(true)
    expect.soft(facts.crown, 'B1: the lead mark has no crown').toBe(true)
    // 🔴 尺寸那两条**不是**这一件的"样式在跑"的证据：摘掉尺寸档它也不塌成 0
    //    （`inline-grid` 里那个 `<svg>` 按父宽撑成 298x298，实测）⇒ 用 `display` 这个**非继承**值来证。
    const display = await page
      .locator('[data-side="right"] .sigil')
      .first()
      .evaluate((node) => getComputedStyle(node).display)
    expect
      .soft(display, 'B1: the sigil box is not the one the style gives (it should be a grid)')
      .toBe('grid')

    // B2 · **断的是数据不是样式**：纹章画的是**谁** —— 名字从卡里现取，不是启发式猜出来的
    expect.soft(facts.label, 'B2: the mark is not labelled with the name the card points at').toBe(LEAD_NAME)
    const rightPane = page.locator('[data-side="right"]')
    await expect.soft(rightPane, 'B2: the name is not written next to the mark').toContainText(LEAD_NAME)

    // B3 · `.sigil-ring` 的 `fill`（**非继承**；这条缺席时两个 <circle> 会按默认画成实心黑饼）
    expect.soft(facts.ringFill, 'B3: the outer ring is filled (it must be none)').toBe('none')
    expect.soft(facts.ringStroke, 'B3: the ring has no colour of its own').not.toBe('none')

    // 顺带：形状由**名字的字节**派生（B2 那条数据判据的另一半 —— 人对了，图案也得跟着对）
    const variant = hash(LEAD_NAME) % 3
    const shape = facts.markPath.includes('32 7') ? 0 : facts.markPath.includes('32 9') ? 1 : 2
    expect.soft(shape, 'B2: the mark shape does not follow from the name in the card').toBe(variant)
  })

  /**
   * **矮栏那一档：整件不画**（B 组的负半）—— 评审第三轮窄复审点出来的那条缝：
   * 正半（720p 要画）套件里有牙，**负半只有一次性探针证明过、判据一条都没有**。
   *
   * 🔴 **为什么必须在这一层断**：那一行的开关是 `tallEnough`，由**真 `ResizeObserver`** 量
   *    "这一栏内容区自己的高"得出（`WorldPanel.vue` 的 `watchPanelHeight`，阈值 `200`）。
   *    jsdom **没有 `ResizeObserver`**、也没有布局 ⇒ 那里这一档**恒为假**、那一行**永远不画**
   *    ⇒ 在组件层断"不画"是**彻头彻尾的假判据**（绿得毫无意义）。只有真浏览器量得到。
   *
   * ⚠️ **阈值附近那个坑（评审量的，我照实记）**：窄横那一档的栏高**不是常数** ——
   *    同一工位两份夹具读出过 **24**（短旁白）与 **4.44**（长旁白）。⇒ 这条判据**只在一个工位、
   *    一份夹具**上断，而两者都离 `200` **一个数量级** ⇒ **不依赖那份夹具的旁白长度**。
   *    下面把当趟量到的栏高打进日志：将来有人改夹具旁白，能一眼看出还差多远。
   *
   * ⚠️ **夹具必须带存档**（`saveWith()`）：不带的话 `hasStory` 假 ⇒ 屏上是**开场封面**、
   *    玩家屏根本不在 DOM 里 ⇒ 这条会断在一个**不存在的屏**上（"0 条"是真话，但毫无意义）。
   */
  test('B4 矮栏那一档（480x320）：主控那一行与剪影整件都不画', async ({ page }) => {
    // ① 正面控制：720p 上这两件**都在** —— 没有这一半，下面那两条"0"什么都不证明
    await openPlayer(page, { config: CONFIG, save: saveWith() })
    await expect(
      page.locator('[data-side="right"] [data-lead]'),
      'B4 guard: the lead row is not drawn at 1280x720 either - the negative half would prove nothing',
    ).toHaveCount(1)
    await expect(
      page.locator('.scene-sigil'),
      'B4 guard: the silhouette is not drawn at 1280x720 either',
    ).toHaveCount(1)

    // ② 换到窄横那一档（480×320）：两件**整件不画**（`v-if` 收掉，不是 CSS 藏起来）
    await page.setViewportSize({ width: 480, height: 320 })
    await page.waitForTimeout(400)
    const band = await page.evaluate(() => {
      const column = document.querySelector('[data-side="right"]')
      const r = column ? column.getBoundingClientRect() : null
      return {
        height: r ? Math.round(r.height * 100) / 100 : null,
        leadRows: document.querySelectorAll('[data-lead]').length,
        sigils: document.querySelectorAll('.scene-sigil').length,
      }
    })
    console.log('B4 @480x320: right band=' + JSON.stringify(band) + ' (threshold is 200)')
    expect(
      band.height,
      'B4: the right column is not on screen at 480x320 - nothing was measured',
    ).not.toBeNull()
    expect(
      band.leadRows,
      'B4 @480x320: the lead row is still drawn in a column this short (the tallEnough gate is gone)',
    ).toBe(0)
    expect(band.sigils, 'B4 @480x320: the silhouette is still drawn in the narrow band').toBe(0)
  })
})

test.describe('C 组 · 开场封面挂在「还没有故事」这个事实上', () => {
  test.use({ viewport: LAPTOP_720 })

  test('C1 没有故事 ⇒ 封面在屏上；有故事 ⇒ 封面不在（两个方向都断）', async ({ page }) => {
    // ① 有故事：封面必须在**不在**
    await openPlayer(page, { config: CONFIG, save: saveWith() })
    // 硬守卫：这一半要照的正是「已经在玩的那一局」—— 故事不在屏上，下面那句就没有对象
    await expect(
      page.locator('.line'),
      'C1 guard: the saved story is not on screen - this half proves nothing',
    ).toHaveCount(2)
    await expect
      .soft(
        page.locator('[data-cover]'),
        'C1: the cover covers a game that is already being played (refresh must not hide the story)',
      )
      .toHaveCount(0)

    // ② 没有故事：封面必须**在**
    await openPlayer(page, { config: UNREACHABLE })
    await expect.soft(page.locator('.line'), 'C1: a fresh game must not have story lines yet').toHaveCount(0)
    await expect.soft(page.locator('[data-cover]'), 'C1: a fresh game shows no cover at all').toHaveCount(1)
  })

  test('C2 封面卡片是它自己那份样式画出来的', async ({ page }) => {
    await openPlayer(page, { config: UNREACHABLE })
    const cover = page.locator('[data-cover]')
    await expect(cover, 'C2: no cover on screen - the rest is vacuous').toHaveCount(1)

    const card = cover.locator('.start-card')
    await expect(card, 'C2: the cover draws no card').toHaveCount(1)
    const reading = (await card.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const parent = el.parentElement
      const pr = parent ? parent.getBoundingClientRect() : null
      return {
        width: Math.round(r.width),
        height: Math.round(r.height),
        parentWidth: pr ? Math.round(pr.width) : 0,
      }
    })) as { width: number; height: number; parentWidth: number }
    console.log('C2 reading: ' + JSON.stringify(reading))
    // 🔴 有分辨力的那一条是**高**：这一份样式给它 `padding` + `gap` ⇒ 实测 296px；
    //    摘掉样式它只剩 `.start-stage` 的 padding ⇒ 120px（实测）。
    //    ⚠️ 不能断"宽 < 300"来证"塌成内容宽"：摘掉样式之后它是个块级盒，**反而撑满父层**（实测 1280px）。
    expect.soft(reading.height >= 200, 'C2: the card collapsed (the cover style is not running)').toBe(true)
    expect.soft(reading.width <= reading.parentWidth, 'C2: the card is wider than its stage').toBe(true)
  })

  test('C3 玩家没点开始就不许开场；点了之后封面进「正在跑」那一档', async ({ page }) => {
    // 🔴 **这一条要的是"点了才跑"，所以"跑"必须在屏上留得住** —— 两个前提：
    //    ① **有配置**（没配的话 `[data-cover-start]` 根本不画，那是 `[data-cover-configure]` 那一档）；
    //    ② **模型那一侧要慢**：用本仓既有的 `fakeLlm(page, 'slow')`（第一次调用拖 5 秒，
    //       `fixtures.ts` 的 `SLOW_MS`）—— 直接用"连不上"的配置会让 busy 那一档
    //       **只闪几十毫秒**（连接当场被拒）⇒ 轮询看不见它，判据会红在**取样**上而不是行为上。
    await fakeLlm(page, 'slow')
    await openPlayer(page, { config: CONFIG })
    const cover = page.locator('[data-cover]')
    await expect(cover, 'C3: no cover on screen - the rest is vacuous').toHaveCount(1)

    // ① 没点之前：没有正文、也没有"正在跑"（**自动开局**这条老行为就是在这一句上被抓的）
    await expect
      .soft(page.locator('.line'), 'C3: the opening ran by itself (the auto start is back)')
      .toHaveCount(0)
    await expect
      .soft(
        cover.locator('[data-status="busy"]'),
        'C3: the opening was already running before the player clicked',
      )
      .toHaveCount(0)

    // ② 点它
    const start = cover.locator('[data-cover-start]')
    await expect(start, 'C3: the cover offers no start button the player could press').toHaveCount(1)
    await start.click()

    // 🔴 **改前断的是"封面 10 秒内消失（进正文）"—— 与它自己用的假 API 自相矛盾**：
    //    那时用的是 `https://127.0.0.1:9/v1`（连不上）⇒ 回合抛错 ⇒ 事件流里永远没有故事
    //    ⇒ `hasStory` 恒假 ⇒ **封面本来就该留着**（S3 实测那一档：`cover=1 · lines=0 · status=error`）。
    //    ⚠️ 判据自己的注释当时就写着"假 API 连不上 ⇒ 跑也跑不出正文" —— 期望值没跟着那句话走。
    // ⇒ 改成断**这一档真能做到的事**：玩家那一下**真的把这一局跑起来了** —— 封面进"正在跑"那一档。
    //    而**不要求**它进正文（进正文要有真模型跑完九个节点，那是 C1 第二半 + `smoke.spec.ts` 的活）。
    // ⚠️ 边界（别读成"点了开始什么都不用发生"）：断的是**"正在跑"这一档真的出现过**；
    //    没接线时它照样红 —— 连那颗按钮都不在。
    await expect
      .soft(
        cover.locator('[data-status="busy"]'),
        'C3: pressing start did not start the opening at all (the cover never entered its running state)',
      )
      .toHaveCount(1, { timeout: 4_000 })
  })

  test('C4 屏上不许有两条 [data-status]（盖上而不是收掉会撞严格模式）', async ({ page }) => {
    // 🔴 **夹具从"有配置但连不上"换成"没配"**（评审 S4 的 O1）：用前者时那一档 `[data-status]`
    //    **恰好 0 条** ⇒ `0 <= 1` 与 `0 === 0` **两边都恒真**、这条判据**不可能红**（假绿）。
    //    换成"没配"之后封面走 `data-status="info"` 那一档 ⇒ 屏上**有**一条，
    //    于是"盖住而不是收掉 ⇒ 两条"这件事**真的能发生、也真的能被抓到**。
    await openPlayer(page, { config: null })
    const cover = page.locator('[data-cover]')
    await expect(cover, 'C4: no cover on screen - the rest is vacuous').toHaveCount(1)

    // 🔴 **改前断的是"恰好 1 条"** —— 那要求封面在"安静"那一档也必须有状态行，
    //    而那道文案今天不存在（`status` / `notice` 都是 `null` ⇒ 封面三个分支全不中）⇒
    //    要让它成立得**给封面加一句新文案 + 一个新键** ⇒ **超甲档**（甲档 = 不动主界面结构）。
    // ⇒ 放宽成**"至多一条"**，但**牙还在**：它原本要抓的是"盖住而不是收掉 ⇒ 屏上两条 `[data-status]`"
    //    （`StoryPanel.vue:106-107` 一条 + `StoryCover.vue:59-64` 一条）—— 两条当场红。
    // ⚠️ 边界（从"恰好 1"放宽掉的那一半）：**"0 条"现在也算过** ⇒ "封面在没配 API 那一档
    //    该不该有一句人话"变成**产品决定**（要老板拍，已进挂账），判据不替它做主。
    //    📌 那条缝另有 `smoke.spec.ts:173` 兜着（它断的就是"欢迎语走状态行"）。
    const statusLines = await page.locator('[data-status]').count()
    console.log('C4 reading: statusLines=' + statusLines)
    expect
      .soft(statusLines <= 1, 'C4: two status lines on one screen (the cover was laid over, not swapped out)')
      .toBe(true)
    // 封面自己那条**不许是"多出来的那份"**：屏上有几条，封面里就有几条（没有一条落在封面之外）
    expect
      .soft(
        await cover.locator('[data-status]').count(),
        'C4: the status line on screen is not the cover own',
      )
      .toBe(statusLines)
  })
})

test.describe('D 组 · 不许挤坏（沿用已有四条探针，一条都不减）', () => {
  test.use({ viewport: LAPTOP_720 })

  test('D 三条栏那一屏照样干净，正文仍在地板之上', async ({ page }) => {
    await openPlayer(page, { config: CONFIG, save: saveWith() })
    const probe = (await page.evaluate(PROBE)) as Probe
    console.log('D probe: ' + JSON.stringify(probe))
    expectClean(probe)
    const story = (await page.locator('[data-story]').boundingBox()) ?? { height: 0 }
    // 正文那一行的硬地板：`player-screen.css:21` 的 `--story-min: 120px`（设计 v5：120 − 32 ≈ 3 行正文）
    expect(
      story.height,
      'D: the story column fell under the 120px floor (--story-min)',
    ).toBeGreaterThanOrEqual(120)
  })
})
