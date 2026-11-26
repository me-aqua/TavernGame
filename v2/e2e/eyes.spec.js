/**
 * SPEC §9.3：**眼睛控制提示词拼装**。
 *
 * 三种眼睛，三种落点（CONTRACT §8.2）：
 *   · 公共提示词块 → **右栏** `[data-prompt-read][data-prompt-id]`；
 *   · 状态元素 → **左栏** `[data-eyes="read"]`；
 *   · 上游节点 → **工作流细条**上、只有排在前面那些节点才有 `[data-read-upstream][data-upstream-id]`。
 *
 * ⚠️ 跑的是**存档快照**（§8.3），所以每一条都是：改卡里的眼睛 → **新建存档** → 跑 → 看 prompt。
 *    拿旧存档去验眼睛会永远看不到变化 —— 那不是 bug，是快照语义。
 * 断言找的是**只住在那一处的记号**（BODY_ONE / VAL_PLACE_A1 / `[mock] turn N:` / 路由回的正文），
 * 所以「找不到」等价于「真的没读它」，不会被别处的同样文字蒙过去。
 *
 * 上游那两条走**真 provider 路径**（`page.route` 顶替服务商）：mock 只有 output 有正文，
 * 拿 mock 证不了「上游正文进没进提示词」。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  createSave,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  openAiSse,
  openStory,
  playTurn,
  promptRead,
  readStorage,
  route,
  slowMock,
  tracePrompt,
  upstreamRead,
} from './support/app.js'

const CARD_ID = 'c1'
/** 调试读数内联在故事流里：读某个节点的 prompt 必须带节点那一格（§8.3） */
const OUTPUT_PROMPT = tracePrompt('output')

/** 一个「真」预设：请求会被 `page.route` 拦掉，不联外网 */
const REAL_PRESET = {
  ...slowMock(0),
  id: 'p-real',
  name: 'real',
  provider: 'openai-compatible',
  baseUrl: 'https://mock.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
}

/** 种一张卡 + 一个预设（不种存档：眼睛要在「快照之前」改） */
function seedCardOnly() {
  const card = makeCard()
  return { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] }
}

/** 进编辑器、选中某节点、点一下某个眼睛，确认它真的翻了面 */
async function toggleEye(page, { nodeId, selector }) {
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator(`[data-node-id="${nodeId}"]`).click()
  const eye = page.locator(selector)
  const before = await eye.getAttribute('data-on')
  await eye.click()
  await expect(eye).toHaveAttribute('data-on', before === 'true' ? 'false' : 'true')
  // v5 §6.1：编辑只改草稿 ⇒ 眼睛翻面后要保存，后面的新建存档 / 读盘才看得到
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-ok]')).toBeVisible()
  return before
}

test.describe('眼睛：公共提示词块（右栏）', () => {
  test('关掉 pr1 的读眼睛 ⇒ 它的正文从 prompt 里消失，pr2 还在', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    // 正向控制：先确认默认是读的
    expect(await toggleEye(page, { nodeId: 'output', selector: promptRead('pr1') })).toBe('true')

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(OUTPUT_PROMPT)
    await expect(prompt).not.toContainText('BODY_ONE')
    await expect(prompt).toContainText('BODY_TWO')
    await expect(prompt).toContainText('NODE_OUT')
  })

  test('把 pr1 再打开 ⇒ 正文回来（不是「永远都不在」）', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    await toggleEye(page, { nodeId: 'output', selector: promptRead('pr1') })
    await toggleEye(page, { nodeId: 'output', selector: promptRead('pr1') })

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)
    await expect(page.locator(OUTPUT_PROMPT)).toContainText('BODY_ONE')
  })
})

test.describe('眼睛：状态元素（左栏）', () => {
  test('关掉元素 1 的读眼睛 ⇒ 它这一回合的值从 prompt 里消失，元素 2 还在', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    await toggleEye(page, { nodeId: 'output', selector: '[data-state-item="1"] [data-eyes="read"]' })

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(OUTPUT_PROMPT)
    // 元素 1 这一回合已被判定节点写成 mock-t1（同一回合内可见，P2）⇒ 关掉眼睛就该一个字符都不剩
    await expect(prompt).not.toContainText('mock-t1')
    await expect(prompt).not.toContainText('VAL_PLACE_A1')
    await expect(prompt).toContainText('VAL_MOOD_B2')
  })

  test('眼睛打开时，元素 1 的值是**这一回合刚写进去的**那份（不是初值）', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(OUTPUT_PROMPT)
    await expect(prompt, '判定节点这一回合写的值要立刻进输出节点的提示词').toContainText('mock-t1')
    await expect(prompt).not.toContainText('VAL_PLACE_A1')
  })
})

