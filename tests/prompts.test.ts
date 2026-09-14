/**
 * 提示词测试。
 *
 * 提示词是这个项目的「游戏逻辑」（doc/DESIGN.md：提示词 = 作者控制 AI 的代码）。
 *
 * ⚠️ 原生 tool calling 之后，提示词里**不再**教模型怎么写工具块 ——
 *    格式由 API 的 tools schema 约束。所以这里断言的重点变成：
 *    何时该调用工具（这部分仍在提示词里）、装配不会漏参数、内容编码干净。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  renderPrompt,
  toolsPrompt,
  buildSystemPrompt,
  openingInstruction,
  forcedNarrationInstruction,
  toolCallsWithoutNarration,
  connectionTestPrompt,
} from '../src/agent/prompts'
import * as game from '../src/game/state'
import type { AgentContext } from '../src/agent/agent'
import type { ChatMessage } from '../src/types/state'
import { i18n, t } from '../src/i18n'

/**
 * buildSystemPrompt 现在接的是 AgentContext（state + 三个动作），不再直接接 GameState。
 * 测试只需要 snapshot 那条路径，其余动作给最小实现 —— 这样提示词装配可以单独测。
 */
function testContext(s: game.GameState): AgentContext {
  return {
    state: s,
    addLog: (kind, text) => game.addLog(s, kind, text),
    endTurn: () => void game.endTurn(s),
    snapshot: (history: ChatMessage[]) => game.snapshot(s, history),
  }
}

// 测试直接读源文件：断言的是**内容本身**（与 src/agent/prompts.ts 取的语言一致）
// 注意：提示词按语言分目录（prompts/<lang>/），路径必须带语言段。
// en/ 与 zh-CN/ 文件同名：正文语义用 ASCII 的英文版断言，
// 中文版用来核对 src 导出的常量（常量就是文件原文）。
// 末尾的 .trim() 是关键：renderPrompt 的契约是「填完占位符后 trim」，
// 所以装配结果与文件原文会差一个末尾换行 —— 这里对奇两侧的形状。
const readPrompt = (lang: string, name: string): string =>
  readFileSync(`prompts/${lang}/${name}.md`, 'utf8').trim()

const systemMarkdown = readPrompt('zh-CN', 'system')
const toolsMarkdown = readPrompt('zh-CN', 'tools')
const toolsMarkdownEn = readPrompt('en', 'tools')
const calendarMarkdown = readPrompt('zh-CN', 'calendar')
const openingMarkdown = readPrompt('zh-CN', 'opening')
const openingMarkdownEn = readPrompt('en', 'opening')
const forcedNarrationMarkdown = readPrompt('zh-CN', 'forced-narration')
const forcedNarrationMarkdownEn = readPrompt('en', 'forced-narration')
const toolCallsWithoutNarrationMarkdown = readPrompt('zh-CN', 'tool-calls-without-narration')
const toolCallsWithoutNarrationMarkdownEn = readPrompt('en', 'tool-calls-without-narration')

// system.md 的二级标题（正文不在 locale 表里，只能从模板文件本身取）
const systemHeadings = systemMarkdown.split('\n').filter((line) => line.startsWith('## '))

// 测试自己编的 fixture（玩家行动、模型回复）
const PLAYER_ACTION = 'I go to the docks'
const GM_REPLY = 'The sea wind tastes of salt.'

describe('prompt files (prompts/)', () => {
  it('has no BOM, no invalid UTF-8 and no CRLF', () => {
    for (const [name, text] of [
      ['system.md', systemMarkdown],
      ['tools.md', toolsMarkdown],
    ] as const) {
      expect(text.charCodeAt(0), `${name} has a BOM`).not.toBe(0xfeff)
      expect(text.includes('\uFFFD'), `${name} has invalid bytes`).toBe(false)
      expect(text.includes('\r'), `${name} contains CRLF`).toBe(false)
    }
  })

  it('system.md declares every placeholder it uses (TOOLS / CALENDAR / SNAPSHOT)', () => {
    for (const key of ['TOOLS', 'CALENDAR', 'SNAPSHOT']) {
      expect(systemMarkdown).toContain(`{{${key}}}`)
    }
  })

  it('no longer teaches a text tool-block format (that is the schema job)', () => {
    // 协议时代提示词里不该再出现「工具块」这类文本协议概念：没有代码围栏，
    // 英文版也没有对应的说法（中文短语不写进代码，直接查协议标记本身）
    for (const text of [toolsMarkdown, toolsMarkdownEn]) {
      expect(text).not.toContain('```')
    }
    expect(toolsMarkdownEn).not.toContain('tool block')
    expect(toolsMarkdownEn).not.toContain('tool call format')
  })

  it('says that crossing time requires calling the tool', () => {
    expect(toolsMarkdownEn).toContain('you must call it')
    expect(toolsMarkdownEn).toMatch(/not optional/)
  })
})

describe('renderPrompt', () => {
  it('fills placeholders', () => {
    expect(renderPrompt('Hello {{name}}!', { name: 'world' })).toBe('Hello world!')
  })

  it('replaces every occurrence of the same placeholder', () => {
    expect(renderPrompt('{{X}} and {{X}}', { X: 'a' })).toBe('a and a')
  })

  it('throws when a placeholder is left unfilled (never send {{X}} to the model)', () => {
    expect(() => renderPrompt('Hello {{missing}}', { unrelated: 'x' })).toThrow(
      t('prompts.unfilled', { names: '{{missing}}' }),
    )
  })
})

