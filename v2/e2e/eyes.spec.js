/**
 * SPEC §9.3：**眼睛控制提示词拼装**。
 *
 * 三种眼睛，三种落点（CONTRACT §8.2）：
 *   · 公共提示词块 → **右栏** `[data-prompt-read][data-prompt-id]`；
 *   · 状态元素 → **左栏** `[data-eyes="read"]`；
 *   · 上游节点 → **工作流细条**上、只有排在前面那些节点才有 `[data-read-upstream][data-upstream-id]`。
 *
 * ⚠️ 跑的是**存档快照**（§8.3），所以每一条都是：改卡里的眼睛 → **新建存档** → 跑 → 看 prompt。
 *    拿旧存档去验眼睛会永远看不到变化 —— 那不是 bug，是快照语义。
 * 断言找的是**只住在那一处的记号**（BODY_ONE / VAL_PLACE_A1 / `[mock] turn N:` / 路由回的正文），
 * 所以「找不到」等价于「真的没读它」，不会被别处的同样文字蒙过去。
 *
 * 上游那两条走**真 provider 路径**（`page.route` 顶替服务商）：mock 只有 output 有正文，
 * 拿 mock 证不了「上游正文进没进提示词」。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  createSave,
  debugPrompt,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  openAiSse,
  openStory,
  playTurn,
  promptRead,
  readStorage,
  route,
  slowMock,
  upstreamRead,
} from './support/app.js'

const CARD_ID = 'c1'
/** 调试面板是按节点分段的：读某个节点的 prompt 必须带节点那一格（§8.3） */
const OUTPUT_PROMPT = debugPrompt('output')

/** 一个「真」预设：请求会被 `page.route` 拦掉，不联外网 */
const REAL_PRESET = {
  ...slowMock(0),
  id: 'p-real',
  name: 'real',
  provider: 'openai-compatible',
  baseUrl: 'https://mock.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
}

/** 种一张卡 + 一个预设（不种存档：眼睛要在「快照之前」改） */
function seedCardOnly() {
  const card = makeCard()
  return { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] }
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

test.describe('眼睛：公共提示词块（右栏）', () => {
  test('关掉 pr1 的读眼睛 ⇒ 它的正文从 prompt 里消失，pr2 还在', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    // 正向控制：先确认默认是读的
    expect(await toggleEye(page, { nodeId: 'output', selector: promptRead('pr1') })).toBe('true')

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(OUTPUT_PROMPT)
    await expect(prompt).not.toContainText('BODY_ONE')
    await expect(prompt).toContainText('BODY_TWO')
    await expect(prompt).toContainText('NODE_OUT')
  })

  test('把 pr1 再打开 ⇒ 正文回来（不是「永远都不在」）', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    await toggleEye(page, { nodeId: 'output', selector: promptRead('pr1') })
    await toggleEye(page, { nodeId: 'output', selector: promptRead('pr1') })

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)
    await expect(page.locator(OUTPUT_PROMPT)).toContainText('BODY_ONE')
  })
})

test.describe('眼睛：状态元素（左栏）', () => {
  test('关掉元素 1 的读眼睛 ⇒ 它这一回合的值从 prompt 里消失，元素 2 还在', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    await toggleEye(page, { nodeId: 'output', selector: '[data-state-item="1"] [data-eyes="read"]' })

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(OUTPUT_PROMPT)
    // 元素 1 这一回合已被判定节点写成 mock-t1（同一回合内可见，P2）⇒ 关掉眼睛就该一个字符都不剩
    await expect(prompt).not.toContainText('mock-t1')
    await expect(prompt).not.toContainText('VAL_PLACE_A1')
    await expect(prompt).toContainText('VAL_MOOD_B2')
  })

  test('眼睛打开时，元素 1 的值是**这一回合刚写进去的**那份（不是初值）', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(OUTPUT_PROMPT)
    await expect(prompt, '判定节点这一回合写的值要立刻进输出节点的提示词').toContainText('mock-t1')
    await expect(prompt).not.toContainText('VAL_PLACE_A1')
  })
})

test.describe('眼睛：上游输出（工作流细条）', () => {
  /**
   * 让真 provider 路径按**请求顺序**回不同正文：1 time / 2 check / 3 extra / 4 output。
   * 这样输出节点的提示词里有没有上游正文、按什么顺序，都能逐字判。
   */
  async function stubProviderByNode(page) {
    const texts = { 0: 'TIME_TEXT', 1: 'CHECK_TEXT', 2: 'EXTRA_TEXT', 3: 'OUTPUT_TEXT' }
    const requests = []
    await page.route('**/chat/completions', async (intercepted) => {
      const body = JSON.stringify(intercepted.request().postDataJSON())
      requests.push(body)
      const index = requests.length - 1
      await intercepted.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: openAiSse([texts[index]]),
      })
    })
    return requests
  }

  test('默认名单（check + extra）：两个上游正文都进输出节点的提示词，按链顺序；没点名的 time 不进', async ({
    page,
  }) => {
    await stubProviderByNode(page)
    const card = makeCard()
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [REAL_PRESET] },
    })
    await openStory(page, CARD_ID, 's1', { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(OUTPUT_PROMPT)
    await expect(prompt).toContainText('CHECK_TEXT')
    await expect(prompt).toContainText('EXTRA_TEXT')
    // 链顺序：check 在 extra 之前（名单里的先后不管用）
    const text = (await prompt.textContent()) ?? ''
    expect(text.indexOf('CHECK_TEXT'), 'check 的上游正文不在 extra 之前').toBeLessThan(
      text.indexOf('EXTRA_TEXT'),
    )
    // 输出节点只点名了 check + extra ⇒ time 的正文不许进来
    await expect(prompt).not.toContainText('TIME_TEXT')
    // 正向控制：这一趟的正文确实是从真 provider 那一条路来的
    await expect(page.locator('[data-line="narration"]')).toHaveText('OUTPUT_TEXT')
  })

  test('关掉 check 的上游眼睛 ⇒ 它的正文不进 prompt；extra 还在（正向控制）', async ({ page }) => {
    await stubProviderByNode(page)
    const card = makeCard()
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [REAL_PRESET] },
    })
    // 默认是读的 ⇒ 点一下关掉
    expect(await toggleEye(page, { nodeId: 'output', selector: upstreamRead('check') })).toBe('true')

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const prompt = page.locator(OUTPUT_PROMPT)
    await expect(prompt).not.toContainText('CHECK_TEXT')
    await expect(prompt).toContainText('EXTRA_TEXT')
  })

  test('打开回来 ⇒ check 的正文又进 prompt', async ({ page }) => {
    await stubProviderByNode(page)
    const card = makeCard()
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [REAL_PRESET] },
    })
    await toggleEye(page, { nodeId: 'output', selector: upstreamRead('check') })
    await toggleEye(page, { nodeId: 'output', selector: upstreamRead('check') })

    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)
    await expect(page.locator(OUTPUT_PROMPT)).toContainText('CHECK_TEXT')
  })
})