test.describe('眼睛：上游输出（工作流细条）', () => {
  /**
   * 让真 provider 路径按**请求顺序**回不同正文：1 time / 2 check / 3 extra / 4 output。
   * 这样输出节点的提示词里有没有上游正文、按什么顺序，都能逐字判。
   */
  async function stubProviderByNode(page) {
    const texts = { 0: 'TIME_TEXT', 1: 'CHECK_TEXT', 2: 'EXTRA_TEXT', 3: 'OUTPUT_TEXT' }
    const requests = []
    await page.route('**/chat/completions', async (intercepted) => {
      const body = JSON.stringify(intercepted.request().postDataJSON())
      requests.push(body)
      const index = requests.length - 1
      await intercepted.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: openAiSse([texts[index]]),
      })
    })
    return requests
  }

  test('默认名单（check + extra）：两个上游正文都进输出节点的提示词，按链顺序；没点名的 time 不进', async ({
    page,
  }) => {
    await stubProviderByNode(page)
    const card = makeCard()
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [REAL_PRESET] },
    })
    await openStory(page, CARD_ID, 's1', { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(OUTPUT_PROMPT)
    await expect(prompt).toContainText('CHECK_TEXT')
    await expect(prompt).toContainText('EXTRA_TEXT')
    // 链顺序：check 在 extra 之前（名单里的先后不管用）
    const text = (await prompt.textContent()) ?? ''
    expect(text.indexOf('CHECK_TEXT'), 'check 的上游正文不在 extra 之前').toBeLessThan(
      text.indexOf('EXTRA_TEXT'),
    )
    // 输出节点只点名了 check + extra ⇒ time 的正文不许进来
    await expect(prompt).not.toContainText('TIME_TEXT')
    // 正向控制：这一趟的正文确实是从真 provider 那一条路来的
    await expect(page.locator('[data-line="narration"]')).toHaveText('OUTPUT_TEXT')
  })

  test('关掉 check 的上游眼睛 ⇒ 它的正文不进 prompt；extra 还在（正向控制）', async ({ page }) => {
    await stubProviderByNode(page)
    const card = makeCard()
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [REAL_PRESET] },
    })
    // 默认是读的 ⇒ 点一下关掉
    expect(await toggleEye(page, { nodeId: 'output', selector: upstreamRead('check') })).toBe('true')

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(OUTPUT_PROMPT)
    await expect(prompt).not.toContainText('CHECK_TEXT')
    await expect(prompt).toContainText('EXTRA_TEXT')
  })

  test('打开回来 ⇒ check 的正文又进 prompt', async ({ page }) => {
    await stubProviderByNode(page)
    const card = makeCard()
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [REAL_PRESET] },
    })
    await toggleEye(page, { nodeId: 'output', selector: upstreamRead('check') })
    await toggleEye(page, { nodeId: 'output', selector: upstreamRead('check') })

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)
    await expect(page.locator(OUTPUT_PROMPT)).toContainText('CHECK_TEXT')
  })
})

