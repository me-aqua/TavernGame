/**
 * 阶段 2.3 · 根初始值子树（契约 §C–§D）。
 *
 * 钉四件事：
 *   1. 初始值块按左栏样式缩进（每深一层右移 12px）；每行从左到右是 **编号 → 中文名 → 值控件**；
 *   2. 容器本体显示 `1.1` **不是** `1.1.0`（存储仍是 `.0`：`[data-initial-path="1.1.0"]` 还在、保存后那格还在）；
 *   3. integer 行的输入框右边有小字 `min~max`（生效上下限）；
 *   4. 存档模式：初始值整块不渲染，`save.tree` 的当前值打开 / 保存前后逐字不变。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, MOCK_PRESET, readStorage } from './support/app.js'
import { elementOf, v6Card, v6Save } from '../tests/support/v6-fixtures.js'

const CARD_ID = 'c-initial-tree'
const SAVE_ID = 's-initial-tree'

/** 一张给「初始值子树」用的卡：根 `1` 是标量（有本体值 + 孩子），根 `2` 是结构体 */
function nestedCard() {
  const card = v6Card({ id: CARD_ID })
  const world = elementOf(card, '1')
  world.type = 'text'
  world.name = '世界'
  world.initial = { '1.0': 'WORLD', '1.1.0': 'A1', '1.1.1': 'SITE_X', 1.2: 'MOOD_Y' }
  elementOf(card, '1.1').name = '区域'
  elementOf(card, '1.1.1').name = '地点'
  elementOf(card, '1.2').name = '天气'
  elementOf(card, '2').name = '玩家'
  elementOf(card, '2.1').name = '名字'
  elementOf(card, '2.2').name = '体力'
  return card
}

/** 卡 + 一份存档 + 一个 mock 预设 */
function seeded() {
  const card = nestedCard()
  return {
    [KEYS.cards]: [card],
    [KEYS.saves]: [v6Save(card, { id: SAVE_ID })],
    [KEYS.presets]: [MOCK_PRESET],
    [KEYS.nodeModels]: {
      [card.id]: Object.fromEntries(card.chain.map((node) => [node.id, MOCK_PRESET.id])),
    },
  }
}

