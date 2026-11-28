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

/**
 * 跨根「删除那一刻就判」：`1.4`（根 `1`）里的 item 被 `2.6.1`（根 `2` 的数组 item 里，`1..1`）指着。
 * item 级引用没有扁平值路径，清不掉 ⇒ 契约 §8.3 第 3 条要的是**删除当下**整笔拒绝、点名引用元素，
 * 而不是先删掉、等到保存才报「id 不在源数组里」。
 */
test('跨根：删 1.4 里被 2.6.1 引用的 item ⇒ 删除那一刻就拒绝，不是等保存', async ({ page }) => {
  await boot(page, { sample: true })
  const cards = await readStorage(page, KEYS.cards)
  await page.goto(`${APP_PATH}${route.edit(cards[0].id)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()

  // `1.4` 在根 `1` 的初始值块里（初始值只挂在根元素上）
  await page.locator('[data-state-item="1"]').click()
  const gains = '[data-array="1.4"]'
  const items = `${gains} [data-array-item]`
  await expect(page.locator(items), '示例卡 1.4 有两项').toHaveCount(2)

  // 第 1 项（微醺）被另一个根里的 2.6.1 指着；1..1 清不掉 ⇒ 删除当场拒绝
  await page.locator(`${items}[data-array-index="1"] [data-array-remove]`).click()
  const blocked = page.locator('[data-delete-error]')
  await expect(blocked, '删被引用的源 item 要在删除那一刻拒绝').toBeVisible()
  await expect(blocked, '拒绝原因要点名引用元素（2.6.1 / 2.6）').toContainText(/2\.6/)
  await expect(page.locator(items), '拒绝后 item 一个都不许少').toHaveCount(2)
  await expect(page.locator('[data-confirm]'), '1..1 清不掉，不许给「确认级联」那条路').toHaveCount(0)

  // 卡片因此没变：保存 0 错，源数组一项不少
  expect(await save(page)).toBe(0)
  const later = (await readStorage(page, KEYS.cards))[0]
  expect(later.state.find((element) => element.code === '1').initial['1.4']).toHaveLength(2)
})

/**
 * 范围重开：**item 级引用也能有孩子**（关系自己的数据）。示例卡 `2.6.1 来源` 加一个孩子 `施加者`：
 * 每个 item 的那一格从裸值变成 `{ "<code>.0": 引用值, "<code>.1": 孩子值 }`（与「有孩子的标量字段」同一形状）。
 */
test('item 级 ref 加子元素：2.6.1 = { 2.6.1.0, 2.6.1.1 }（施加者），add-child 可用、保存 0 错', async ({
  page,
}) => {
  await boot(page, { sample: true })
  const cards = await readStorage(page, KEYS.cards)
  await page.goto(`${APP_PATH}${route.edit(cards[0].id)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()

  // ① item 级 ref 现在能加孩子：选中它再点 +
  await page.locator('[data-state-item="2.6"]').click()
  await expect(
    page.locator('[data-state-item="2.6.1"] [data-add-child]'),
    'item 级引用也要有加子元素',
  ).toHaveCount(1)
  await page.locator('[data-state-item="2.6.1"] [data-add-child]').click()
  await expect(page.locator('[data-state-item="2.6.1.1"]'), '新孩子挂在 2.6.1 下').toBeVisible()

  // ② 把孩子改名成「施加者」
  await page.locator('[data-state-item="2.6.1.1"]').click()
  await page.locator('[data-field="name"]').fill('施加者')

  // ③ 在第 1 个 item 的 item 卡里填孩子值
  await page.locator('[data-state-item="2"]').click()
  const item1 = '[data-array="2.6"] [data-array-item][data-array-index="1"]'
  await expect(page.locator(`${item1} [data-array-field="2.6.1"]`), '引用自己的值格子还在').toHaveCount(0)
  await page.locator(`${item1} [data-array-field="2.6.1.1"]`).fill('旅人')

  // ④ 保存 0 错；item 的那一格是「自身值 + 孩子」的对象形状
  expect(await save(page), '加孩子之后保存不许报错').toBe(0)
  const card = (await readStorage(page, KEYS.cards))[0]
  const items = card.state.find((element) => element.code === '2').initial['2.6']
  expect(items).toHaveLength(2)
  expect(items[0].id, 'item 的隐藏 id 不动').toBe('id_1')
  expect(items[0]['2.6.1'], '自身值住 .0、孩子住 .1').toEqual({ '2.6.1.0': 'id_1', '2.6.1.1': '旅人' })
  expect(items[1]['2.6.1'], '另一个 item 也换成同一形状（孩子取默认空串）').toEqual({
    '2.6.1.0': 'id_2',
    '2.6.1.1': '',
  })
  expect(items[0]['2.6.2'], '同一 item 的别的字段不动').toBe('轻')
  const child = card.state.find((element) => element.code === '2.6.1.1')
  expect(child, '新孩子是 2.6.1.1').toBeTruthy()
  expect(child.name, '孩子名 = 施加者').toBe('施加者')
})
