// @vitest-environment jsdom
/**
 * 票 55 契约（一）：**工具调用行**的摘要只留「是什么」。
 *
 * 判据来源：`.team/test/2026-09-17/contract-55.md` §2–§4。两行各自独立 —— 这是**这一行**的用例表。
 * 那两行由生产路径写出来（`runTurnWithArgs` 跑一个真回合），测试不自己拼 `t(...)`：
 * 自己拼一份，断言到的只是测试造的那个对象。
 *
 * 选元素按 **kind** 这个结构化字段（`details.trace.tool`），不按文案找。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StoryPanel from '../src/components/StoryPanel.vue'
import { label, setLocale } from './support/trace-blocks'
import {
  argsOfLength,
  LONG_ARGS,
  PREVIEW_CUT_KEY,
  PREVIEW_LIMIT,
  previewOf,
  runTurnWithArgs,
  TAIL_SENTINEL,
  TOOL,
} from './support/trace-summary'
import type { DebugRow } from './support/trace-summary'

/** 这一行的折叠条（渲染出来的摘要行）与折叠里的原文，都按 kind 选 */
function mountRow(row: DebugRow) {
  return mount(StoryPanel, { props: { rows: [row], status: null } })
}

/** 模板套上「上限 + 标记」个字符 = 这条摘要行的天花板（模板或语言换了它跟着换） */
function ceiling(): number {
  const cut = label(PREVIEW_CUT_KEY).length
  return label('toolbar.toolCall', {
    tool: TOOL,
    args: 'x'.repeat(PREVIEW_LIMIT + cut),
  }).length
}

describe('the tool call line keeps only a preview', () => {
  it('puts the head of the arguments on the line and leaves the tail in the fold', async () => {
    const { tool } = await runTurnWithArgs(LONG_ARGS)

    // 前置：源串真的比上限长，否则下面几条会在空转
    expect(LONG_ARGS.length, 'the fixture must be longer than the limit').toBeGreaterThan(PREVIEW_LIMIT)
    expect(tool.detail, 'the payload is what the protocol gave, verbatim').toBe(LONG_ARGS)

    expect(tool.text, 'the line is the template with the preview in it').toBe(
      label('toolbar.toolCall', { tool: TOOL, args: previewOf(LONG_ARGS) }),
    )
    expect(tool.text, 'the tail only lives in the fold').not.toContain(TAIL_SENTINEL)
    expect(tool.text.length, 'and the line has an upper bound').toBeLessThanOrEqual(ceiling())
  })

  it('leaves an argument that is exactly the limit alone', async () => {
    const exact = argsOfLength(PREVIEW_LIMIT)
    expect(exact.length, 'the fixture really is exactly the limit').toBe(PREVIEW_LIMIT)
    const { tool } = await runTurnWithArgs(exact)

    expect(tool.text, 'nothing is cut at the limit').toBe(
      label('toolbar.toolCall', { tool: TOOL, args: exact }),
    )
    expect(tool.text, 'and no marker shows up').not.toContain(label(PREVIEW_CUT_KEY))
  })

  it('draws a short line and keeps every byte one fold away', async () => {
    const { tool } = await runTurnWithArgs(LONG_ARGS)
    const w = mountRow(tool)

    expect(
      w.find('details.trace.tool > summary').text().length,
      'the drawn line has an upper bound',
    ).toBeLessThanOrEqual(ceiling() + label('story.rawToggle').length)
    expect(
      w.find('details.trace.tool > pre').element.textContent,
      'and the fold still carries the payload byte for byte',
    ).toBe(LONG_ARGS)
  })

  it('holds in English too', async () => {
    // 语言要在跑回合**之前**切：文案是写痕迹那一刻定下来的数据
    setLocale('en')
    const { tool } = await runTurnWithArgs(LONG_ARGS)

    expect(tool.text, 'the English line is the English template with the preview').toBe(
      label('toolbar.toolCall', { tool: TOOL, args: previewOf(LONG_ARGS) }),
    )
    expect(tool.text.length, 'and it has an upper bound in English as well').toBeLessThanOrEqual(ceiling())
  })
})
