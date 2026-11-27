/**
 * 阶段 2.2 · B（节日与提示词）：勾选 ⇒ 提示词里那一行 `节日：…`（契约 §B3–§B4）。
 *
 * 钉住五件事：
 *   1. 年份模式勾上节日 ⇒ 调试面板里 `check` 节点的提示词出现 `节日：春节`（2024-02-10），只一次；
 *   2. 现代中国组不产出春节（它只有公历固定日）；
 *   3. 传统节日在表外年份（1899）静默不产出：没有 `节日：`，也不报错；
 *   4. 三组同时开时同名节日只写一次（2024-01-01 ⇒ 元旦）；
 *   5. 天数模式没有节日勾选（编辑器里一个都没有），提示词里也没有节日行。
 *
 * ⚠️ 种子数据是新形状；功能没做时应用打不开它 ⇒ 这一份全红。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, MOCK_PRESET, playTurn, openStory } from './support/app.js'
import { cardWithTime, holidaysV6, v6Save } from '../tests/support/v6-fixtures.js'

/** 一张卡 + 一份存档 + mock 预设 */
function seeded({ id = 'c-holiday', mode = 'year-minute', time, holidays } = {}) {
  const card = cardWithTime({ id, mode, time, holidays })
  const save = v6Save(card, { id: `s-${id}` })
  return {
    [KEYS.cards]: [card],
    [KEYS.saves]: [save],
    [KEYS.presets]: [MOCK_PRESET],
    [KEYS.nodeModels]: {
      [card.id]: Object.fromEntries(card.chain.map((node) => [node.id, MOCK_PRESET.id])),
    },
  }
}

/** 跑一回合，读 `check` 节点的提示词（它读时间元素） */
async function checkPromptOf(page) {
  await playTurn(page, 'look around', 1)
  const prompt = page.locator(`[data-trace][data-trace-node="check"] [data-trace-prompt]`).first()
  await expect(prompt).toBeVisible()
  return (await prompt.textContent()) ?? ''
}

test.describe('B4 节日进提示词', () => {
  test('2024-02-10 三组全开 ⇒ `节日：春节`，只出现一次', async ({ page }) => {
    await boot(page, {
      storage: seeded({
        id: 'c-newyear',
        time: { year: 2024, month: 2, day: 9, hour: 8, minute: 30 },
        holidays: holidaysV6({ international: true, china: true, traditional: true }),
      }),
    })
    await openStory(page, 'c-newyear', 's-c-newyear', { debug: true })
    const prompt = await checkPromptOf(page)
    expect(prompt).toContain('节日：春节')
    expect((prompt.match(/节日：/g) ?? []).length, '节日行只出现一次').toBe(1)
  })

  test('现代中国组（只有公历固定日）在春节当天没有节日行', async ({ page }) => {
    await boot(page, {
      storage: seeded({
        id: 'c-china',
        time: { year: 2024, month: 2, day: 9, hour: 8, minute: 30 },
        holidays: holidaysV6({ china: true }),
      }),
    })
    await openStory(page, 'c-china', 's-c-china', { debug: true })
    const prompt = await checkPromptOf(page)
    expect(prompt).not.toContain('节日：')
  })

  test('传统节日在表外年份（1899）静默不产出，时间照常显示', async ({ page }) => {
    await boot(page, {
      storage: seeded({
        id: 'c-bc',
        time: { year: 1899, month: 2, day: 9, hour: 8, minute: 30 },
        holidays: holidaysV6({ traditional: true }),
      }),
    })
    await openStory(page, 'c-bc', 's-c-bc', { debug: true })
    const prompt = await checkPromptOf(page)
    expect(prompt).toContain('1899-02-10')
    expect(prompt).not.toContain('节日：')
  })

  test('三组同时开：2024-01-01 只写一个元旦（去重）', async ({ page }) => {
    await boot(page, {
      storage: seeded({
        id: 'c-dedup',
        time: { year: 2023, month: 12, day: 31, hour: 8, minute: 30 },
        holidays: holidaysV6({ international: true, china: true, traditional: true }),
      }),
    })
    await openStory(page, 'c-dedup', 's-c-dedup', { debug: true })
    const prompt = await checkPromptOf(page)
    expect(prompt).toContain('节日：元旦')
    expect((prompt.match(/元旦/g) ?? []).length).toBe(1)
  })
})

test.describe('B5 天数模式没有节日', () => {
  test('编辑器里一个节日勾选都没有；提示词里也没有节日行', async ({ page }) => {
    await boot(page, {
      storage: seeded({
        id: 'c-days',
        mode: 'days-minute',
        time: { day: 2, hour: 9, minute: 15 },
      }),
    })
    await page.goto(`${APP_PATH}#/edit/c-days`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-state-item="0"]').click()
    await expect(page.locator('[data-holiday]')).toHaveCount(0)

    await openStory(page, 'c-days', 's-c-days', { debug: true })
    const prompt = await checkPromptOf(page)
    expect(prompt).toContain('第 3 天 09:15')
    expect(prompt).not.toContain('节日：')
  })
})
