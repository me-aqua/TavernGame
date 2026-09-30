/**
 * 接线票（甲档）· **A 组**：地标剪影接在右栏底纹上 —— 真浏览器判据。
 *
 * 契约与逐条理由：`.team/test/2026-09-30/契约-接线.md`；
 * 形态与验收口径：`.team/design/2026-09-30/接线票-形态方案.md` §六（S1 组长采纳为全组口径）。
 * 起点红原文：`.team/test/2026-09-30/start-red-wiring-A.log`；验牙读数：`teeth-probe.log`。
 *
 * 🔴 **只断"继承不下来"的计算值**（承重纪律）：`color` / `font-family` 这类**继承属性**是最弱的一把尺 ——
 *    组件那份样式没加载时它会从父层继承、**可能照样命中期望值**。真正证明"这份样式在跑"的是
 *    `position` / `opacity` / `pointer-events` / `animation-name`，**再配一条几何值**。
 * 🔴 **为什么只能在真浏览器里**：jsdom 没有布局（盒子恒为 0×0）、`matchMedia` 恒为 `false`
 *    ⇒ 组件层那件判据（`tests/world-sigil-dom.test.ts`）自己就写着"这一件不测样式"。
 *
 * ⚠️ 这一层读的是**构建产物**（`dist/`）：`src/` 改了必须重新构建才看得见。
 * ⚠️ **B/C/D 三组在同目录的 `wiring-mark-cover.spec.ts`**（同一票，按组长 2026-09-30 的裁决拆成两份
 *    —— 一个文件一次交不上去：逐文件 500 行的门是按"这一笔加了多少行"算的）。
 */
import { expect, test, type Page } from '@playwright/test'
import {
  APP_PATH,
  CONFIG,
  CONFIG_KEY,
  DEBUG_KEY,
  LANG_KEY,
  SAVE_KEY,
  THEME_KEY,
  saveWith,
  seedStorage,
} from './fixtures'

/** 最差承诺工位（老板：「我们玩家用的最差最差也是个 720p 屏幕」）· 与整页巡检同一块屏幕 */
const LAPTOP_720 = { width: 1280, height: 720 }

/**
 * 剪影的种子 —— **从屏上那条 `.scene-name` 现读**（不是我在 Node 侧拼一个期望串）。
 *
 * 🔴 **前两版都错在"期望值是从哪来的"上，两次的原因不一样，都记在这儿**：
 *    ① 第一版取 `fixtures.OPENING_PLACE`（**卡的初值**），而这条用例种的是 `saveWith()`
 *       （那份存档把主控写在**酒馆**）⇒ 期望 `晨风镇 · 醉猫旅店 · 旅店大堂` vs 真读数
 *       `晨风镇 · 酒馆 · 大堂`（S3 先量到的就是这个）；
 *    ② 第二版改成"从存档里按 `display.scene.who` 取"—— **那条路径取不到地点**：
 *       卡的 `display.scene` 是 `{ path: 'world.谁在哪', who: 'lead.名称' }`，**`who` 是"主控名字在哪一格"**
 *       （拿它去册子里查那一条），**地点在 `path` 那本册子里**。实测：`at('lead.名称')` = `"无名者"`（一个字符串）
 *       ⇒ `PLACE_FIELDS` 那三个栏名在它下面全是 `undefined` ⇒ 拼出 ` ·  · ` ⇒
 *       `toContainText(' ·  · ')` **红在一条看着像空串的期望上**（探针读数在 `zz-probe-seed.log`）。
 * ⇒ 正解：**侧栏那一串读屏**（`AppSidebar.vue:27-29` 算出来的就是它），再拿它去算期望的那一座地标。
 *    ⚠️ 这不是"用实现算期望"：那一条断的是**两处消费点的一致性**（同一个 `scene` 投影 ⇒ 同一座地标），
 *    而"侧栏那一串本身对不对"另有 `smoke.spec.ts:163` 在断（对照卡的初值）。
 */
function seedFromSidebar(page: Page): string {
  return page.evaluate(() => (document.querySelector('.scene-name')?.textContent ?? '').trim())
}

/** 名字 → 一个非负整数（`SceneSigil.vue` 里那一份是同一个函数） */
function hash(text: string): number {
  let value = 0
  for (let i = 0; i < text.length; i += 1) value = ((value << 5) - value + text.charCodeAt(i)) | 0
  return Math.abs(value)
}

