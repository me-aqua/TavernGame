/**
 * 提示词标记 / 历史语义的**界面侧**判据（单元那份在 `v2/tests/prompt-markers.test.js`）。
 *
 * 这一份只管玩家 / 作者在界面上真的看得见的三格：
 *   ① 编辑器里那个数字框的标签**逐字**是「读取历史回合」；
 *   ② 校验错误文案用的也是这个词（不是旧名「历史回合数」）——种子放一张 `historyTurns: -1` 的卡，
 *      首页坏项那一行显示的就是 `error.historyTurns`；
 *   ③ 调试开着时，trace 卡片里的提示词**真的带上了五段标记**（按固定顺序）——
 *      标记是提示词结构的一部分，作者只能从 trace 里看见它。
 */
import { expect, test } from '@playwright/test'
import {
  boot,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  openStory,
  playTurn,
  route,
  traceCard,
} from './support/app.js'

const CARD_ID = 'c1'
const SAVE_ID = 's1'

/** 一张卡 + 一份存档 + 一个 mock 预设 */
function seeded() {
  const card = makeCard()
  return { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [MOCK_PRESET] }
}

/**
 * 一张「开场白有正文」的卡（`opening` 的 body = OP），输出节点的 `historyTurns` 由调用方给。
 * 开场白不是公共提示词眼睛读的（输出节点只读 pr1/pr2），所以它在提示词里只可能从历史块来 ——
 * 这正是这一组判据要量的东西。
 */
function cardWithOpening(historyTurns, body = 'OPENING_OP') {
  const card = makeCard()
  card.prompts = card.prompts.map((prompt) => (prompt.id === 'opening' ? { ...prompt, body } : prompt))
  card.chain = card.chain.map((node) => (node.id === 'output' ? { ...node, historyTurns } : node))
  return card
}

/** 读一次跑完回合之后、输出节点 trace 里的提示词 */
async function tracePromptText(page) {
  const prompt = page.locator(`${traceCard('output')} [data-trace-prompt]`)
  await expect(prompt).toHaveCount(1)
  return (await prompt.textContent()) ?? ''
}

test.describe('读取历史回合：标签与错误文案', () => {
  test('编辑器里那个数字框的标签逐字是「读取历史回合」', async ({ page }) => {
    await boot(page, { storage: seeded(), hash: route.edit(CARD_ID) })
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-node-id="check"]').click()
    const field = page.locator('label:has([data-node-history])')
    await expect(field).toBeVisible()
    await expect(field, '历史回合数那个输入框的标签不是「读取历史回合」').toHaveText('读取历史回合')
  })

  test('错误文案里用的是「读取历史回合」（不是旧名「历史回合数」）', async ({ page }) => {
    const card = makeCard()
    const broken = {
      ...card,
      chain: card.chain.map((node) => (node.id === 'check' ? { ...node, historyTurns: -1 } : node)),
    }
    await boot(page, { storage: { [KEYS.cards]: [broken], [KEYS.presets]: [MOCK_PRESET] } })

    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page.locator('[data-invalid-card]')).toHaveCount(1)
    const reason = page.locator('[data-invalid-reason]')
    await expect(reason).toContainText('读取历史回合')
    await expect(reason, '错误文案还在用旧名「历史回合数」').not.toContainText('历史回合数')
  })
})

test.describe('提示词标记：trace 里看得见，按固定顺序', () => {
  test('跑一回合之后：有正文的段带标记、空的上游段连标记都不出现', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, SAVE_ID, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(`${traceCard('output')} [data-trace-prompt]`)
    await expect(prompt).toHaveCount(1)
    const text = (await prompt.textContent()) ?? ''

    const markers = [
      '<公共提示词·tone>',
      '<公共提示词·style>',
      '<世界状态树>',
      '<游戏历史记录>',
      '<节点提示词>',
    ]
    for (const marker of markers) {
      expect(text, `trace 里的提示词缺少 ${marker}`).toContain(marker)
    }
    // 顺序固定：两两相邻比位置
    for (let i = 0; i < markers.length - 1; i += 1) {
      expect(text.indexOf(markers[i]), `${markers[i]} 应该排在 ${markers[i + 1]} 之前`).toBeLessThan(
        text.indexOf(markers[i + 1]),
      )
    }

    // mock 的 normal 节点只回工具调用、正文是空串 ⇒ 上游那一段没有正文，**连标记都不该出现**。
    // （上游标记本身由单测 `prompt-markers.test.js` 用非空输出钉着；这里钉的是「空段不留光标题」也到得了界面。）
    expect(text, '上游这一段是空的，不该留下 <上游输出·…> 标记').not.toContain('<上游输出')
  })
})

/**
 * 开场白作为历史的第一条：新存档第一次跑回合时，历史块应当是「开场白 → 本回合行动」。
 * 这条只能在界面上看（提示词住 trace），所以放在 e2e：种一张开场白有正文的卡、跑一回合，读 trace。
 */
test.describe('开场白作为历史的第一条（trace 里看得见）', () => {
  test('新存档 + historyTurns=1 ⇒ 历史块先是开场白、再是本回合行动（各一次）', async ({ page }) => {
    const card = cardWithOpening(1)
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card)],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })
    await openStory(page, CARD_ID, SAVE_ID, { debug: true })
    // 故事流的第一段就是开场白，所以跑完一回合是 2 条 narration（开场 + 本回合正文）
    await playTurn(page, 'act one', 2)

    const text = await tracePromptText(page)
    const at = (needle) => text.indexOf(needle)
    expect(text, '开场白没有进历史块').toContain('OPENING_OP')
    expect(text.split('OPENING_OP').length - 1, '开场白在提示词里出现了不止一次').toBe(1)
    expect(at('OPENING_OP'), '开场白必须落在历史块里').toBeGreaterThan(at('<游戏历史记录>'))
    expect(at('act one'), '本回合行动必须排在开场白之后').toBeGreaterThan(at('OPENING_OP'))
    expect(at('OPENING_OP'), '开场白必须在节点提示词之前').toBeLessThan(at('<节点提示词>'))
  })

  test('新存档 + historyTurns=0 ⇒ 只有本回合行动，开场白不进提示词', async ({ page }) => {
    const card = cardWithOpening(0)
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card)],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })
    await openStory(page, CARD_ID, SAVE_ID, { debug: true })
    await playTurn(page, 'act one', 2)

    const text = await tracePromptText(page)
    expect(text, 'historyTurns=0 不该把开场白带进提示词').not.toContain('OPENING_OP')
    expect(text).toContain('<游戏历史记录>')
    expect(text.indexOf('act one')).toBeGreaterThan(text.indexOf('<游戏历史记录>'))
  })
})