test.describe('眼睛：细条上的上游眼睛只长在「前面」的节点上', () => {
  test('选中输出节点 ⇒ 三个上游各一颗；选中判定节点 ⇒ 只有时间那一颗；选中首节点 ⇒ 一颗都没有', async ({
    page,
  }) => {
    await boot(page, { storage: seedCardOnly() })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()

    // S0：没选节点 ⇒ 一颗都没有
    await expect(page.locator('[data-read-upstream]')).toHaveCount(0)

    await page.locator('[data-node-id="output"]').click()
    const eyes = page.locator('[data-read-upstream]')
    await expect(eyes).toHaveCount(3)
    for (const upstreamId of ['time', 'check', 'extra']) {
      await expect(page.locator(upstreamRead(upstreamId))).toHaveCount(1)
    }
    // 自己（output）没有上游眼睛
    await expect(page.locator(upstreamRead('output'))).toHaveCount(0)

    await page.locator('[data-node-id="check"]').click()
    await expect(eyes).toHaveCount(1)
    await expect(page.locator(upstreamRead('time'))).toHaveCount(1)
    // 下游的 output / extra 不是 check 的上游
    await expect(page.locator(upstreamRead('output'))).toHaveCount(0)
    await expect(page.locator(upstreamRead('extra'))).toHaveCount(0)

    await page.locator('[data-node-id="time"]').click()
    await expect(eyes, '首节点没有任何上游').toHaveCount(0)
  })

  test('点一下上游眼睛：翻面并把这条 id 写进 / 拿出选中节点的 readsUpstream', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await page.locator('[data-node-id="output"]').click()

    const eye = page.locator(upstreamRead('check'))
    await expect(eye).toHaveAttribute('data-on', 'true')
    await eye.click()
    await expect(eye).toHaveAttribute('data-on', 'false')
    // v5：编辑只改草稿 ⇒ 先保存再读盘
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    let stored = (await readStorage(page, KEYS.cards))[0]
    let output = stored.chain.find((node) => node.id === 'output')
    expect(output.readsUpstream, '关掉之后名单里不该还有 check').not.toContain('check')
    expect(output.readsUpstream, '别的上游不许被顺手删掉').toContain('extra')

    await eye.click()
    await expect(eye).toHaveAttribute('data-on', 'true')
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()
    stored = (await readStorage(page, KEYS.cards))[0]
    output = stored.chain.find((node) => node.id === 'output')
    expect(output.readsUpstream).toContain('check')
  })
})

test.describe('眼睛：拼装顺序', () => {
  test('输出节点的 prompt 里 提示词 → 状态 → 历史（含本回合行动）→ 本节点 的先后关系成立', async ({
    page,
  }) => {
    await boot(page, { storage: seedCardOnly() })
    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const output = (await page.locator(OUTPUT_PROMPT).textContent()) ?? ''
    const at = (mark) => output.indexOf(mark)
    // 状态段用**没被这一回合写过**的元素 2 当锚（元素 1 已被判定节点写成 mock-t1，P2）
    for (const mark of ['BODY_ONE', 'BODY_TWO', 'VAL_MOOD_B2', 'mock-t1', 'act one', 'NODE_OUT']) {
      expect(at(mark), `${mark} 没进输出节点的 prompt`).toBeGreaterThanOrEqual(0)
    }
    expect(at('BODY_ONE')).toBeLessThan(at('BODY_TWO'))
    expect(at('BODY_TWO')).toBeLessThan(at('VAL_MOOD_B2'))
    // 行动是历史块的最后一条（不是独立的一段）⇒ 它在状态之后、本节点提示词之前
    expect(at('VAL_MOOD_B2')).toBeLessThan(at('act one'))
    expect(at('act one')).toBeLessThan(at('NODE_OUT'))
    expect((output.match(/act one/g) ?? []).length, '行动在历史块里只出现一次').toBe(1)

    // 口径 A 再钉一条：historyTurns=0 的节点**也**看得见行动（只此一句，不重复）
    const time = (await page.locator(tracePrompt('time')).textContent()) ?? ''
    expect(time, 'historyTurns=0 也要看见本回合行动（口径 A）').toContain('act one')
    expect((time.match(/act one/g) ?? []).length, '行动在历史块里只出现一次').toBe(1)
  })
})