/** 剪影那一屏的读数（`evaluate` 的返回形状） */
interface SigilFacts {
  count: number
  /** 只读**非继承**的那几样 —— 动画在跑时 `opacity` 会漂，所以不把它写进期望值 */
  style: { position: string; pointerEvents: string; zIndex: string } | null
  rect: { left: number; right: number; top: number; bottom: number; width: number; height: number } | null
  /** 它挂着的那一层 = 最近的那个非 static 祖先（`position: absolute` 的几何父层） */
  anchor: { tag: string; cls: string; rect: SigilFacts['rect'] } | null
  /** 种子真的传到了组件里没有：四座地标里的哪一座（按第一段 path 的起点认） */
  variant: number | null
  /** 右栏那一栏的盒子 */
  column: SigilFacts['rect']
}

/**
 * 剪影那一屏的读数。
 *
 * ⚠️ 这一整段在**模板字符串**里：注释里别写反引号 + 美元花括号，那会被当成插值求值（踩过一次）。
 * ⚠️ 定位祖先**不用 `offsetParent`**：它在 SVG 元素上是 `undefined`（实测），
 *    自己往上找第一个非 `static` 的祖先 —— 那就是"几何父层"的定义，HTML / SVG 一视同仁。
 */
const SIGIL_PROBE = `(() => {
  const round = (n) => Math.round(n * 100) / 100
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom),
      width: round(r.width), height: round(r.height),
    }
  }
  const el = document.querySelector('.scene-sigil')
  const column = document.querySelector('[data-side="right"]')
  if (!el) return { count: 0, style: null, rect: null, anchor: null, variant: null, column: box(column) }
  const cs = getComputedStyle(el)
  const marks = el.querySelectorAll('.scene-mark')
  let anchor = el.parentElement
  while (anchor && getComputedStyle(anchor).position === 'static') anchor = anchor.parentElement
  const head = (marks.length ? marks[0].getAttribute('d') || '' : '').slice(0, 28)
  return {
    count: document.querySelectorAll('.scene-sigil').length,
    style: { position: cs.position, pointerEvents: cs.pointerEvents, zIndex: cs.zIndex },
    rect: box(el),
    anchor: anchor ? { tag: anchor.tagName.toLowerCase(), cls: String(anchor.className || ''), rect: box(anchor) } : null,
    variant: head.startsWith('M104 214V92H88V66') ? 0 : head.startsWith('M78 214v-84') ? 1 : head.startsWith('M96 214v-40H72') ? 2 : head.startsWith('M24 214') ? 3 : null,
    column: box(column),
  }
})()`

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

