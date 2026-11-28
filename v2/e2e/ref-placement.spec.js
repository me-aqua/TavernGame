/**
 * 阶段 4 · **引用（ref）能住在哪一行**（范围已重开：任何标量位置都能选 `ref`）；
 * 引用源仍只允许**顶层数组**（嵌套数组字段不作用源）。
 *
 * 三件事：
 *   ① **类型下拉**：顶层行、顶层数组的直接字段（`2.6.1`）、嵌套数组里的字段（`2.4.5.1`）、
 *      对象字段的子孙（`2.4.4.1`）**都能选 `ref`**（重开前那一版把它们排除在外，已翻面）；
 *   ② **引用自仍只列顶层数组**：深层 ref（`2.4.5.1`）的候选里没有嵌套数组（`2.4.5`），
 *      也没法选「包含自己的数组」（`2.4` / `2.4.5` 置灰）；
 *   ③ **item 级引用也能加子元素**：`2.6.1`（数组 item 里的 ref）现在有 `[data-add-child]`；
 *      同一 item 的普通字段 `2.6.2` 与顶层 ref `2.5` 照旧有。
 *
 * 判据只用 `data-*` 钩子；文案不在这里钉。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { defCard } from './support/ref-fixtures.js'

const row = (code) => `[data-state-item="${code}"]`
const source = '[data-ref-source]'

/** 选中一个元素，读它类型下拉的每一档（value） */
async function typeOptionsOf(page, code) {
  await page.locator(row(code)).click()
  await expect(page.locator('[data-state-type]')).toBeVisible()
  return page
    .locator('[data-state-type] option')
    .evaluateAll((options) => options.map((option) => option.value))
}

/** 引用自：此刻**可选**的源数组 code（置灰 / 不出现的都不算） */
async function sourceCodes(page) {
  const options = await page
    .locator(`${source} option`)
    .evaluateAll((all) => all.map((option) => ({ value: option.value, disabled: option.disabled })))
  return options.filter((option) => option.value !== '' && !option.disabled).map((option) => option.value)
}

test('类型下拉：任何标量位置都能选 ref（顶层行 / 顶层数组字段 / 嵌套数组字段 / 对象子孙）', async ({
  page,
}) => {
  const card = defCard()
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()

  // 顶层行 / 顶层数组行 / 顶层数组的直接字段
  expect(await typeOptionsOf(page, '2.5'), '顶层行能选 ref').toContain('ref')
  expect(await typeOptionsOf(page, '2.4'), '顶层数组行能选 ref').toContain('ref')
  expect(await typeOptionsOf(page, '2.6.1'), '顶层数组的直接字段能选 ref').toContain('ref')
  expect(await typeOptionsOf(page, '2.4.1'), '顶层数组的直接字段能选 ref（第二个采样）').toContain('ref')

  // 重开的那两格：嵌套数组里的字段 / 对象字段的子孙
  expect(await typeOptionsOf(page, '2.4.5.1'), '嵌套数组里的字段也能选 ref（范围重开）').toContain('ref')
  expect(await typeOptionsOf(page, '2.4.4.1'), '对象字段的子孙也能选 ref（范围重开）').toContain('ref')
})

test('深层 ref（2.4.5.1）的引用自仍只列顶层数组：嵌套数组不列，包含自己的置灰', async ({ page }) => {
  const card = defCard()
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()

  // 先把深层字段换成 ref（契约 §九：换类型先弹警告）
  await page.locator(row('2.4.5.1')).click()
  await expect(
    page.locator('[data-state-type] option[value="ref"]'),
    '深层字段也要有 ref 这一档（范围重开）',
  ).toHaveCount(1)
  await page.locator('[data-state-type]').selectOption('ref')
  await expect(page.locator('[data-confirm]')).toBeVisible()
  await page.locator('[data-confirm-ok]').click()
  await expect(page.locator('[data-state-type]')).toHaveValue('ref')
  await expect(page.locator(source), '深层 ref 也要有引用自').toBeVisible()

  // 顶层数组全部可选，嵌套数组 2.4.5 不列；含自己的 2.4 / 2.4.5 不可选
  expect(await sourceCodes(page), '引用源仍只列顶层数组').toEqual(['2.6', '2.7', '2.8'])
  const offered = await page
    .locator(`${source} option`)
    .evaluateAll((all) => all.map((option) => ({ value: option.value, disabled: option.disabled })))
  for (const code of ['2.4.5', '2.4']) {
    const found = offered.find((option) => option.value === code)
    expect(found === undefined || found.disabled, `包含自己的数组 ${code} 不许作为源`).toBe(true)
  }
})

test('item 级引用也能加子元素；同 item 的普通字段与顶层 ref 照旧有', async ({ page }) => {
  await boot(page, { sample: true })
  const cards = await readStorage(page, KEYS.cards)
  await page.goto(`${APP_PATH}${route.edit(cards[0].id)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
  // 「加子元素」只在 S2（选中了某个元素）才渲染
  await page.locator(row('2')).click()

  await expect(
    page.locator(`${row('2.6.1')} [data-add-child]`),
    'item 级引用也能加关系子元素（范围重开）',
  ).toHaveCount(1)
  await expect(page.locator(`${row('2.6.2')} [data-add-child]`), '同一 item 的普通字段照旧有 +').toHaveCount(
    1,
  )
  await expect(page.locator(`${row('2.5')} [data-add-child]`), '顶层 ref 的关系子元素照旧能加').toHaveCount(1)
})
