/**
 * SPEC §9.4：**改卡之后旧存档仍能跑**（快照）。
 *
 * 两条方向都要验，只验一半等于没验：
 *   ① 旧存档跑的还是**冻结时**那张卡（改过的初值 / 提示词一个字都不许进来）；
 *   ② 改完的卡**新建**存档时用的是新值（否则「快照生效」与「改动根本没保存」长得一模一样）。
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
  openStory,
  playTurn,
  readStorage,
  route,
  tracePrompt,
} from './support/app.js'

const CARD_ID = 'c1'

function seedWithSave() {
  const card = makeCard()
  return {
    [KEYS.cards]: [card],
    [KEYS.saves]: [makeSave(card)],
    [KEYS.presets]: [MOCK_PRESET],
  }
}

test('改初值与节点提示词之后：旧存档仍按旧卡跑，新存档吃新值', async ({ page }) => {
  await boot(page, { storage: seedWithSave() })

  // ---- 改卡：元素 1 的初值 + 输出节点的提示词
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator('[data-state-item="1"]').click()
  await page.locator('[data-field="initial"]').fill('VAL_PLACE_NEW')
  await page.locator('[data-node-id="output"]').click()
  await page.locator('[data-node-prompt]').fill('NODE_OUT_EDITED')

  // ---- 旧存档：跑一回合，prompt 里还是旧卡（trace 卡片按节点分 ⇒ 读输出节点那一张）
  await openStory(page, CARD_ID, 's1', { debug: true })
  await playTurn(page, 'act one', 1)
  const prompt = page.locator(tracePrompt('output'))
  // 旧存档的 tree 取的是**快照**的初值：元素 1 这一回合被判定节点写成 mock-t1（P2 同回合可见），
  // 所以「跑的是旧卡」用三样东西证：提示词块正文、节点提示词、以及没被写过的元素 2。
  await expect(prompt).toContainText('BODY_ONE')
  await expect(prompt).toContainText('NODE_OUT')
  await expect(prompt).toContainText('VAL_MOOD_B2')
  await expect(prompt).not.toContainText('VAL_PLACE_NEW')
  await expect(prompt).not.toContainText('NODE_OUT_EDITED')

  // ---- 盘上两个方向都在：卡被改了，存档快照没被改
  const saves = await readStorage(page, KEYS.saves)
  const cards = await readStorage(page, KEYS.cards)
  expect(cards[0].state[1].initial).toBe('VAL_PLACE_NEW')
  expect(cards[0].chain.find((node) => node.id === 'output').prompt).toBe('NODE_OUT_EDITED')
  expect(saves[0].cardSnapshot.state[1].initial).toBe('VAL_PLACE_A1')
  expect(saves[0].cardSnapshot.chain.find((node) => node.id === 'output').prompt).toBe('NODE_OUT')
  expect(saves[0].turn).toBe(1)

  // ---- 新存档吃新值（新值只进新存档的 tree，旧存档的快照没被改写）
  const newSaveId = await createSave(page, CARD_ID)
  const after = await readStorage(page, KEYS.saves)
  const fresh = after.find((save) => save.id === newSaveId)
  expect(fresh.tree['1']).toBe('VAL_PLACE_NEW')
  // 旧存档跑过一回合：元素 1 已被判定节点写过（mock 只写 writable[0] = '1'），
  // 所以这里量的是**写入发生了**；「初值仍是旧的」由上面 line 59 的 cardSnapshot 断言负责。
  expect(after.find((save) => save.id === 's1').tree['1']).toBe('mock-t1')

  await openStory(page, CARD_ID, newSaveId, { debug: true })
  await playTurn(page, 'act one', 1)
  await expect(page.locator(tracePrompt('output'))).toContainText('NODE_OUT_EDITED')
})

test('删掉卡连带删掉它的存档（盘上卡与存档都清空）', async ({ page }) => {
  await boot(page, { storage: seedWithSave() })
  await page.goto(`${APP_PATH}${route.home}`)
  await page.locator(`[data-card-id="${CARD_ID}"] [data-card-delete]`).click()
  await expect(page.locator('[data-confirm]')).toBeVisible()
  await page.locator('[data-confirm-ok]').click()
  await expect(page.locator('[data-card-id]')).toHaveCount(0)

  // 契约 §8.1：删卡连带删掉它的存档 —— 这里把口径钉死在读盘上，不靠界面猜
  expect(await readStorage(page, KEYS.cards)).toEqual([])
  expect(await readStorage(page, KEYS.saves)).toEqual([])
})
