/**
 * 编辑器控件的**两档高度**（老板 2026-11-25 晚）：
 *   · **行内控件 = 28px**：流程节点按钮、读 / 写 chip、上游读 chip、提示词读 chip、输入框、下拉选择器、
 *     图标按钮（裸 `+` / `×`）、顶栏按钮；
 *   · **行 / 块容器 = 36px**：`[data-prompt-block]`、`[data-state-item]`、细条的列表行。
 *   · 文本框（textarea）**不在任何一档里**（本文件不量它）。
 *
 * 为什么两档要写在一起：它们是一对——容器 36 里装 28 的行内控件，谁单独漂了都说明「统一」没落地。
 * 所以除了逐组量，还钉两对**同屏对照**：提示词块（36）里那颗读 chip 必须是 28（两者必须不同）；
 * 节点按钮与它同一行的上游读 chip 必须相同（都是 28）。
 *
 * 量 `offsetHeight`（取整）与 `getBoundingClientRect().height`（小数）两个读数：
 * 只信 offsetHeight 的话，27.6 与 28.4 都会被读成 28 —— 那是「取整」不是「统一」。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, makeCard, makeSave, MOCK_PRESET, route } from './support/app.js'

const CARD_ID = 'c1'

/** 行内控件：28 ± 0.5 */
const INLINE_RANGE = [27.5, 28.5]
/** 行 / 块容器：36 ± 0.5 */
const ROW_RANGE = [35.5, 36.5]

/** 种一张卡 + 一个存档 + 一个预设（首页的列表行要有一个存档才量得到） */
function seedCardAndSave() {
  const card = makeCard()
  return { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [MOCK_PRESET] }
}

/**
 * 量一组选择器命中的**所有**元素的高度。
 * 浏览器侧代码一律写成模板串（见 support/app.js 的约定），否则 lint 的 no-undef 会拦。
 */
async function measureHeights(page, selectors) {
  return page.evaluate(
    `(() => {
      const groups = {}
      for (const selector of ${JSON.stringify(selectors)}) {
        groups[selector] = [...document.querySelectorAll(selector)].map((element) => ({
          offsetHeight: element.offsetHeight,
          rectHeight: Math.round(element.getBoundingClientRect().height * 100) / 100,
          text: (element.textContent || '').trim().slice(0, 24),
        }))
      }
      return groups
    })()`,
  )
}

/** 逐组断言：每组至少命中一个（否则判据空转），每个元素两个读数都落在区间里 */
function expectHeights(groups, [min, max], kind) {
  for (const [selector, elements] of Object.entries(groups)) {
    expect(elements.length, `${selector} 一个都没命中（${kind}判据会空转）`).toBeGreaterThan(0)
    for (const element of elements) {
      const label = `${selector}（${element.text || 'no text'}）`
      expect(element.offsetHeight, `${label} 的 offsetHeight 不是 ${kind}`).toBeGreaterThanOrEqual(min)
      expect(element.offsetHeight, `${label} 的 offsetHeight 不是 ${kind}`).toBeLessThanOrEqual(max)
      // 取整会骗人：27.6 / 28.4 的 offsetHeight 都是 28，所以小数高度也得在区间里
      expect(element.rectHeight, `${label} 的实际高度不是 ${kind}`).toBeGreaterThanOrEqual(min)
      expect(element.rectHeight, `${label} 的实际高度不是 ${kind}`).toBeLessThanOrEqual(max)
    }
  }
}