async function openRoot(page, code) {
  await page.goto(`${APP_PATH}#/edit/${CARD_ID}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator(`[data-state-item="${code}"]`).click()
}

/** 读盘上的那张卡 */
async function readCard(page) {
  const cards = await readStorage(page, KEYS.cards)
  return cards.find((card) => card.id === CARD_ID)
}

/** 每行的显示编号（按 DOM 顺序） */
async function codesOf(page) {
  return page
    .locator('[data-initial-code]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()))
}

/** 某一行的编号格位置 */
async function codeBox(page, path) {
  return page.locator(`[data-initial-row="${path}"] [data-initial-code]`).boundingBox()
}

test.describe('C 初始值子树：编号 / 名字 / 值 / 缩进', () => {
  test('每行从左到右是编号 → 中文名 → 值；值就是当前初始值', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openRoot(page, '2')

    expect(await codesOf(page)).toEqual(['2.1', '2.2'])

    for (const [path, name, value] of [
      ['2.1', '名字', 'HERO'],
      ['2.2', '体力', '80'],
    ]) {
      const row = page.locator(`[data-initial-row="${path}"]`)
      await expect(row).toHaveCount(1)
      await expect(row.locator('[data-initial-name]')).toHaveText(name)
      await expect(row.locator(`[data-initial-path="${path}"]`)).toHaveValue(value)

      const code = await row.locator('[data-initial-code]').boundingBox()
      const label = await row.locator('[data-initial-name]').boundingBox()
      const control = await row.locator(`[data-initial-path="${path}"]`).boundingBox()
      expect(code.x, `${path}：编号在最左`).toBeLessThan(label.x)
      expect(label.x, `${path}：中文名在值的左边`).toBeLessThan(control.x)
    }
  })

  test('容器本体显示 1.1（不是 1.1.0）；存储仍是 .0，保存后还在', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openRoot(page, '1')

    expect(await codesOf(page)).toEqual(['1', '1.1', '1.1.1', '1.2'])
    for (const code of await codesOf(page)) {
      expect(code, `屏上的编号不许露 .0：${code}`).not.toMatch(/\.0$/)
    }

    // 存储路径还是 `.0`：行容器与编辑控件都按真实值路径挂
    await expect(page.locator('[data-initial-row="1.1.0"]')).toHaveCount(1)
    await expect(page.locator('[data-initial-row="1.1.0"] [data-initial-code]')).toHaveText('1.1')
    await expect(page.locator('[data-initial-path="1.1.0"]')).toHaveValue('A1')

    // 改后代值 ⇒ 落进所属根 initial 的真实路径
    await page.locator('[data-initial-path="1.1.1"]').fill('NEW_SITE')
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()
    const card = await readCard(page)
    expect(elementOf(card, '1').initial['1.1.0']).toBe('A1')
    expect(elementOf(card, '1').initial['1.1.1']).toBe('NEW_SITE')
    expect(elementOf(card, '1.1')).not.toHaveProperty('initial')
  })

  test('缩进：每深一层右移 12px（与左栏同一把尺），同层对齐', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openRoot(page, '1')

    const own = await codeBox(page, '1.0')
    const child = await codeBox(page, '1.1.0')
    const grandchild = await codeBox(page, '1.1.1')
    const sibling = await codeBox(page, '1.2')

    const stepOne = child.x - own.x
    const stepTwo = grandchild.x - child.x
    expect(stepOne, '第一层 → 第二层').toBeGreaterThanOrEqual(8)
    expect(stepOne).toBeLessThanOrEqual(16)
    expect(stepTwo, '第二层 → 第三层').toBeGreaterThanOrEqual(8)
    expect(stepTwo).toBeLessThanOrEqual(16)
    expect(Math.abs(stepOne - stepTwo), '每层缩进一样宽').toBeLessThanOrEqual(2)
    expect(Math.abs(sibling.x - child.x), '同层两行对齐').toBeLessThanOrEqual(2)
    expect(own.x, '本体那一行在最左').toBeLessThan(child.x)
  })

  test('integer 行：输入框右边小字 min~max（生效上下限）', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openRoot(page, '2')

    const input = page.locator('[data-initial-path="2.2"]')
    const range = page.locator('[data-initial-row="2.2"] [data-initial-range]')
    await expect(range).toBeVisible()
    await expect(range).toHaveText(/^0\s*~\s*100$/)
    await expect(input).toHaveValue('80')

    const inputBox = await input.boundingBox()
    const rangeBox = await range.boundingBox()
    expect(rangeBox.x, '小字在输入框右边').toBeGreaterThanOrEqual(inputBox.x + inputBox.width - 1)
    const fontSize = Number.parseFloat(
      await page.evaluate(
        `getComputedStyle(document.querySelector('[data-initial-row="2.2"] [data-initial-range]')).fontSize`,
      ),
    )
    expect(fontSize, '是小字（≤12px）').toBeLessThanOrEqual(12)
  })
})

test.describe('D 存档模式：初始值不显示，当前值不动', () => {
  test('初始值整块与行钩子都不渲染；当前值只在根当前值树里；save.tree 保存前后逐字不变', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await page.goto(`${APP_PATH}#/edit-save/${SAVE_ID}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()

    const savesBefore = await readStorage(page, KEYS.saves)
    const treeBefore = savesBefore.find((save) => save.id === SAVE_ID).tree

    await page.locator('[data-state-item="2"]').click()
    await expect(page.locator('[data-initial-block]')).toHaveCount(0)
    await expect(page.locator('[data-initial-row]')).toHaveCount(0)
    await expect(page.locator('[data-initial-code]')).toHaveCount(0)

    // 非根元素没有自己的当前值块；当前值只挂在根元素的当前值树里
    await page.locator('[data-state-item="2.2"]').click()
    await expect(
      page.locator('[data-current-value], [data-current-array], [data-current-tree]'),
      '非根标量不许有自己的当前值块',
    ).toHaveCount(0)

    await page.locator('[data-state-item="2"]').click()
    await expect(
      page.locator('[data-current-tree="2"] [data-current-tree-value="2.2"]'),
      '整数的当前值在根当前值树里',
    ).toHaveText('80')

    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()
    const savesAfter = await readStorage(page, KEYS.saves)
    expect(savesAfter.find((save) => save.id === SAVE_ID).tree, '当前值一个字节都不动').toEqual(treeBefore)
  })
})
