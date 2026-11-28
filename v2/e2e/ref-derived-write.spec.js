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
 * 判据只用 `data-*` 钩子。**这条现在应当是红的**（t80 还没落地），转绿即证明显示层接上了。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, route } from './support/app.js'
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
