/**
 * 读写覆盖对称 · 编辑器眼睛（`.team/test/2026-11-28/契约-读写覆盖对称.md` §4 / §5）。
 *
 * 这一份量的是**界面上点得到**的那几件事：
 *   · 父行是**标量**（有孩子）⇒ 孩子眼睛 off；父行是 **object / array 容器** ⇒ 孩子眼睛 on；
 *   · 数组 item 字段：标量字段的孩子 off，object / array 字段的孩子 on；
 *   · 读 / 写 **同一套**容器口径（写侧也要对称，不只读侧）；
 *   · 点父标量 ⇒ 不吞掉单独开着的孩子 ref；点父容器 ⇒ 去掉冗余的后代 ref；
 *   · 点被容器派生亮的子行 ⇒ 拆开容器，真的关掉这一列。
 *
 * 判据只用既有 `data-*` 钩子：`[data-state-item] [data-eyes="read"|"write"]` 的 `data-on`。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { cardWithRefs, coverageCard } from '../tests/support/coverage-fixtures.js'

const row = (code) => `[data-state-item="${code}"]`
const readEye = (code) => `${row(code)} [data-eyes="read"]`
const writeEye = (code) => `${row(code)} [data-eyes="write"]`

/** 开卡编辑器、选中判定节点（S1 才有眼睛） */
async function openEditor(page, card) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
  await page.locator('[data-node-id="check"]').click()
}

/** 点保存并等结果出现 */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-ok]'), '保存应当成功（权限引用都合法）').toBeVisible({
    timeout: 5_000,
  })
}

/** 盘上这张卡 `check` 节点的两面眼睛 */
async function storedRefs(page) {
  const cards = await readStorage(page, KEYS.cards)
  const check = cards[0].chain.find((node) => node.id === 'check')
  return { reads: check.reads, writable: check.writable }
}

/** 断言某一行某只眼睛的 on/off（`data-on` 是唯一判据） */
async function expectEye(page, code, field, on) {
  await expect(page.locator(field === 'read' ? readEye(code) : writeEye(code))).toHaveAttribute(
    'data-on',
    on ? 'true' : 'false',
  )
}

/** 排序后比较：存储顺序不是契约（契约只钉成员集合） */
function sorted(list) {
  return [...list].sort()
}

test.describe('读眼睛 · 标量只自己 / 容器覆盖孩子', () => {
  test('[E1] 读文字根 1（有孩子）⇒ 1 亮，普通孩子与数组 item 字段全灭', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['1'] })
    await openEditor(page, card)

    await expectEye(page, '1', 'read', true)
    await expectEye(page, '1.1', 'read', false)
    await expectEye(page, '1.1.1', 'read', false)
    await expectEye(page, '1.2', 'read', false)
    await expectEye(page, '1.3', 'read', false)
    await expectEye(page, '1.3.1', 'read', false)
  })

  test('[E2] 读 enum 1.1（有孩子）⇒ 1.1 亮，1.1.1 灭（只覆盖自己的值）', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['1.1'] })
    await openEditor(page, card)

    await expectEye(page, '1.1', 'read', true)
    await expectEye(page, '1.1.1', 'read', false)
  })

  test('[E3] 读 object 3 ⇒ 3 与它的全部孩子（含数组字段与字段行）都亮', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['3'] })
    await openEditor(page, card)

    await expectEye(page, '3', 'read', true)
    await expectEye(page, '3.1', 'read', true)
    await expectEye(page, '3.2', 'read', true)
    await expectEye(page, '3.3', 'read', true)
    await expectEye(page, '3.3.1', 'read', true)
    await expectEye(page, '3.4', 'read', true)
    await expectEye(page, '3.4.1', 'read', true)
  })

  test('[E4] 读 array 2.2 ⇒ 容器与所有 item 字段（含嵌套孩子）都亮（回归）', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['2.2'] })
    await openEditor(page, card)

    await expectEye(page, '2.2', 'read', true)
    await expectEye(page, '2.2.1', 'read', true)
    await expectEye(page, '2.2.3', 'read', true)
    await expectEye(page, '2.2.3.1', 'read', true)
    await expectEye(page, '2.2.4.1', 'read', true)
    await expectEye(page, '2.2.5.1', 'read', true)
  })

  test('[E5] 读标量字段 2.2.3 ⇒ 自己亮，孩子 2.2.3.1 灭', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['2.2.3'] })
    await openEditor(page, card)

    await expectEye(page, '2.2.3', 'read', true)
    await expectEye(page, '2.2.3.1', 'read', false)
  })

  test('[E6] 读 object 字段 2.2.4 ⇒ 自己与孩子 2.2.4.1 都亮（回归）', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['2.2.4'] })
    await openEditor(page, card)

    await expectEye(page, '2.2.4', 'read', true)
    await expectEye(page, '2.2.4.1', 'read', true)
  })
})