describe('assembled prompt', () => {
  it('collapses runs of blank lines (what the model sees must be clean)', () => {
    const state = game.initialState()
    const prompt = buildSystemPrompt(testContext(state), [])
    expect(prompt).not.toMatch(/\n{3,}/)
    expect(toolsPrompt()).not.toMatch(/\n{3,}/)
  })

  it('toolsPrompt fills its placeholders and names the only tool', () => {
    const result = toolsPrompt()
    expect(result).toContain('advance_time')
    expect(result).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })

  it('buildSystemPrompt splices in the tools, the calendar and the world state', () => {
    const state = game.initialState()
    const prompt = buildSystemPrompt(testContext(state), [])
    expect(prompt).toContain('advance_time')
    expect(prompt).toContain(calendarMarkdown.trim())
    for (const heading of systemHeadings) {
      expect(prompt).toContain(heading)
    }
    expect(prompt).toContain(t('snapshot.turn', { turn: 0 }))
    expect(prompt).toContain(game.timeLabel(state))
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })

  it('shows recent events in the snapshot when a history is passed in', () => {
    const state = game.initialState()
    const prompt = buildSystemPrompt(testContext(state), [
      { role: 'user', content: PLAYER_ACTION },
      { role: 'assistant', content: GM_REPLY },
    ])
    expect(prompt).toContain(t('snapshot.recent'))
    expect(prompt).toContain(t('snapshot.recentLine', { who: t('snapshot.player'), text: PLAYER_ACTION }))
  })
})

describe('standalone instructions', () => {
  it('the opening instruction starts the story directly, without meta questions', () => {
    expect(openingInstruction()).toBe(openingMarkdown)
    expect(openingMarkdownEn).toContain('Do not ask meta questions')
    expect(openingMarkdownEn).toContain('just start the story')
  })

  it('both narration-repair instructions ask for narration only', () => {
    for (const [instruction, markdown, markdownEn] of [
      [forcedNarrationInstruction(), forcedNarrationMarkdown, forcedNarrationMarkdownEn],
      [toolCallsWithoutNarration(), toolCallsWithoutNarrationMarkdown, toolCallsWithoutNarrationMarkdownEn],
    ] as const) {
      expect(instruction).toBe(markdown)
      expect(markdownEn).toContain('narration only')
      expect(markdownEn).toContain('do not call any more tools')
    }
  })

  it('keeps the connection test prompt short (token budget)', () => {
    expect(connectionTestPrompt().length).toBeLessThan(60)
  })

  it('standalone instructions contain no placeholders (they take no arguments)', () => {
    for (const text of [
      openingInstruction(),
      forcedNarrationInstruction(),
      toolCallsWithoutNarration(),
      connectionTestPrompt(),
    ]) {
      expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/)
    }
  })
})

describe('model language follows the UI language', () => {
  /**
   * ⚠️ 这条测试是补上一个**假通过**：早先只断言「en 与 zh 两版不同」，
   * 而 buildSystemPrompt 里的快照标签走 t()，光靠它就能让两版不同 ——
   * 提示词正文其实一直写死 zh-CN。所以这里必须断言**正文本身**。
   */
  it('switches the whole system prompt body when the locale changes', () => {
    const state = game.initialState()
    const set = (v: string) => ((i18n.global.locale as unknown as { value: string }).value = v)

    set('zh-CN')
    const zh = buildSystemPrompt(testContext(state))
    const zhTools = toolsPrompt()
    const zhSnapshotTurn = t('snapshot.turn', { turn: 0 })

    set('en')
    const en = buildSystemPrompt(testContext(state))
    const enTools = toolsPrompt()
    const enSnapshotTurn = t('snapshot.turn', { turn: 0 })

    expect(
      zhSnapshotTurn,
      'the snapshot label must differ per locale, or the assertions below are vacuous',
    ).not.toBe(enSnapshotTurn)

    // 正文：中文版有中文字符，英文版没有（工具名 advance_time 两边都有）
    expect(zhTools, 'zh tools must contain CJK').toMatch(/[\u4e00-\u9fff]/)
    expect(enTools, 'en tools must be ASCII English').not.toMatch(/[\u4e00-\u9fff]/)
    expect(zh, 'zh system must contain CJK').toMatch(/[\u4e00-\u9fff]/)
    expect(en, 'en system must be ASCII English').not.toMatch(/[\u4e00-\u9fff]/)

    // 两边都必须带上工具名与世界状态（换语言不能丢掉结构）。
    // ⚠️ 世界状态的文字本身也跟随语言（时间标签、场景名都走 t()），
    //    所以这里用「各自语言下该有的那份」来断言，而不是同一个值。
    expect(zhTools).toContain('advance_time')
    expect(enTools).toContain('advance_time')
    expect(zh, 'the zh prompt must still carry the world-state heading').toContain(zhSnapshotTurn)
    expect(en, 'the en prompt must still carry the world-state heading').toContain(enSnapshotTurn)
  })

  it('picks the matching language for the standalone instructions too', () => {
    const set = (v: string) => ((i18n.global.locale as unknown as { value: string }).value = v)

    set('zh-CN')
    expect(openingInstruction()).toMatch(/[\u4e00-\u9fff]/)
    set('en')
    expect(openingInstruction()).not.toMatch(/[\u4e00-\u9fff]/)

    set('zh-CN')
    expect(forcedNarrationInstruction()).toMatch(/[\u4e00-\u9fff]/)
    set('en')
    expect(forcedNarrationInstruction()).not.toMatch(/[\u4e00-\u9fff]/)

    set('en')
    expect(connectionTestPrompt().length).toBeLessThan(60)
  })
})
