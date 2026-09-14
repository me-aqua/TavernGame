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
  OPENING_INSTRUCTION,
  FORCED_NARRATION_INSTRUCTION,
  TOOL_CALLS_WITHOUT_NARRATION,
  CONNECTION_TEST_PROMPT,
} from '../src/core/prompts'
import { GameState } from '../src/core/state'
import { createInitialState } from '../src/core/persistence'
import { t } from '../src/i18n'

// 测试直接读源文件：断言的是**内容本身**（中文版，与 src/core/prompts.ts 当前取的语言一致）
// 注意：提示词按语言分目录（prompts/<lang>/），路径必须带语言段。
// en/ 与 zh-CN/ 文件同名：正文语义用 ASCII 的英文版断言，
// 中文版用来核对 src 导出的常量（常量就是文件原文）。
const readPrompt = (lang: string, name: string): string => readFileSync(`prompts/${lang}/${name}.md`, 'utf8')

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
    const state = new GameState(createInitialState())
    const prompt = buildSystemPrompt(state, [])
    expect(prompt).not.toMatch(/\n{3,}/)
    expect(toolsPrompt()).not.toMatch(/\n{3,}/)
  })

  it('toolsPrompt fills its placeholders and names the only tool', () => {
    const result = toolsPrompt()
    expect(result).toContain('advance_time')
    expect(result).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })

  it('buildSystemPrompt splices in the tools, the calendar and the world state', () => {
    const state = new GameState(createInitialState())
    const prompt = buildSystemPrompt(state, [])
    expect(prompt).toContain('advance_time')
    expect(prompt).toContain(calendarMarkdown.trim())
    for (const heading of systemHeadings) {
      expect(prompt).toContain(heading)
    }
    expect(prompt).toContain(t('snapshot.turn', { turn: 0 }))
    expect(prompt).toContain(state.timeLabel)
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })

  it('shows recent events in the snapshot when a history is passed in', () => {
    const state = new GameState(createInitialState())
    const prompt = buildSystemPrompt(state, [
      { role: 'user', content: PLAYER_ACTION },
      { role: 'assistant', content: GM_REPLY },
    ])
    expect(prompt).toContain(t('snapshot.recent'))
    expect(prompt).toContain(t('snapshot.recentLine', { who: t('snapshot.player'), text: PLAYER_ACTION }))
  })
})

describe('standalone instructions', () => {
  it('the opening instruction starts the story directly, without meta questions', () => {
    expect(OPENING_INSTRUCTION).toBe(openingMarkdown)
    expect(openingMarkdownEn).toContain('Do not ask meta questions')
    expect(openingMarkdownEn).toContain('just start the story')
  })

  it('both narration-repair instructions ask for narration only', () => {
    for (const [instruction, markdown, markdownEn] of [
      [FORCED_NARRATION_INSTRUCTION, forcedNarrationMarkdown, forcedNarrationMarkdownEn],
      [TOOL_CALLS_WITHOUT_NARRATION, toolCallsWithoutNarrationMarkdown, toolCallsWithoutNarrationMarkdownEn],
    ] as const) {
      expect(instruction).toBe(markdown)
      expect(markdownEn).toContain('narration only')
      expect(markdownEn).toContain('do not call any more tools')
    }
  })

  it('keeps the connection test prompt short (token budget)', () => {
    expect(CONNECTION_TEST_PROMPT.length).toBeLessThan(60)
  })

  it('standalone instructions contain no placeholders (they take no arguments)', () => {
    for (const text of [
      OPENING_INSTRUCTION,
      FORCED_NARRATION_INSTRUCTION,
      TOOL_CALLS_WITHOUT_NARRATION,
      CONNECTION_TEST_PROMPT,
    ]) {
      expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/)
    }
  })
})
