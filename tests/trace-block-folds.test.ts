// @vitest-environment jsdom
/**
 * 票 55 契约（三）：块清单进来时**所有块都是折叠的**（2026-09-17 用户拍板，取代票 53 §4-1）。
 *
 * 两条行（模型输入 / 模型原始回复）都一样。请求行那一半在 `tests/trace-blocks-dom.test.ts`
 * 那条改过期望的用例里；这一份守**回复行**那一半 —— 用户原话就是「两条都一样」，
 * 只守一边等于把那半句留成没断言面的口径。
 *
 * 判据：每个块元素的 `open` 属性都不在（逐块断言，不是只数几个开着）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StoryPanel from '../src/components/StoryPanel.vue'
import * as llm from '../src/agent/llm'
import { clearConfig } from '../src/agent/config'
import { fakeTracker, label, replyFrom } from './support/trace-blocks'
import type { BlockGroup } from '../src/agent/prompts'
import type { ChatReply } from '../src/agent/llm'
import type { Row } from '../src/stores/game'

const track = fakeTracker()

afterEach(() => {
  track.restoreAll()
  clearConfig()
})

const SAID = 'I will move the clock'
const TOOL_ARGUMENTS = '{"minutes":7}'
const RESPONSE = {
  usage: { total_tokens: 33 },
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        content: SAID,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'advance_time', arguments: TOOL_ARGUMENTS },
          },
        ],
      },
    },
  ],
}

/** 一条回复行的调试数据：分块来自生产路径（`replyBlocks`），界面只负责画 */
function replyRow(groups: BlockGroup[], reply: ChatReply): Row {
  return {
    id: 1,
    kind: 'model',
    text: label('store.rawReply'),
    detail: JSON.stringify(reply.raw, null, 2),
    blocks: groups,
    debug: true,
  }
}

describe('the reply line comes in folded', () => {
  it('opens none of its blocks', async () => {
    const reply = await replyFrom(track, RESPONSE)
    const groups = llm.replyBlocks(reply)
    const blocks = groups.flatMap((group) => group.blocks)
    // 前置：不止一块 —— 只有一块时「全都折叠」证明不了第二条行与第一条一样
    expect(blocks.length, 'the fixture must have more than one block to fold').toBeGreaterThan(1)

    const w = mount(StoryPanel, {
      props: { rows: [replyRow(groups, reply)], status: null },
    })
    const drawn = w.findAll('[data-block]')
    expect(drawn).toHaveLength(blocks.length)
    for (const [index, el] of drawn.entries()) {
      expect(
        el.attributes('open'),
        'block ' + index + ' must not be open when the line comes in',
      ).toBeUndefined()
    }
  })
})
