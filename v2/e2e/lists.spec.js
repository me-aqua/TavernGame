/**
 * SPEC §5 的列表操作：**重命名**与**删除确认**（首页两条默认动作）。
 *
 * 为什么单开一份：这两条最容易「看起来能用」——
 * 重命名没落盘（刷新就回去了）、删除没有确认（误点就没了）、删卡留下悬空存档。
 * 所以每条都读盘对账，不看界面猜。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  readRaw,
  readStorage,
  route,
} from './support/app.js'

const CARD_ID = 'c1'

function seed() {
  const card = makeCard()
  return { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [MOCK_PRESET] }
}

/**
 * 行内重命名框的当场状态：有没有、焦点在不在、光标在哪。
 * 浏览器侧代码一律写成模板串（见 support/app.js 的约定），否则 lint 的 no-undef 会拦。
 */
async function renameInputState(page) {
  return page.evaluate(
    `(() => {
      const element = document.querySelector('[data-rename-input]')
      return {
        found: element !== null,
        focused: document.activeElement === element,
        start: element ? element.selectionStart : null,
        length: element ? element.value.length : null,
      }
    })()`,
  )
}

/**
 * 点「重命名」→ **点进输入框**：这一步是回归点（存档行原来会把整行的「进对话页」带出去）。
 * 钉三样：URL 不变、还在首页、焦点与光标都在输入框里（按 End 之后光标 = 值长度）。
 * 返回输入框，调用方接着填名字 / 回车 / Esc。
 */
async function openRenameInput(page, { rowSelector, renameSelector, homeUrl }) {
  await page.locator(`${rowSelector} ${renameSelector}`).click()
  const input = page.locator('[data-rename-input]')
  await expect(input).toBeVisible()
  await input.click()

  await expect(page, '点重命名输入框不许跳页').toHaveURL(homeUrl)
  await expect(page.locator('[data-page="home"]')).toBeVisible()
  await expect(input, '输入框丢了焦点').toBeFocused()
  await input.press('End')
  const state = await renameInputState(page)
  expect(state.found, '输入框不见了').toBe(true)
  expect(state.focused, '输入框丢了焦点').toBe(true)
  expect(state.start, '光标不在输入框末尾').toBe(state.length)
  return input
}

test('卡带重命名：回车提交并落盘，刷新后还在', async ({ page }) => {
  await boot(page, { storage: seed() })
  await page.locator(`[data-card-id="${CARD_ID}"] [data-card-rename]`).click()
  const input = page.locator('[data-rename-input]')
  await expect(input).toBeVisible()
  await input.fill('CARD_RENAMED')
  await input.press('Enter')

  await expect(page.locator(`[data-card-id="${CARD_ID}"] [data-card-name]`)).toHaveText('CARD_RENAMED')
  expect((await readStorage(page, KEYS.cards))[0].name).toBe('CARD_RENAMED')

  await page.reload()
  await expect(page.locator(`[data-card-id="${CARD_ID}"] [data-card-name]`)).toHaveText('CARD_RENAMED')
})

test('存档重命名：落盘，且存档行仍显示卡名与回合', async ({ page }) => {
  await boot(page, { storage: seed() })
  await page.locator('[data-save-id] [data-save-rename]').first().click()
  const input = page.locator('[data-rename-input]')
  await expect(input).toBeVisible()
  await input.fill('SAVE_RENAMED')
  await input.press('Enter')

  await expect(page.locator('[data-save-name]').first()).toHaveText('SAVE_RENAMED')
  expect((await readStorage(page, KEYS.saves))[0].name).toBe('SAVE_RENAMED')
})

