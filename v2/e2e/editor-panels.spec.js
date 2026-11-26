/**
 * 编辑器的 6 项 UI 变更（老板 2026-11-25 口径）。
 *
 * 这一层的价值是把「看起来对」的三种东西钉死：
 *   ① 右栏**只有**名字 + 读眼睛 + `×`（没有输入框）—— 搬回来一个输入框，玩家能用但规矩没了；
 *   ② **没有教程提示**（左栏 / 首页 / 中栏空态 / 没有预设时 / 设置页）—— 提示是「一次性」的东西，
 *      但代码里留着它就会在别的状态里冒出来；
 *   ③ S2 的 `×`、时间元素的 day/hour、开场的「不可删且排第一」—— 这三条都是**互斥状态**里的规则，
 *      不分别验就会「看起来都对」。
 *
 * 🔴 旧格式（带校对节点 / 布尔上游 / 缺开场）**不迁移**：打开就是中文 `E_VALIDATION`，
 *    一个块都不渲染、盘上的字节也不改 —— 这条是拒绝的判据（CONTRACT §2.1）。
 *
 * ⚠️ 「没有提示」判两条腿：**结构**（这些作用域里不许有 `.hint` 元素 / `title` 属性）
 *    + **文案**（旧提示那几句不许出现在屏上）。只判结构，换一句话就漏；只判文案，加一个无名提示就漏。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  KEYS,
  makeCard,
  makeNode,
  makeSave,
  MOCK_PRESET,
  OPENING_PROMPT,
  readStorage,
  route,
} from './support/app.js'

const CARD_ID = 'c1'

/** 旧提示的文案（`locales/zh-CN.json` 当前值）：这些句子不该再出现在屏上 */
const OLD_HINTS = {
  emptyMiddle: '未选择',
  noPreset: '还没有模型预设',
  settingsEmpty: '还没有模型预设',
  rename: '回车提交，Esc 取消',
}

function seedCard({ presets = [MOCK_PRESET] } = {}) {
  return { [KEYS.cards]: [makeCard()], [KEYS.presets]: presets }
}

/** 进编辑器（可指定预设池；空数组 = 一个预设都没有） */
async function openEditor(page, options) {
  await boot(page, { storage: seedCard(options) })
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
}

test.describe('右栏：名字 + 读眼睛 + ×，没有输入框', () => {
  test('没选节点时：每块只有名字 + 至多一个 ×；没有输入框、也没有读眼睛', async ({ page }) => {
    await openEditor(page)
    // 夹具卡有两块提示词；加上每张卡必带的「开场」= 3 块
    const blocks = page.locator('[data-col="right"] [data-prompt-block]')
    await expect(blocks).toHaveCount(3)

    for (let index = 0; index < 3; index += 1) {
      const block = blocks.nth(index)
      await expect(block.locator('[data-prompt-name]')).toHaveCount(1)
      expect(await block.locator('[data-delete-prompt]').count()).toBeLessThanOrEqual(1)
      // 这一栏不摆输入控件；「读不读这块」是选中节点时才有的眼睛（CONTRACT §8.2）
      await expect(block.locator('input, textarea, select')).toHaveCount(0)
    }
    await expect(page.locator('[data-prompt-read]')).toHaveCount(0)
  })

  test('两个「+」按钮的文本恰好是 +；左栏那个只在 S2 才出现', async ({ page }) => {
    await openEditor(page)
    await expect(page.locator('[data-add-prompt]')).toHaveText('+')
    // S0：没选任何东西 ⇒ 左栏没有 `+`
    await expect(page.locator('[data-add-state]')).toHaveCount(0)
    // S2：选中一行 ⇒ 出现，且文本就是 +
    await page.locator('[data-state-item="0"]').click()
    await expect(page.locator('[data-add-state]')).toHaveText('+')
  })

  test('选中节点后右栏每块一颗读眼睛（带 data-on），点了会改 node.reads', async ({ page }) => {
    await openEditor(page)
    await page.locator('[data-node-id="output"]').click()

    // 与提示词块一一对应；左栏（状态树）里没有它
    const reads = page.locator('[data-prompt-read]')
    await expect(reads).toHaveCount(3)
    await expect(page.locator('[data-col="left"] [data-prompt-read]')).toHaveCount(0)

    const pr1 = page.locator('[data-prompt-read][data-prompt-id="pr1"]')
    await expect(pr1).toHaveAttribute('data-on', 'true')
    await pr1.click()
    await expect(pr1).toHaveAttribute('data-on', 'false')

    const cards = await readStorage(page, KEYS.cards)
    const output = cards[0].chain.find((node) => node.id === 'output')
    expect(output.reads).not.toContain('pr1')
    expect(output.reads, '别的引用不许被顺手删掉').toContain('pr2')
  })
})

