/**
 * 阶段 4 · **数组 item 里的引用字段**（`2.6.1 来源`，引用契约 §4.3 / §6 / 验收 #20 / #21）。
 *
 * 这是评审 F7 点名的缺口：实现有（`ArrayValue.vue` 把 ref 字段的值格子换成 `RefValueEditor`），
 * 但常驻判据一条都没有——临时探针验完就删了。这里把它转正，钉住界面上点得到的那几件事：
 *
 *   · item 里的 ref 值渲染成**投影字段**（`1.4` 的「微醺」），不是裸 id；
 *   · `×` 清空 ⇒ 零条 = `null`（`min = 1` 的行内红字同时出现）；
 *   · 「选择引用」的选择器只列**本引用源**（`1.4`）的 item（微醺 / 潮湿），不是 `2.4` 背包；
 *   · 选一条 ⇒ 写回这一格（`2.6.1`），item 的隐藏 `id` 一个字不动，保存 0 错。
 *
 * 用内置示例卡（`2.6 当前增益` 的第 1 条，`2.6.1 来源` 引用 `1.4`，`1..1`）——
 * 它正是验收 #20 / #21 说的那个形状，不另造一份夹具。
 *
 * 判据只用 `data-*` 钩子；界面文案不在这里钉（字段中文名来自卡数据）。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, KEYS, boot, readStorage, route } from './support/app.js'

const ITEMS = '[data-array="2.6"] [data-array-item]'
const itemAt = (index) => `${ITEMS}[data-array-index="${index}"]`

/** 打开示例卡的编辑器（示例卡是首次打开时种下来的那张） */
async function openSampleEditor(page) {
  await boot(page, { sample: true })
  const cards = await readStorage(page, KEYS.cards)
  await page.goto(`${APP_PATH}${route.edit(cards[0].id)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
  // 初始值块只挂在根元素上：选中 `2 玩家` 才能看到 `2.6` 的 item
  await page.locator('[data-state-item="2"]').click()
}

/** 盘上示例卡的 `2.6` 初始值 */
async function storedBuffs(page) {
  const card = (await readStorage(page, KEYS.cards))[0]
  return card.state.find((item) => item.code === '2').initial['2.6']
}

/** 点保存并等结果出现；返回错误清单条数（0 = 成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

test('item 里的 ref（2.6.1 来源）：投影成一页、× 回 null、选择器只列 1.4、选中写回且 item id 不动', async ({
  page,
}) => {
  await openSampleEditor(page)
  const scope = itemAt(1)

  // ① 值渲染成投影字段（1.4 的「微醺」），不是裸 id
  await expect(page.locator(`${ITEMS}`), '示例卡 2.6 有两条').toHaveCount(2)
  await expect(page.locator(`${scope} [data-ref-row]`), '第 1 条的来源是一条引用').toHaveCount(1)
  const rowText = await page.locator(`${scope} [data-ref-row]`).innerText()
  expect(rowText, 'item 里的 ref 也要显示投影字段').toContain('微醺')
  expect(rowText, '不许显示裸 id').not.toContain('id_1')

  // ② × 清空：零条 = null，min=1 的行内红字同时出现
  await page.locator(`${scope} [data-ref-row-remove]`).click()
  await expect(page.locator(`${scope} [data-ref-row]`), '× 之后零条').toHaveCount(0)
  await expect(page.locator(`${scope} [data-ref-choose]`), '空状态是「选择引用」').toBeVisible()
  await expect(page.locator(`${scope} [data-ref-error]`), 'min=1 的零条要行内报错').toBeVisible()

  // ③ 选择器只列**本引用的源**（1.4 的微醺 / 潮湿），不是 2.4 背包
  await page.locator(`${scope} [data-ref-choose]`).click()
  await expect(page.locator('[data-ref-picker]')).toBeVisible()
  const ids = await page
    .locator('[data-ref-candidate]:not([disabled])')
    .evaluateAll((rows) => rows.map((item) => item.getAttribute('data-ref-candidate')))
  expect(ids, '候选来自 1.4（两条，按源数组顺序）').toEqual(['id_1', 'id_2'])
  const pickerText = await page.locator('[data-ref-picker]').innerText()
  expect(pickerText, '候选显示 1.4 的投影字段').toContain('微醺')
  expect(pickerText, '另一条也在').toContain('潮湿')
  expect(pickerText, '不许把 2.4 背包的物品列进来').not.toContain('短剑')

  // ④ 选一条 ⇒ 写回这一格
  await page.locator('[data-ref-candidate="id_2"]').click()
  await expect(page.locator('[data-ref-picker]')).toHaveCount(0)
  await expect(page.locator(`${scope} [data-ref-row]`)).toContainText('潮湿')

  // ⑤ 保存 0 错；item 的隐藏 id 不动，另一条 item 一个字不动
  expect(await save(page)).toBe(0)
  const items = await storedBuffs(page)
  expect(items, '两条 item 一个都不多不少').toHaveLength(2)
  expect(items[0].id, '改 ref 值不许动 item 的隐藏 id').toBe('id_1')
  expect(items[0]['2.6.1'], '选中后写回 id').toBe('id_2')
  expect(items[0]['2.6.2'], '同一 item 的别的字段不动').toBe('轻')
  expect(items[1]).toEqual({ id: 'id_2', '2.6.1': 'id_2', '2.6.2': '中' })
})
