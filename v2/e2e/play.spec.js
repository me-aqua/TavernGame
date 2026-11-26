/**
 * 对话页（CONTRACT §8.3）—— 老板 2026-11-25 的新口径：
 *
 *   ① **没有封面、没有开始按钮**：打开存档直接看见故事流，第一段是「开场」那块提示词的**正文**；
 *   ② 消息里只有输入框 + `[data-send]`；
 *   ③ 调试读数**内联在故事流里**（右侧面板与 `[data-turn-ms]` 表头都已删除）：
 *      关 = 只剩故事 + 每回合一行合计 `[data-turn-stats]`（回合 / 总 token / 总耗时 / t/s）；
 *      开 = 每个节点一张 `[data-trace]` 卡片（提示词 / 思考 / 工具 / 输出 / token / t/s / 耗时 / 预设）。
 *
 * 为什么单独一份：这三条都是「界面在不在」的事，单测看不见；而 trace 卡片是**唯一**
 * 能看见「这一步到底用了哪个预设 / 拼了什么提示词」的地方 —— 它的开、关、以及
 * **加载旧存档后再打开开关也要补出历史回合**（读数落在 `save.events`，不是内存里那一回合），
 * 都必须能翻面。
 *
 * 🔴 这一份**不用 `playTurn(page, action, n)`**：`n` 数的是「故事流里正文的条数」，
 *    而「开场」的正文也是 story 里的一条 narration —— 带开场正文的卡跑一回合到底算 2 条还是 3 条，
 *    会把判据钉在计数口径上（措辞一变就红）。这里改成等**这一回合的终态**：
 *    `[data-turn]` = 第几回合 + 最后一条 narration 的正文 —— 那才是玩家看得见的事实。
 */
import { expect, test } from '@playwright/test'
import {
  boot,
  CJK,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  openAiSse,
  openStory,
  readRaw,
  readStorage,
  slowMock,
  traceCard,
  turnStatsRow,
} from './support/app.js'

const CARD_ID = 'c1'
/** 夹具卡的节点 id（链顺序）：time → check → extra → output */
const NODE_IDS = ['time', 'check', 'extra', 'output']

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

/** 带「开场正文」的卡：这条正文必须是故事流的第一段（§8.3） */
function cardWithOpening(body = 'OPENING_LINE') {
  const card = makeCard()
  card.prompts = card.prompts.map((prompt) => (prompt.id === 'opening' ? { ...prompt, body } : prompt))
  return card
}

function seeded() {
  const card = cardWithOpening()
  return {
    [KEYS.cards]: [card],
    [KEYS.presets]: [MOCK_PRESET],
    [KEYS.saves]: [makeSave(card)],
  }
}

/**
 * 走一个回合，等它的终态：`[data-turn]` = `turn`、最后一条 narration = `narrationText`、
 * 「停止」已经消失。**不依赖故事流里正文的条数**（开场算不算一条与这条判据无关）。
 */
async function playOneTurn(page, { action, turn, narrationText }) {
  await page.locator('[data-action-input]').fill(action)
  await page.locator('[data-send]').click()
  await expect(page.locator('[data-turn]')).toHaveText(String(turn), { timeout: 15_000 })
  await expect(page.locator('[data-stop]')).toHaveCount(0)
  await expect(page.locator('[data-line="narration"]').last()).toHaveText(narrationText)
}

/** mock 提供方这一回合的正文（CONTRACT §7，逐字可断言） */
const mockNarration = (turn, action) => `[mock] turn ${turn}: ${action}`