test.describe('读 / 写控件：看得见的 chip（老板 2026-11-25）', () => {
  test('三处读眼睛 + 写眼睛：≥24×24、关着也有底色与边框、点开换成另一种底色', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    // 判定节点：状态元素可读可写、上游有时间、公共提示词也都在同一屏
    await page.locator('[data-node-id="check"]').click()

    const eyes = {
      stateRead: '[data-state-item="1"] [data-eyes="read"]',
      upstreamEye: upstreamRead('time'),
      promptEye: promptRead('pr1'),
      writeEye: '[data-state-item="1"] [data-eyes="write"]',
    }

    /** 控件这一刻的盒子与底色 —— 关着 / 开着都要能判，不靠像素基线 */
    async function measure(selector) {
      const box = await page.locator(selector).boundingBox()
      // 这一段在页面里跑 ⇒ 写成模板串（普通函数会被 lint 的 no-undef 拦下，见 support/app.js 的约定）
      const style = await page.evaluate(
        `(() => {
          const element = document.querySelector(${JSON.stringify(selector)})
          const computed = getComputedStyle(element)
          return { background: computed.backgroundColor, border: parseFloat(computed.borderTopWidth) }
        })()`,
      )
      return { ...style, width: box?.width ?? 0, height: box?.height ?? 0 }
    }

    // ① 点按目标：旧的 24px 幽灵按钮现在必须还是够大（WCAG 2.5.8 的 24×24 底线）
    for (const [name, selector] of Object.entries(eyes)) {
      await expect(page.locator(selector), `${name} 不见了`).toBeVisible()
      const chip = await measure(selector)
      expect(chip.width, `${name} 太窄（点按目标不足 24）`).toBeGreaterThanOrEqual(24)
      expect(chip.height, `${name} 太矮（点按目标不足 24）`).toBeGreaterThanOrEqual(24)
    }

    // ② 关着 ≠ 没有这个控件：底色不是全透明、边框至少 1px
    for (const name of ['stateRead', 'upstreamEye', 'promptEye']) {
      const chip = await measure(eyes[name])
      // 先钉读回来的形状：读不到底色时上面的 not.toBe 会静默通过（假绿）
      expect(chip.background, `${name} 没读到底色（量具坏了）`).toMatch(/^rgba?\(/)
      expect(chip.background, `${name} 关着时没有底色（像幽灵按钮）`).not.toBe('rgba(0, 0, 0, 0)')
      expect(chip.border, `${name} 关着时没有边框`).toBeGreaterThanOrEqual(1)
    }

    // ③ 开着 = 换一种底色（accent 实心），不是「只有一点点描边变化」
    const stateRead = page.locator(eyes.stateRead)
    await expect(stateRead).toHaveAttribute('data-on', 'false')
    const before = await measure(eyes.stateRead)
    await stateRead.click()
    await expect(stateRead).toHaveAttribute('data-on', 'true')
    const after = await measure(eyes.stateRead)
    expect(after.background, '开着的 chip 要换底色（accent 实心）').not.toBe(before.background)
    expect(after.background).not.toBe('rgba(0, 0, 0, 0)')
  })

  test('读 / 写 / 上游 chip 与普通按钮圆角统一：彼此差 ≤0.5px，且都 >4px、<12px', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card)],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    // 判定节点：状态树读/写、细条上游读、右栏提示词读 —— 三类 chip 同屏
    await page.locator('[data-node-id="check"]').click()

    // 读回每一颗 chip 的圆角（浏览器侧代码一律模板串，见 support/app.js 的约定）
    const chips = await page.evaluate(
      `(() => {
        const groups = ['[data-eyes]', '[data-read-upstream]', '[data-prompt-read]']
        return groups.map((selector) => {
          const elements = [...document.querySelectorAll(selector)]
          return {
            selector,
            count: elements.length,
            radii: elements.map((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius)),
          }
        })
      })()`,
    )
    const chipRadii = []
    for (const group of chips) {
      expect(group.count, `${group.selector} 一颗都没有（判据失去对象）`).toBeGreaterThan(0)
      for (const radius of group.radii) {
        expect(Number.isFinite(radius), `${group.selector} 的圆角没读到数字（量具坏了）`).toBe(true)
        chipRadii.push(radius)
      }
    }

    // 普通按钮（CONTRACT §8.2 / §9.5 #15 的新口径：全站只留一档圆角，chip 不再单独一套）
    await openStory(page, CARD_ID, 's1')
    const buttons = await page.evaluate(
      `(() => {
        return ['[data-send]', '[data-debug-toggle]', '[data-back]'].map((selector) => {
          const element = document.querySelector(selector)
          return [selector, element ? parseFloat(getComputedStyle(element).borderTopLeftRadius) : null]
        })
      })()`,
    )
    const buttonRadii = []
    for (const [selector, radius] of buttons) {
      expect(Number.isFinite(radius), `${selector} 不在页面上`).toBe(true)
      buttonRadii.push(radius)
    }

    // ① 两类之间不许有「特殊那一档」：最大最小相差 ≤0.5px（3px chip / 999px 胶囊都过不了这关）
    const all = [...chipRadii, ...buttonRadii]
    const min = Math.min(...all)
    const max = Math.max(...all)
    expect(
      max - min,
      `圆角没统一：最小 ${min}px、最大 ${max}px（chip 与按钮必须同一档）`,
    ).toBeLessThanOrEqual(0.5)

    // ② 这一档本身是「普通圆角」：>4px（不是方角 chip），<12px（不是胶囊 / 999px）
    for (const radius of all) {
      expect(radius, `圆角 ${radius}px 太小（不是普通按钮的圆角）`).toBeGreaterThan(4)
      expect(radius, `圆角 ${radius}px 太大（胶囊 / 999px 那一档）`).toBeLessThan(12)
    }
  })
})