test('删除确认：取消就什么都不删，确认才删', async ({ page }) => {
  await boot(page, { storage: seed() })
  await page.locator(`[data-card-id="${CARD_ID}"] [data-card-delete]`).click()
  await expect(page.locator('[data-confirm]')).toBeVisible()

  await page.locator('[data-confirm-cancel]').click()
  await expect(page.locator('[data-confirm]')).toHaveCount(0)
  expect((await readStorage(page, KEYS.cards)).length).toBe(1)
  await expect(page.locator(`[data-card-id="${CARD_ID}"]`)).toBeVisible()

  await page.locator(`[data-card-id="${CARD_ID}"] [data-card-delete]`).click()
  await page.locator('[data-confirm-ok]').click()
  await expect(page.locator('[data-card-id]')).toHaveCount(0)
  expect(await readStorage(page, KEYS.cards)).toEqual([])
})

test('存档行点击进对话页；卡行点「编辑」进编辑器（点行本身只是选中）', async ({ page }) => {
  await boot(page, { storage: seed() })
  await page.locator('[data-save-id]').first().click()
  await expect(page.locator('[data-page="play"]')).toBeVisible()

  await page.goto(`${APP_PATH}${route.home}`)
  await page.locator(`[data-card-id="${CARD_ID}"]`).click()
  // 点行不跳页：它是「选中这张卡」，新建存档要用这个选中态
  await expect(page.locator('[data-page="home"]')).toBeVisible()
  await page.locator(`[data-card-id="${CARD_ID}"] [data-card-edit]`).click()
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
})

test('卡带重命名：点输入框不跳页、焦点与光标都在；回车提交，Esc 取消（含盘上字节）', async ({ page }) => {
  await boot(page, { storage: seed() })
  const homeUrl = page.url()
  const row = `[data-card-id="${CARD_ID}"]`

  let input = await openRenameInput(page, {
    rowSelector: row,
    renameSelector: '[data-card-rename]',
    homeUrl,
  })
  await input.fill('CARD_RENAMED')
  await input.press('Enter')
  await expect(page.locator(`${row} [data-card-name]`)).toHaveText('CARD_RENAMED')
  expect((await readStorage(page, KEYS.cards))[0].name).toBe('CARD_RENAMED')
  await expect(page, '提交后不许离开首页').toHaveURL(homeUrl)

  // Esc = 取消：行上还是刚才提交的名字，盘上一个字节都不许动
  const committedRaw = await readRaw(page, KEYS.cards)
  input = await openRenameInput(page, {
    rowSelector: row,
    renameSelector: '[data-card-rename]',
    homeUrl,
  })
  await input.fill('CARD_DISCARDED')
  await input.press('Escape')
  await expect(page.locator('[data-rename-input]')).toHaveCount(0)
  await expect(page.locator(`${row} [data-card-name]`)).toHaveText('CARD_RENAMED')
  expect(await readRaw(page, KEYS.cards), 'Esc 取消不许写盘').toBe(committedRaw)
})

test('存档重命名：点输入框不跳对话页、焦点与光标都在；回车提交，Esc 取消（含盘上字节）', async ({ page }) => {
  await boot(page, { storage: seed() })
  const homeUrl = page.url()
  const row = '[data-save-id="s1"]'

  let input = await openRenameInput(page, {
    rowSelector: row,
    renameSelector: '[data-save-rename]',
    homeUrl,
  })
  await input.fill('SAVE_RENAMED')
  await input.press('Enter')
  await expect(page.locator(`${row} [data-save-name]`)).toHaveText('SAVE_RENAMED')
  expect((await readStorage(page, KEYS.saves))[0].name).toBe('SAVE_RENAMED')
  await expect(page, '提交后不许跳去对话页').toHaveURL(homeUrl)

  // Esc = 取消：行上还是刚才提交的名字，盘上一个字节都不许动
  const committedRaw = await readRaw(page, KEYS.saves)
  input = await openRenameInput(page, {
    rowSelector: row,
    renameSelector: '[data-save-rename]',
    homeUrl,
  })
  await input.fill('SAVE_DISCARDED')
  await input.press('Escape')
  await expect(page.locator('[data-rename-input]')).toHaveCount(0)
  await expect(page.locator(`${row} [data-save-name]`)).toHaveText('SAVE_RENAMED')
  expect(await readRaw(page, KEYS.saves), 'Esc 取消不许写盘').toBe(committedRaw)
})
