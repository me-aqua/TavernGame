/**
 * 阶段 4 · **派生写权限的显示**（引用契约 §8.4：`写 2.4 ⇒ 自动获得直接引用它的 ref 自身值写权限`，
 * 且「派生写权限必须在编辑器里显示（例如『随 2.4 级联』）；源写关掉时，派生自动消失」）。
 *
 * 评审 F3 记的是「全仓 0 处实现、0 条判据」；这条判据先钉形状，**等 t80 把标记挂上就转绿**：
 *
 *   · ref 行（`[data-state-item="2.5"]`）里出现一个 `[data-derived-write="<源数组 code>"]`
 *     的标记，文字里点名源数组（`2.4`）且是「随 / 级联」这类中文说明；
 *   · 源数组**不可写**的 ref（`2.11` 的源是 `2.10`）没有这个标记；
 *   · 把 `2.4` 的写眼睛关掉 ⇒ 标记消失；再打开 ⇒ 标记回来。
 *
 * 判据只用 `data-*` 钩子。t80 已落地（`StateTree.vue` 的 `[data-derived-write]` 标记）；
 * 第二条反过来钉「item 内的 ref 不派生」这一档（评审 F8 / P2）。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { refCard } from './support/ref-fixtures.js'

const row = (code) => `[data-state-item="${code}"]`
const badge = (code, source) => `${row(code)} [data-derived-write="${source}"]`

/** 开卡编辑器并选中判定节点（只有选中工作流节点才露出读 / 写眼睛） */
async function openNode(page) {
  const card = refCard()
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
  await page.locator('[data-node-id="check"]').click()
}

test('源数组可写时，ref 行显示派生写标记（点名源数组），源写关掉就消失', async ({ page }) => {
  await openNode(page)

  // 正控：2.5 的源是 2.4，而当前节点的 writable 里有 2.4 ⇒ 派生标记必须在
  await expect(page.locator(`${row('2.4')} [data-eyes="write"]`), '前置：2.4 的写眼睛是开的').toHaveAttribute(
    'data-on',
    'true',
  )
  await expect(page.locator(badge('2.5', '2.4')), '派生写权限要在 ref 行里显示').toHaveCount(1)
  const text = await page.locator(badge('2.5', '2.4')).innerText()
  expect(text, '标记要点名源数组').toContain('2.4')
  expect(text, '标记要说清是派生的（随 / 级联）').toMatch(/随|级联/)

  // 负控：2.11 的源是 2.10，不在 writable 里 ⇒ 没有派生标记
  await expect(page.locator(`${row('2.11')} [data-derived-write]`), '源不可写就没有派生标记').toHaveCount(0)

  // 关掉源数组的写眼睛 ⇒ 派生自动消失
  await page.locator(`${row('2.4')} [data-eyes="write"]`).click()
  await expect(page.locator(`${row('2.4')} [data-eyes="write"]`)).toHaveAttribute('data-on', 'false')
  await expect(page.locator(badge('2.5', '2.4')), '源写关掉，派生标记也要消失').toHaveCount(0)

  // 再打开 ⇒ 回来
  await page.locator(`${row('2.4')} [data-eyes="write"]`).click()
  await expect(page.locator(`${row('2.4')} [data-eyes="write"]`)).toHaveAttribute('data-on', 'true')
  await expect(page.locator(badge('2.5', '2.4')), '源写打开，派生标记回来').toHaveCount(1)
})

/**
 * P2（评审 F8）：**item 内的 ref 没有自己的值路径**，引擎不把源数组的写权限派生给它
 * ——所以它也不该画派生写标记。用示例卡：判定节点的 `writable` 同时含 `1.4`（`2.6.1` 的源）
 * 与 `2.4`（`2.5` 的源），一个在 item 里、一个是顶层，刚好对照。
 */
test('P2：item 内的 ref（2.6.1）不显示派生写标记；顶层 2.5 仍显示「随 2.4 级联」', async ({ page }) => {
  await boot(page, { sample: true })
  const cards = await readStorage(page, KEYS.cards)
  await page.goto(`${APP_PATH}${route.edit(cards[0].id)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
  await page.locator('[data-node-id="check"]').click()

  // 前置：item 内 ref 的源（1.4）写眼睛确实是开的 —— 否则「没有标记」测不出东西
  await expect(
    page.locator(`${row('1.4')} [data-eyes="write"]`),
    '前置：示例卡的 1.4 在判定节点的写权限里',
  ).toHaveAttribute('data-on', 'true')

  // 顶层 ref 2.5（源 2.4）照旧显示「随 2.4 级联」
  const top = page.locator(badge('2.5', '2.4'))
  await expect(top, '顶层 ref 的派生标记还在').toHaveCount(1)
  await expect(top).toHaveText('随 2.4 级联')

  // item 内的 ref（2.6.1，源 1.4）一个派生标记都不许有
  await expect(
    page.locator(`${row('2.6.1')} [data-derived-write]`),
    'item 内的 ref 没有自己的值路径 ⇒ 不派生写，也不许画标记',
  ).toHaveCount(0)
})
