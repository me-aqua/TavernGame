// @vitest-environment jsdom
/**
 * 票 55 契约（二）：**工具结果行**的摘要只留「前若干字」，完整结果一个字节都不丢。
 *
 * 判据来源：`.team/test/2026-09-17/contract-55.md` §2–§3。工具调用行与这一行**各自独立**：
 * 这一份只断言结果行（另一份是 `tests/trace-tool-call.test.ts`）。
 *
 * ⚠️ 源串的锚点不是摘要自己：结果由引擎回传，而测试给进去的是那份长正文（`LONG_NOTE`）——
 *    `detail` 里必须逐字含它、摘要在上限内又放不下它，这一对才是「收短的是摘要，不是内容」。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StoryPanel from '../src/components/StoryPanel.vue'
import { label, setLocale } from './support/trace-blocks'
import {
  LONG_ARGS,
  LONG_NOTE,
  PREVIEW_CUT_KEY,
  PREVIEW_LIMIT,
  previewOf,
  runTurnWithArgs,
  SHORT_ARGS,
  TAIL_SENTINEL,
} from './support/trace-summary'
import type { DebugRow } from './support/trace-summary'

/** 这一行的折叠条与折叠里的原文，都按 kind 选（不按文案找） */
function mountRow(row: DebugRow) {
  return mount(StoryPanel, { props: { rows: [row], status: null } })
}

/** 模板套上「上限 + 标记」个字符 = 这条摘要行的天花板（模板或语言换了它跟着换） */
function ceiling(): number {
  const cut = label(PREVIEW_CUT_KEY).length
  return label('store.toolResultLine', {
    result: 'x'.repeat(PREVIEW_LIMIT + cut),
  }).length
}

/** 折叠起来的那份结果原文；没有它，这一行的判据全都在空转 */
function detailOf(row: DebugRow): string {
  const detail = row.detail
  if (detail === undefined) throw new Error('the tool result row carries no payload')
  return detail
}

describe('the tool result line keeps only a preview', () => {
  it('puts the head of the result on the line and ends it with the cut marker', async () => {
    const { result } = await runTurnWithArgs(LONG_ARGS)
    const detail = detailOf(result)
    const cut = label(PREVIEW_CUT_KEY)

    // 前置：折叠里是**引擎回传的完整结果**（含测试给进去的那段长正文），而它比上限长
    expect(detail, 'the fold carries the engine result verbatim').toContain(LONG_NOTE)
    expect(detail, 'including its tail').toContain(TAIL_SENTINEL)
    expect(detail.length, 'the result must be longer than the limit').toBeGreaterThan(PREVIEW_LIMIT)

    expect(result.text, 'the line is the template with the preview in it').toBe(
      label('store.toolResultLine', { result: previewOf(detail) }),
    )
    expect(result.text.endsWith(cut), 'the line ends with the cut marker: ' + result.text).toBe(true)
    expect(result.text, 'the tail only lives in the fold').not.toContain(TAIL_SENTINEL)
    expect(result.text.length, 'and the line has an upper bound').toBeLessThanOrEqual(ceiling())
  })

  it('leaves a result that fits on the line alone', async () => {
    const { result } = await runTurnWithArgs(SHORT_ARGS)
    const detail = detailOf(result)
    expect(detail.length, 'this fixture really produces a short result').toBeLessThanOrEqual(PREVIEW_LIMIT)

    expect(result.text, 'a short result is not cut').toBe(label('store.toolResultLine', { result: detail }))
    expect(result.text, 'and no marker shows up').not.toContain(label(PREVIEW_CUT_KEY))
  })

  it('draws a line that carries the marker, and keeps every byte one fold away', async () => {
    const { result } = await runTurnWithArgs(LONG_ARGS)
    const detail = detailOf(result)
    const w = mountRow(result)
    const line = w.find('details.trace.toolResult > summary').text()

    expect(line, 'the drawn line carries the cut marker: ' + line).toContain(label(PREVIEW_CUT_KEY))
    expect(line.length, 'the drawn line has an upper bound').toBeLessThanOrEqual(
      ceiling() + label('story.rawToggle').length,
    )
    expect(
      w.find('details.trace.toolResult > pre').element.textContent,
      'and the fold still carries the result byte for byte',
    ).toBe(detail)
  })

  it('holds in English too', async () => {
    // 语言要在跑回合**之前**切：文案是写痕迹那一刻定下来的数据
    setLocale('en')
    const { result } = await runTurnWithArgs(LONG_ARGS)
    const detail = detailOf(result)

    expect(result.text, 'the English line is the English template with the preview').toBe(
      label('store.toolResultLine', { result: previewOf(detail) }),
    )
    expect(result.text.length, 'and it has an upper bound in English as well').toBeLessThanOrEqual(ceiling())
  })
})
