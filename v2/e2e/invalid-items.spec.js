/**
 * 阶段 2 第一项：非法卡 / 非法存档在首页**逐项标记**，不影响合法项与新建。
 *
 * 现在这一份应当红（整表校验一抛，首页就是错误页）：`loadCards()` / `loadSaves()` 是整表校验，
 * 一条坏的就把合法项一起挡在门外 —— 这正是本票要修的那个现场。
 *
 * 判据只认钩子 + 盘上字节：原因文案用中文正则（`[\u4e00-\u9fff]`），不抄文案表；
 * 「原样还在」用**原始 JSON 的序列化字符串逐字相等**来量（不靠界面猜）。
 *
 * 每个用例都带一条**反向臂**：`[data-invalid-*]` 不许出现在该出现的地方之外，
 * 而「按 id 只校验目标项」也不等于「什么都能打开」—— 直接打开非法目标照样报中文 E_VALIDATION。
 */
import { expect, test } from '@playwright/test'
import { boot, CJK, KEYS, makeCard, makeSave, MOCK_PRESET, readRaw, route } from './support/app.js'

const CARD_ID = 'c1'
const SAVE_ID = 's1'
const BAD_CARD_ID = 'c-bad'
const BAD_SAVE_ID = 's-bad'
/** 只有坏项才有的字段：宽松写那条判据靠它证明「没有顺手把字段洗掉」 */
const VERBATIM = 'KEEP_ME_VERBATIM'

/** 一张「缺 opening 提示词」的旧卡（契约 §6.1 ⇒ E_VALIDATION），形状与真坏卡一致 */
function badCard() {
  const card = makeCard()
  return {
    ...card,
    id: BAD_CARD_ID,
    name: 'BAD_CARD',
    prompts: card.prompts.filter((prompt) => prompt.id !== 'opening'),
    extra: VERBATIM,
  }
}

/** 一份 `tree['0']` 不是 `{day,hour}` 的存档（契约 §6.1 ⇒ E_VALIDATION） */
function badSave(card) {
  return {
    ...makeSave(card),
    id: BAD_SAVE_ID,
    name: 'BAD_SAVE',
    tree: { ...makeSave(card).tree, 0: 'day 1 hour 8' },
    extra: VERBATIM,
  }
}

/** 盘上一个键的解析值（`readRaw` 是原始字符串，这里要逐元素比字节） */
async function readArray(page, key) {
  return JSON.parse(await readRaw(page, key))
}

test.describe('首页：非法卡逐项标记，不挡合法项', () => {
  test('1 合法 + 1 非法卡：首页正常、非法行有中文原因、点它不跳页、合法卡能进编辑器', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: { [KEYS.cards]: [card, badCard()], [KEYS.presets]: [MOCK_PRESET] },
    })
    const homeUrl = page.url()

    // 首页照常：列表与新建都在，没有错误面板
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page.locator('[data-error]')).toHaveCount(0)
    await expect(page.locator('[data-card-list]')).toBeVisible()
    await expect(page.locator('[data-new-card]')).toBeVisible()

    // 合法行照旧
    await expect(page.locator(`[data-card-id="${CARD_ID}"]`)).toBeVisible()
    await expect(page.locator(`[data-card-id="${CARD_ID}"] [data-card-edit]`)).toBeVisible()

    // 非法行：标记 + 中文原因 + 没有任何入口
    await expect(page.locator('[data-invalid-card]')).toHaveCount(1)
    await expect(page.locator('[data-invalid-reason]')).toHaveText(CJK)
    await expect(page.locator('[data-invalid-card] [data-card-edit]')).toHaveCount(0)
    await expect(page.locator(`[data-card-id="${BAD_CARD_ID}"] [data-card-edit]`)).toHaveCount(0)

    // 点非法行不跳页
    await page.locator('[data-invalid-card]').click()
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page, '点非法卡行不许跳页').toHaveURL(homeUrl)

    // 合法卡照旧能进编辑器
    await page.locator(`[data-card-id="${CARD_ID}"] [data-card-edit]`).click()
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await expect(page.locator('[data-error]')).toHaveCount(0)
  })
})

test.describe('首页：非法存档逐项标记，不挡合法项', () => {
  test('1 合法 + 1 非法存档：首页正常、非法行有中文原因、点它不进对话页、合法存档能进游戏', async ({
    page,
  }) => {
    const card = makeCard()
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card), badSave(card)],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })
    const homeUrl = page.url()

    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page.locator('[data-error]')).toHaveCount(0)
    await expect(page.locator('[data-save-list]')).toBeVisible()
    await expect(page.locator('[data-new-save]')).toBeVisible()

    await expect(page.locator(`[data-save-id="${SAVE_ID}"]`)).toBeVisible()
    await expect(page.locator('[data-invalid-save]')).toHaveCount(1)
    await expect(page.locator('[data-invalid-reason]')).toHaveText(CJK)
    await expect(page.locator(`[data-save-id="${BAD_SAVE_ID}"] [data-save-rename]`)).toHaveCount(0)

    // 点非法存档不进对话页
    await page.locator('[data-invalid-save]').click()
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page, '点非法存档行不许进对话页').toHaveURL(homeUrl)

    // 合法存档照旧能进游戏
    await page.locator(`[data-save-id="${SAVE_ID}"]`).click()
    await expect(page.locator('[data-page="play"]')).toBeVisible()
    await expect(page.locator('[data-error]')).toHaveCount(0)
  })
})

