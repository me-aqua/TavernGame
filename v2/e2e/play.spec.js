/**
 * 对话页（CONTRACT §8.3）—— 老板 2026-11-25 的新口径：
 *
 *   ① **没有封面、没有开始按钮**：打开存档直接看见故事流，第一段是「开场」那块提示词的**正文**；
 *   ② 消息里只有输入框 + `[data-send]`；
 *   ③ 右上角 `[data-debug-toggle]` 是**开关**（`?debug=1` 只是初始态）：
 *      开 = 逐节点读数（提示词 / 返回 / token / t/s / 耗时）+ 总耗时；
 *      关 = 只剩最终故事 + 表头一行本回合总耗时 `[data-turn-ms]`。
 *
 * 为什么要单独一份：这三条都是「界面在不在」的事，单测看不见；而调试面板是**唯一**
 * 能看见「这一步到底用了哪个预设 / 拼了什么提示词」的地方，它的开与关都必须能翻面。
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
  readStorage,
  slowMock,
} from './support/app.js'

const CARD_ID = 'c1'

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

test.describe('对话页：调试开关', () => {
  test('关着：没有面板 / 逐节点行，表头 [data-turn-ms] 是本回合总耗时', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    const toggle = page.locator('[data-debug-toggle]')
    await expect(toggle).toHaveAttribute('data-on', 'false')
    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: mockNarration(1, 'act one') })

    await expect(page.locator('[data-debug]')).toHaveCount(0)
    await expect(page.locator('[data-debug-node]')).toHaveCount(0)
    const turnMs = page.locator('[data-turn-ms]')
    await expect(turnMs).toBeVisible()
    // 「总耗时」：中文标签（本回合）+ 毫秒数 + ms 单位
    await expect(turnMs).toHaveText(CJK)
    await expect(turnMs).toHaveText(/\d+\s*ms/)
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
    // 其余三个节点的返回只许住在调试面板里（现在是关着的 ⇒ 屏上任何地方都不该有）
    const screen = (await page.locator('[data-page="play"]').textContent()) ?? ''
    for (const mark of ['TIME_TEXT', 'CHECK_TEXT', 'EXTRA_TEXT']) {
      expect(screen.includes(mark), `${mark} 漏进了故事流（只有 output 能进）`).toBe(false)
    }
  })

  test('打开：逐节点的 提示词 / 返回 / token / t/s / 耗时 + 本回合总耗时都在', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: mockNarration(1, 'act one') })
    await page.locator('[data-debug-toggle]').click()

    await expect(page.locator('[data-debug]')).toBeVisible()
    await expect(page.locator('[data-debug-total]')).toHaveText(CJK)
    await expect(page.locator('[data-debug-total]')).toHaveText(/\d+\s*ms/)
    // 开着时表头那一行让位给面板（总耗时只报一次）
    await expect(page.locator('[data-turn-ms]')).toHaveCount(0)

    for (const nodeId of ['time', 'check', 'extra', 'output']) {
      const row = page.locator(`[data-debug-node="${nodeId}"]`)
      await expect(row, `调试面板缺 ${nodeId} 这一行`).toHaveCount(1)
      // 每一行都要有**这一节点**的五样读数
      await expect(row.locator('[data-debug-duration]')).toHaveText(/\d+\s*ms/)
      await expect(row.locator('[data-debug-tokens]')).not.toHaveText('')
      await expect(row.locator('[data-debug-tps]')).not.toHaveText('')
      await expect(row.locator('[data-debug-prompt]')).not.toHaveText('')
      await expect(row.locator('[data-debug-response]')).toHaveCount(1)
    }
    // 输出节点的提示词与返回逐字在；普通节点这一回合没有正文（mock 只回工具调用）⇒ 返回可以为空
    await expect(page.locator('[data-debug-node="output"] [data-debug-prompt]')).toContainText('NODE_OUT')
    await expect(page.locator('[data-debug-node="output"] [data-debug-response]')).toHaveText(
      mockNarration(1, 'act one'),
    )
    // mock 不给用量 ⇒ 面板要说「没有用量 / 没有速率」，不是空白、也不是 0
    await expect(page.locator('[data-debug-node="output"] [data-debug-tokens]')).toHaveText(CJK)
    await expect(page.locator('[data-debug-node="output"] [data-debug-tps]')).toHaveText(CJK)
    await expect(page.locator('[data-debug-presets]')).toContainText(MOCK_PRESET.id)
  })

  test('没有 ?debug 时打开开关：跑下一回合仍然保持（开关是页面里的状态）', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    const toggle = page.locator('[data-debug-toggle]')
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-on', 'true')

    await playOneTurn(page, { action: 'act one', turn: 1, narrationText: mockNarration(1, 'act one') })
    await playOneTurn(page, { action: 'act two', turn: 2, narrationText: mockNarration(2, 'act two') })
    await expect(toggle).toHaveAttribute('data-on', 'true')
    await expect(page.locator('[data-debug]')).toBeVisible()
    await expect(page.locator('[data-debug-node="output"]')).toHaveCount(1)
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
    await expect(page.locator('[data-debug]')).toHaveCount(0)

    // 刷新：重新读 URL 的初始态 ⇒ 又开了（`?debug=1` 只是初始值，不是持久状态）
    await page.reload()
    await expect(page.locator('[data-debug-toggle]')).toHaveAttribute('data-on', 'true')
    await expect(page.locator('[data-debug]')).toBeVisible()
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
})
