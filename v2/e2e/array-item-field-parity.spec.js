/**
 * 阶段 3 · 数组 item 字段：自身值 + 孩子（Stage3 parity；契约 `契约-阶段3-数组项字段-自身值与孩子.md` §4）。
 *
 * 这一份量的是玩家在卡编辑器里点得到的那几件事：
 *   · 数组子树里的标量字段 `2.4.1`：类型下拉恰好 text / integer / enum / array（没有 time / object）；
 *   · `[data-add-child="2.4.1"]` 可见；点下去每个 item 的 2.4.1 从裸标量提升成
 *     `{ "2.4.1.0": 旧值, "2.4.1.1": "" }`；
 *   · item 卡里渲染「自己的输入 + 孩子的行」，删除按钮仍在第一行、第一行上方没有空行；
 *   · 编辑自己的输入 / 孩子的行都会落进初始值；删掉最后一个孩子后收成裸标量。
 *
 * 判据只用 `data-*` 钩子；界面文案不在这里钉（字段中文名来自卡数据 / `editor.newChildName`）。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { holdCard } from '../tests/support/array-fixtures.js'

const ARRAY = '[data-array="2.4"]'
const ITEMS = `${ARRAY} [data-array-item]`
const row = (code) => `[data-state-item="${code}"]`
const field = (code) => `[data-array-field="${code}"]`
const fieldName = (code) => `[data-array-field-name="${code}"]`

/** 开卡编辑器：种一张数组卡 + mock 预设，直接进 `#/edit/:cardId` */
async function openEditor(page, card) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
}

/** 选中状态元素（S2） */
async function selectElement(page, code) {
  await page.locator(row(code)).click()
  await expect(page.locator(`${row(code)}.selected, ${row(code)}[data-selected]`)).toHaveCount(1)
}

/** 点保存并等结果出现；返回中文错误清单条数（0 = 成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

/** 某个 item（1 基位置） */
function itemAt(index) {
  return `${ARRAY} [data-array-item][data-array-index="${index}"]`
}

/** 读盘上的 2.4 初始值 */
async function storedItems(page) {
  const card = (await readStorage(page, KEYS.cards))[0]
  return card.state.find((element) => element.code === '2').initial['2.4']
}

