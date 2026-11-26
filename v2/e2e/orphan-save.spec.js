/**
 * 孤儿存档（评审 P1-1）：存档的 `cardId` 指向一张**不在盘上**的卡时，首页不许白屏。
 *
 * 现场：`validateSave(raw)` 只看存档自身那一半，`cardSnapshot` 可以从没被校验过；
 * 而首页取卡名的路径是 `cards.find(save.cardId)?.name ?? save.cardSnapshot.name` ——
 * 只要 `cardId` 找不到卡，就会去解引用 `cardSnapshot`。快照缺失 / 为 `null` 时当场 `TypeError`，
 * Vue 渲染函数抛错 ⇒ 挂载失败 ⇒ **空白页**（不是错误面板）。所以这里量三样：
 *   ① `#app` 非空 + 首页在（不是白屏）；
 *   ② 这类存档渲染成**非法行**（`[data-invalid-save]` + 中文原因）、点不进去；
 *   ③ 旁边的合法存档照常（不被孤儿拖下水）。
 *
 * ⚠️ 第三种「卡被删掉、但快照完好」**不**在这一类里：`save.cardSnapshot` 是跑回合的唯一真源
 * （CONTRACT §8.3：改卡 / 删卡都不该影响旧存档），所以它照常是一行合法存档、点进去能玩。
 * 要把它也标成非法是另一个口径，得组长拍板 —— 这一条现在钉的是「不白屏 + 能玩」。
 */
import { expect, test } from '@playwright/test'
import { boot, CJK, KEYS, makeCard, makeSave, MOCK_PRESET } from './support/app.js'

const SAVE_ID = 's1'
const ORPHAN_ID = 's-orphan'
/** 存档指向一张盘上不存在的卡（卡被删了 / 从没存在过） */
const GONE_CARD_ID = 'c-gone'

/** 一张「已经不在盘上」的卡的克隆（快照里的 id 与 `save.cardId` 一致，别的字段都合法） */
function goneCardSnapshot() {
  return { ...makeCard(), id: GONE_CARD_ID }
}

/** 孤儿存档：`cardId` 指向不存在的卡；`over` 用来把 `cardSnapshot` 删掉 / 置 null */
function orphanSave(over = {}) {
  const save = makeSave(goneCardSnapshot(), { id: ORPHAN_ID, cardId: GONE_CARD_ID, name: 'ORPHAN_SAVE' })
  return { ...save, ...over }
}

/** 首页照常的公共断言：挂上了、不是错误页、旁边那条合法存档还在 */
async function expectHomeAlive(page) {
  await expect(page.locator('#app'), '#app 是空的 —— 渲染期抛了（白屏）').toBeAttached()
  const appText = (await page.locator('#app').innerText()).trim()
  expect(appText.length, '#app 是空的 —— 白屏').toBeGreaterThan(0)
  await expect(page.locator('[data-page="home"]')).toBeVisible()
  await expect(page.locator('[data-error]'), '孤儿存档把首页挡成错误页了').toHaveCount(0)
  await expect(page.locator(`[data-save-id="${SAVE_ID}"]`), '合法存档被孤儿拖没了').toBeVisible()
}

test.describe('孤儿存档：快照缺失 / 为 null 时首页要标记它，不许白屏', () => {
  test('cardSnapshot 缺失 ⇒ 首页在、孤儿一行带中文原因、点不进去', async ({ page }) => {
    const card = makeCard()
    const orphan = orphanSave()
    delete orphan.cardSnapshot
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card), orphan],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })
    const homeUrl = page.url()

    await expectHomeAlive(page)
    await expect(page.locator('[data-invalid-save]')).toHaveCount(1)
    await expect(page.locator('[data-invalid-reason]')).toHaveText(CJK)
    // 非法行没有任何入口
    await expect(page.locator('[data-invalid-save] [data-save-rename]')).toHaveCount(0)
    await expect(page.locator('[data-invalid-save] [data-save-delete]')).toHaveCount(0)

    // 点它不跳页
    await page.locator('[data-invalid-save]').click()
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page, '点孤儿存档行不许跳页').toHaveURL(homeUrl)
  })

  test('cardSnapshot 是 null ⇒ 同样：首页在、孤儿一行带中文原因、点不进去', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card), orphanSave({ cardSnapshot: null })],
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
    await expect(page, '点孤儿存档行不许跳页').toHaveURL(homeUrl)
  })
})

test.describe('孤儿存档：卡被删掉但快照完好', () => {
  test('照常是一行合法存档：卡名取快照、点进去能玩（快照才是真源）', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card), orphanSave()],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })

    await expectHomeAlive(page)
    // 快照完好 ⇒ 这一条不是非法行，卡名从快照里取
    await expect(page.locator('[data-invalid-save]')).toHaveCount(0)
    await expect(page.locator(`[data-save-id="${ORPHAN_ID}"]`)).toBeVisible()
    await expect(page.locator(`[data-save-id="${ORPHAN_ID}"] [data-save-meta]`)).toContainText('card one')

    // 点进去照常能玩：跑的是 save.cardSnapshot，不需要盘上还有那张卡
    await page.locator(`[data-save-id="${ORPHAN_ID}"]`).click()
    await expect(page.locator('[data-page="play"]')).toBeVisible()
    await expect(page.locator('[data-story]')).toBeVisible()
    await expect(page.locator('[data-error]')).toHaveCount(0)
  })
})
