/**
 * SPEC §9.8 的后半 / SPEC §4 的错误体系：**错误必须是中文 + 带下一步**，且不白屏。
 *
 * 四个入口各来一条（这是玩家真的会撞上的四条路）：
 *   · 链不合法（0 个输出）⇒ `E_CHAIN`
 *   · 存档 / 卡的 schemaVersion 不认、id 不存在 ⇒ `E_VALIDATION`
 *   · 服务商 401 ⇒ `E_PROVIDER`
 *   · 网络直接断 ⇒ `E_PROVIDER`
 * 断言看三样：`[data-error-code]` 的码、`[data-error-next]` 的中文下一步、页面本身还活着。
 */
import { expect, test } from '@playwright/test'
import {
  boot,
  CJK,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  openStory,
  route,
  slowMock,
} from './support/app.js'

const CARD_ID = 'c1'

/** 错误页 / 错误条的公共断言：码 + 中文正文 + 中文下一步 + 页面没白 */
async function expectError(page, code) {
  const panel = page.locator('[data-error]')
  await expect(panel).toBeVisible()
  await expect(page.locator('[data-error-code]')).toHaveText(code)
  await expect(panel).toHaveText(CJK)
  const next = page.locator('[data-error-next]')
  await expect(next).toBeVisible()
  await expect(next).toHaveText(CJK)
}

test.describe('E_CHAIN：链不合法', () => {
  test('卡里一个输出节点都没有 ⇒ 中文错误 + 下一步，不白屏', async ({ page }) => {
    const base = makeCard()
    const card = { ...base, chain: base.chain.filter((node) => node.type !== 'output') }
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [MOCK_PRESET] },
      hash: route.play(CARD_ID, 's1'),
    })
    await expectError(page, 'E_CHAIN')
  })
})

test.describe('E_VALIDATION：坏存档 / 不存在的 id', () => {
  test('存档 schemaVersion 不认识 ⇒ E_VALIDATION', async ({ page }) => {
    const card = makeCard()
    const save = makeSave(card, { schemaVersion: 2 })
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [save], [KEYS.presets]: [MOCK_PRESET] },
      hash: route.play(CARD_ID, 's1'),
    })
    await expectError(page, 'E_VALIDATION')
  })

  test('深链指向不存在的卡 / 存档 ⇒ E_VALIDATION（中文错误页，不是白屏）', async ({ page }) => {
    await boot(page, { hash: route.play('no-card', 'no-save') })
    await expectError(page, 'E_VALIDATION')
  })

  test('深链指向不存在的编辑器 id ⇒ 中文错误页，不白屏', async ({ page }) => {
    await boot(page, { hash: route.edit('no-card') })
    const panel = page.locator('[data-error]')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveText(CJK)
    await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
  })
})

test.describe('E_PROVIDER：上游的错要翻成人话', () => {
  test('服务商 401 ⇒ E_PROVIDER，正文是中文，下一步指向设置', async ({ page }) => {
    const preset = {
      ...slowMock(0),
      id: 'p-real',
      provider: 'openai-compatible',
      baseUrl: 'https://mock.invalid/v1',
      apiKey: 'bad-key',
    }
    const card = makeCard()
    await page.route('**/chat/completions', (intercepted) =>
      intercepted.fulfill({
        status: 401,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: { message: 'Invalid API key provided', type: 'invalid_request_error' },
        }),
      }),
    )
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [preset] },
    })
    await openStory(page, CARD_ID, 's1')
    await page.locator('[data-action-input]').fill('act one')
    await page.locator('[data-send]').click()

    await expectError(page, 'E_PROVIDER')
    // 英文原文可以进 detail / 调试面板，但不许成为玩家看到的那一句
    const shown = await page.locator('[data-error]').textContent()
    expect((shown ?? '').includes('Invalid API key provided')).toBe(false)
  })

  test('网络直接断掉 ⇒ 也是 E_PROVIDER（不是 E_UNKNOWN 兜底）', async ({ page }) => {
    const preset = {
      ...slowMock(0),
      id: 'p-real',
      provider: 'openai-compatible',
      baseUrl: 'https://mock.invalid/v1',
      apiKey: 'k',
    }
    const card = makeCard()
    await page.route('**/chat/completions', (intercepted) => intercepted.abort('connectionrefused'))
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [preset] },
    })
    await openStory(page, CARD_ID, 's1')
    await page.locator('[data-action-input]').fill('act one')
    await page.locator('[data-send]').click()
    await expectError(page, 'E_PROVIDER')
    // 出错之后这一回合不算数
    await expect(page.locator('[data-turn]')).toHaveText('0')
  })
})