test.describe('眼睛：细条上的上游眼睛只长在「前面」的节点上', () => {
  test('选中输出节点 ⇒ 三个上游各一颗；选中判定节点 ⇒ 只有时间那一颗；选中首节点 ⇒ 一颗都没有', async ({
    page,
  }) => {
    await boot(page, { storage: seedCardOnly() })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()

    // S0：没选节点 ⇒ 一颗都没有
    await expect(page.locator('[data-read-upstream]')).toHaveCount(0)

    await page.locator('[data-node-id="output"]').click()
    const eyes = page.locator('[data-read-upstream]')
    await expect(eyes).toHaveCount(3)
    for (const upstreamId of ['time', 'check', 'extra']) {
      await expect(page.locator(upstreamRead(upstreamId))).toHaveCount(1)
    }
    // 自己（output）没有上游眼睛
    await expect(page.locator(upstreamRead('output'))).toHaveCount(0)

    await page.locator('[data-node-id="check"]').click()
    await expect(eyes).toHaveCount(1)
    await expect(page.locator(upstreamRead('time'))).toHaveCount(1)
    // 下游的 output / extra 不是 check 的上游
    await expect(page.locator(upstreamRead('output'))).toHaveCount(0)
    await expect(page.locator(upstreamRead('extra'))).toHaveCount(0)

    await page.locator('[data-node-id="time"]').click()
    await expect(eyes, '首节点没有任何上游').toHaveCount(0)
  })

  test('点一下上游眼睛：翻面并把这条 id 写进 / 拿出选中节点的 readsUpstream', async ({ page }) => {
    await boot(page, { storage: seedCardOnly() })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await page.locator('[data-node-id="output"]').click()

    const eye = page.locator(upstreamRead('check'))
    await expect(eye).toHaveAttribute('data-on', 'true')
    await eye.click()
    await expect(eye).toHaveAttribute('data-on', 'false')

    let stored = (await readStorage(page, KEYS.cards))[0]
    let output = stored.chain.find((node) => node.id === 'output')
    expect(output.readsUpstream, '关掉之后名单里不该还有 check').not.toContain('check')
    expect(output.readsUpstream, '别的上游不许被顺手删掉').toContain('extra')

    await eye.click()
    await expect(eye).toHaveAttribute('data-on', 'true')
    stored = (await readStorage(page, KEYS.cards))[0]
    output = stored.chain.find((node) => node.id === 'output')
    expect(output.readsUpstream).toContain('check')
  })
})

test.describe('眼睛：拼装顺序', () => {
  test('输出节点的 prompt 里 提示词 → 状态 → 历史（含本回合行动）→ 本节点 的先后关系成立', async ({
    page,
  }) => {
    await boot(page, { storage: seedCardOnly() })
    const saveId = await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, saveId, { debug: true })
    await playTurn(page, 'act one', 1)

    const output = (await page.locator(OUTPUT_PROMPT).textContent()) ?? ''
    const at = (mark) => output.indexOf(mark)
    // 状态段用**没被这一回合写过**的元素 2 当锚（元素 1 已被判定节点写成 mock-t1，P2）
    for (const mark of ['BODY_ONE', 'BODY_TWO', 'VAL_MOOD_B2', 'mock-t1', 'act one', 'NODE_OUT']) {
      expect(at(mark), `${mark} 没进输出节点的 prompt`).toBeGreaterThanOrEqual(0)
    }
    expect(at('BODY_ONE')).toBeLessThan(at('BODY_TWO'))
    expect(at('BODY_TWO')).toBeLessThan(at('VAL_MOOD_B2'))
    // 行动是历史块的最后一条（不是独立的一段）⇒ 它在状态之后、本节点提示词之前
    expect(at('VAL_MOOD_B2')).toBeLessThan(at('act one'))
    expect(at('act one')).toBeLessThan(at('NODE_OUT'))
    expect((output.match(/act one/g) ?? []).length, '行动在历史块里只出现一次').toBe(1)

    // 口径 A 再钉一条：historyTurns=0 的节点**也**看得见行动（只此一句，不重复）
    const time = (await page.locator(debugPrompt('time')).textContent()) ?? ''
    expect(time, 'historyTurns=0 也要看见本回合行动（口径 A）').toContain('act one')
    expect((time.match(/act one/g) ?? []).length, '行动在历史块里只出现一次').toBe(1)
  })
})
