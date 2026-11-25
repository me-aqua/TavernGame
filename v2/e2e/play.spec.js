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
 */
import { expect, test } from '@playwright/test'
import {
  boot,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  openStory,
  playTurn,
  readStorage,
} from './support/app.js'

const CARD_ID = 'c1'

/** 带「开场正文」的卡：这条正文必须是故事流的第一段（§8.3） */
function cardWithOpening(body = 'OPENING_LINE') {
  const card = makeCard()
  card.prompts = card.prompts.map((prompt) => (prompt.id === 'opening' ? { ...prompt, body } : prompt))
  return card
}

function seeded({ saves = 1 } = {}) {
  const card = cardWithOpening()
  return {
    [KEYS.cards]: [card],
    [KEYS.presets]: [MOCK_PRESET],
    [KEYS.saves]: saves ? [makeSave(card)] : [],
  }
}

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
    await playTurn(page, 'act one', 2)

    const lines = page.locator('[data-line]')
    await expect(lines).toHaveCount(3)
    await expect(lines.nth(0)).toHaveText('OPENING_LINE')
    expect(await lines.nth(1).getAttribute('data-line'), '开场之后第一条是玩家的行动').toBe('action')
    await expect(page.locator('[data-line="action"]').first()).toHaveText('act one')
    await expect(page.locator('[data-line="narration"]').last()).toHaveText('[mock] turn 1: act one')
  })
})

test.describe('对话页：调试开关', () => {
  test('默认关着：没有面板，只有最终故事 + 表头 [data-turn-ms]', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    const toggle = page.locator('[data-debug-toggle]')
    await expect(toggle).toHaveAttribute('data-on', 'false')
    await playTurn(page, 'act one', 2)

    await expect(page.locator('[data-debug]')).toHaveCount(0)
    await expect(page.locator('[data-turn-ms]')).toBeVisible()
    await expect(page.locator('[data-turn-ms]')).toContainText('ms')

    // 打开：面板出来、总耗时与逐节点读数都在，表头那一行让位给面板
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-on', 'true')
    await expect(page.locator('[data-debug]')).toBeVisible()
    await expect(page.locator('[data-debug-total]')).toContainText('ms')
    await expect(page.locator('[data-turn-ms]')).toHaveCount(0)
    for (const nodeId of ['time', 'check', 'extra', 'output']) {
      const row = page.locator(`[data-debug-node="${nodeId}"]`)
      await expect(row, `调试面板缺 ${nodeId} 这一行`).toHaveCount(1)
      await expect(row.locator('[data-debug-duration]')).toContainText('ms')
      await expect(row.locator('[data-debug-tokens]')).not.toHaveText('')
      await expect(row.locator('[data-debug-tps]')).not.toHaveText('')
      await expect(row.locator('[data-debug-prompt]')).not.toHaveText('')
    }
    // 普通节点这一回合没有正文（mock 只回工具调用）⇒ 返回那一格可以是空的；
    // 但**输出节点**的提示词与返回都必须逐字在
    await expect(page.locator('[data-debug-node="output"] [data-debug-response]')).toHaveText(
      '[mock] turn 1: act one',
    )
    // mock 不给用量 ⇒ 面板要说「没有用量」，不是空白
    await expect(page.locator('[data-debug-node="output"] [data-debug-tokens]')).toHaveText('没有用量')
    await expect(page.locator('[data-debug-presets]')).toContainText(MOCK_PRESET.id)

    // 再关回来：面板消失、表头那行回来
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-on', 'false')
    await expect(page.locator('[data-debug]')).toHaveCount(0)
    await expect(page.locator('[data-turn-ms]')).toBeVisible()
  })

  test('?debug=1 只是初始态：打开就有面板，点一下能关掉', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1', { debug: true })
    const toggle = page.locator('[data-debug-toggle]')
    await expect(toggle).toHaveAttribute('data-on', 'true')
    await playTurn(page, 'act one', 2)
    await expect(page.locator('[data-debug]')).toBeVisible()
    await expect(page.locator('[data-turn-ms]')).toHaveCount(0)

    await toggle.click()
    await expect(page.locator('[data-debug]')).toHaveCount(0)
    await expect(page.locator('[data-turn-ms]')).toBeVisible()
  })

  test('开关状态不写盘（它是看板，不是设置）', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1')
    await page.locator('[data-debug-toggle]').click()
    await playTurn(page, 'act one', 2)
    const settings = await readStorage(page, KEYS.settings)
    expect(Object.keys(settings)).not.toContain('debug')
    // 而且刷新之后回到默认（关着）—— ?debug=1 不在 URL 里。
    // ⚠️ 这里必须 `reload()`：goto 同一个 hash URL 是**同文档导航**，SPA 不会重挂组件，状态还在。
    await page.reload()
    await expect(page.locator('[data-debug-toggle]')).toHaveAttribute('data-on', 'false')
  })
})
