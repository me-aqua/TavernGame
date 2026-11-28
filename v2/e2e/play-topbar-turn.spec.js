/**
 * 对话页顶栏 · 回合文字只在 `[data-status]` 里可见（契约 `.team/test/2026-11-28/契约-顶栏回合与存档当前块.md` §3）。
 *
 * 钉住的东西：
 *   · `[data-turn]` 仍在 DOM 里（测试钩子），`textContent` 恰好是回合数，但**视觉隐藏**；
 *   · `[data-status]` 是唯一可见的回合显示：存档 `turn > 0` 时可见，文字同时含「已保存」与「第 N 回合」；
 *   · 页栏里不许有第二处可见回合文字：匹配「第 N 回合」的可见元素恰好 1 个，
 *     文字恰好是裸回合数 `N` 的可见元素 0 个；
 *   · 打开一份 `turn: 2` 的旧存档：状态栏直接从 `save.turn` 显示第 2 回合，不要求先走一回合。
 *
 * 故事流里的 `[data-turn-stats]` 每回合自带「第 N 回合」，在页栏之外，不算重复。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, makeCard, makeSave, MOCK_PRESET, openStory } from './support/app.js'

/** 页栏：回合显示的判据全部只在这一条里量 */
const BAR = '[data-page="play"] header'
/** 页栏里的可见元素（Playwright 的 `:visible`：有布局盒子且没被 display / visibility 藏掉） */
const BAR_VISIBLE = `${BAR} :visible`

function seeded({ turn = 0 } = {}) {
  const card = makeCard()
  const save = makeSave(card, { turn })
  return {
    card,
    save,
    storage: {
      [KEYS.cards]: [card],
      [KEYS.saves]: [save],
      [KEYS.presets]: [MOCK_PRESET],
    },
  }
}

async function openSeededStory(page, { turn = 0 } = {}) {
  const { storage, card, save } = seeded({ turn })
  await boot(page, { storage })
  await openStory(page, card.id, save.id)
}

/** 走一回合，等它的终态（`[data-turn]` 隐藏也照样读得到 textContent） */
async function playOneTurn(page, action, turn) {
  await page.locator('[data-action-input]').fill(action)
  await page.locator('[data-send]').click()
  await expect(page.locator('[data-turn]')).toHaveText(String(turn), { timeout: 15_000 })
  await expect(page.locator('[data-stop]')).toHaveCount(0)
}

/** 页栏里文字匹配 `text` 的可见元素 */
function visibleWith(page, text) {
  return page.locator(BAR_VISIBLE).filter({ hasText: text })
}

/** 「没有第二处可见回合文字」的三条：钩子隐藏、短语一处、裸数字零处 */
async function expectTurnShownOnce(page, turn) {
  const status = page.locator('[data-status]')
  await expect(status, '回合文字要显示在状态栏里').toBeVisible()
  await expect(status).toContainText('已保存')
  await expect(status).toContainText(`第 ${turn} 回合`)

  const hook = page.locator('[data-turn]')
  await expect(hook, '测试钩子不许被删').toHaveCount(1)
  await expect(hook, '测试钩子的 textContent 仍是回合数').toHaveText(String(turn))

  await expect(
    visibleWith(page, new RegExp(`第\\s*${turn}\\s*回合`)),
    '页栏里「第 N 回合」只许有一处可见',
  ).toHaveCount(1)
  await expect(
    visibleWith(page, new RegExp(`^\\s*${turn}\\s*$`)),
    '页栏里不许有可见的裸回合数字',
  ).toHaveCount(0)
  await expect(hook, '回合数钩子必须视觉隐藏（它只是测试钩子）').toBeHidden()
}

test('T1 开局 turn 0：钩子在、文本 0、视觉隐藏；页栏没有可见的裸 0', async ({ page }) => {
  await openSeededStory(page, { turn: 0 })

  const hook = page.locator('[data-turn]')
  await expect(hook).toHaveCount(1)
  await expect(hook).toHaveText('0')
  await expect(hook, '回合数钩子必须视觉隐藏').toBeHidden()

  await expect(page.locator('[data-status]')).toHaveCount(1)
  await expect(visibleWith(page, /^\s*0\s*$/), '开局页栏里不许有可见的裸回合数字').toHaveCount(0)
})

test('T2 走一回合：status 显示「已保存 · 第 1 回合」，钩子隐藏，无重复', async ({ page }) => {
  await openSeededStory(page, { turn: 0 })
  await playOneTurn(page, 'act one', 1)

  await expectTurnShownOnce(page, 1)
})

test('T3 再走一回合：status 跟到第 2 回合，钩子仍隐藏', async ({ page }) => {
  await openSeededStory(page, { turn: 0 })
  await playOneTurn(page, 'act one', 1)
  await playOneTurn(page, 'act two', 2)

  await expectTurnShownOnce(page, 2)
})

test('T4 打开 turn 2 的旧存档：status 直接显示第 2 回合，钩子隐藏', async ({ page }) => {
  await openSeededStory(page, { turn: 2 })

  await expectTurnShownOnce(page, 2)
})