test.describe('写眼睛 · 与读同一套覆盖口径', () => {
  test('[E7] 写 object 3 ⇒ 3 与全部孩子（含数组字段与字段行）都亮', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { writable: ['3'] })
    await openEditor(page, card)

    await expectEye(page, '3', 'write', true)
    await expectEye(page, '3.1', 'write', true)
    await expectEye(page, '3.3', 'write', true)
    await expectEye(page, '3.3.1', 'write', true)
    await expectEye(page, '3.4', 'write', true)
    await expectEye(page, '3.4.1', 'write', true)
  })

  test('[E8] 写文字根 1（有孩子）⇒ 1 亮，普通孩子与数组字段全灭（回归）', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { writable: ['1'] })
    await openEditor(page, card)

    await expectEye(page, '1', 'write', true)
    await expectEye(page, '1.1', 'write', false)
    await expectEye(page, '1.3', 'write', false)
    await expectEye(page, '1.3.1', 'write', false)
  })

  test('[E9] 写标量字段 2.2.3 ⇒ 自己亮，孩子 2.2.3.1 灭', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { writable: ['2.2.3'] })
    await openEditor(page, card)

    await expectEye(page, '2.2.3', 'write', true)
    await expectEye(page, '2.2.3.1', 'write', false)
  })

  test('[E10] 写 array 2.2 ⇒ 容器与全部 item 字段（含嵌套孩子）都亮（回归）', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { writable: ['2.2'] })
    await openEditor(page, card)

    await expectEye(page, '2.2', 'write', true)
    await expectEye(page, '2.2.1', 'write', true)
    await expectEye(page, '2.2.3.1', 'write', true)
    await expectEye(page, '2.2.5.1', 'write', true)
  })
})

test.describe('点眼睛 · 父标量不吞子 ref / 容器开则子派生', () => {
  test('[E11] 只开着孩子 1.2 时点父标量 1 ⇒ 两条都留（父不吞子）', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['1.2'] })
    await openEditor(page, card)

    await page.locator(readEye('1')).click()
    await expectEye(page, '1', 'read', true)
    await expectEye(page, '1.2', 'read', true)
    await save(page)
    expect(sorted((await storedRefs(page)).reads), '父标量开着时孩子 ref 仍要保留').toEqual(['1', '1.2'])
  })

  test('[E12] 父标量 + 孩子都开着时点父 1 ⇒ 只摘父，孩子仍在（回归）', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['1', '1.2'] })
    await openEditor(page, card)

    await page.locator(readEye('1')).click()
    await expectEye(page, '1', 'read', false)
    await expectEye(page, '1.2', 'read', true)
    await save(page)
    expect((await storedRefs(page)).reads).toEqual(['1.2'])
  })

  test('[E13] 开着标量字段 2.2.3 时点它的孩子 2.2.3.1 ⇒ 加孩子 ref，两条都亮', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['2.2.3'] })
    await openEditor(page, card)

    await expectEye(page, '2.2.3.1', 'read', false)
    await page.locator(readEye('2.2.3.1')).click()
    await expectEye(page, '2.2.3', 'read', true)
    await expectEye(page, '2.2.3.1', 'read', true)
    await save(page)
    expect(sorted((await storedRefs(page)).reads)).toEqual(['2.2.3', '2.2.3.1'])
  })

  test('[E14] 只开着 object 3 时点孩子 3.1 ⇒ 拆开 3，3.1 灭、3.2 / 3.3 亮', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['3'] })
    await openEditor(page, card)

    await expectEye(page, '3.1', 'read', true)
    await page.locator(readEye('3.1')).click()
    await expectEye(page, '3', 'read', false)
    await expectEye(page, '3.1', 'read', false)
    await expectEye(page, '3.2', 'read', true)
    await expectEye(page, '3.3', 'read', true)
    await save(page)
    expect(sorted((await storedRefs(page)).reads)).toEqual(['3.2', '3.3', '3.4'])
  })

  test('[E15] 只开着 array 2.2 时点字段 2.2.1 ⇒ 拆开容器，其余字段仍亮（回归）', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['2.2'] })
    await openEditor(page, card)

    await page.locator(readEye('2.2.1')).click()
    await expectEye(page, '2.2', 'read', false)
    await expectEye(page, '2.2.1', 'read', false)
    await expectEye(page, '2.2.2', 'read', true)
    await save(page)
    expect(sorted((await storedRefs(page)).reads)).toEqual(['2.2.2', '2.2.3', '2.2.4', '2.2.5'])
  })

  test('[E16] 只开着孩子 3.1 时点 object 3 ⇒ 只留父 3（容器开 = 全选，去冗余）', async ({ page }) => {
    const card = cardWithRefs(coverageCard(), { reads: ['3.1'] })
    await openEditor(page, card)

    await page.locator(readEye('3')).click()
    await expectEye(page, '3', 'read', true)
    await expectEye(page, '3.1', 'read', true)
    await save(page)
    expect((await storedRefs(page)).reads).toEqual(['3'])
  })
})