test.describe('对话页：没有封面、开场是故事第一段', () => {
  test('打开存档就直接看见故事流：没有封面 / 开始按钮，第一段是开场正文', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')

    await expect(page.locator('[data-cover]')).toHaveCount(0)
    await expect(page.locator('[data-start]')).toHaveCount(0)
    const lines = page.locator('[data-line="narration"]')
    await expect(lines).toHaveCount(1)
    await expect(lines.first()).toHaveText('OPENING_LINE')
    // 输入区在（消息里只有输入框 + 发送）
    await expect(page.locator('[data-action-input]')).toBeVisible()
    await expect(page.locator('[data-send]')).toBeVisible()
  })

  test('开场正文为空 ⇒ 不硬塞一个空段落', async ({ page }) => {
    const card = cardWithOpening('')
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET], [KEYS.saves]: [makeSave(card)] },
    })
    await openStory(page, CARD_ID, 's1')
    await expect(page.locator('[data-line="narration"]')).toHaveCount(0)
  })

  test('有回合之后：开场在最前，其后是 action / narration 交替', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: mockNarration(1, 'act one') })

    // 开场 + 本回合的行动 + 本回合的正文
    const lines = page.locator('[data-line]')
    await expect(lines).toHaveCount(3)
    await expect(lines.nth(0)).toHaveText('OPENING_LINE')
    expect(await lines.nth(1).getAttribute('data-line'), '开场之后第一条是玩家的行动').toBe('action')
    await expect(page.locator('[data-line="action"]').first()).toHaveText('act one')
    await expect(page.locator('[data-line="narration"]').last()).toHaveText(mockNarration(1, 'act one'))
  })
})