test.describe('没有教程提示', () => {
  test('编辑器 S0：中栏只有「编辑」标题、空态没有「未选择」这类提示，左栏没有 .hint', async ({ page }) => {
    await openEditor(page)
    const middle = page.locator('[data-col="middle"]')
    // 面板 chrome（CONTRACT §8.2）：S0 的中栏也有标题条，但它只是「编辑」两个字；
    // 空态本体（[data-empty-middle]）仍然一个字都没有 —— 这条判据量的还是「没有教程提示」。
    await expect(middle.locator('[data-panel-title]')).toHaveText('编辑')
    const emptyMiddle = middle.locator('[data-empty-middle]')
    await expect(emptyMiddle).toHaveText('')
    await expect(page.locator('[data-page="editor"] .hint')).toHaveCount(0)
    expect(await emptyMiddle.textContent()).not.toContain(OLD_HINTS.emptyMiddle)
  })

  test('没有预设时：中栏不再挂「还没有模型预设」这句提示（下拉仍是禁用的）', async ({ page }) => {
    await openEditor(page, { presets: [] })
    await page.locator('[data-node-id="output"]').click()
    const select = page.locator('[data-node-preset]')
    await expect(select).toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('[data-col="middle"] .hint')).toHaveCount(0)
    expect(await page.locator('[data-col="middle"]').textContent()).not.toContain(OLD_HINTS.noPreset)
  })

  test('首页：改名框不再带「回车提交，Esc 取消」这个 title 提示', async ({ page }) => {
    await boot(page, { storage: seedCard() })
    await page.locator(`[data-card-id="${CARD_ID}"] [data-card-rename]`).click()
    const input = page.locator('[data-rename-input]')
    await expect(input).toBeVisible()
    expect(await input.getAttribute('title'), '教程提示不该再挂在 title 上').toBeNull()
    await expect(page.locator('[data-page="home"] .hint')).toHaveCount(0)
    expect(await page.locator('[data-page="home"]').textContent()).not.toContain(OLD_HINTS.rename)
  })

  test('设置页：一个预设都没有时不再挂「还没有模型预设」这句提示', async ({ page }) => {
    await boot(page, { storage: { [KEYS.presets]: [] } })
    await page.goto(`${APP_PATH}${route.settings}`)
    await expect(page.locator('[data-page="settings"]')).toBeVisible()
    await expect(page.locator('[data-preset]')).toHaveCount(0)
    await expect(page.locator('[data-page="settings"] .hint')).toHaveCount(0)
    expect(await page.locator('[data-page="settings"]').textContent()).not.toContain(OLD_HINTS.settingsEmpty)
  })
})

test.describe('S2：每行都有 ×，除了 0', () => {
  test('S0 没有 ×；S2 每行都有，唯独时间元素（code 0）没有', async ({ page }) => {
    await openEditor(page)
    // S0
    await expect(page.locator('[data-delete-state]')).toHaveCount(0)

    await page.locator('[data-state-item="0"]').click()
    await expect(page.locator('[data-state-item="0"] [data-delete-state]')).toHaveCount(0)
    // 夹具卡有 3 个元素（0/1/2）⇒ S2 里另外两行各一个 ×
    await expect(page.locator('[data-delete-state]')).toHaveCount(2)
    for (const code of ['1', '2']) {
      await expect(page.locator(`[data-state-item="${code}"] [data-delete-state]`)).toHaveCount(1)
    }
  })

  test('S1 也没有 ×（眼睛与 × 不并存）', async ({ page }) => {
    await openEditor(page)
    await page.locator('[data-node-id="output"]').click()
    await expect(page.locator('[data-state-item="1"] [data-eyes="read"]')).toHaveCount(1)
    await expect(page.locator('[data-delete-state]')).toHaveCount(0)
  })
})

