/**
 * 本票 DOM 判据：编辑器的**撤销 / 重做**（卡编辑器与存档编辑器共用顶栏）。
 *
 * 口径见 `.team/test/2026-11-28/契约-数组字段转标量-类型下拉-撤销重做.md` §4：
 *   · 顶栏顺序 `[data-save-ok]` → `[data-save-card]` → `[data-undo]` → `[data-redo]`；
 *   · 没有历史时两个按钮 `disabled`；
 *   · 改草稿 → 撤销恢复上一份、重做再回到改后那份；
 *   · `Ctrl+Z` 撤销；`Ctrl+Y` / `Ctrl+Shift+Z` 重做（焦点不在输入控件时）；
 *   · 新改动清空重做栈；保存不清空两摞栈；
 *   - 撤销 / 重做 / 任何新改动都立刻收起 `[data-save-ok]`，并把草稿标记为脏。
 *
 * 判据只用 `data-*` 钩子；按钮文案不在这里钉。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { holdCard, holdSave } from '../tests/support/array-fixtures.js'

const NAME_ROW = '[data-state-item="2.1"] [data-state-name]'
const NAME_INPUT = '[data-field="name"]'
const UNDO = '[data-undo]'
const REDO = '[data-redo]'

/** 开卡编辑器（选中 `2.1 名字`，中栏是 StateForm） */
async function openCardEditor(page, card = holdCard({ id: 'c-undo' })) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator('[data-state-item="2.1"]').click()
  await expect(page.locator(NAME_INPUT)).toBeVisible()
}