test.describe('对话页：调试开关（读数内联在故事流里）', () => {
  test('关着：没有 trace 卡片，每回合一行 [data-turn-stats]（回合 / token / 耗时 / 速率）', async ({
    page,
  }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    const toggle = page.locator('[data-debug-toggle]')
    await expect(toggle).toHaveAttribute('data-on', 'false')
    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: mockNarration(1, 'act one') })
    await playOneTurn(page, { action: 'act two', turn: 2, narrationText: mockNarration(2, 'act two') })

    // 旧的调试面板钩子按老板口径整块删除 —— 一个都不许回来
    await expect(page.locator('[data-trace]')).toHaveCount(0)
    for (const gone of ['[data-debug]', '[data-debug-node]', '[data-debug-prompt]', '[data-turn-ms]']) {
      await expect(page.locator(gone), `${gone} 已被删除`).toHaveCount(0)
    }

    // 合计读数永远在：两回合各一行
    await expect(page.locator('[data-turn-stats]')).toHaveCount(2)
    for (const turn of [1, 2]) {
      const row = page.locator(turnStatsRow(turn))
      await expect(row.locator('[data-turn-stats-turn]')).toContainText(String(turn))
      // mock 不给用量 / 速率 ⇒ 说「没有」，不拿 0 冒充（CONTRACT §8.3）
      await expect(row.locator('[data-turn-stats-tokens]'), '没有用量时不许写 0').toHaveText(CJK)
      await expect(row.locator('[data-turn-stats-ms]')).toHaveText(/\d+\s*ms/)
      await expect(row.locator('[data-turn-stats-tps]'), '没有速率时不许写 0').toHaveText(CJK)
    }
  })

  test('关着：故事流只有 output 那条正文 —— 上游节点的返回一个字符都不许漏进去', async ({ page }) => {
    // 用真 provider 路径按请求顺序回不同正文：1 time / 2 check / 3 extra / 4 output
    const texts = { 0: 'TIME_TEXT', 1: 'CHECK_TEXT', 2: 'EXTRA_TEXT', 3: 'OUTPUT_TEXT' }
    const requests = []
    await page.route('**/chat/completions', async (intercepted) => {
      const body = openAiSse([texts[requests.length]])
      requests.push(body)
      await intercepted.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body,
      })
    })
    const card = cardWithOpening()
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [REAL_PRESET] },
    })
    await openStory(page, CARD_ID, 's1')
    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: 'OUTPUT_TEXT' })
    expect(requests, '四个节点各要一次调用（才可能漏正文）').toHaveLength(4)

    const narrations = page.locator('[data-line="narration"]')
    await expect(narrations).toHaveCount(2) // 开场 + 本回合 output 正文
    await expect(narrations.first()).toHaveText('OPENING_LINE')
    await expect(narrations.last()).toHaveText('OUTPUT_TEXT')
    // 其余三个节点的返回只许住在 trace 卡片里（调试关着 ⇒ 屏上任何地方都不该有）
    const screen = (await page.locator('[data-page="play"]').textContent()) ?? ''
    for (const mark of ['TIME_TEXT', 'CHECK_TEXT', 'EXTRA_TEXT']) {
      expect(screen.includes(mark), `${mark} 漏进了故事流（只有 output 能进）`).toBe(false)
    }
  })

  test('打开：每个节点一张 trace 卡片，按链顺序；提示词 / 工具 / 输出 / 读数都在', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: mockNarration(1, 'act one') })
    await page.locator('[data-debug-toggle]').click()

    const cards = page.locator('[data-trace]')
    await expect(cards, '四个节点 = 四张卡片').toHaveCount(4)
    const nodeIds = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-trace-node')),
    )
    expect(nodeIds, '卡片必须按链顺序排').toEqual(['time', 'check', 'extra', 'output'])
    const turns = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-trace-turn')),
    )
    expect(turns).toEqual(['1', '1', '1', '1'])

    for (const nodeId of ['time', 'check', 'extra', 'output']) {
      const card = page.locator(traceCard(nodeId))
      await expect(card, `缺少 ${nodeId} 的 trace 卡片`).toHaveCount(1)
      // 五样读数一个不少：提示词 / 耗时 / token / t/s / 预设
      await expect(card.locator('[data-trace-prompt]')).not.toHaveText('')
      await expect(card.locator('[data-trace-ms]')).toHaveText(/\d+\s*ms/)
      await expect(card.locator('[data-trace-tokens]')).toHaveText(CJK)
      await expect(card.locator('[data-trace-tps]')).toHaveText(CJK)
      await expect(card.locator('[data-trace-preset]')).toContainText(MOCK_PRESET.id)
    }

    // 输出节点：提示词与正文逐字在；没有工具调用 / 思考 ⇒ 不画空框
    const outputCard = page.locator(traceCard('output'))
    await expect(outputCard.locator('[data-trace-prompt]')).toContainText('NODE_OUT')
    await expect(outputCard.locator('[data-trace-output]')).toHaveText(mockNarration(1, 'act one'))
    await expect(outputCard.locator('[data-trace-tools]')).toHaveCount(0)
    await expect(outputCard.locator('[data-trace-thinking]')).toHaveCount(0)

    // 时间节点：工具调用带着执行结果；这一节点没有正文
    const timeCard = page.locator(traceCard('time'))
    await expect(timeCard.locator('[data-trace-tool]')).toHaveCount(1)
    await expect(timeCard.locator('[data-trace-tool-result]')).toContainText('day 1 hour 9')
    await expect(timeCard.locator('[data-trace-output]')).toHaveCount(0)

    // 开关开着时合计行照样在（不是「表头让位给面板」那套旧口径）
    await expect(page.locator(turnStatsRow(1))).toBeVisible()
  })

  test('加载后打开开关 / 刷新：历史回合的 trace 全在，且按链顺序', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: mockNarration(1, 'act one') })
    await playOneTurn(page, { action: 'act two', turn: 2, narrationText: mockNarration(2, 'act two') })
    await expect(page.locator('[data-trace]'), '关着时一张卡片都不该有').toHaveCount(0)

    await page.locator('[data-debug-toggle]').click()

    const cards = page.locator('[data-trace]')
    await expect(cards, '两回合 × 四节点 = 八张卡片').toHaveCount(8)
    await expect(cards.first()).toHaveAttribute('data-trace-node', 'time')
    await expect(cards.first()).toHaveAttribute('data-trace-turn', '1')
    await expect(cards.last()).toHaveAttribute('data-trace-node', 'output')
    await expect(cards.last()).toHaveAttribute('data-trace-turn', '2')
    await expect(page.locator('[data-turn-stats]')).toHaveCount(2)
    // 历史回合不是空壳：第一回合的提示词里还是当时的行动
    await expect(page.locator(traceCard('output', 1)).locator('[data-trace-prompt]')).toContainText('act one')
    await expect(page.locator(traceCard('output', 2)).locator('[data-trace-prompt]')).toContainText('act two')

    // 刷新（`?debug=1`）：读数来自存档 ⇒ 历史两回合的每一步都还在，顺序仍是链顺序
    await openStory(page, CARD_ID, 's1', { debug: true })
    const afterReload = page.locator('[data-trace]')
    await expect(afterReload, '刷新后历史回合的 trace 不许丢').toHaveCount(8)
    const nodeIds = await afterReload.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-trace-node')),
    )
    expect(nodeIds).toEqual([...NODE_IDS, ...NODE_IDS])
    const turns = await afterReload.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-trace-turn')),
    )
    expect(turns).toEqual(['1', '1', '1', '1', '2', '2', '2', '2'])
    await expect(page.locator('[data-turn-stats]')).toHaveCount(2)
  })

  test('?debug=1 只是初始态：关掉之后跑一回合仍关，刷新才回到开', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1', { debug: true })
    const toggle = page.locator('[data-debug-toggle]')
    await expect(toggle).toHaveAttribute('data-on', 'true')

    await toggle.click()
    await expect(toggle).toHaveAttribute('data-on', 'false')
    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: mockNarration(1, 'act one') })
    await expect(toggle).toHaveAttribute('data-on', 'false')
    await expect(page.locator('[data-trace]')).toHaveCount(0)
    // 关着也有合计行 —— 它不是调试面板的一部分
    await expect(page.locator('[data-turn-stats]')).toHaveCount(1)

    // 刷新：重新读 URL 的初始态 ⇒ 又开了，而且历史回合的 trace 从存档里补出来
    await page.reload()
    await expect(page.locator('[data-debug-toggle]')).toHaveAttribute('data-on', 'true')
    await expect(page.locator('[data-trace]')).toHaveCount(4)
    await expect(page.locator('[data-trace]').first()).toHaveAttribute('data-trace-turn', '1')
  })

  test('开关状态不写盘（它是看板，不是设置）', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    await page.locator('[data-debug-toggle]').click()
    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: mockNarration(1, 'act one') })
    const settings = await readStorage(page, KEYS.settings)
    expect(Object.keys(settings)).not.toContain('debug')
    // 而且刷新之后回到默认（关着）—— ?debug=1 不在 URL 里。
    // ⚠️ 这里必须 `reload()`：goto 同一个 hash URL 是**同文档导航**，SPA 不会重挂组件，状态还在。
    await page.reload()
    await expect(page.locator('[data-debug-toggle]')).toHaveAttribute('data-on', 'false')
  })

  /**
   * 开关的**样子**：`data-on` 只是状态，玩家看得见的是颜色。
   * 开着 = `--accent` 实心 + `--accent-ink` 字（与 `.chip[data-on='true']` 同一对 token，也同一套 600 字重）；
   * 关着 = 普通按钮（`--panel` 底 + `--ink` 字 + `--line-strong` 边框）。
   *
   * 判据拿**解析后的计算值**比，不抄 hex：先把根上的 token 解析成 rgb，再与按钮的计算样式逐字相等 ——
   * 换主题 / 调色板时这一条跟着走，不会变成一条永远钉在旧色号上的假红。
   * 指针必须先挪开再量：普通按钮的 hover 会改边框色，会把「关着的常态」量歪。
   */
  test('调试开关的样式：开着 = accent 实心 + 浅字，关回去恢复普通按钮', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    const toggle = page.locator('[data-debug-toggle]')

    /** 读开关当前的计算样式 + 根上那几对 token 解析出来的 rgb */
    const readToggle = async () => {
      await page.mouse.move(2, 420)
      return page.evaluate(`(() => {
        const element = document.querySelector('[data-debug-toggle]')
        const resolve = (name) => {
          const probe = document.createElement('span')
          probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
          document.body.appendChild(probe)
          const value = getComputedStyle(probe).color
          probe.remove()
          return value
        }
        const style = getComputedStyle(element)
        return {
          on: element.getAttribute('data-on'),
          background: style.backgroundColor,
          color: style.color,
          border: style.borderTopColor,
          weight: Number(style.fontWeight),
          accent: resolve('--accent'),
          accentInk: resolve('--accent-ink'),
          panel: resolve('--panel'),
          ink: resolve('--ink'),
          lineStrong: resolve('--line-strong'),
        }
      })()`)
    }

    /** WCAG 相对亮度（只看前三个通道；`rgb(...)` 与 `rgba(...)` 都能读） */
    const luminance = (rgb) => {
      const [r, g, b] = rgb
        .match(/\d+(?:\.\d+)?/g)
        .slice(0, 3)
        .map(Number)
      const channel = (value) => {
        const c = value / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    // ① 关着：普通按钮的样子
    const off = await readToggle()
    expect(off.on).toBe('false')
    expect(off.background, '关着的按钮不是普通按钮底色').toBe(off.panel)
    expect(off.color, '关着的按钮不是普通字色').toBe(off.ink)
    expect(off.border, '关着的按钮不是普通边框').toBe(off.lineStrong)
    expect(off.background, '关着就已经是 accent 实心了').not.toBe(off.accent)
    expect(off.weight).toBeLessThan(600)

    // ② 点开：accent 实心 + accent-ink 字（与开着的 chip 同一对 token）
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-on', 'true')
    const on = await readToggle()
    expect(on.background, '开着的底色不是 accent').toBe(on.accent)
    expect(on.color, '开着的字色不是 accent-ink').toBe(on.accentInk)
    expect(on.border, '开着的边框不是 accent').toBe(on.accent)
    expect(on.background, '开着与关着看不出区别').not.toBe(off.background)
    expect(on.color, '开着与关着字色一样').not.toBe(off.color)
    expect(on.weight, '开着的字重没有加重（chip 是 600）').toBeGreaterThanOrEqual(600)

    // 浅字压深底：字的亮度必须高于底色，对比度够看（实际比值也报出来）
    const ratio = (luminance(on.color) + 0.05) / (luminance(on.background) + 0.05)
    expect(luminance(on.color), '开着的字不是浅色（比底色还暗）').toBeGreaterThan(luminance(on.background))
    expect(ratio, `开着的字底对比度只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)

    // ③ 点回去：恢复普通按钮（底色 / 字色 / 边框都回去，字重也回去）
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-on', 'false')
    const back = await readToggle()
    expect(back.background, '关回去没恢复普通按钮底色').toBe(off.background)
    expect(back.color, '关回去没恢复普通按钮字色').toBe(off.color)
    expect(back.border, '关回去没恢复普通按钮边框').toBe(off.border)
    expect(back.weight).toBe(off.weight)
  })
})

test.describe('对话页：发送即见（乐观行动 / 生成中）', () => {
  /**
   * 「首字延迟」的服务商替身（CONTRACT §8.3）：前三个节点立刻回，**输出节点卡在 gate 上**，
   * 直到调用方 `releaseOutput()` 才回第一段正文。
   *
   * 为什么不用 mock：mock 几百毫秒就跑完了，「生成中」与「首字之后」这两个中间态根本看不见。
   * 为什么用 gate 而不是 `setTimeout`：定时器会把判据钉在「机器多快」上；gate 让中间态**停在原地**，
   * 断言完再放行。
   */
  async function stubGatedOutput(page) {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const requests = []
    const texts = ['TIME_TEXT', 'CHECK_TEXT', 'EXTRA_TEXT', 'OUTPUT_TEXT']
    const reply = (intercepted, text) =>
      intercepted.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: openAiSse([text]),
      })

    await page.route('**/chat/completions', async (intercepted) => {
      const index = requests.length
      requests.push(index)
      if (index !== 3) {
        await reply(intercepted, texts[index] ?? 'TAIL_TEXT')
        return
      }
      await gate
      try {
        await reply(intercepted, texts[3])
      } catch {
        // 停止之后这次请求已被取消：fulfill 失败是预期（不是产品错）
      }
    })
    return { requests, releaseOutput: () => release() }
  }

  /** 空开场 + 一个真预设：故事流里不会多出「开场」那条 narration，计数才干净 */
  function gatedStorage() {
    const card = cardWithOpening('')
    return {
      [KEYS.cards]: [card],
      [KEYS.saves]: [makeSave(card)],
      [KEYS.presets]: [REAL_PRESET],
    }
  }

  test('行动气泡立刻上屏 + 生成中；首个 trace 到了生成中还挂着；首字一到生成中消失、气泡仍在、收尾只有一个', async ({
    page,
  }) => {
    const { requests, releaseOutput } = await stubGatedOutput(page)
    await boot(page, { storage: gatedStorage() })
    // 调试开着：输出节点还卡着时，前三个节点的 trace 卡片已经会先出来
    await openStory(page, CARD_ID, 's1', { debug: true })
    await expect(page.locator('[data-turn]')).toHaveText('0')

    await page.locator('[data-action-input]').fill('act one')
    await page.locator('[data-send]').click()

    // ① 点下去当场：行动气泡（pending 副本）+「生成中……」；回合数还是 0、正文一条都没有
    const pending = page.locator('[data-line="action"][data-pending-action]')
    await expect(pending, '发送后行动要立刻上屏').toHaveText('act one')
    await expect(page.locator('[data-generating]')).toHaveText('生成中……')
    await expect(page.locator('[data-turn]')).toHaveText('0')
    await expect(page.locator('[data-line="narration"]')).toHaveCount(0)

    // ② 前三个节点跑完（trace 卡片已出现），输出节点还没出首字 ⇒ 「生成中」必须还挂着
    await expect(page.locator('[data-trace]'), 'time/check/extra 的 trace 先到').toHaveCount(3, {
      timeout: 10_000,
    })
    await expect(page.locator('[data-generating]'), '首字没到之前，生成中要一直挂着').toBeVisible()
    await expect(page.locator('[data-line="action"][data-pending-action]'), '行动气泡也还在').toBeVisible()
    await expect(page.locator('[data-turn]')).toHaveText('0')

    // ③ 放行首字：生成中消失、换成正交流出来的 narration，行动气泡留着且只有一条
    releaseOutput()
    await expect(page.locator('[data-generating]'), '首字一到就该撤掉').toHaveCount(0, {
      timeout: 10_000,
    })
    await expect(page.locator('[data-line="action"]'), '行动气泡不许随首字一起消失').toHaveCount(1)
    await expect(page.locator('[data-line="action"]')).toHaveText('act one')

    // ④ 收尾：正好一条 action 气泡、没有 pending 副本、正文是 output 的、存档里也只有一条 action
    await expect(page.locator('[data-turn]')).toHaveText('1', { timeout: 15_000 })
    await expect(page.locator('[data-stop]')).toHaveCount(0)
    await expect(page.locator('[data-pending-action]'), '成功后乐观副本要撤掉（不许两个气泡）').toHaveCount(0)
    await expect(page.locator('[data-line="action"]')).toHaveCount(1)
    await expect(page.locator('[data-line="narration"]').last()).toHaveText('OUTPUT_TEXT')
    expect(requests, '四个节点各一次调用').toHaveLength(4)

    const save = (await readStorage(page, KEYS.saves))[0]
    expect(save.turn).toBe(1)
    expect(save.events.filter((event) => event.type === 'action').map((event) => event.text)).toEqual([
      'act one',
    ])
    expect(save.events.filter((event) => event.type === 'narration')).toHaveLength(1)
  })

  test('首字之前停止：乐观气泡与生成中都撤掉、故事流回到回合前、草稿回来、存档一个字节没动', async ({
    page,
  }) => {
    const { releaseOutput } = await stubGatedOutput(page)
    await boot(page, { storage: gatedStorage() })
    await openStory(page, CARD_ID, 's1')
    const before = await readRaw(page, KEYS.saves)

    await page.locator('[data-action-input]').fill('act one')
    await page.locator('[data-send]').click()
    await expect(page.locator('[data-line="action"][data-pending-action]')).toHaveText('act one')
    await expect(page.locator('[data-generating]')).toBeVisible()

    await page.locator('[data-stop]').click()

    // 气泡与「生成中」一起撤掉；故事流回到本轮开始前（空开场 ⇒ 两条都是 0）
    await expect(page.locator('[data-pending-action]')).toHaveCount(0)
    await expect(page.locator('[data-generating]')).toHaveCount(0)
    await expect(page.locator('[data-line="action"]')).toHaveCount(0)
    await expect(page.locator('[data-line="narration"]')).toHaveCount(0)
    await expect(page.locator('[data-turn]')).toHaveText('0')
    // 草稿回来、输入框可用、停止按钮消失
    await expect(page.locator('[data-stop]')).toHaveCount(0)
    await expect(page.locator('[data-action-input]')).toBeEnabled()
    await expect(page.locator('[data-action-input]')).toHaveValue('act one')
    // 存档一个字节都没写：比原始字符串，不是比解析后的对象
    expect(await readRaw(page, KEYS.saves), '停止不许写存档').toBe(before)
    releaseOutput()
  })

  test('发送即清空输入框（Enter 也算）：首字没到之前是空串，停止后把发出去的那句还回来', async ({ page }) => {
    const { releaseOutput } = await stubGatedOutput(page)
    await boot(page, { storage: gatedStorage() })
    await openStory(page, CARD_ID, 's1')
    const input = page.locator('[data-action-input]')

    await input.fill('act one')
    await input.press('Enter')
    // ① 发出去的当场：输入框空（不是等回合结束才清），气泡与「生成中」都在
    await expect(input, '发送后输入框要立刻清空').toHaveValue('')
    await expect(page.locator('[data-line="action"][data-pending-action]')).toHaveText('act one')
    await expect(page.locator('[data-generating]')).toBeVisible()

    await page.locator('[data-stop]').click()
    await expect(page.locator('[data-stop]')).toHaveCount(0)
    // ② 停止 = 这一句没发出去 ⇒ 还回输入框（不然玩家得重打一遍）
    await expect(input, '停止后要把发出去的那句还回来').toHaveValue('act one')
    await expect(input).toBeEnabled()
    releaseOutput()
  })

  test('上游出错：发送即清空输入框，错误条出现后把发出去的那句还回来', async ({ page }) => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.route('**/chat/completions', async (intercepted) => {
      await gate
      try {
        await intercepted.fulfill({
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: { message: 'upstream boom' } }),
        })
      } catch {
        // 请求可能已被取消：fulfill 失败是预期
      }
    })
    await boot(page, { storage: gatedStorage() })
    await openStory(page, CARD_ID, 's1')
    const input = page.locator('[data-action-input]')

    await input.fill('act one')
    await page.locator('[data-send]').click()
    await expect(input, '发送后输入框要立刻清空').toHaveValue('')

    release()
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-error-code]')).toHaveText('E_PROVIDER')
    await expect(input, '出错后要把发出去的那句还回来').toHaveValue('act one')
    await expect(page.locator('[data-pending-action]')).toHaveCount(0)
    await expect(page.locator('[data-generating]')).toHaveCount(0)
  })
})

test.describe('对话页：玩家行动不是气泡（左对齐 / 虚线分隔）', () => {
  test('行动与叙事同一套左对齐、没有气泡底色与圆角；行动 / 叙事 / trace 卡片之间是虚线上边', async ({
    page,
  }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1', { debug: true })
    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: mockNarration(1, 'act one') })

    const styles = await page.evaluate(
      `(() => {
        const read = (element) => {
          const computed = getComputedStyle(element)
          return {
            textAlign: computed.textAlign,
            alignSelf: computed.alignSelf,
            background: computed.backgroundColor,
            radius: computed.borderTopLeftRadius,
            borderTopStyle: computed.borderTopStyle,
            borderTopWidth: parseFloat(computed.borderTopWidth),
          }
        }
        const narrations = [...document.querySelectorAll('[data-line="narration"]')]
        return {
          action: read(document.querySelector('[data-line="action"]')),
          narration: read(narrations[narrations.length - 1]),
          trace: read(document.querySelector('[data-trace]')),
        }
      })()`,
    )

    // ① 左对齐：与叙事同一套（不是靠右的气泡）
    expect(styles.action.textAlign, '行动的文字对齐与叙事不一致').toBe(styles.narration.textAlign)
    expect(['start', 'left'], `行动不是左对齐：${styles.action.textAlign}`).toContain(styles.action.textAlign)
    expect(styles.action.alignSelf, '行动又被推回右边了').not.toBe('flex-end')
    expect(styles.action.alignSelf, '行动与叙事的 align-self 不一致').toBe(styles.narration.alignSelf)

    // ② 没有气泡：底色与圆角都跟叙事一致（透明 / 0）
    expect(styles.action.background, '行动还带着气泡底色').toBe(styles.narration.background)
    expect(styles.action.radius, '行动还带着气泡圆角').toBe(styles.narration.radius)

    // ③ 相邻块之间是虚线上边：行动、叙事、trace 卡片都要有
    for (const [name, block] of Object.entries(styles)) {
      expect(block.borderTopStyle, `${name} 的上边不是虚线`).toBe('dashed')
      expect(block.borderTopWidth, `${name} 的虚线上边宽度为 0`).toBeGreaterThan(0)
    }
  })
})