test.describe('时间元素：类型显示「时间」，day/hour 可编辑并落盘', () => {
  test('类型是「时间」，初值是两个数字框；改完落盘、刷新还在', async ({ page }) => {
    await openEditor(page)
    await page.locator('[data-state-item="0"]').click()

    await expect(page.locator('[data-state-type]')).toHaveText('时间')
    // 时间元素用 day/hour 两个框，不再有单一字符串框
    await expect(page.locator('[data-field="initial"]')).toHaveCount(0)
    const day = page.locator('[data-field="initial-day"]')
    const hour = page.locator('[data-field="initial-hour"]')
    await expect(day).toHaveValue('1')
    await expect(hour).toHaveValue('8')

    await day.fill('3')
    await hour.fill('21')
    expect((await readStorage(page, KEYS.cards))[0].state[0].initial).toEqual({ day: 3, hour: 21 })

    await page.reload()
    await page.locator('[data-state-item="0"]').click()
    await expect(page.locator('[data-field="initial-day"]')).toHaveValue('3')
    await expect(page.locator('[data-field="initial-hour"]')).toHaveValue('21')
  })

  test('文字元素的类型显示「文字」，初值仍是单个输入框', async ({ page }) => {
    await openEditor(page)
    await page.locator('[data-state-item="1"]').click()
    await expect(page.locator('[data-state-type]')).toHaveText('文字')
    await expect(page.locator('[data-field="initial"]')).toHaveCount(1)
    await expect(page.locator('[data-field="initial-day"]')).toHaveCount(0)
  })
})

test.describe('开场：每张卡都有、排第一、删不掉', () => {
  test('新卡自带开场（只有它一块），右栏排第一且没有 ×', async ({ page }) => {
    await boot(page, { storage: { [KEYS.presets]: [MOCK_PRESET] } })
    await page.locator('[data-new-card]').click()
    const cardId = await page.locator('[data-card-id]').first().getAttribute('data-card-id')

    const cards = await readStorage(page, KEYS.cards)
    expect(cards[0].prompts.map((prompt) => prompt.id)).toEqual(['opening'])
    expect(cards[0].prompts[0].title, '开场的标题来自文案表，不该是空串').not.toBe('')

    await page.goto(`${APP_PATH}${route.edit(cardId)}`)
    await expect(page.locator('[data-prompt-block]')).toHaveCount(1)
    await expect(page.locator('[data-prompt-block]').nth(0)).toHaveAttribute('data-prompt-block', 'opening')
    await expect(page.locator('[data-prompt-block="opening"] [data-delete-prompt]')).toHaveCount(0)
  })

  test('旧卡（没有开场）打开编辑器 ⇒ 中文 E_VALIDATION，且**不补**开场、不改盘', async ({ page }) => {
    const legacy = makeCard({ prompts: makeCard().prompts.filter((p) => p.id !== OPENING_PROMPT.id) })
    const raw = JSON.stringify([legacy])
    await boot(page, { storage: { [KEYS.cards]: [legacy], [KEYS.presets]: [MOCK_PRESET] } })

    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
    await expect(page.locator('[data-error-next]')).not.toHaveText('')
    // 没有「补上开场再落盘」这种事：编辑器一个块都不渲染，盘上的卡逐字不变
    await expect(page.locator('[data-prompt-block]')).toHaveCount(0)
    expect(JSON.stringify(await readStorage(page, KEYS.cards)), '读旧卡不许顺手回写新格式').toBe(raw)
  })

  test('旧卡（布尔上游 / 校对节点）同样被拒：不迁移、不改盘', async ({ page }) => {
    const base = makeCard()
    const legacy = {
      ...base,
      chain: [
        ...base.chain.map((node) => ({ ...node, readsUpstream: node.id === 'output' })),
        makeNode('proof', 'proof'),
      ],
    }
    const raw = JSON.stringify([legacy])
    const save = { ...makeSave(base), cardSnapshot: legacy }
    await boot(page, {
      storage: { [KEYS.cards]: [legacy], [KEYS.saves]: [save], [KEYS.presets]: [MOCK_PRESET] },
    })

    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
    expect(JSON.stringify(await readStorage(page, KEYS.cards))).toBe(raw)

    // 对话页打开也不能「跑着跑着才炸」：旧卡的存档一进去就报错（校验在入场那一步）
    await page.goto(`${APP_PATH}${route.play(CARD_ID, save.id)}`)
    await expect(page.locator('[data-error]')).toBeVisible()
    await expect(page.locator('[data-error-code]')).toHaveText('E_VALIDATION')
  })

  test('开场能改名改正文（只是不能删）：改动落盘', async ({ page }) => {
    await openEditor(page)
    await page.locator('[data-prompt-block="opening"] [data-prompt-name]').click()
    await expect(page.locator('[data-prompt-block="opening"]')).toHaveAttribute('data-selected', 'true')

    await page.locator('[data-prompt-title]').fill('开场白')
    await page.locator('[data-prompt-body]').fill('OPENING_BODY')
    const stored = (await readStorage(page, KEYS.cards))[0]
    expect(stored.prompts[0]).toMatchObject({ id: 'opening', title: '开场白', body: 'OPENING_BODY' })
    // 开场仍然排第一、仍然没有 ×
    await expect(page.locator('[data-prompt-block]').first()).toHaveAttribute('data-prompt-block', 'opening')
    await expect(page.locator('[data-prompt-block="opening"] [data-delete-prompt]')).toHaveCount(0)
  })
})