test.describe('含非法项时新建：新项出现，非法项原样还在', () => {
  test('新建合法卡：落盘追加在末尾，非法项仍在原位、原始 JSON 逐字不变（刷新后仍如此）', async ({ page }) => {
    await boot(page, { storage: { [KEYS.cards]: [badCard()], [KEYS.presets]: [MOCK_PRESET] } })
    const before = await readArray(page, KEYS.cards)

    await page.locator('[data-new-card]').click()

    const after = await readArray(page, KEYS.cards)
    expect(after).toHaveLength(2)
    const created = after[1]
    expect(created.id, '新卡没有排在末尾').not.toBe(BAD_CARD_ID)
    // 新卡是合法的：它有正常的编辑入口
    await expect(page.locator(`[data-card-id="${created.id}"] [data-card-edit]`)).toBeVisible()
    // 非法项：还在原位，字节逐字不变
    expect(after[0].extra, '非法项的字段被洗掉了').toBe(VERBATIM)
    expect(JSON.stringify(after[0]), '非法项的原始 JSON 被改写了').toBe(JSON.stringify(before[0]))
    await expect(page.locator('[data-invalid-card]')).toHaveCount(1)

    await page.reload()
    await expect(page.locator(`[data-card-id="${created.id}"]`)).toBeVisible()
    await expect(page.locator('[data-invalid-card]')).toHaveCount(1)
    const reloaded = await readArray(page, KEYS.cards)
    expect(JSON.stringify(reloaded[0]), '刷新之后非法项被改写了').toBe(JSON.stringify(before[0]))
  })

  test('新建合法存档：落盘追加在末尾，非法存档仍在原位、原始 JSON 逐字不变（刷新后仍如此）', async ({
    page,
  }) => {
    const card = makeCard()
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card), badSave(card)],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })
    const before = await readArray(page, KEYS.saves)

    await page.locator(`[data-card-id="${CARD_ID}"]`).click()
    await page.locator('[data-new-save]').click()

    const after = await readArray(page, KEYS.saves)
    expect(after).toHaveLength(3)
    expect(after.map((save) => save.id).slice(0, 2)).toEqual([SAVE_ID, BAD_SAVE_ID])
    const created = after[2]
    expect(created.cardId).toBe(CARD_ID)
    await expect(page.locator(`[data-save-id="${created.id}"]`)).toBeVisible()

    expect(after[1].extra, '非法存档的字段被洗掉了').toBe(VERBATIM)
    expect(JSON.stringify(after[1]), '非法存档的原始 JSON 被改写了').toBe(JSON.stringify(before[1]))
    await expect(page.locator('[data-invalid-save]')).toHaveCount(1)

    await page.reload()
    await expect(page.locator(`[data-save-id="${created.id}"]`)).toBeVisible()
    await expect(page.locator('[data-invalid-save]')).toHaveCount(1)
    const reloaded = await readArray(page, KEYS.saves)
    expect(JSON.stringify(reloaded[1]), '刷新之后非法存档被改写了').toBe(JSON.stringify(before[1]))
  })
})

test.describe('编辑器 / 对话页：按 id 只校验自己要打开的那一条', () => {
  test('编辑器：旁边有坏卡也进得去（合法 id）', async ({ page }) => {
    await boot(page, {
      storage: { [KEYS.cards]: [badCard(), makeCard()], [KEYS.presets]: [MOCK_PRESET] },
      hash: route.edit(CARD_ID),
    })
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await expect(page.locator('[data-error]')).toHaveCount(0)
    await expect(page.locator('[data-state-tree]')).toBeVisible()
    await expect(page.locator('[data-node-id="time"]')).toBeVisible()
  })

  test('对话页：旁边有坏存档也进得去（合法 id）', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [badSave(card), makeSave(card)],
        [KEYS.presets]: [MOCK_PRESET],
      },
      hash: route.play(CARD_ID, SAVE_ID),
    })
    await expect(page.locator('[data-page="play"]')).toBeVisible()
    await expect(page.locator('[data-story]')).toBeVisible()
    await expect(page.locator('[data-error]')).toHaveCount(0)
    await expect(page.locator('[data-turn]')).toHaveText('0')
  })

  test('反向臂：直接打开非法卡 ⇒ 中文 E_VALIDATION（「只校验目标项」不等于「什么都放行」）', async ({
    page,
  }) => {
    await boot(page, {
      storage: { [KEYS.cards]: [badCard()], [KEYS.presets]: [MOCK_PRESET] },
      hash: route.edit(BAD_CARD_ID),
    })
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
    await expect(page.locator('[data-error]')).toHaveText(CJK)
  })

  test('反向臂：直接打开非法存档 ⇒ 中文 E_VALIDATION', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [badSave(card)],
        [KEYS.presets]: [MOCK_PRESET],
      },
      hash: route.play(CARD_ID, BAD_SAVE_ID),
    })
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
    await expect(page.locator('[data-error]')).toHaveText(CJK)
  })
})
