/**
 * SPEC §9.8：**流式可停止** + 「真 provider 那条路」的接口形状。
 *
 * 两条路都要走一遍，缺一条都不算验过：
 *   ① `provider:'mock'` —— 没 Key、没网络的机器上也能看见「一段一段出、可停止、停止后存档不动」；
 *   ② `provider:'openai-compatible'` —— 用 `page.route` 顶替服务商，钉住**请求长什么样**
 *      （`POST {baseUrl}/chat/completions`、`stream:true`、Bearer 头、一节点一次调用）与
 *      SSE 增量能被拼成正文。真 key 那一步只能人工验收（留一格给组长）。
 */
import { expect, test } from '@playwright/test'
import {
  boot,
  createSave,
  KEYS,
  makeCard,
  makeSave,
  openAiSse,
  openStory,
  playTurn,
  readStorage,
  slowMock,
} from './support/app.js'

const CARD_ID = 'c1'

test.describe('mock 提供方：流式与停止', () => {
  test('发送后正文一段段长出来，期间「停止」在、输入框禁用；完成自动存档', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [slowMock(40)] },
    })
    await openStory(page, CARD_ID, 's1')

    await page.locator('[data-action-input]').fill('act one')
    await page.locator('[data-send]').click()

    const stop = page.locator('[data-stop]')
    await expect(stop).toBeVisible()
    await expect(page.locator('[data-action-input]')).toBeDisabled()

    // 半截文本：先看见它存在，再看见它变长（至少两段）
    const narration = page.locator('[data-line="narration"]')
    await expect(narration).toHaveCount(1)
    const lengthOf = async () => ((await narration.textContent()) ?? '').length
    const first = await lengthOf()
    await expect.poll(lengthOf, { timeout: 10_000 }).toBeGreaterThan(first)

    await expect(stop).toHaveCount(0)
    await expect(page.locator('[data-action-input]')).toBeEnabled()
    await expect(narration).toHaveText('[mock] turn 1: act one')
    await expect(page.locator('[data-turn]')).toHaveText('1')
    expect((await readStorage(page, KEYS.saves))[0].turn).toBe(1)
  })

  test('点「停止」：本轮丢弃、回合数不动、存档一个字节没写、草稿还在输入框里', async ({ page }) => {
    const card = makeCard()
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [slowMock(60)] },
    })
    await openStory(page, CARD_ID, 's1')

    await page.locator('[data-action-input]').fill('act one')
    await page.locator('[data-send]').click()
    await expect(page.locator('[data-stop]')).toBeVisible()
    await page.locator('[data-stop]').click()

    await expect(page.locator('[data-stop]')).toHaveCount(0)
    await expect(page.locator('[data-action-input]')).toBeEnabled()
    await expect(page.locator('[data-action-input]')).toHaveValue('act one')
    await expect(page.locator('[data-line="action"]')).toHaveCount(0)
    await expect(page.locator('[data-line="narration"]')).toHaveCount(0)
    await expect(page.locator('[data-turn]')).toHaveText('0')

    await page.reload()
    await expect(page.locator('[data-turn]')).toHaveText('0')
    const save = (await readStorage(page, KEYS.saves))[0]
    expect(save.turn).toBe(0)
    expect(save.events).toEqual([])
  })
})

test.describe('openai-compatible：请求形状与 SSE 增量', () => {
  test('四个节点各发一次请求；流式增量拼成正文；Bearer 头与 stream:true 都在', async ({ page }) => {
    const realPreset = {
      ...slowMock(0),
      id: 'p-real',
      name: 'real',
      provider: 'openai-compatible',
      baseUrl: 'https://mock.invalid/v1',
      apiKey: 'test-key',
      model: 'fake-model',
    }
    const card = makeCard()

    const requests = []
    await page.route('**/chat/completions', async (route) => {
      requests.push({
        url: route.request().url(),
        method: route.request().method(),
        headers: route.request().headers(),
        body: route.request().postDataJSON(),
      })
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: openAiSse(['ALPHA', 'BETA', 'GAMMA']),
      })
    })

    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [realPreset] },
    })
    await createSave(page, CARD_ID)
    await openStory(page, CARD_ID, (await readStorage(page, KEYS.saves))[0].id)
    await playTurn(page, 'act one', 1)

    // 请求形状
    expect(requests.length, '一个节点一次调用（CONTRACT §4.2）').toBe(4)
    for (const request of requests) {
      expect(request.url).toBe('https://mock.invalid/v1/chat/completions')
      expect(request.method).toBe('POST')
      expect(request.headers.authorization).toBe('Bearer test-key')
      expect(request.body.stream).toBe(true)
      expect(request.body.model).toBe('fake-model')
      expect(Array.isArray(request.body.messages)).toBe(true)
      expect(request.body.messages.length).toBeGreaterThan(0)
    }
    // 行动逐字进了**每一跳**的请求，而且每一跳只有一次 —— 它只在历史块里（口径 A）：
    // historyTurns=0 的节点也看得见行动，但**没有**第二条独立的行动段。
    const occurrencesOf = (value) => (JSON.stringify(value).match(/act one/g) ?? []).length
    expect(occurrencesOf(requests[3].body), '输出节点的历史块里要有行动').toBe(1)
    for (const [index, request] of requests.entries()) {
      expect(occurrencesOf(request.body), `第 ${index + 1} 跳的行动出现次数`).toBe(1)
    }

    // 三段增量拼成正文（不是等整段回来再写）
    await expect(page.locator('[data-line="narration"]')).toHaveText('ALPHABETAGAMMA')
  })
})
