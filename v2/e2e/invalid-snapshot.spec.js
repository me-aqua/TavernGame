/**
 * 存档快照「有名字但不合法」（评审 P2-1 / 组长口径）：首页要标成非法行，不是可点的合法行。
 *
 * 现场：`validateSave(raw)` 只看存档自己那一半，**从不校验 `cardSnapshot`**；
 * 而「这份存档能不能打开」取决于快照（对话页进场先 `validateCard(save.cardSnapshot)`）。
 * 于是旧格式快照（多一个校对节点 / 缺 `opening`）在首页是一行**合法**存档：有改名 / 删除、
 * 点了进对话页、然后才看到错误页 —— 而本票的目标是「非法项逐项标记、不可点进游戏」。
 *
 * 判据三条：
 *   ① 快照是旧格式卡（有 `name`）⇒ `[data-invalid-save]` + 中文原因、行内没有改名 / 删除、点它不跳页；
 *   ② 缺 `opening` 的快照 ⇒ 同上（两种不同的坏法，别只堵一种）；
 *   ③ **反向臂**：卡被删掉、但快照是合法卡 ⇒ 照常是合法存档、点进去能玩
 *      （`save.cardSnapshot` 是跑回合的真源，CONTRACT §8.3 —— 防「一刀切把所有孤儿都标非法」）。
 *
 * ⚠️ 第 ③ 条与 `orphan-save.spec.js` 的第三条同义：这里重一份是为了让它和 ①② 挨着 ——
 * 判定口径一变，「哪些该标非法」与「哪些不该」必须同时被钉住。
 */
import { expect, test } from '@playwright/test'
import { boot, CJK, KEYS, makeCard, makeNode, makeSave, MOCK_PRESET } from './support/app.js'

const VALID_SAVE_ID = 's1'
const BAD_SAVE_ID = 's-bad'
const GONE_CARD_ID = 'c-gone'

/** 旧格式之一：多一个校对节点（`name` 还在，所以它「有名字但不合法」） */
function snapshotWithProof() {
  const base = makeCard()
  return { ...base, chain: [...base.chain, makeNode('proof', 'proof')] }
}

/** 旧格式之二：缺 `opening` 提示词块 */
function snapshotWithoutOpening() {
  const card = makeCard()
  return { ...card, prompts: card.prompts.filter((prompt) => prompt.id !== 'opening') }
}

/** 一份「快照坏了」的存档：存档自身那一半是合法的，坏在 `cardSnapshot` */
function saveWithBadSnapshot(cardSnapshot) {
  return makeSave(makeCard(), { id: BAD_SAVE_ID, name: 'BAD_SNAPSHOT_SAVE', cardSnapshot })
}

/** 首页照常的公共断言 */
async function expectHomeAlive(page) {
  await expect(page.locator('[data-page="home"]')).toBeVisible()
  await expect(page.locator('[data-error]'), '坏快照把首页挡成错误页了').toHaveCount(0)
  await expect(page.locator(`[data-save-id="${VALID_SAVE_ID}"]`), '合法存档被拖没了').toBeVisible()
}

test.describe('坏快照的存档：首页标成非法行，不许当成可点的合法行', () => {
  test('快照是旧格式卡（多一个校对节点）⇒ [data-invalid-save] + 中文原因、点不进去', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card), saveWithBadSnapshot(snapshotWithProof())],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })
    const homeUrl = page.url()

    await expectHomeAlive(page)
    await expect(page.locator('[data-invalid-save]')).toHaveCount(1)
    await expect(page.locator('[data-invalid-reason]')).toHaveText(CJK)
    // 非法行没有入口
    await expect(page.locator('[data-invalid-save] [data-save-rename]')).toHaveCount(0)
    await expect(page.locator('[data-invalid-save] [data-save-delete]')).toHaveCount(0)

    // 点它不跳页
    await page.locator('[data-invalid-save]').click()
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page, '点坏快照存档行不许进对话页').toHaveURL(homeUrl)
  })

  test('快照缺 opening ⇒ 同样标非法行（另一种坏法）', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card), saveWithBadSnapshot(snapshotWithoutOpening())],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })
    const homeUrl = page.url()

    await expectHomeAlive(page)
    await expect(page.locator('[data-invalid-save]')).toHaveCount(1)
    await expect(page.locator('[data-invalid-reason]')).toHaveText(CJK)
    await expect(page.locator('[data-invalid-save] [data-save-rename]')).toHaveCount(0)

    await page.locator('[data-invalid-save]').click()
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page, '点坏快照存档行不许进对话页').toHaveURL(homeUrl)
  })

  test('反向臂：卡被删掉、快照是合法卡 ⇒ 照常是合法存档、点进去能玩', async ({ page }) => {
    const card = makeCard()
    // 快照是「那张已经被删掉的卡」的合法克隆（id 与 save.cardId 对齐）
    const gone = { ...makeCard(), id: GONE_CARD_ID }
    const orphan = makeSave(gone, { id: 's-orphan', cardId: GONE_CARD_ID, name: 'ORPHAN_SAVE' })
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card), orphan],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })

    await expectHomeAlive(page)
    // 快照合法 ⇒ 不是非法行（别一刀切把所有孤儿都标非法）
    await expect(page.locator('[data-invalid-save]')).toHaveCount(0)
    await expect(page.locator('[data-save-id="s-orphan"]')).toBeVisible()
    await expect(page.locator('[data-save-id="s-orphan"] [data-save-meta]')).toContainText('card one')

    await page.locator('[data-save-id="s-orphan"]').click()
    await expect(page.locator('[data-page="play"]')).toBeVisible()
    await expect(page.locator('[data-story]')).toBeVisible()
    await expect(page.locator('[data-error]')).toHaveCount(0)
  })
})
