/**
 * 节点显示名：编辑器里 `[data-node-name]` 改的是**节点的 name**（展示用），不是 id、不是结构。
 *
 * 两个模式都要落对地方：
 *   · 卡带编辑器 `#/edit/:cardId` ⇒ 写 `tg2.cards[0].chain[i].name`；
 *   · 存档编辑器 `#/edit-save/:saveId` ⇒ 写 **`save.cardSnapshot.chain[i].name`**，`tg2.cards` 一个字节不动。
 *
 * 「不动结构」量四样：链的 **id 列表**、每个节点的 `reads` / `writable` / `readsUpstream` / `prompt` / `historyTurns`、
 * 状态树的 code 列表、提示词的 id 列表 —— 全部与改名前逐字段相同。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, makeCard, makeSave, MOCK_PRESET, readRaw, readStorage, route } from './support/app.js'

const CARD_ID = 'c1'
const SAVE_ID = 's1'

function seeded() {
  const card = makeCard()
  return {
    [KEYS.cards]: [card],
    [KEYS.saves]: [makeSave(card)],
    [KEYS.presets]: [MOCK_PRESET],
  }
}

/** 结构指纹：只取「不该变」的那些字段 */
function structureOf(snapshot) {
  return {
    chainIds: snapshot.chain.map((node) => node.id),
    stateCodes: snapshot.state.map((element) => element.code),
    promptIds: snapshot.prompts.map((prompt) => prompt.id),
    nodes: snapshot.chain.map((node) => ({
      id: node.id,
      reads: node.reads,
      writable: node.writable,
      readsUpstream: node.readsUpstream,
      prompt: node.prompt,
      historyTurns: node.historyTurns,
    })),
  }
}

test.describe('节点显示名：卡带编辑器', () => {
  test('改 name 落到 tg2.cards，id / 结构 / 其它字段都不动，刷新还在', async ({ page }) => {
    await boot(page, { storage: seeded(), hash: route.edit(CARD_ID) })
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    const before = (await readStorage(page, KEYS.cards))[0]
    const savesBefore = await readRaw(page, KEYS.saves)

    await page.locator('[data-node-id="check"]').click()
    const input = page.locator('[data-node-name]')
    await expect(input, '节点编辑区要有显示名输入框').toBeVisible()
    await expect(input, '输入框里应该是节点当前的显示名').toHaveValue('check')
    await input.fill('CHECK_RENAMED')
    // v5：编辑只改草稿 ⇒ 点【保存】才写 tg2.cards
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const after = (await readStorage(page, KEYS.cards))[0]
    const node = after.chain.find((item) => item.id === 'check')
    expect(node.name, '显示名没落到 tg2.cards').toBe('CHECK_RENAMED')
    expect(structureOf(after), '改名动到了结构 / id').toEqual(structureOf(before))
    expect(await readRaw(page, KEYS.saves), '卡带编辑器改名动到了存档').toBe(savesBefore)

    await page.reload()
    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-name]')).toHaveValue('CHECK_RENAMED')
  })
})

test.describe('节点显示名：存档编辑器', () => {
  test('改 name 落到 save.cardSnapshot，tg2.cards 一个字节不动，刷新还在', async ({ page }) => {
    await boot(page, { storage: seeded(), hash: `#/edit-save/${SAVE_ID}` })
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    const cardsBefore = await readRaw(page, KEYS.cards)
    const saveBefore = (await readStorage(page, KEYS.saves))[0]

    await page.locator('[data-node-id="check"]').click()
    const input = page.locator('[data-node-name]')
    await expect(input, '存档编辑器也要有节点显示名输入框').toBeVisible()
    await expect(input).toHaveValue('check')
    await input.fill('SAVE_NODE_NAME')
    // 存档编辑器同样是草稿 + 保存
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const after = (await readStorage(page, KEYS.saves))[0]
    const node = after.cardSnapshot.chain.find((item) => item.id === 'check')
    expect(node.name, '显示名没落到 save.cardSnapshot').toBe('SAVE_NODE_NAME')
    expect(structureOf(after.cardSnapshot), '改名动到了快照的结构 / id').toEqual(
      structureOf(saveBefore.cardSnapshot),
    )
    expect(await readRaw(page, KEYS.cards), '存档编辑器改名动到了卡带库').toBe(cardsBefore)

    await page.reload()
    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-name]')).toHaveValue('SAVE_NODE_NAME')
  })
})