test.describe('A 组 · 地标剪影接在右栏底纹上', () => {
  test.use({ viewport: LAPTOP_720 })

  test('A1-A5 剪影在右栏里，且它自己那份样式真的在跑 @ 1280x720', async ({ page }) => {
    await openPlayer(page, { config: CONFIG, save: saveWith() })

    const facts = (await page.evaluate(SIGIL_PROBE)) as SigilFacts
    console.log('A group reading: ' + JSON.stringify(facts))

    // A1 · 在不在（**反空转**：它不在 ⇒ 下面几句全绿也是空转）
    expect(facts.count, 'A1: no scene silhouette on the player screen - the rest is vacuous').toBeGreaterThan(
      0,
    )

    // A1 · **它落在右栏里**（方案 §1.2）。🔴 这一条就是"那个根有没有 `relative`"的现场判据：
    //    实测（`teeth-probe.log`）没有 `relative` 时它挂到 `.story-bg` 上 ⇒ 宽 **1280px**、跨过两栏。
    const column = facts.column
    expect(column, 'A1: the right column is not on screen at 1280x720').not.toBeNull()
    expect
      .soft(
        facts.rect!.left >= column!.left - 1 && facts.rect!.right <= column!.right + 1,
        'A1: the silhouette is not inside the right column',
      )
      .toBe(true)

    // A2 · `position` / `z-index`：**非继承** ⇒ 摘掉 `<style scoped>` 立刻变 static
    expect
      .soft(
        facts.style?.position,
        'A2: the silhouette is not absolutely positioned (its scoped style is not running)',
      )
      .toBe('absolute')
    expect.soft(facts.style?.zIndex, 'A2: the silhouette does not sit on its own layer').toBe('0')

    // A3 · `pointer-events`：非继承，且是这份样式的字面值（装饰不许吃点击）
    expect
      .soft(facts.style?.pointerEvents, 'A3: the decoration eats clicks (pointer-events must be none)')
      .toBe('none')

    // A4 · 呼吸动效的名字 —— `@keyframes` 随件走，摘了就是 `none`。
    // 🔴 **断的是前缀，不是全等**：Vue 的 SFC 编译器会给 `<style scoped>` 里的 `@keyframes`
    //    **改一个带 hash 的名字**（构建产物逐字：`@keyframes scene-breathe-f28103b1`；
    //    真浏览器读到 `animationName = "scene-breathe-f28103b1"`）。
    //    ⚠️ 我造这条时用的是 `teeth-probe.mjs` **注入的裸 CSS**（没过 Vue 编译）⇒ 那时量到的是裸名 ——
    //    **量具的口径与实件的口径不是同一个**（同族第三次）。
    // ⇒ 前缀匹配**照样证明"这份 CSS 在跑"**：hash 是 Vue 加的、名字主体是作者写的；
    //    而"样式根本没加载"那一档读到的是 `none`（不是别的名字）⇒ 仍然抓得住。
    // ⚠️ 它抓不住的是"换一个同前缀的动画名"（那得靠 A7 的两个动效上下文与 A5 的几何一起看）。
    let animationName: string
    try {
      animationName = await page
        .locator('.scene-sigil')
        .first()
        .evaluate((node) => getComputedStyle(node).animationName)
    } catch {
      animationName = 'MISSING'
    }
    expect
      .soft(
        animationName,
        'A4: the breathing animation is not running (animation-name must start with scene-breathe)',
      )
      .toMatch(/^scene-breathe/)

    // A5 · **几何**：这条是 A2-A4 的兜底，也是"看得见"的唯一硬证据。
    // 🔴 只断"≥200 / ≥100"**不够** —— 实测（`teeth-probe.log`）：把整块样式摘掉，那个 `<svg>`
    //    仍按 `viewBox 400x240` 撑出 **298x179**（宽高来自固有比例，不是 0）⇒ 光比阈值它照样过。
    //    真正有分辨力的两条：① 弦宽=栏的内容宽（这条样式给的 `width:100%`）；
    //    ② **框高 = 浏览器解出来的 `min(46vh, 26rem)`**（实测 331px；摘掉样式是 179px）。
    expect
      .soft(
        Math.abs((facts.rect?.width ?? 0) - (column!.width - 2)) <= 2,
        'A5: the silhouette does not span the column content width',
      )
      .toBe(true)
    const wanted = await page
      .locator('.scene-sigil')
      .first()
      .evaluate(() => {
        const probe = document.createElement('div')
        probe.style.height = 'min(46vh, 26rem)'
        document.body.appendChild(probe)
        const height = Math.round(probe.getBoundingClientRect().height)
        probe.remove()
        return height
      })
    expect
      .soft(
        Math.abs((facts.rect?.height ?? 0) - wanted) <= 2,
        'A5: the box height is not the one this style gives (' +
          wanted +
          'px) - it fell back to the SVG intrinsic size',
      )
      .toBe(true)

    // 种子对不对：侧栏那一串与剪影画出来那一座**必须由同一份数据算出来**。
    // ⚠️ 这条断的是**数据**（哪座地标），不是样式；它与 A2-A5 是两件事。
    const seed = await seedFromSidebar(page)
    console.log('A1 seed from the sidebar: ' + JSON.stringify(seed))
    expect(seed, 'A1: the sidebar prints nothing for the place - this assertion would be vacuous').not.toBe(
      '',
    )
    expect
      .soft(facts.variant, 'A1: the silhouette does not follow from the place the sidebar prints')
      .toBe(hash(seed) % 4)
  })

  test('A6 剪影挂在它自己那一层上，且 480x320 那档不许伸出栏外', async ({ page }) => {
    await openPlayer(page, { config: CONFIG, save: saveWith() })

    // 1280x720：`position: absolute` 的几何父层 = 最近的那个非 static 祖先。
    // 🔴 这一条是 A1"落在栏里"的**成因版**：没有 `relative` 时它挂到 `.story-bg` 上，
    //    宽 **1280px**、跨过两条栏（`teeth-probe.log` 实测）。
    const wide = (await page.evaluate(SIGIL_PROBE)) as SigilFacts
    expect(wide.count, 'A6: no scene silhouette on the player screen - the rest is vacuous').toBeGreaterThan(
      0,
    )
    expect(wide.anchor, 'A6: the silhouette has no positioned ancestor to hang on').not.toBeNull()
    console.log(
      'A6 wide: silhouette=' +
        JSON.stringify(wide.rect) +
        ' anchor=' +
        JSON.stringify(wide.anchor!.rect) +
        ' cls=' +
        wide.anchor!.cls,
    )
    // 它挂着的那一层必须**就是它所在的那一栏**（不是更外面那层壳）
    expect
      .soft(
        wide.rect!.left >= wide.column!.left - 1 && wide.rect!.right <= wide.column!.right + 1,
        'A6: the silhouette is anchored outside its own column (the relative root is missing)',
      )
      .toBe(true)

    // 480x320：窄横那一档 —— 右带只剩几像素高，剪影要么不画、要么不许伸出栏外
    await page.setViewportSize({ width: 480, height: 320 })
    await page.waitForTimeout(400)
    const narrow = (await page.evaluate(SIGIL_PROBE)) as SigilFacts
    console.log(
      'A6 narrow: count=' +
        narrow.count +
        ' silhouette=' +
        JSON.stringify(narrow.rect) +
        ' column=' +
        JSON.stringify(narrow.column),
    )
    if (narrow.count > 0 && narrow.rect && narrow.column) {
      expect
        .soft(
          narrow.rect.bottom <= narrow.column.bottom + 1 && narrow.rect.top >= narrow.column.top - 1,
          'A6 @480x320: the silhouette spills out of its column',
        )
        .toBe(true)
    }
  })

  test('A6b 900x700（一条栏档）：屏上一个剪影都没有 —— 媒体查询在按宽度办事', async ({ page }) => {
    await openPlayer(page, { config: CONFIG, save: saveWith() })

    // 反面控制：1280x720 上必须有 ⇒ 两条一起才证明那条媒体查询在按宽度办事
    const wide = (await page.evaluate(SIGIL_PROBE)) as SigilFacts
    expect(
      wide.count,
      'A6b: the wide screen must draw one - otherwise this pair proves nothing',
    ).toBeGreaterThan(0)

    await page.setViewportSize({ width: 900, height: 700 })
    await page.waitForTimeout(400)
    const narrow = (await page.evaluate(SIGIL_PROBE)) as SigilFacts
    console.log('A6b @900x700: count=' + narrow.count)
    expect(
      narrow.count,
      'A6b: a silhouette is drawn in the one-column band (the min-width: 1280px media query is not doing its job)',
    ).toBe(0)
  })

  test('A7 reduced motion 下剪影静止（两个动效上下文对撞）', async ({ browser }) => {
    /** 只换动效偏好、其余逐字相同：同一条屏在两个上下文各量一次 `animation-name` */
    const nameIn = async (reducedMotion: 'reduce' | 'no-preference') => {
      const context = await browser.newContext({ viewport: LAPTOP_720, reducedMotion })
      const page = await context.newPage()
      try {
        await openPlayer(page, { config: CONFIG, save: saveWith() })
        const facts = (await page.evaluate(SIGIL_PROBE)) as SigilFacts
        expect(facts.count, 'A7: no silhouette at all in the ' + reducedMotion + ' context').toBeGreaterThan(
          0,
        )
        return await page
          .locator('.scene-sigil')
          .first()
          .evaluate((node) => getComputedStyle(node).animationName)
      } finally {
        await context.close()
      }
    }
    const reduce = await nameIn('reduce')
    const animated = await nameIn('no-preference')
    console.log('A7: reduce=' + reduce + ' no-preference=' + animated)
    // 同样断**前缀**（理由见 A4：Vue 给 scoped 的 `@keyframes` 加了 hash）。
    // 🔴 这一条的牙在两个上下文**对撞**：reduce 那半必须是 `none` —— 那一档名字被换掉了也是"红"，
    //    所以"名字主体对不对"由上面那句管、"这条媒体查询有没有生效"由这一对管。
    expect(reduce, 'A7: the silhouette must stand still under reduced motion').toBe('none')
    expect(animated, 'A7: it must really be breathing otherwise (a missing style is not "still")').toMatch(
      /^scene-breathe/,
    )
  })
})
