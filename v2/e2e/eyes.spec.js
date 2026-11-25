/**
 * SPEC §9.3：**眼睛控制提示词拼装** —— 关掉某块提示词 / 某个状态元素 / 上游输出之后，
 * `?debug=1` 的面板里对应内容必须消失（打开就回来）。
 *
 * ⚠️ 跑的是**存档快照**（§8.3），所以每一条都是：改卡里的眼睛 → **新建存档** → 跑 → 看 prompt。
 *    拿旧存档去验眼睛会永远看不到变化 —— 那不是 bug，是快照语义。
 * 断言找的是**只住在那一处的记号**（BODY_ONE / VAL_PLACE_A1 / `[mock] turn N:`），
 * 所以「找不到」等价于「真的没读它」，不会被别处的同样文字蒙过去。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  createSave,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  openStory,
  playTurn,
  route,
} from './support/app.js'

const CARD_ID = 'c1'
const DEBUG_PROMPT = '[data-debug-prompt]'

/** 种一张卡 + 一个预设（不种存档：眼睛要在「快照之前」改） */
function seedCardOnly({ saves = false } = {}) {
  const card = makeCard()
  const storage = { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] }
  if (saves) storage[KEYS.saves] = [makeSave(card)]
  return storage
}

/** 进编辑器、选中某节点、点一下某个眼睛，确认它真的翻了面 */
async function toggleEye(page, { nodeId, selector }) {
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator(`[data-node-id="${nodeId}"]`).click()
  const eye = page.locator(selector)
  const before = await eye.getAttribute('data-on')
  await eye.click()
  await expect(eye).toHaveAttribute('data-on', before === 'true' ? 'false' : 'true')
  return before
}

test.describe('眼睛：公共提示词块', () => {
  test('关掉 pr1 的读眼睛 ⇒ 它的正文从 prompt 里消失，pr2 还在', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    // 正向控制：先确认默认是读的
    expect(
      await toggleEye(page, { nodeId: 'output', selector: '[data-prompt-block="pr1"] [data-prompt-eyes]' }),
    ).toBe('true')

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(DEBUG_PROMPT)
    await expect(prompt).not.toContainText('BODY_ONE')
    await expect(prompt).toContainText('BODY_TWO')
    await expect(prompt).toContainText('NODE_OUT')
  })

  test('把 pr1 再打开 ⇒ 正文回来（不是「永远都不在」）', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    await toggleEye(page, { nodeId: 'output', selector: '[data-prompt-block="pr1"] [data-prompt-eyes]' })
    await toggleEye(page, { nodeId: 'output', selector: '[data-prompt-block="pr1"] [data-prompt-eyes]' })

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)
    await expect(page.locator(DEBUG_PROMPT)).toContainText('BODY_ONE')
  })
})

test.describe('眼睛：状态元素', () => {
  test('关掉元素 1 的读眼睛 ⇒ 它的值从 prompt 里消失，元素 2 还在', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    await toggleEye(page, { nodeId: 'output', selector: '[data-state-item="1"] [data-eyes="read"]' })

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(DEBUG_PROMPT)
    await expect(prompt).not.toContainText('VAL_PLACE_A1')
    await expect(prompt).toContainText('VAL_MOOD_B2')
  })
})

test.describe('眼睛：上游输出', () => {
  test('校对节点关掉上游 ⇒ 本回合正文不进它的 prompt；打开 ⇒ 进去', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })

    // ① 默认打开：跑两回合，第二回合的 prompt 里要有「本回合」的正文
    const onSave = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, onSave, { debug: true })
    await playTurn(page, 'act one', 1)
    await playTurn(page, 'act two', 2)
    await expect(page.locator(DEBUG_PROMPT)).toContainText('[mock] turn 2: act two')

    // ② 关掉校对的上游：新存档、同样两回合，这一句必须消失
    await toggleEye(page, { nodeId: 'proof', selector: '[data-node-upstream]' })
    const offSave = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, offSave, { debug: true })
    await playTurn(page, 'act one', 1)
    await playTurn(page, 'act two', 2)

    const prompt = page.locator(DEBUG_PROMPT)
    await expect(prompt).not.toContainText('[mock] turn 2: act two')
    // 正向控制：上一回合的正文（走历史，不走上游）还在 —— 证明这一条测的是上游那一格
    await expect(prompt).toContainText('[mock] turn 1: act one')
  })

  test('首节点的上游眼睛不可点（SPEC §2：首节点 readsUpstream=false）', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await page.locator('[data-node-id="time"]').click()
    const upstream = page.locator('[data-node-upstream]')
    await expect(upstream).toHaveAttribute('data-on', 'false')
    await expect(upstream).toHaveAttribute('aria-disabled', 'true')
  })
})

test.describe('眼睛：拼装顺序', () => {
  test('prompt 里 提示词 → 状态 → 历史（含本回合行动）→ 本节点 的先后关系成立', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const full = (await page.locator(DEBUG_PROMPT).textContent()) ?? ''
    // 调试面板按节点分段（`[node:<id>]`，CONTRACT §8.3）—— 顺序只能在**一个节点**里判：
    // 时间 / 判定 / 校对 的 historyTurns 都是 0，它们的块里也带这一句行动（口径 A），
    // 拿整块 indexOf 比会被前一个节点打断。
    const sectionOf = (nodeId) => {
      const head = `[node:${nodeId}]`
      const start = full.indexOf(head)
      if (start < 0) return null
      const rest = full.slice(start + head.length)
      const next = rest.indexOf('[node:')
      return next < 0 ? rest : rest.slice(0, next)
    }
    const output = sectionOf('output')
    expect(output, '调试面板要按 [node:<id>] 分段（CONTRACT §8.3）').not.toBeNull()

    const at = (mark) => output.indexOf(mark)
    for (const mark of ['BODY_ONE', 'BODY_TWO', 'VAL_PLACE_A1', 'act one', 'NODE_OUT']) {
      expect(at(mark), `${mark} 没进输出节点的 prompt`).toBeGreaterThanOrEqual(0)
    }
    expect(at('BODY_ONE')).toBeLessThan(at('BODY_TWO'))
    expect(at('BODY_TWO')).toBeLessThan(at('VAL_PLACE_A1'))
    // 行动是历史块的最后一条（不是独立的一段）⇒ 它在状态之后、本节点提示词之前
    expect(at('VAL_PLACE_A1')).toBeLessThan(at('act one'))
    expect(at('act one')).toBeLessThan(at('NODE_OUT'))
    expect((output.match(/act one/g) ?? []).length, '行动在历史块里只出现一次').toBe(1)

    // 口径 A 再钉一条：historyTurns=0 的节点**也**看得见行动（只此一句，不重复）
    const time = sectionOf('time')
    expect(time, '每个节点都该有自己那一段').not.toBeNull()
    expect(time, 'historyTurns=0 也要看见本回合行动（口径 A）').toContain('act one')
    expect((time.match(/act one/g) ?? []).length, '行动在历史块里只出现一次').toBe(1)
  })
})