test('2.4.1 类型下拉五档（含引用）、+ 可见；加孩子后 item 渲染自身输入 + 子行，保存出对象形状', async ({
  page,
}) => {
  await openEditor(page, holdCard())
  await selectElement(page, '2.4.1')

  const types = await page
    .locator('[data-state-type] option')
    .evaluateAll((options) => options.map((option) => option.getAttribute('value')))
  expect([...types].sort(), '数组字段的类型选项').toEqual(['array', 'enum', 'integer', 'ref', 'text'])
  expect(types, '不许出现时间').not.toContain('time')
  expect(types, '不许出现结构体').not.toContain('object')

  const addChild = page.locator('[data-add-child="2.4.1"]')
  await expect(addChild, '标量字段也要有加子元素').toHaveCount(1)
  await expect(addChild).toBeVisible()
  await addChild.click()
  await expect(page.locator(row('2.4.1.1')), '左栏多了子字段').toBeVisible()

  await selectElement(page, '2')
  await expect(page.locator(ITEMS)).toHaveCount(3)
  const old = ['短剑', '斗篷', '银币']
  for (let at = 1; at <= 3; at += 1) {
    await expect(page.locator(`${itemAt(at)} ${field('2.4.1')}`), '自己的输入还在').toHaveValue(old[at - 1])
    await expect(page.locator(`${itemAt(at)} ${field('2.4.1.1')}`), '孩子的行也在').toHaveCount(1)
    await expect(page.locator(`${itemAt(at)} ${field('2.4.1.1')}`)).toHaveValue('')
    await expect(page.locator(`${itemAt(at)} ${fieldName('2.4.1.1')}`)).toBeVisible()
  }

  // item 第一行 = 字段名 + 自己的输入 + 删除按钮；孩子行在下面；第一行上方没有空行
  const rows = await page.locator(ITEMS).evaluateAll((items) =>
    items.map((item) => {
      const name = item.querySelector('[data-array-field-name="2.4.1"]')
      const childName = item.querySelector('[data-array-field-name="2.4.1.1"]')
      const remove = item.querySelector('[data-array-remove]')
      if (!name || !childName || !remove) return { missing: true }
      const rect = (element) => {
        const box = element.getBoundingClientRect()
        return {
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
          height: box.height,
          cy: box.top + box.height / 2,
        }
      }
      return {
        item: rect(item),
        name: rect(name),
        childName: rect(childName),
        remove: rect(remove),
        removeCount: item.querySelectorAll('[data-array-remove]').length,
        position: remove.ownerDocument.defaultView.getComputedStyle(remove).position,
      }
    }),
  )
  expect(rows).toHaveLength(3)
  for (const [index, one] of rows.entries()) {
    expect(one.missing, `第 ${index + 1} 项要有第一字段 / 子行 / 删除按钮`).toBeUndefined()
    expect(one.removeCount, `第 ${index + 1} 项恰好一个删除按钮`).toBe(1)
    expect(one.position, '删除按钮不是绝对 / 固定定位').not.toMatch(/absolute|fixed/)
    expect(one.name.top - one.item.top, '第一行上方没有空行').toBeLessThanOrEqual(10)
    expect(one.childName.top, '孩子的行在自身下面').toBeGreaterThan(one.name.top)
    expect(one.remove.top - one.item.top, '删除按钮仍在第一行').toBeLessThanOrEqual(10)
    expect(Math.abs(one.remove.cy - one.name.cy), '删除按钮与第一字段同一行').toBeLessThanOrEqual(4)
  }

  // 自己的输入改 `<code>.0`，孩子的行改孩子 code；保存后每项是对象
  await page.locator(`${itemAt(1)} ${field('2.4.1')}`).fill('长弓')
  await page.locator(`${itemAt(1)} ${field('2.4.1.1')}`).fill('尖')
  expect(await save(page)).toBe(0)
  const items = await storedItems(page)
  expect(items[0]['2.4.1']).toEqual({ '2.4.1.0': '长弓', '2.4.1.1': '尖' })
  expect(items[1]['2.4.1']).toEqual({ '2.4.1.0': '斗篷', '2.4.1.1': '' })
  expect(items[2]['2.4.1']).toEqual({ '2.4.1.0': '银币', '2.4.1.1': '' })
  expect(items[0]['2.4.2'], '兄弟字段不动').toBe(1)
  expect(items[2]['2.4.2']).toBe(3)
})

test('删掉 2.4.1 的最后一个子字段：每个 item 收成裸标量（旧自身值），保存合法', async ({ page }) => {
  await openEditor(page, holdCard())
  await selectElement(page, '2.4.1')
  await page.locator('[data-add-child="2.4.1"]').click()
  await expect(page.locator(row('2.4.1.1'))).toBeVisible()

  await selectElement(page, '2.4.1.1')
  await page.locator(`${row('2.4.1.1')} [data-delete-state]`).click()
  await expect(page.locator('[data-confirm]')).toBeVisible()
  await page.locator('[data-confirm-ok]').click()
  await expect(page.locator(row('2.4.1.1')), '子字段行消失').toHaveCount(0)

  await selectElement(page, '2')
  await expect(page.locator(`${ARRAY} ${field('2.4.1.1')}`), '子行不再渲染').toHaveCount(0)
  const old = ['短剑', '斗篷', '银币']
  for (let at = 1; at <= 3; at += 1) {
    await expect(page.locator(`${itemAt(at)} ${field('2.4.1')}`)).toHaveValue(old[at - 1])
  }
  expect(await save(page)).toBe(0)
  expect(await storedItems(page)).toEqual([
    { id: 'id_1', '2.4.1': '短剑', '2.4.2': 1 },
    { id: 'id_2', '2.4.1': '斗篷', '2.4.2': 1 },
    { id: 'id_3', '2.4.1': '银币', '2.4.2': 3 },
  ])
})