/**
 * 写眼睛**不按节点类型收窄**（设计更正）：`writable` 决定这个节点拿到哪个工具 ——
 * 含 `'0'` ⇒ `advance_time`；含文本 code ⇒ `write_state`。所以：
 *   · 普通节点在「0 时间」那行**有**写 chip，勾上要落进 `writable`；
 *   · 时间节点在文本元素那行**也有**写 chip；
 *   · **例外：输出节点什么也不写** —— 一行写 chip 都不许有。
 */
test.describe('写眼睛：普通 / 时间节点能勾任意元素，输出节点一只都没有', () => {
  test('判定节点在「0 时间」有写 chip、勾上会落进 writable；时间节点文本行也有', async ({ page }) => {
    await boot(page, { storage: { [KEYS.cards]: [makeCard()], [KEYS.presets]: [MOCK_PRESET] } })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()

    // S1：选中判定节点（normal）—— 0 那一行要有写 chip，勾上会落进 writable
    await page.locator('[data-node-id="check"]').click()
    const zeroChip = page.locator('[data-state-item="0"] [data-eyes="write"]')
    await expect(zeroChip, '普通节点也看得见时间元素那一行的写 chip').toHaveCount(1)
    await expect(zeroChip).toHaveAttribute('data-on', 'false')
    await zeroChip.click()
    await expect(zeroChip).toHaveAttribute('data-on', 'true')

    const stored = await readStorage(page, KEYS.cards)
    const check = stored[0].chain.find((node) => node.id === 'check')
    expect(check.writable, '勾上写眼睛要落进 writable').toContain('0')

    // S1：选中时间节点（time）—— 文本元素那行也要有写 chip
    await page.locator('[data-node-id="time"]').click()
    await expect(
      page.locator('[data-state-item="1"] [data-eyes="write"]'),
      '时间节点也看得见文本元素的写 chip',
    ).toHaveCount(1)
    await expect(page.locator('[data-state-item="0"] [data-eyes="write"]')).toHaveCount(1)
  })

  test('输出节点：状态树一行写 chip 都没有（例外）', async ({ page }) => {
    await boot(page, { storage: { [KEYS.cards]: [makeCard()], [KEYS.presets]: [MOCK_PRESET] } })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()

    await page.locator('[data-node-id="output"]').click()
    await expect(page.locator('[data-eyes="write"]'), '输出节点什么也不写，一行写 chip 都不该有').toHaveCount(
      0,
    )
    // 读眼睛不受影响：0 那一行仍然可以点「读」
    await expect(page.locator('[data-eyes="read"]').first()).toBeVisible()
  })
})
