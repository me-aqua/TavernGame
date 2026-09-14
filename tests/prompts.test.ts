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

// 测试直接读源文件：断言的是**内容本身**（编码是否同步由 npm run prompts:check 负责）
const systemMarkdown = readFileSync('prompts/system.md', 'utf8')
const toolsMarkdown = readFileSync('prompts/tools.md', 'utf8')

describe('提示词文件（prompts/）', () => {
  it('不含 BOM、不含非法 UTF-8、不含 CRLF', () => {
    for (const [name, text] of [
      ['system.md', systemMarkdown],
      ['tools.md', toolsMarkdown],
    ] as const) {
      expect(text.charCodeAt(0), `${name} 带 BOM`).not.toBe(0xfeff)
      expect(text.includes('\uFFFD'), `${name} 有非法字节`).toBe(false)
      expect(text.includes('\r'), `${name} 含 CRLF`).toBe(false)
    }
  })

  it('system.md 的占位符都已声明（TOOLS / CALENDAR / SNAPSHOT）', () => {
    for (const key of ['TOOLS', 'CALENDAR', 'SNAPSHOT']) {
      expect(systemMarkdown).toContain(`{{${key}}}`)
    }
  })

  it('⚠️ 不再教模型写工具块的格式（那是 schema 的职责）', () => {
    // 协议时代提示词里不该再出现「工具块」这类文本协议概念
    expect(toolsMarkdown).not.toContain('工具块')
    expect(toolsMarkdown).not.toContain('```tool')
    expect(toolsMarkdown).not.toContain('工具调用格式')
  })

  it('明确写了「时间过去了就必须调用工具」', () => {
    expect(toolsMarkdown).toContain('必须调用')
    expect(toolsMarkdown).toMatch(/不是可选项/)
  })
})

describe('renderPrompt', () => {
  it('替换占位符', () => {
    expect(renderPrompt('你好 {{名字}}！', { 名字: '世界' })).toBe('你好 世界！')
  })

  it('同一个占位符出现多次也会全替换', () => {
    expect(renderPrompt('{{X}} 和 {{X}}', { X: 'a' })).toBe('a 和 a')
  })

  it('⚠️ 有占位符没填就抛错（绝不把 {{X}} 发给模型）', () => {
    expect(() => renderPrompt('你好 {{漏掉的}}', { 别的不相关: 'x' })).toThrow(/未填的占位符/)
  })
})

describe('装配结果', () => {
  it('⚠️ 折叠了连续空行（发给模型的东西要干净）', () => {
    const state = new GameState(createInitialState())
    const prompt = buildSystemPrompt(state, [])
    expect(prompt).not.toMatch(/\n{3,}/)
    expect(toolsPrompt()).not.toMatch(/\n{3,}/)
  })

  it('toolsPrompt 填好了占位符，且提到唯一的工具名', () => {
    const result = toolsPrompt()
    expect(result).toContain('advance_time')
    expect(result).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })

  it('buildSystemPrompt 拼进工具、历法、世界状态', () => {
    const state = new GameState(createInitialState())
    const prompt = buildSystemPrompt(state, [])
    expect(prompt).toContain('advance_time')
    expect(prompt).toContain('## 时间设定')
    expect(prompt).toContain('## 当前世界状态')
    expect(prompt).toContain('【第 0 回合】')
    expect(prompt).toContain(state.timeLabel)
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })

  it('传入历史时，快照里能看到最近发生的事', () => {
    const state = new GameState(createInitialState())
    const prompt = buildSystemPrompt(state, [
      { role: 'user', content: '我去码头' },
      { role: 'assistant', content: '海风很咸。' },
    ])
    expect(prompt).toContain('最近发生的事')
    expect(prompt).toContain('玩家：我去码头')
  })
})

describe('独立提示词', () => {
  it('开场指令要求直接开始故事，不问元问题', () => {
    expect(OPENING_INSTRUCTION).toContain('不要问')
    expect(OPENING_INSTRUCTION).toContain('直接开始故事')
  })

  it('两条补写指令都要求只写叙事', () => {
    for (const text of [FORCED_NARRATION_INSTRUCTION, TOOL_CALLS_WITHOUT_NARRATION]) {
      expect(text).toContain('只写叙事')
      expect(text).toContain('不要再调用')
    }
  })

  it('连接测试提示词很短（省 token）', () => {
    expect(CONNECTION_TEST_PROMPT.length).toBeLessThan(60)
  })

  it('独立提示词都不含占位符（它们没有可填的参数）', () => {
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