test('编辑器两档高度：行内控件 28px、行/块容器 36px；36 里的 chip 是 28', async ({ page }) => {
  await boot(page, { storage: seedCardAndSave() })
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()

  // 选中判定节点：状态树的读 / 写 chip、细条的上游 chip、右栏的提示词 chip 同时在场
  await page.locator('[data-node-id="check"]').click()
  const selectedNode = await measureHeights(page, [
    // 行内控件（28）
    '[data-node-id="time"]',
    '[data-eyes="read"]',
    '[data-eyes="write"]',
    '[data-read-upstream]',
    '[data-prompt-read]',
    '[data-node-preset]',
    '[data-node-history]',
    '[data-add-prompt]',
    '[data-delete-prompt]',
    '[data-page="editor"] .page-bar button',
    // 行 / 块容器（36）
    '[data-state-item]',
    '[data-prompt-block]',
  ])

  // 同屏对照要趁 S1（选中节点）量：切到 S2 之后读 chip / 上游 chip 就不在页面上了
  const pair = await page.evaluate(
    `(() => {
      const block = document.querySelector('[data-prompt-block="pr1"]')
      const chip = block.querySelector('[data-prompt-read][data-prompt-id="pr1"]')
      const node = document.querySelector('[data-node-id="time"]')
      const nodeRow = node.parentElement
      const nodeChip = nodeRow.querySelector('[data-read-upstream][data-upstream-id="time"]')
      return {
        block: block.offsetHeight,
        blockChip: chip ? chip.offsetHeight : null,
        node: node.offsetHeight,
        nodeChip: nodeChip ? nodeChip.offsetHeight : null,
        chipIsInsideBlock: block.contains(chip),
        chipIsInNodeRow: nodeChip ? nodeRow.contains(nodeChip) : false,
      }
    })()`,
  )

  // 选中状态元素：中栏换成状态表单，量文本输入框与 S2 的图标按钮
  await page.locator('[data-state-item="1"]').click()
  await expect(page.locator('[data-field="name"]')).toBeVisible()
  const selectedElement = await measureHeights(page, [
    '[data-field="name"]',
    '[data-field="initial"]',
    '[data-add-state]',
    '[data-delete-state]',
  ])

  // 首页的列表行（游戏卡 / 存档）：它们也是 36 的行容器（控件 28 居中）
  await page.goto(`${APP_PATH}${route.home}`)
  await expect(page.locator('[data-page="home"]')).toBeVisible()
  const listRows = await measureHeights(page, ['[data-card-id]', '[data-save-id]'])

  // 逐组量：两档分开判
  const inlineSelectors = new Set([
    '[data-node-id="time"]',
    '[data-eyes="read"]',
    '[data-eyes="write"]',
    '[data-read-upstream]',
    '[data-prompt-read]',
    '[data-node-preset]',
    '[data-node-history]',
    '[data-add-prompt]',
    '[data-delete-prompt]',
    '[data-page="editor"] .page-bar button',
    '[data-field="name"]',
    '[data-field="initial"]',
    '[data-add-state]',
    '[data-delete-state]',
  ])
  const all = { ...selectedNode, ...selectedElement, ...listRows }
  const inline = {}
  const rows = {}
  for (const [selector, elements] of Object.entries(all)) {
    if (inlineSelectors.has(selector)) inline[selector] = elements
    else rows[selector] = elements
  }
  expectHeights(inline, INLINE_RANGE, '28px 的行内控件')
  expectHeights(rows, ROW_RANGE, '36px 的行 / 块容器')

  // 同屏对照①：提示词块是 36，它里面那颗读 chip 是 28（两者必须不同）
  expect(pair.chipIsInsideBlock, '读 chip 不在提示词块里（对照失效）').toBe(true)
  expect(pair.block, '提示词块不是 36px').toBeGreaterThanOrEqual(ROW_RANGE[0])
  expect(pair.block, '提示词块不是 36px').toBeLessThanOrEqual(ROW_RANGE[1])
  expect(pair.blockChip, '提示词块里的读 chip 不是 28px').toBeGreaterThanOrEqual(INLINE_RANGE[0])
  expect(pair.blockChip, '提示词块里的读 chip 不是 28px').toBeLessThanOrEqual(INLINE_RANGE[1])
  expect(pair.block, '36 的块与 28 的 chip 不许一样高').toBeGreaterThan(pair.blockChip)

  // 同屏对照②：节点按钮与它同一行的上游读 chip 必须相同（都是 28）
  expect(pair.chipIsInNodeRow, '上游读 chip 不在节点那一行里（对照失效）').toBe(true)
  expect(pair.node, '节点按钮不是 28px').toBeGreaterThanOrEqual(INLINE_RANGE[0])
  expect(pair.node, '节点按钮不是 28px').toBeLessThanOrEqual(INLINE_RANGE[1])
  expect(pair.nodeChip, '同行的上游读 chip 不是 28px').toBeGreaterThanOrEqual(INLINE_RANGE[0])
  expect(pair.nodeChip, '同行的上游读 chip 不是 28px').toBeLessThanOrEqual(INLINE_RANGE[1])
  expect(pair.node, '节点按钮与它这一行的读 chip 高度不一致').toBe(pair.nodeChip)
})