/** 开存档编辑器（同一份页面，编辑目标 = save.cardSnapshot） */
async function openSaveEditor(page, save = holdSave(holdCard({ id: 'c-undo-save' }))) {
  await boot(page, {
    storage: {
      [KEYS.cards]: [save.cardSnapshot],
      [KEYS.saves]: [save],
      [KEYS.presets]: [MOCK_PRESET],
    },
    hash: route.editSave(save.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator('[data-state-item="2.1"]').click()
  await expect(page.locator(NAME_INPUT)).toBeVisible()
  return save
}

/** 改 `2.1` 的名字（input 事件就是一次草稿改动） */
async function editName(page, text) {
  await page.locator(NAME_INPUT).fill(text)
  await expect(page.locator(NAME_ROW)).toHaveText(text)
}

/** 把焦点从输入控件挪开（快捷键判据要在「焦点不在输入控件」时按） */
async function blur(page) {
  await page.locator('[data-panel-title]').first().click()
}

/** 点保存并等成功提示 */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-ok]')).toBeVisible()
}

/**
 * 成功提示必须在 1 秒内消失。
 * 不能只写 `toHaveCount(0)`：它默认重试 5 秒，会等 3 秒自动消失后假绿。
 */
async function expectSavedHiddenFast(page) {
  await expect.poll(() => page.locator('[data-save-ok]').count(), { timeout: 1_000, intervals: [50] }).toBe(0)
}

/** 草稿是脏的：点【返回】会弹确认（取消后留在编辑器） */
async function expectDirty(page) {
  await page.locator('[data-back]').click()
  await expect(page.locator('[data-confirm]'), '脏草稿点返回要先确认').toBeVisible()
  await page.locator('[data-confirm-cancel]').click()
  await expect(page.locator('[data-confirm]')).toHaveCount(0)
}

/** 盘上第一张卡 / 第一份存档里 `2.1` 的名字 */
async function storedName(page, key = KEYS.cards) {
  const rows = await readStorage(page, key)
  const target = key === KEYS.cards ? rows[0] : rows[0].cardSnapshot
  return target.state.find((item) => item.code === '2.1').name
}

test.describe('顶栏顺序与无历史禁用（§4.1）', () => {
  test('四件齐全、undo/redo 默认 disabled；保存后顺序 = save-ok → save → undo → redo', async ({ page }) => {
    await openCardEditor(page)
    await expect(page.locator(UNDO)).toBeVisible()
    await expect(page.locator(REDO)).toBeVisible()
    await expect(page.locator(UNDO), '没有历史时撤销 disabled').toBeDisabled()
    await expect(page.locator(REDO), '没有历史时重做 disabled').toBeDisabled()

    await save(page)
    const order = await page.evaluate(`(() => {
      const nodes = [
        ...document.querySelectorAll(
          'header [data-save-ok], header [data-save-card], header [data-undo], header [data-redo]',
        ),
      ]
      return nodes.map((node) => {
        if (node.hasAttribute('data-save-ok')) return 'save-ok'
        if (node.hasAttribute('data-save-card')) return 'save'
        if (node.hasAttribute('data-undo')) return 'undo'
        return 'redo'
      })
    })()`)
    expect(order, '顶栏这一组的文档顺序').toEqual(['save-ok', 'save', 'undo', 'redo'])

    const tags = await page
      .locator(`${UNDO}, ${REDO}`)
      .evaluateAll((nodes) => nodes.map((node) => node.tagName))
    expect(tags, '撤销 / 重做是 button').toEqual(['BUTTON', 'BUTTON'])
  })
})

test.describe('改草稿 → 撤销 / 重做（§4.2）', () => {
  test('撤销回到改前、重做回到改后；栈见底后按钮重新 disabled', async ({ page }) => {
    await openCardEditor(page)
    await editName(page, 'NEW_ONE')
    await expect(page.locator(UNDO)).toBeEnabled()
    await expect(page.locator(REDO)).toBeDisabled()

    await page.locator(UNDO).click()
    await expect(page.locator(NAME_INPUT)).toHaveValue('名字')
    await expect(page.locator(NAME_ROW)).toHaveText('名字')
    await expect(page.locator(UNDO), '只有一步，撤到底就 disabled').toBeDisabled()
    await expect(page.locator(REDO)).toBeEnabled()

    await page.locator(REDO).click()
    await expect(page.locator(NAME_INPUT)).toHaveValue('NEW_ONE')
    await expect(page.locator(NAME_ROW)).toHaveText('NEW_ONE')
    await expect(page.locator(REDO), '重做到底就 disabled').toBeDisabled()
    await expect(page.locator(UNDO)).toBeEnabled()
  })

  test('Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 与点按钮等价', async ({ page }) => {
    await openCardEditor(page)
    await editName(page, 'CTRL_ONE')
    await blur(page)

    await page.keyboard.press('Control+z')
    await expect(page.locator(NAME_INPUT)).toHaveValue('名字')
    await expect(page.locator(REDO)).toBeEnabled()

    await page.keyboard.press('Control+y')
    await expect(page.locator(NAME_INPUT)).toHaveValue('CTRL_ONE')
    await expect(page.locator(REDO)).toBeDisabled()

    await page.keyboard.press('Control+z')
    await expect(page.locator(NAME_INPUT)).toHaveValue('名字')
    await page.keyboard.press('Control+Shift+z')
    await expect(page.locator(NAME_INPUT)).toHaveValue('CTRL_ONE')
  })

  test('撤销后做新改动：重做栈被清空（新分支）', async ({ page }) => {
    await openCardEditor(page)
    await editName(page, 'BRANCH_A')
    await page.locator(UNDO).click()
    await expect(page.locator(REDO)).toBeEnabled()

    await editName(page, 'BRANCH_B')
    await expect(page.locator(REDO), '新改动清空重做栈').toBeDisabled()
    await expect(page.locator(UNDO)).toBeEnabled()
    await expect(page.locator(NAME_ROW)).toHaveText('BRANCH_B')
  })
})

test.describe('保存与脏 / 成功提示（§4.2 / §4.3）', () => {
  test('保存成功后立刻改一个字：成功提示 1 秒内消失（不等 3 秒自动消失）', async ({ page }) => {
    await openCardEditor(page)
    await save(page)
    await editName(page, 'EDITED')
    await expectSavedHiddenFast(page)
    await expectDirty(page)
  })

  test('保存 → 撤销：草稿回改前、盘上不动、提示收起、草稿变脏；重做仍可回到保存前那一份', async ({
    page,
  }) => {
    await openCardEditor(page)
    await editName(page, 'SAVED_ONE')
    await save(page)
    expect(await storedName(page)).toBe('SAVED_ONE')

    await page.locator(UNDO).click()
    await expect(page.locator(NAME_INPUT)).toHaveValue('名字')
    await expectSavedHiddenFast(page)
    await expect(page.locator(REDO), '保存不清空重做栈').toBeEnabled()
    expect(await storedName(page), '撤销不写盘').toBe('SAVED_ONE')
    await expectDirty(page)

    // 撤销后保存（盘上写回旧值、提示回来），再重做：重做不写盘、提示立刻收起、草稿变脏。
    await save(page)
    expect(await storedName(page)).toBe('名字')
    await page.locator(REDO).click()
    await expect(page.locator(NAME_INPUT)).toHaveValue('SAVED_ONE')
    await expectSavedHiddenFast(page)
    await expect(page.locator(REDO)).toBeDisabled()
    expect(await storedName(page), '重做也不写盘').toBe('名字')
    await expectDirty(page)
  })

  test('存档编辑器同一套：改快照 → 撤销恢复、save.tree / 盘上快照不动', async ({ page }) => {
    const fixture = await openSaveEditor(page)
    const beforeSnapshot = JSON.stringify(fixture.cardSnapshot)
    await editName(page, 'SAVE_EDIT')
    await page.locator(UNDO).click()
    await expect(page.locator(NAME_INPUT)).toHaveValue('名字')
    await expect(page.locator(REDO)).toBeEnabled()

    const stored = (await readStorage(page, KEYS.saves))[0]
    expect(JSON.stringify(stored.cardSnapshot), '撤销不写盘：盘上快照仍是打开时那一份').toBe(beforeSnapshot)
    expect(stored.tree, 'save.tree 一个字节不动').toEqual(fixture.tree)
    await expectDirty(page)
  })
})
