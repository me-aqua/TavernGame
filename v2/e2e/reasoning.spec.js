/**
 * 思考读数（CONTRACT §4.5 / §8.3）：provider 的 `delta.reasoning_content` 要进该节点的 `trace.thinking`，
 * 调试开着时在 trace 卡片里单独一段 `[data-trace-thinking]`；**没有思考就不画那一段**（空段不占一行）。
 *
 * 为什么单独一份：这一条只能走真 provider 路径 —— mock 一律不吐思考（§7「不 fake thinking」），
 * 用 mock 永远测不到「思考进来了没有」。SSE 由 `page.route` 顶替服务商，不联外网。
 */
import { expect, test } from '@playwright/test'
import { boot, KEYS, makeCard, makeSave, openStory, playTurn, slowMock } from './support/app.js'

const CARD_ID = 'c1'

/** 一个「真」预设：请求会被 `page.route` 拦掉 */
const REAL_PRESET = {
  ...slowMock(0),
  id: 'p-real',
  name: 'real',
  provider: 'openai-compatible',
  baseUrl: 'https://mock.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
}

function seeded() {
  const card = makeCard()
  return { [KEYS.cards]: [card], [KEYS.saves]: [makeSave(card)], [KEYS.presets]: [REAL_PRESET] }
}

/** OpenAI 风格的一帧（`delta` 里放 content / reasoning_content） */
function chunk(delta) {
  return JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fake-model',
    choices: [{ index: 0, delta, finish_reason: null }],
  })
}

/** 把若干帧拼成 SSE 正文（补一个 finish 帧与 [DONE]） */
function sseOf(frames) {
  const finish = JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fake-model',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })
  return [...frames, finish].map((frame) => `data: ${frame}\n\n`).join('') + 'data: [DONE]\n\n'
}

/** 四个节点都回同一段（节点顺序：time / check / extra / output；只有 output 的正文进故事流） */
async function stubProvider(page, body) {
  const requests = []
  await page.route('**/chat/completions', async (intercepted) => {
    requests.push(intercepted.request().url())
    await intercepted.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body,
    })
  })
  return requests
}

test.describe('思考：reasoning_content 进 trace，与正文分开', () => {
  test('思考增量拼进 [data-trace-thinking]，正文仍在 [data-trace-output]（两者不混）', async ({ page }) => {
    const requests = await stubProvider(
      page,
      sseOf([
        chunk({ reasoning_content: 'THINK_ONE ' }),
        chunk({ reasoning_content: 'THINK_TWO' }),
        chunk({ content: 'OUTPUT_TEXT' }),
      ]),
    )
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1', { debug: true })
    await playTurn(page, 'act one', 1)

    expect(requests, '四个节点各一次调用').toHaveLength(4)
    const outputCard = page.locator('[data-trace][data-trace-node="output"]')
    const thinking = outputCard.locator('[data-trace-thinking]')
    await expect(thinking, 'reasoning_content 没有进 trace.thinking').toContainText('THINK_ONE')
    await expect(thinking).toContainText('THINK_TWO')
    await expect(outputCard.locator('[data-trace-output]')).toHaveText('OUTPUT_TEXT')

    // 分开：思考段里没有正文，正文段里没有思考
    expect((await thinking.textContent()) ?? '', '思考段混进了正文').not.toContain('OUTPUT_TEXT')
    await expect(outputCard.locator('[data-trace-output]'), '正文段混进了思考').not.toContainText('THINK_ONE')
    // 叙事只拿正文
    await expect(page.locator('[data-line="narration"]').last()).toHaveText('OUTPUT_TEXT')
  })

  test('没有 reasoning_content ⇒ 不画 [data-trace-thinking]（空段不占一行）', async ({ page }) => {
    await stubProvider(page, sseOf([chunk({ content: 'OUTPUT_TEXT' })]))
    await boot(page, { storage: seeded() })
    await openStory(page, CARD_ID, 's1', { debug: true })
    await playTurn(page, 'act one', 1)

    await expect(page.locator('[data-trace][data-trace-node="output"] [data-trace-output]')).toHaveText(
      'OUTPUT_TEXT',
    )
    await expect(page.locator('[data-trace-thinking]'), '没思考却画了空框').toHaveCount(0)
  })
})
